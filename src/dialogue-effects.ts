const SPEED_STORAGE_KEY = 'nekogpt:dialogue-text-speed';
const BASE_CHARACTERS_PER_SECOND = 18;
const SPEED_VALUES = [1, 2, 3] as const;
const INITIAL_DIALOGUE_SETTLE_MS = 1100;
const DIALOGUE_START_EVENT = 'nekogpt:dialogue-animation-start';
const DIALOGUE_END_EVENT = 'nekogpt:dialogue-animation-end';

type DialogueSpeed = (typeof SPEED_VALUES)[number];

let speed: DialogueSpeed = readSavedSpeed();
let installed = false;
let observer: MutationObserver | null = null;
let dialogueLive = false;
let settleTimer: number | null = null;
const animatedRows = new WeakSet<HTMLElement>();
const activeFrames = new WeakMap<HTMLElement, number>();

function readSavedSpeed(): DialogueSpeed {
  try {
    const value = Number(localStorage.getItem(SPEED_STORAGE_KEY));
    return SPEED_VALUES.includes(value as DialogueSpeed) ? value as DialogueSpeed : 1;
  } catch {
    return 1;
  }
}

function saveSpeed(value: DialogueSpeed) {
  try {
    localStorage.setItem(SPEED_STORAGE_KEY, String(value));
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}

function nextSpeed(value: DialogueSpeed): DialogueSpeed {
  return value === 1 ? 2 : value === 2 ? 3 : 1;
}

function speedLabel(value = speed) {
  return `×${value}`;
}

function speedAriaLabel(value = speed) {
  const language = document.documentElement.lang.toLowerCase();
  if (language.startsWith('pt')) return `Velocidade do texto: ${value}x. Toque para alterar.`;
  if (language.startsWith('es')) return `Velocidad del texto: ${value}x. Toca para cambiar.`;
  return `Text speed: ${value}x. Tap to change.`;
}

function syncSpeedButton() {
  const button = document.querySelector<HTMLButtonElement>('.floating-composer .control-mic-button');
  if (!button) return;
  button.dataset.speedLabel = speedLabel();
  button.dataset.dialogueSpeed = String(speed);
  button.setAttribute('aria-label', speedAriaLabel());
  button.setAttribute('title', speedAriaLabel());
  button.setAttribute('aria-pressed', 'false');
}

function splitGraphemes(text: string) {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const Segmenter = (Intl as typeof Intl & {
      Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => {
        segment(input: string): Iterable<{ segment: string }>;
      };
    }).Segmenter;
    if (Segmenter) {
      const segmenter = new Segmenter(undefined, { granularity: 'grapheme' });
      return Array.from(segmenter.segment(text), (entry) => entry.segment);
    }
  }
  return Array.from(text);
}

/*
 * Important: never rewrite span.textContent during the reveal. React owns that
 * text and the Live2D/TTS state causes frequent React renders. Rewriting the
 * same text node from requestAnimationFrame made React restore the full string
 * on a render, producing the visible flash/cancel. The reveal now lives only in
 * a data attribute rendered by CSS, while React's real text remains untouched.
 */
function renderRevealedText(spans: HTMLElement[], graphemeSets: string[][], revealed: number) {
  let remaining = revealed;
  for (let index = 0; index < spans.length; index += 1) {
    const graphemes = graphemeSets[index];
    const visibleCount = Math.max(0, Math.min(graphemes.length, remaining));
    spans[index].dataset.dialogueVisible = graphemes.slice(0, visibleCount).join('');
    remaining -= visibleCount;
  }
}

function finishRowAnimation(row: HTMLElement, spans: HTMLElement[]) {
  spans.forEach((span) => delete span.dataset.dialogueVisible);
  row.removeAttribute('aria-busy');
  row.classList.remove('is-dialogue-typing');
  activeFrames.delete(row);
  document.dispatchEvent(new CustomEvent(DIALOGUE_END_EVENT));
}

function animateAssistantRow(row: HTMLElement) {
  if (animatedRows.has(row) || row.closest('.history-overlay')) return;
  const spans = Array.from(row.querySelectorAll<HTMLElement>('.app-message-content'));
  if (!spans.length) return;

  animatedRows.add(row);
  const graphemeSets = spans.map((span) => splitGraphemes(span.textContent || ''));
  const total = graphemeSets.reduce((sum, graphemes) => sum + graphemes.length, 0);
  if (!total || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  row.setAttribute('aria-busy', 'true');
  row.classList.add('is-dialogue-typing');
  document.dispatchEvent(new CustomEvent(DIALOGUE_START_EVENT));
  renderRevealedText(spans, graphemeSets, 0);

  let revealed = 0;
  let carry = 0;
  let previous = performance.now();

  const step = (now: number) => {
    if (!row.isConnected) {
      finishRowAnimation(row, spans);
      return;
    }

    const deltaMs = Math.min(80, Math.max(0, now - previous));
    previous = now;
    carry += (deltaMs * BASE_CHARACTERS_PER_SECOND * speed) / 1000;
    const increment = Math.floor(carry);
    if (increment > 0) {
      carry -= increment;
      revealed = Math.min(total, revealed + increment);
      renderRevealedText(spans, graphemeSets, revealed);
    }

    if (revealed >= total) {
      finishRowAnimation(row, spans);
      return;
    }
    activeFrames.set(row, window.requestAnimationFrame(step));
  };

  activeFrames.set(row, window.requestAnimationFrame(step));
}

function markAssistantRowsComplete(root: ParentNode = document) {
  root
    .querySelectorAll<HTMLElement>('.floating-messages .app-message-line--assistant')
    .forEach((row) => animatedRows.add(row));
}

function rowsFromNode(node: Node, selector: string) {
  if (!(node instanceof HTMLElement)) return [] as HTMLElement[];
  const rows: HTMLElement[] = [];
  if (node.matches(selector)) rows.push(node);
  node.querySelectorAll<HTMLElement>(selector).forEach((row) => rows.push(row));
  return rows;
}

function clearSettleTimer() {
  if (settleTimer === null) return;
  window.clearTimeout(settleTimer);
  settleTimer = null;
}

function activateDialogueLiveMode() {
  clearSettleTimer();
  markAssistantRowsComplete();
  dialogueLive = true;
}

function scheduleDialogueLiveMode() {
  clearSettleTimer();
  settleTimer = window.setTimeout(() => {
    markAssistantRowsComplete();
    dialogueLive = true;
    settleTimer = null;
  }, INITIAL_DIALOGUE_SETTLE_MS);
}

function processMutations(mutations: MutationRecord[]) {
  const assistantRows: HTMLElement[] = [];
  const userRows: HTMLElement[] = [];

  for (const mutation of mutations) {
    mutation.addedNodes.forEach((node) => {
      assistantRows.push(...rowsFromNode(node, '.floating-messages .app-message-line--assistant'));
      userRows.push(...rowsFromNode(node, '.floating-messages .app-message-line--user'));
    });
  }

  if (!dialogueLive) {
    if (assistantRows.length) {
      // Initial/history hydration can arrive after the page itself has loaded.
      // Mark that whole batch as already read so reload/reconnect never types it again.
      assistantRows.forEach((row) => animatedRows.add(row));
      scheduleDialogueLiveMode();
    } else if (userRows.length) {
      // An isolated optimistic user row means a real new turn has started.
      activateDialogueLiveMode();
    }
  } else {
    assistantRows.forEach(animateAssistantRow);
  }

  syncSpeedButton();
}

function handleComposerSubmit(event: SubmitEvent) {
  const form = event.target instanceof Element ? event.target.closest<HTMLFormElement>('.floating-composer') : null;
  if (!form) return;
  // Arm live mode before React inserts the optimistic user message. The next
  // assistant row is therefore the only row that receives the typewriter effect.
  activateDialogueLiveMode();
}

function handleSpeedClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.floating-composer .control-mic-button') : null;
  if (!target) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  speed = nextSpeed(speed);
  saveSpeed(speed);
  syncSpeedButton();
  target.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(0.92)' },
      { transform: 'scale(1)' },
    ],
    { duration: 160, easing: 'ease-out' },
  );
}

export function installDialogueEffects() {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  const start = () => {
    markAssistantRowsComplete();
    syncSpeedButton();
    document.addEventListener('submit', handleComposerSubmit, true);
    document.addEventListener('click', handleSpeedClick, true);
    observer = new MutationObserver(processMutations);
    observer.observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
