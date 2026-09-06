const CORE_SCRIPT_URLS = [
  '/vendor/live2d/live2dcubismcore.min.js',
  'https://cdn.jsdelivr.net/gh/inobushi3/Nekogpt-mobile@main/public/vendor/live2d/live2dcubismcore.min.js',
] as const;

const LEGACY_CORE_SCRIPT_URLS = [
  '/vendor/live2d/live2d.min.js',
  'https://cdn.jsdelivr.net/gh/inobushi3/Nekogpt-mobile@main/public/vendor/live2d/live2d.min.js',
] as const;

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
      const handleLoad = () => {
        if (ready()) resolve();
        else reject(new Error(`${src} foi carregado, mas o runtime Live2D não iniciou.`));
      };
      existing.addEventListener('load', handleLoad, { once: true });
      existing.addEventListener('error', () => reject(new Error(`Falha ao carregar ${src}.`)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    script.dataset.runtimeSource = src;
    script.onload = () => {
      script.dataset.loaded = 'true';
      if (ready()) {
        resolve();
        return;
      }
      script.dataset.loadFailed = 'true';
      reject(new Error(`${src} foi carregado, mas o runtime Live2D não iniciou.`));
    };
    script.onerror = () => {
      script.dataset.loadFailed = 'true';
      reject(new Error(`Falha ao carregar ${src}.`));
    };
    document.head.appendChild(script);
  });
}

async function loadScriptWithFallback(
  id: string,
  sources: readonly string[],
  ready: () => boolean,
) {
  if (ready()) return;

  let lastError: unknown = null;
  for (const src of sources) {
    try {
      await loadScript(id, src, ready);
      if (ready()) return;
    } catch (error) {
      lastError = error;
      const current = document.getElementById(id) as HTMLScriptElement | null;
      if (current && !ready()) current.remove();
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'Runtime Live2D indisponível.';
  throw new Error(message);
}

export function loadLive2DRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      await Promise.all([
        loadScriptWithFallback('cubism-core', CORE_SCRIPT_URLS, () => Boolean((window as any).Live2DCubismCore)),
        loadScriptWithFallback('live2d-legacy-core', LEGACY_CORE_SCRIPT_URLS, () => Boolean((window as any).Live2D)),
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
