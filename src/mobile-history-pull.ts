let installed = false;
let pulling = false;
let inlineOpen = false;
let startX = 0;
let startY = 0;
let lastY = 0;

function historyScroller() {
  return document.querySelector<HTMLElement>('.history-messages');
}

function scrollHistoryToBottom(attempt = 0) {
  const scroller = historyScroller();
  if (scroller) {
    scroller.scrollTop = scroller.scrollHeight;
    return;
  }
  if (attempt < 10) window.requestAnimationFrame(() => scrollHistoryToBottom(attempt + 1));
}

function openInlineHistory() {
  if (inlineOpen) return;
  const bubble = document.querySelector<HTMLButtonElement>('.floating-messages button.app-message-bubble');
  if (!bubble) return;
  inlineOpen = true;
  document.documentElement.classList.add('dialogue-inline-history');
  bubble.click();
  window.requestAnimationFrame(() => scrollHistoryToBottom());
}

function closeInlineHistory() {
  if (!inlineOpen && !document.documentElement.classList.contains('dialogue-inline-history')) return;
  inlineOpen = false;
  document.documentElement.classList.remove('dialogue-inline-history');
  const close = document.querySelector<HTMLButtonElement>('.history-header button');
  close?.click();
}

function handleTouchStart(event: TouchEvent) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  if (target.closest('.floating-composer')) {
    closeInlineHistory();
    pulling = false;
    return;
  }

  if (target.closest('.history-messages')) {
    pulling = false;
    return;
  }

  if (!target.closest('.floating-messages') || event.touches.length !== 1) {
    pulling = false;
    return;
  }

  const touch = event.touches[0];
  pulling = true;
  startX = touch.clientX;
  startY = touch.clientY;
  lastY = touch.clientY;
}

function handleTouchMove(event: TouchEvent) {
  if (!pulling || event.touches.length !== 1) return;
  const touch = event.touches[0];
  const deltaX = touch.clientX - startX;
  const deltaY = touch.clientY - startY;

  if (!inlineOpen) {
    if (deltaY < 30 || Math.abs(deltaX) > Math.abs(deltaY) * 0.9) return;
    openInlineHistory();
  }

  if (!inlineOpen) return;
  event.preventDefault();
  const scroller = historyScroller();
  if (scroller) {
    const frameDelta = touch.clientY - lastY;
    scroller.scrollTop = Math.max(0, scroller.scrollTop - frameDelta);
  }
  lastY = touch.clientY;
}

function handleTouchEnd() {
  pulling = false;
}

function handleWheel(event: WheelEvent) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest('.floating-messages') || event.deltaY >= 0) return;
  openInlineHistory();
}

function handleComposerPointer(event: Event) {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('.floating-composer')) closeInlineHistory();
}

export function installMobileHistoryPull() {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  document.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
  document.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
  document.addEventListener('touchend', handleTouchEnd, { capture: true, passive: true });
  document.addEventListener('touchcancel', handleTouchEnd, { capture: true, passive: true });
  document.addEventListener('wheel', handleWheel, { capture: true, passive: true });
  document.addEventListener('pointerdown', handleComposerPointer, true);
  document.addEventListener('submit', closeInlineHistory, true);
}