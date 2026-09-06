const CORE_SCRIPT_URL = '/vendor/live2d/live2dcubismcore.min.js';
const LEGACY_CORE_SCRIPT_URL = '/vendor/live2d/live2d.min.js';

type Live2DPerformanceProfile = {
  mobile: boolean;
  lowMemory: boolean;
  resolution: number;
  maxFps: number;
};

let runtimePromise: Promise<{
  PIXI: typeof import('pixi.js');
  engine: typeof import('untitled-pixi-live2d-engine');
}> | null = null;
let pixiPerformancePatched = false;
const contextLossProtectedCanvases = new WeakSet<HTMLCanvasElement>();

function getPerformanceProfile(): Live2DPerformanceProfile {
  const mobile = typeof window !== 'undefined'
    && (window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth <= 820);
  const deviceMemory = typeof navigator !== 'undefined'
    ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory)
    : 0;
  const lowMemory = Number.isFinite(deviceMemory) && deviceMemory > 0 && deviceMemory <= 4;
  const dpr = typeof window !== 'undefined' ? Math.max(1, Number(window.devicePixelRatio) || 1) : 1;

  return {
    mobile,
    lowMemory,
    // A DPR 2 canvas is 4x as many pixels as DPR 1. This was needlessly expensive
    // for a full-screen Live2D layer on phones. Keep desktop a little sharper while
    // mobile renders at native CSS-pixel resolution.
    resolution: mobile ? 1 : Math.min(dpr, 1.5),
    maxFps: lowMemory ? 30 : mobile ? 45 : 60,
  };
}

function protectCanvasFromContextLoss(canvas: HTMLCanvasElement | null | undefined) {
  if (!canvas || contextLossProtectedCanvases.has(canvas)) return;
  contextLossProtectedCanvases.add(canvas);
  canvas.addEventListener('webglcontextlost', (event) => {
    // Allow the browser/Pixi renderer to restore the context instead of letting a
    // transient GPU-memory event take the whole page down.
    event.preventDefault();
  }, { passive: false });
}

function patchPixiForMobile(PIXI: typeof import('pixi.js'), profile: Live2DPerformanceProfile) {
  if (pixiPerformancePatched) return;
  pixiPerformancePatched = true;

  const pixi = PIXI as any;
  const Application = pixi.Application;
  const applicationPrototype = Application?.prototype;
  const originalInit = applicationPrototype?.init;

  if (typeof originalInit === 'function') {
    applicationPrototype.init = async function initWithMobileProfile(options: Record<string, any> = {}) {
      const requestedResolution = Number(options.resolution);
      const resolution = Number.isFinite(requestedResolution) && requestedResolution > 0
        ? Math.min(requestedResolution, profile.resolution)
        : profile.resolution;
      const canvas = options.canvas instanceof HTMLCanvasElement ? options.canvas : null;

      const result = await originalInit.call(this, {
        ...options,
        // Live2D artwork already contains antialiased texture edges; multisample AA
        // mainly increases framebuffer bandwidth and memory on mobile.
        antialias: false,
        autoDensity: true,
        resolution,
        preference: 'webgl',
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
      });
      protectCanvasFromContextLoss(canvas);
      return result;
    };
  }

  // Live2DStage and the engine can both set ticker.maxFPS. Cap all Pixi tickers at
  // the device-safe value so a desktop state asking for 60 FPS cannot force a weak
  // phone to render 60 full-screen Live2D frames every second.
  const tickerPrototype = pixi.Ticker?.prototype;
  const maxFpsDescriptor = tickerPrototype
    ? Object.getOwnPropertyDescriptor(tickerPrototype, 'maxFPS')
    : undefined;
  if (maxFpsDescriptor?.get && maxFpsDescriptor.set && maxFpsDescriptor.configurable !== false) {
    Object.defineProperty(tickerPrototype, 'maxFPS', {
      ...maxFpsDescriptor,
      set(value: number) {
        const requested = Number(value);
        const safeValue = Number.isFinite(requested) && requested > 0
          ? Math.min(requested, profile.maxFps)
          : profile.maxFps;
        maxFpsDescriptor.set!.call(this, safeValue);
      },
    });
  }
}

function loadScript(id: string, src: string, ready: () => boolean) {
  if (ready()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing?.dataset.loadFailed === 'true' || (existing?.dataset.loaded === 'true' && !ready())) {
      existing.remove();
      existing = null;
    }
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Falha ao carregar ${src}.`)), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      if (ready()) resolve();
      else {
        script.dataset.loadFailed = 'true';
        reject(new Error(`${src} foi carregado, mas o runtime Live2D não iniciou.`));
      }
    };
    script.onerror = () => {
      script.dataset.loadFailed = 'true';
      reject(new Error(`Falha ao carregar ${src}.`));
    };
    document.head.appendChild(script);
  });
}

export function loadLive2DRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      await Promise.all([
        loadScript('cubism-core', CORE_SCRIPT_URL, () => Boolean((window as any).Live2DCubismCore)),
        loadScript('live2d-legacy-core', LEGACY_CORE_SCRIPT_URL, () => Boolean((window as any).Live2D)),
      ]);
      const PIXI = await import('pixi.js');
      const profile = getPerformanceProfile();
      patchPixiForMobile(PIXI, profile);
      (window as any).PIXI = PIXI;
      const engine = await import('untitled-pixi-live2d-engine');
      engine.configureCubismSDK({ memorySizeMB: 128 });

      // Do not preload every motion on phones when the engine exposes a NONE
      // strategy. Motions remain available and are loaded only when requested.
      if (profile.mobile) {
        try {
          const strategies = (engine as any).MotionPreloadStrategy;
          if (strategies && strategies.NONE !== undefined && strategies.IDLE !== undefined) {
            strategies.IDLE = strategies.NONE;
          }
        } catch {
          // Some builds freeze the enum object; IDLE remains the safe fallback.
        }
      }

      PIXI.extensions.add(engine.Live2DPlugin);
      return { PIXI, engine };
    })().catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}
