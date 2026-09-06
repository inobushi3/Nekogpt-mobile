const CORE_SCRIPT_URL = '/vendor/live2d/live2dcubismcore.min.js';
const LEGACY_CORE_SCRIPT_URL = '/vendor/live2d/live2d.min.js';

let runtimePromise: Promise<{
  PIXI: typeof import('pixi.js');
  engine: typeof import('untitled-pixi-live2d-engine');
}> | null = null;

const live2DApps = new Set<any>();
let performanceTimer: number | null = null;
let applicationInitPatched = false;

function getRenderProfile() {
  const mobile = typeof window !== 'undefined'
    && (window.innerWidth <= 820 || window.matchMedia?.('(pointer: coarse)').matches);
  const memory = typeof navigator !== 'undefined'
    ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory)
    : 0;
  const lowMemory = mobile && Number.isFinite(memory) && memory > 0 && memory <= 4;

  return {
    mobile,
    lowMemory,
    resolution: mobile ? (lowMemory ? 0.5 : 0.65) : 1,
    maxFps: 60,
  };
}

function setTickerToTarget(ticker: any, maxFps = 60) {
  if (!ticker) return;
  try {
    ticker.maxFPS = maxFps;
    ticker.minFPS = 10;
  } catch {}
}

function enforcePerformanceProfile(PIXI: typeof import('pixi.js')) {
  const profile = getRenderProfile();
  live2DApps.forEach((app) => setTickerToTarget(app?.ticker, profile.maxFps));
  try {
    setTickerToTarget(PIXI.Ticker?.shared, profile.maxFps);
  } catch {}
}

function installPerformanceProfile(PIXI: typeof import('pixi.js')) {
  if (!applicationInitPatched) {
    const prototype = (PIXI.Application as any)?.prototype;
    const originalInit = prototype?.init;
    if (typeof originalInit === 'function') {
      applicationInitPatched = true;
      prototype.init = async function nekogptOptimizedInit(options: Record<string, unknown> = {}) {
        const profile = getRenderProfile();
        const result = await originalInit.call(this, {
          ...options,
          antialias: false,
          autoDensity: true,
          resolution: profile.resolution,
          preference: 'webgl',
          powerPreference: 'high-performance',
          preserveDrawingBuffer: false,
          clearBeforeRender: true,
        });
        live2DApps.add(this);
        setTickerToTarget(this?.ticker, profile.maxFps);
        try {
          if (this?.stage) {
            this.stage.sortableChildren = false;
            this.stage.eventMode = 'none';
            this.stage.interactiveChildren = false;
          }
        } catch {}
        return result;
      };
    }
  }

  if (performanceTimer === null && typeof window !== 'undefined') {
    performanceTimer = window.setInterval(() => enforcePerformanceProfile(PIXI), 500);
    document.addEventListener('visibilitychange', () => {
      live2DApps.forEach((app) => {
        try {
          if (document.hidden) app?.ticker?.stop?.();
          else app?.ticker?.start?.();
        } catch {}
      });
      if (!document.hidden) enforcePerformanceProfile(PIXI);
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
      installPerformanceProfile(PIXI);
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
