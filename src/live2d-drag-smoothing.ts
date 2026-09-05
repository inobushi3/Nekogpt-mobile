let installed = false;

/**
 * The Live2D model itself is rendered by Pixi at up to 60 FPS, but mobile
 * pointer events can arrive less frequently than display frames. The model
 * therefore jumps between pointer samples even when the renderer is healthy.
 *
 * This tiny compositor bridge visually interpolates each committed drag delta
 * back to zero on the canvas layer. React/Pixi remains the source of truth for
 * the real model position; this only fills the frames between pointer samples.
 */
export function installLive2DDragSmoothing() {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  const pointers = new Map<number, { x: number; y: number }>();
  let activeStage: HTMLElement | null = null;
  let activeCanvas: HTMLCanvasElement | null = null;
  let pendingX = 0;
  let pendingY = 0;
  let flushFrame = 0;
  let currentAnimation: Animation | null = null;
  let lastSampleAt = 0;

  const cancelInterpolation = () => {
    if (flushFrame) cancelAnimationFrame(flushFrame);
    flushFrame = 0;
    pendingX = 0;
    pendingY = 0;
    currentAnimation?.cancel();
    currentAnimation = null;
  };

  const finishGesture = () => {
    cancelInterpolation();
    activeStage?.classList.remove('live2d-stage--gesture-boost');
    activeStage = null;
    activeCanvas = null;
    pointers.clear();
    lastSampleAt = 0;
  };

  const scheduleInterpolation = () => {
    if (flushFrame || !activeCanvas) return;
    flushFrame = requestAnimationFrame(() => {
      flushFrame = 0;
      const canvas = activeCanvas;
      if (!canvas || pointers.size !== 1) {
        pendingX = 0;
        pendingY = 0;
        return;
      }

      const dx = pendingX;
      const dy = pendingY;
      pendingX = 0;
      pendingY = 0;
      if (Math.abs(dx) + Math.abs(dy) < 0.35) return;

      currentAnimation?.cancel();
      const now = performance.now();
      const sampleInterval = lastSampleAt > 0 ? now - lastSampleAt : 22;
      lastSampleAt = now;
      const duration = Math.max(17, Math.min(38, sampleInterval || 22));

      if (typeof canvas.animate !== 'function') return;
      currentAnimation = canvas.animate(
        [
          { transform: `translate3d(${-dx}px, ${-dy}px, 0)` },
          { transform: 'translate3d(0, 0, 0)' },
        ],
        {
          duration,
          easing: 'linear',
          fill: 'none',
        },
      );
    });
  };

  document.addEventListener('pointerdown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const stage = target?.closest<HTMLElement>('.live2d-stage') || null;
    if (!stage) return;

    if (activeStage && activeStage !== stage) finishGesture();
    activeStage = stage;
    activeCanvas = stage.querySelector<HTMLCanvasElement>('canvas');
    activeStage.classList.add('live2d-stage--gesture-boost');
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size > 1) cancelInterpolation();
  }, true);

  document.addEventListener('pointermove', (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous || !activeStage || !activeCanvas) return;

    const coalesced = typeof event.getCoalescedEvents === 'function'
      ? event.getCoalescedEvents()
      : [];
    const sample = coalesced.length ? coalesced[coalesced.length - 1] : event;
    const next = { x: sample.clientX, y: sample.clientY };
    pointers.set(event.pointerId, next);

    if (pointers.size !== 1) {
      cancelInterpolation();
      return;
    }

    pendingX += next.x - previous.x;
    pendingY += next.y - previous.y;
    scheduleInterpolation();
  }, true);

  const endPointer = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size === 0) {
      // Let the app's own pointer-up handler commit its final transform first.
      requestAnimationFrame(finishGesture);
      return;
    }

    cancelInterpolation();
    const remaining = pointers.entries().next().value as [number, { x: number; y: number }] | undefined;
    if (remaining) pointers.set(remaining[0], remaining[1]);
  };

  document.addEventListener('pointerup', endPointer, true);
  document.addEventListener('pointercancel', endPointer, true);
  window.addEventListener('blur', finishGesture);
}
