const SPEED_STORAGE_KEY = 'nekogpt:dialogue-text-speed';
const BASE_CHARACTERS_PER_SECOND = 18;
const SPEED_VALUES = [1, 2, 3] as const;
const INITIAL_DIALOGUE_SETTLE_MS = 1100;
const RECENT_ANIMATION_GUARD_MS = 5000;

type DialogueSpeed = (typeof SPEED_VALUES)[number];

type ActiveDialogueAnimation = {
  id: string;
  sourceTexts: string[];
  graphemeSets: string[][];
  signature: string;
  total: number;
  revealed: number;
  carry: number;
  previous: number;
  row: HTMLElement | null;
};

let speed: DialogueSpeed = readSavedSpeed();
let installed = false;
let observer: MutationObserver | null = null;
let dialogueLive = false;
let settleTimer: number | null = null;
let animationFrame: number | null = null;
let activeAnimation: ActiveDialogueAnimation | null = null;
let lastFinishedSignature = '';
let lastFinishedAt = 0;
const animatedRows = new WeakSet<HTMLElement>();

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

function latestAssistantRow() {
  const rows = document.querySelectorAll<HTMLElement>('.floating-messages .app-message-line--assistant');
  return rows.length ? rows[rows.length - 1] : null;
}

function animationSignature(sourceTexts: string[]) {
  return sourceTexts.join('\u241e');
}

function visibleTextForSpan(graphemes: string[], remaining: number) {
  const visibleCount = Math.max(0, Math.min(graphemes.length, remaining));
  return graphemes.slice(0, visibleCount).join('');
}

function clearAnimationDecorations(row: HTMLElement | null) {
  if (!row) return;
  row.removeAttribute('aria-busy');
  row.classList.remove('is-dialogue-typing');
  row.removeAttribute('data-dialogue-animation-id');
  row.querySelectorAll<HTMLElement>('.app-message-content').forEach((span) => {
    span.removeAttribute('data-dialogue-visible');
  });
}

function bindAnimationToCurrentRow(animation: ActiveDialogueAnimation) {
  let row = animation.row;
  if (!row?.isConnected || !row.matches('.floating-messages .app-message-line--assistant')) {
    row = latestAssistantRow();
  }
  if (!row) return null;

  if (animation.row && animation.row !== row) clearAnimationDecorations(animation.row);
  animation.row = row;
  animatedRows.add(row);
  row.dataset.dialogueAnimationId = animation.id;
  row.setAttribute('aria-busy', 'true');
  row.classList.add('is-dialogue-typing');

  const spans = Array.from(row.querySelectorAll<HTMLElement>('.app-message-content'));
  let remaining = animation.revealed;
  for (let index = 0; index < spans.length; index += 1) {
    const graphemes = animation.graphemeSets[index] || [];
    spans[index].dataset.dialogueVisible = visibleTextForSpan(graphemes, remaining);
    remaining -= graphemes.length;
  }
  return row;
}

function cancelAnimationFrameIfNeeded() {
  if (animationFrame === null) return;
  window.cancelAnimationFrame(animationFrame);
  animationFrame = null;
}

function finishActiveAnimation() {
  const animation = activeAnimation;
  if (!animation) return;
  cancelAnimationFrameIfNeeded();
  bindAnimationToCurrentRow(animation);
  clearAnimationDecorations(animation.row);
  lastFinishedSignature = animation.signature;
  lastFinishedAt = performance.now();
  activeAnimation = null;
  document.documentElement.classList.remove('dialogue-animation-active');
  document.dispatchEvent(new CustomEvent('nekogpt:dialogue-animation-end'));
}

function stepActiveAnimation(now: number) {
  const animation = activeAnimation;
  if (!animation) {
    animationFrame = null;
    return;
  }

  const deltaMs = Math.min(80, Math.max(0, now - animation.previous));
  animation.previous = now;
  animation.carry += (deltaMs * BASE_CHARACTERS_PER_SECOND * speed) / 1000;
  const increment = Math.floor(animation.carry);
  if (increment > 0) {
    animation.carry -= increment;
    animation.revealed = Math.min(animation.total, animation.revealed + increment);
  }

  // React re-renders this chat frequently while Live2D/TTS state changes. Never
  // keep references to the original text nodes: rebind every frame so a render,
  // history gesture or scroll cannot replace the node and cancel the reveal.
  bindAnimationToCurrentRow(animation);

  if (animation.revealed >= animation.total) {
    finishActiveAnimation();
    return;
  }

  animationFrame = window.requestAnimationFrame(stepActiveAnimation);
}

function animateAssistantRow(row: HTMLElement) {
  if (row.closest('.history-overlay')) return;
  const spans = Array.from(row.querySelectorAll<HTMLElement>('.app-message-content'));
  if (!spans.length) return;

  const sourceTexts = spans.map((span) => span.textContent || '');
  const graphemeSets = sourceTexts.map(splitGraphemes);
  const total = graphemeSets.reduce((sum, graphemes) => sum + graphemes.length, 0);
  if (!total || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    animatedRows.add(row);
    return;
  }

  const signature = animationSignature(sourceTexts);
  const now = performance.now();
  if (signature === lastFinishedSignature && now - lastFinishedAt < RECENT_ANIMATION_GUARD_MS) {
    animatedRows.add(row);
    return;
  }

  if (activeAnimation) finishActiveAnimation();

  animatedRows.add(row);
  activeAnimation = {
    id: `dialogue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sourceTexts,
    graphemeSets,
    signature,
    total,
    revealed: 0,
    carry: 0,
    previous: performance.now(),
    row,
  };

  document.documentElement.classList.add('dialogue-animation-active');
  bindAnimationToCurrentRow(activeAnimation);
  document.dispatchEvent(new CustomEvent('nekogpt:dialogue-animation-start'));
  cancelAnimationFrameIfNeeded();
  animationFrame = window.requestAnimationFrame(stepActiveAnimation);
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
      assistantRows.forEach((row) => animatedRows.add(row));
      scheduleDialogueLiveMode();
    } else if (userRows.length) {
      activateDialogueLiveMode();
    }
  } else if (!activeAnimation && assistantRows.length) {
    const newest = assistantRows[assistantRows.length - 1];
    if (!animatedRows.has(newest)) animateAssistantRow(newest);
  }

  // If React replaced the active row during any unrelated state update, the
  // next animation frame rebinds it. Keeping the document lock active here also
  // closes the tiny timing gap before the next frame.
  if (activeAnimation) document.documentElement.classList.add('dialogue-animation-active');
  syncSpeedButton();
}

function handleComposerSubmit(event: SubmitEvent) {
  const form = event.target instanceof Element ? event.target.closest<HTMLFormElement>('.floating-composer') : null;
  if (!form) return;
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
