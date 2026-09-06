const CORE_SCRIPT_URL = '/vendor/live2d/live2dcubismcore.min.js';
const LEGACY_CORE_SCRIPT_URL = '/vendor/live2d/live2d.min.js';

let runtimePromise: Promise<{
  PIXI: typeof import('pixi.js');
  engine: typeof import('untitled-pixi-live2d-engine');
}> | null = null;

let applicationInitPatched = false;
let live2DModelFactoryPatched = false;
let activeApplicationTicker: any = null;

function isMobileDevice() {
  return typeof window !== 'undefined'
    && (window.innerWidth <= 820 || window.matchMedia?.('(pointer: coarse)').matches);
}

function getDeviceMemoryGB() {
  if (typeof navigator === 'undefined') return 8;
  const value = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory);
  return Number.isFinite(value) && value > 0 ? value : 8;
}

function getRenderProfile() {
  const mobile = isMobileDevice();
  const lowMemory = mobile && getDeviceMemoryGB() <= 4;
  return {
    mobile,
    lowMemory,
    resolution: mobile ? (lowMemory ? 0.65 : 0.8) : 1,
    cubismMemoryMB: mobile ? 32 : 64,
  };
}

function installApplicationProfile(PIXI: typeof import('pixi.js')) {
  if (applicationInitPatched) return;
  const prototype = (PIXI.Application as any)?.prototype;
  const originalInit = prototype?.init;
  if (typeof originalInit !== 'function') return;

  applicationInitPatched = true;
  prototype.init = async function nekogptLive2DInit(options: Record<string, unknown> = {}) {
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

    activeApplicationTicker = this?.ticker || null;
    return result;
  };
}

function installModelFactoryProfile(
  PIXI: typeof import('pixi.js'),
  engine: typeof import('untitled-pixi-live2d-engine'),
) {
  if (live2DModelFactoryPatched) return;
  const modelClass = (engine as any)?.Live2DModel;
  const originalFrom = modelClass?.from;
  if (typeof originalFrom !== 'function') return;

  live2DModelFactoryPatched = true;
  modelClass.from = function nekogptLive2DFrom(source: unknown, options: Record<string, any> = {}) {
    return originalFrom.call(this, source, {
      ...options,
      ticker: options.ticker || activeApplicationTicker || (PIXI.Ticker as any)?.shared,
      textureOptions: {
        lod: 'single-auto',
        ...(options.textureOptions || {}),
      },
    });
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
      (window as any).PIXI = PIXI;

      const engine = await import('untitled-pixi-live2d-engine');
      const profile = getRenderProfile();
      engine.configureCubismSDK({ memorySizeMB: profile.cubismMemoryMB });
      PIXI.extensions.add(engine.Live2DPlugin);

      installApplicationProfile(PIXI);
      installModelFactoryProfile(PIXI, engine);

      return { PIXI, engine };
    })().catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}
