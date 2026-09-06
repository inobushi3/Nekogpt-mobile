const CORE_SCRIPT_URL = '/vendor/live2d/live2dcubismcore.min.js';
const LEGACY_CORE_SCRIPT_URL = '/vendor/live2d/live2d.min.js';

let runtimePromise: Promise<{
  PIXI: typeof import('pixi.js');
  engine: typeof import('untitled-pixi-live2d-engine');
}> | null = null;

const live2DApps = new Set<any>();
let live2DPerformanceTimer: number | null = null;
let pixiInitPatched = false;

function getMobilePerformanceProfile() {
  const mobile = typeof window !== 'undefined'
    && (window.innerWidth <= 820 || window.matchMedia?.('(pointer: coarse)').matches);
  const memory = typeof navigator !== 'undefined'
    ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory)
    : 0;
  const lowMemory = Number.isFinite(memory) && memory > 0 && memory <= 4;

  return {
    mobile,
    lowMemory,
    maxFps: lowMemory ? 24 : mobile ? 30 : 60,
    resolution: lowMemory ? 0.75 : mobile ? 1 : Math.min(window.devicePixelRatio || 1, 1.5),
  };
}

function startPerformanceGuard(PIXI: typeof import('pixi.js')) {
  if (live2DPerformanceTimer !== null || typeof window === 'undefined') return;
  live2DPerformanceTimer = window.setInterval(() => {
    const profile = getMobilePerformanceProfile();
    if (!profile.mobile) return;

    live2DApps.forEach((app) => {
      try {
        if (!app?.ticker) return;
        app.ticker.maxFPS = Math.min(Number(app.ticker.maxFPS) || profile.maxFps, profile.maxFps);
        app.ticker.minFPS = Math.min(10, profile.maxFps);
      } catch {}
    });

    try {
      if (PIXI.Ticker?.shared) {
        PIXI.Ticker.shared.maxFPS = Math.min(Number(PIXI.Ticker.shared.maxFPS) || profile.maxFps, profile.maxFps);
        PIXI.Ticker.shared.minFPS = Math.min(10, profile.maxFps);
      }
    } catch {}
  }, 750);
}

function patchApplicationInit(PIXI: typeof import('pixi.js')) {
  if (pixiInitPatched) return;
  const prototype = (PIXI.Application as any)?.prototype;
  const originalInit = prototype?.init;
  if (typeof originalInit !== 'function') return;
  pixiInitPatched = true;

  prototype.init = async function nekogptMobileInit(options: Record<string, unknown> = {}) {
    const profile = getMobilePerformanceProfile();
    const nextOptions = profile.mobile
      ? {
          ...options,
          antialias: false,
          autoDensity: true,
          resolution: profile.resolution,
          powerPreference: 'high-performance',
          preference: 'webgl',
          preserveDrawingBuffer: false,
        }
      : options;

    const result = await originalInit.call(this, nextOptions);
    live2DApps.add(this);
    if (profile.mobile && this?.ticker) {
      this.ticker.maxFPS = profile.maxFps;
      this.ticker.minFPS = Math.min(10, profile.maxFps);
    }
    return result;
  };
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
      patchApplicationInit(PIXI);
      startPerformanceGuard(PIXI);
      (window as any).PIXI = PIXI;
      const engine = await import('untitled-pixi-live2d-engine');
      engine.configureCubismSDK({ memorySizeMB: 128 });
      PIXI.extensions.add(engine.Live2DPlugin);
      return { PIXI, engine };
    })().catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}
