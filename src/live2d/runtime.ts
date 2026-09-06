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
    resolution: mobile ? (lowMemory ? 0.7 : 0.85) : 1,
    cubismMemoryMB: mobile ? 32 : 64,
  };
}

function getResizeElement(value: unknown): HTMLElement | null {
  return value instanceof HTMLElement ? value : null;
}

function getValidTargetSize(target: HTMLElement | null) {
  if (!target) return null;
  const rect = target.getBoundingClientRect();
  const width = Math.max(0, rect.width || target.clientWidth || 0);
  const height = Math.max(0, rect.height || target.clientHeight || 0);
  return width >= 2 && height >= 2 ? { width, height } : null;
}

function installResponsiveApplication(app: any, resizeTo: HTMLElement | null) {
  let frame = 0;
  let destroyed = false;
  let resizeObserver: ResizeObserver | null = null;

  const resizeNow = () => {
    if (destroyed) return;
    const size = getValidTargetSize(resizeTo);
    if (!size) return;

    try {
      app?.renderer?.resize?.(Math.round(size.width), Math.round(size.height));
    } catch {}

    const canvas = app?.canvas as HTMLCanvasElement | undefined;
    if (canvas) {
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.maxWidth = 'none';
      canvas.style.maxHeight = 'none';
      canvas.style.opacity = '1';
      canvas.style.visibility = 'visible';
    }
  };

  const scheduleResize = () => {
    if (destroyed) return;
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      resizeNow();
      requestAnimationFrame(resizeNow);
    });
  };

  if (resizeTo && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(scheduleResize);
    resizeObserver.observe(resizeTo);
  }

  const onViewportChange = () => scheduleResize();
  window.addEventListener('resize', onViewportChange, { passive: true });
  window.addEventListener('orientationchange', onViewportChange, { passive: true });
  window.addEventListener('pageshow', onViewportChange, { passive: true });
  window.visualViewport?.addEventListener('resize', onViewportChange, { passive: true });

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      try {
        app?.ticker?.start?.();
      } catch {}
      scheduleResize();
      window.setTimeout(scheduleResize, 180);
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  const originalDestroy = typeof app?.destroy === 'function' ? app.destroy.bind(app) : null;
  if (originalDestroy) {
    app.destroy = (...args: any[]) => {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('orientationchange', onViewportChange);
      window.removeEventListener('pageshow', onViewportChange);
      window.visualViewport?.removeEventListener('resize', onViewportChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      return originalDestroy(...args);
    };
  }

  resizeNow();
  requestAnimationFrame(scheduleResize);
  window.setTimeout(scheduleResize, 120);
}

function installApplicationProfile(PIXI: typeof import('pixi.js')) {
  if (applicationInitPatched) return;
  const prototype = (PIXI.Application as any)?.prototype;
  const originalInit = prototype?.init;
  if (typeof originalInit !== 'function') return;

  applicationInitPatched = true;
  prototype.init = async function nekogptLive2DInit(options: Record<string, any> = {}) {
    const profile = getRenderProfile();
    const resizeTo = getResizeElement(options.resizeTo);

    const stableOptions = {
      ...options,
      antialias: false,
      autoDensity: true,
      resolution: profile.resolution,
      preference: 'webgl',
      powerPreference: 'default',
      preserveDrawingBuffer: false,
      clearBeforeRender: true,
    };

    const result = await originalInit.call(this, stableOptions);

    // Keep model updates and Pixi rendering on one clock. This prevents mobile
    // browsers from desynchronizing the Live2D update loop after page resume.
    activeApplicationTicker = this?.ticker || null;
    try {
      this?.ticker?.start?.();
    } catch {}

    installResponsiveApplication(this, resizeTo);
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
  modelClass.from = async function nekogptLive2DFrom(source: unknown, options: Record<string, any> = {}) {
    const model = await originalFrom.call(this, source, {
      ...options,
      ticker: options.ticker || activeApplicationTicker || (PIXI.Ticker as any)?.shared,
      textureOptions: {
        lod: 'single-auto',
        ...(options.textureOptions || {}),
      },
    });

    // Some WebViews resume a Pixi object as invisible/non-renderable even though
    // the model loaded correctly. Normalize these flags every time a model is created.
    if (model) {
      model.visible = true;
      model.renderable = true;
      model.alpha = 1;
      model.cullable = false;
    }

    return model;
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
