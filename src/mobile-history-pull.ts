let installed = false;
let pulling = false;
let inlineOpen = false;
let startX = 0;
let startY = 0;
let lastY = 0;
let revealLocked = false;
let revealUnlockTimer: number | null = null;

const REVEAL_RELEASE_DELAY_MS = 180;

function historyScroller() {
  return document.querySelector<HTMLElement>('.history-messages');
}

function hasTypingRow() {
  return Boolean(document.querySelector(
    '.floating-messages .app-message-line--assistant.is-dialogue-typing, '
      + '.floating-messages .app-message-line--assistant[aria-busy="true"]',
  ));
}

function isScrollLocked() {
  return revealLocked || hasTypingRow();
}

function clearRevealUnlockTimer() {
  if (revealUnlockTimer === null) return;
  window.clearTimeout(revealUnlockTimer);
  revealUnlockTimer = null;
}

function beginRevealLock() {
  clearRevealUnlockTimer();
  revealLocked = true;
  pulling = false;
  document.documentElement.classList.add('dialogue-scroll-locked');
}

function scheduleRevealUnlock() {
  clearRevealUnlockTimer();
  revealUnlockTimer = window.setTimeout(() => {
    if (hasTypingRow()) {
      scheduleRevealUnlock();
      return;
    }
    revealLocked = false;
    document.documentElement.classList.remove('dialogue-scroll-locked');
    revealUnlockTimer = null;
  }, REVEAL_RELEASE_DELAY_MS);
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
  if (inlineOpen || isScrollLocked()) return;
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

function stopGestureDuringReveal(event: Event) {
  pulling = false;
  if (event.cancelable) event.preventDefault();
  event.stopImmediatePropagation();
  event.stopPropagation();
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

  if (isScrollLocked()) {
    stopGestureDuringReveal(event);
    return;
  }

  const touch = event.touches[0];
  pulling = true;
  startX = touch.clientX;
  startY = touch.clientY;
  lastY = touch.clientY;
}

function handleTouchMove(event: TouchEvent) {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('.floating-messages') && isScrollLocked()) {
    stopGestureDuringReveal(event);
    return;
  }

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
  if (!target?.closest('.floating-messages')) return;

  if (isScrollLocked()) {
    stopGestureDuringReveal(event);
    return;
  }

  if (event.deltaY >= 0) return;
  openInlineHistory();
}

/*
 * A touch scroll can still synthesize a click on the message button on some
 * mobile browsers. That click toggles React's history overlay and was the
 * remaining source of the visible flash/cancel. Block only that generated
 * history click while the newest assistant line is being revealed.
 */
function handleMessageBubbleClick(event: MouseEvent) {
  if (!isScrollLocked()) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest('.floating-messages button.app-message-bubble')) return;
  stopGestureDuringReveal(event);
}

function handleComposerPointer(event: Event) {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('.floating-composer')) closeInlineHistory();
}

function handleDialogueAnimationStart() {
  beginRevealLock();
}

function handleDialogueAnimationEnd() {
  scheduleRevealUnlock();
}

export function installMobileHistoryPull() {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  document.addEventListener('nekogpt:dialogue-animation-start', handleDialogueAnimationStart);
  document.addEventListener('nekogpt:dialogue-animation-end', handleDialogueAnimationEnd);
  document.addEventListener('touchstart', handleTouchStart, { capture: true, passive: false });
  document.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
  document.addEventListener('touchend', handleTouchEnd, { capture: true, passive: true });
  document.addEventListener('touchcancel', handleTouchEnd, { capture: true, passive: true });
  document.addEventListener('wheel', handleWheel, { capture: true, passive: false });
  document.addEventListener('click', handleMessageBubbleClick, true);
  document.addEventListener('pointerdown', handleComposerPointer, true);
  document.addEventListener('submit', closeInlineHistory, true);
}
