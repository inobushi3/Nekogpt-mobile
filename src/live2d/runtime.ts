const CORE_SCRIPT_URL = '/vendor/live2d/live2dcubismcore.min.js';
const LEGACY_CORE_SCRIPT_URL = '/vendor/live2d/live2d.min.js';

let runtimePromise: Promise<{
  PIXI: typeof import('pixi.js');
  engine: typeof import('untitled-pixi-live2d-engine');
}> | null = null;

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
