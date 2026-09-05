const SPEED_STORAGE_KEY = 'nekogpt:dialogue-text-speed';
const BASE_CHARACTERS_PER_SECOND = 18;
const SPEED_VALUES = [1, 2, 3] as const;

type DialogueSpeed = (typeof SPEED_VALUES)[number];

let speed: DialogueSpeed = readSavedSpeed();
let installed = false;
let observer: MutationObserver | null = null;
let animateAfter = 0;
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

function renderRevealedText(spans: HTMLElement[], graphemeSets: string[][], revealed: number) {
  let remaining = revealed;
  for (let index = 0; index < spans.length; index += 1) {
    const graphemes = graphemeSets[index];
    const visibleCount = Math.max(0, Math.min(graphemes.length, remaining));
    spans[index].textContent = graphemes.slice(0, visibleCount).join('');
    remaining -= visibleCount;
  }
}

function finishRowAnimation(row: HTMLElement, spans: HTMLElement[], graphemeSets: string[][]) {
  renderRevealedText(spans, graphemeSets, graphemeSets.reduce((sum, graphemes) => sum + graphemes.length, 0));
  row.removeAttribute('aria-busy');
  row.classList.remove('is-dialogue-typing');
  activeFrames.delete(row);
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
  renderRevealedText(spans, graphemeSets, 0);

  let revealed = 0;
  let carry = 0;
  let previous = performance.now();

  const step = (now: number) => {
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
      finishRowAnimation(row, spans, graphemeSets);
      return;
    }
    activeFrames.set(row, window.requestAnimationFrame(step));
  };

  activeFrames.set(row, window.requestAnimationFrame(step));
}

function markExistingRowsAsComplete() {
  document
    .querySelectorAll<HTMLElement>('.floating-messages .app-message-line--assistant')
    .forEach((row) => animatedRows.add(row));
}

function processAssistantRow(row: HTMLElement) {
  if (performance.now() < animateAfter) {
    animatedRows.add(row);
    return;
  }
  animateAssistantRow(row);
}

function processAddedNode(node: Node) {
  if (!(node instanceof HTMLElement)) return;
  if (node.matches('.floating-messages .app-message-line--assistant')) processAssistantRow(node);
  node
    .querySelectorAll<HTMLElement>('.floating-messages .app-message-line--assistant')
    .forEach((row) => processAssistantRow(row));
  if (node.matches('.control-mic-button') || node.querySelector('.control-mic-button')) syncSpeedButton();
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
    animateAfter = performance.now() + 1400;
    markExistingRowsAsComplete();
    syncSpeedButton();
    document.addEventListener('click', handleSpeedClick, true);
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(processAddedNode);
      }
      syncSpeedButton();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
