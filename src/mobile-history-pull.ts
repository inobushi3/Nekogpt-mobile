let installed = false;
let pulling = false;
let inlineOpen = false;
let startX = 0;
let startY = 0;
let lastY = 0;
let revealLocked = false;
let revealLockStartedAt = 0;
let revealUnlockFrame: number | null = null;
let revealObserver: MutationObserver | null = null;

const REVEAL_SETTLE_MS = 260;
const REVEAL_MAX_LOCK_MS = 30000;

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

function cancelRevealUnlockFrame() {
  if (revealUnlockFrame === null) return;
  window.cancelAnimationFrame(revealUnlockFrame);
  revealUnlockFrame = null;
}

function releaseRevealLock() {
  revealLocked = false;
  revealLockStartedAt = 0;
  cancelRevealUnlockFrame();
  document.documentElement.classList.remove('dialogue-scroll-locked');
}

function pollRevealLock() {
  cancelRevealUnlockFrame();
  if (!revealLocked) return;

  const elapsed = performance.now() - revealLockStartedAt;
  if (elapsed >= REVEAL_MAX_LOCK_MS) {
    releaseRevealLock();
    return;
  }

  if (hasTypingRow()) {
    revealLockStartedAt = performance.now();
    revealUnlockFrame = window.requestAnimationFrame(pollRevealLock);
    return;
  }

  if (elapsed < REVEAL_SETTLE_MS) {
    revealUnlockFrame = window.requestAnimationFrame(pollRevealLock);
    return;
  }

  releaseRevealLock();
}

function beginRevealLock() {
  revealLocked = true;
  revealLockStartedAt = performance.now();
  document.documentElement.classList.add('dialogue-scroll-locked');
  cancelRevealUnlockFrame();
  revealUnlockFrame = window.requestAnimationFrame(pollRevealLock);
}

function nodeContainsAssistantRow(node: Node) {
  if (!(node instanceof HTMLElement)) return false;
  return node.matches('.floating-messages .app-message-line--assistant')
    || Boolean(node.querySelector('.floating-messages .app-message-line--assistant'));
}

function observeAssistantArrivals() {
  revealObserver?.disconnect();
  revealObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (nodeContainsAssistantRow(node)) {
          beginRevealLock();
          return;
        }
      }

      if (
        mutation.type === 'attributes'
        && mutation.target instanceof HTMLElement
        && mutation.target.matches('.floating-messages .app-message-line--assistant')
        && (mutation.attributeName === 'aria-busy' || mutation.attributeName === 'class')
      ) {
        if (hasTypingRow()) beginRevealLock();
      }
    }
  });

  revealObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-busy', 'class'],
  });
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

function handleComposerPointer(event: Event) {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('.floating-composer')) closeInlineHistory();
}

export function installMobileHistoryPull() {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  observeAssistantArrivals();
  document.addEventListener('touchstart', handleTouchStart, { capture: true, passive: false });
  document.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
  document.addEventListener('touchend', handleTouchEnd, { capture: true, passive: true });
  document.addEventListener('touchcancel', handleTouchEnd, { capture: true, passive: true });
  document.addEventListener('wheel', handleWheel, { capture: true, passive: false });
  document.addEventListener('pointerdown', handleComposerPointer, true);
  document.addEventListener('submit', closeInlineHistory, true);
}