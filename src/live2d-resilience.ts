const STAGE_SELECTOR = '.live2d-stage';
const CONTEXT_RELOAD_KEY = 'nekogpt:live2d-context-reload';

let installed = false;
let syntheticResize = false;
let scheduledFrame = 0;
const observedStages = new WeakSet<HTMLElement>();
const stageObservers = new WeakMap<HTMLElement, ResizeObserver>();

function stageRect(stage: HTMLElement) {
  const rect = stage.getBoundingClientRect();
  return {
    width: Math.max(0, rect.width || stage.clientWidth || 0),
    height: Math.max(0, rect.height || stage.clientHeight || 0),
  };
}

function normalizeCanvas(stage: HTMLElement) {
  const canvas = stage.querySelector('canvas');
  if (!(canvas instanceof HTMLCanvasElement)) return;

  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.maxWidth = 'none';
  canvas.style.maxHeight = 'none';
  canvas.style.opacity = '1';
  canvas.style.visibility = 'visible';

  const { width, height } = stageRect(stage);
  if (width >= 2 && height >= 2 && (canvas.width < 2 || canvas.height < 2)) {
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.max(2, Math.round(width * dpr));
    canvas.height = Math.max(2, Math.round(height * dpr));
  }
}

function nudgeRendererResize() {
  if (syntheticResize) return;
  syntheticResize = true;
  try {
    window.dispatchEvent(new Event('resize'));
  } finally {
    queueMicrotask(() => {
      syntheticResize = false;
    });
  }
}

function repairStage(stage: HTMLElement) {
  stage.style.position = 'absolute';
  stage.style.inset = '0';
  stage.style.width = '100%';
  stage.style.height = '100%';
  stage.style.minWidth = '1px';
  stage.style.minHeight = '1px';

  const { width, height } = stageRect(stage);
  if (width < 2 || height < 2) {
    const parent = stage.parentElement;
    if (parent) {
      const parentRect = parent.getBoundingClientRect();
      if (parentRect.width >= 2) stage.style.width = `${parentRect.width}px`;
      if (parentRect.height >= 2) stage.style.height = `${parentRect.height}px`;
    }
  }

  normalizeCanvas(stage);
}

function scheduleRepair() {
  if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
  scheduledFrame = requestAnimationFrame(() => {
    scheduledFrame = 0;
    document.querySelectorAll<HTMLElement>(STAGE_SELECTOR).forEach((stage) => repairStage(stage));
    nudgeRendererResize();
    requestAnimationFrame(() => {
      document.querySelectorAll<HTMLElement>(STAGE_SELECTOR).forEach((stage) => normalizeCanvas(stage));
    });
  });
}

function attachStage(stage: HTMLElement) {
  if (observedStages.has(stage)) return;
  observedStages.add(stage);
  repairStage(stage);

  const observer = new ResizeObserver(() => {
    repairStage(stage);
    nudgeRendererResize();
  });
  observer.observe(stage);
  stageObservers.set(stage, observer);

  const canvas = stage.querySelector('canvas');
  if (canvas instanceof HTMLCanvasElement) {
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      stage.dataset.live2dContext = 'lost';
      const alreadyReloaded = sessionStorage.getItem(CONTEXT_RELOAD_KEY) === '1';
      if (!alreadyReloaded) {
        sessionStorage.setItem(CONTEXT_RELOAD_KEY, '1');
        window.setTimeout(() => window.location.reload(), 350);
      }
    });

    canvas.addEventListener('webglcontextrestored', () => {
      stage.dataset.live2dContext = 'ready';
      sessionStorage.removeItem(CONTEXT_RELOAD_KEY);
      scheduleRepair();
    });
  }
}

function scanStages() {
  document.querySelectorAll<HTMLElement>(STAGE_SELECTOR).forEach(attachStage);
}

export function installLive2DResilience() {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') return;
  installed = true;

  const mutationObserver = new MutationObserver(() => {
    scanStages();
    scheduleRepair();
  });
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true });

  const onViewportChange = () => scheduleRepair();
  window.addEventListener('resize', onViewportChange, { passive: true });
  window.addEventListener('orientationchange', onViewportChange, { passive: true });
  window.addEventListener('pageshow', onViewportChange, { passive: true });

  window.visualViewport?.addEventListener('resize', onViewportChange, { passive: true });
  window.visualViewport?.addEventListener('scroll', onViewportChange, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      sessionStorage.removeItem(CONTEXT_RELOAD_KEY);
      scheduleRepair();
      window.setTimeout(scheduleRepair, 180);
    }
  });

  scanStages();
  scheduleRepair();
}
