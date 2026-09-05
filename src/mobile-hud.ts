const STORAGE_KEY = 'nekogpt:relationship-context-v1';
const APPROX_CONTEXT_TOKENS = 32768;

type StoredContext = { chars: number; hashes: string[] };

let installed = false;
let reportedPercent: number | null = null;
let intervalId = 0;

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function readStoredContext(): StoredContext {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<StoredContext>;
    return {
      chars: Number.isFinite(parsed.chars) ? Math.max(0, Number(parsed.chars)) : 0,
      hashes: Array.isArray(parsed.hashes)
        ? parsed.hashes.filter((item): item is string => typeof item === 'string').slice(-500)
        : [],
    };
  } catch {
    return { chars: 0, hashes: [] };
  }
}

function saveStoredContext(value: StoredContext) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ chars: value.chars, hashes: value.hashes.slice(-500) }));
  } catch {
    // Storage may be unavailable in restricted browser contexts.
  }
}

function contextLabel(percent: number) {
  const lang = document.documentElement.lang.toLowerCase();
  if (lang.startsWith('pt')) return `Relacionamento · contexto do chat ${percent}%`;
  if (lang.startsWith('es')) return `Relación · contexto del chat ${percent}%`;
  return `Relationship · chat context ${percent}%`;
}

function micLabel(active: boolean) {
  const lang = document.documentElement.lang.toLowerCase();
  if (lang.startsWith('pt')) return active ? 'Microfone ativado' : 'Microfone desativado';
  if (lang.startsWith('es')) return active ? 'Micrófono activado' : 'Micrófono desactivado';
  return active ? 'Microphone enabled' : 'Microphone disabled';
}

function ensureGauge(screen: HTMLElement) {
  let gauge = screen.querySelector<HTMLElement>('.relationship-gauge');
  if (gauge) return gauge;

  gauge = document.createElement('div');
  gauge.className = 'relationship-gauge';
  gauge.setAttribute('role', 'img');
  gauge.innerHTML = `
    <span class="relationship-gauge__track">
      <img class="relationship-gauge__base" src="/gauge-base.png" alt="" aria-hidden="true" />
      <span class="relationship-gauge__fill"><img src="/gauge-active-01.png" alt="" aria-hidden="true" /></span>
    </span>
    <img class="relationship-gauge__heart" src="/hp-icon-base.png" alt="" aria-hidden="true" />
  `;
  screen.appendChild(gauge);
  return gauge;
}

function updateGauge(percent: number) {
  const gauge = document.querySelector<HTMLElement>('.relationship-gauge');
  if (!gauge) return;
  const cleanPercent = clampPercent(percent);
  const fill = gauge.querySelector<HTMLElement>('.relationship-gauge__fill');
  const heart = gauge.querySelector<HTMLImageElement>('.relationship-gauge__heart');
  if (fill) fill.style.width = `${1.88 * cleanPercent}px`;
  if (heart) heart.src = cleanPercent >= 100 ? '/hp-icon-active.png' : '/hp-icon-base.png';
  gauge.dataset.percent = String(cleanPercent);
  gauge.setAttribute('aria-label', contextLabel(cleanPercent));
  gauge.title = contextLabel(cleanPercent);
}

function getReportedContextPercent() {
  if (reportedPercent !== null) return reportedPercent;
  const source = document.querySelector<HTMLElement>('[data-context-percent]');
  const value = Number(source?.dataset.contextPercent);
  return Number.isFinite(value) ? clampPercent(value) : null;
}

function scanContext() {
  const direct = getReportedContextPercent();
  if (direct !== null) {
    updateGauge(direct);
    return;
  }

  const stored = readStoredContext();
  const hashes = new Set(stored.hashes);
  let chars = stored.chars;
  const messageLines = Array.from(
    document.querySelectorAll<HTMLElement>('.history-messages .app-message-line, .floating-messages .app-message-line'),
  );

  for (const line of messageLines) {
    if (line.classList.contains('is-dialogue-typing') || line.getAttribute('aria-busy') === 'true') continue;
    const text = Array.from(line.querySelectorAll<HTMLElement>('.app-message-content'))
      .map((node) => node.textContent || '')
      .join('\n')
      .trim();
    if (!text) continue;
    const role = line.classList.contains('app-message-line--assistant') ? 'assistant' : 'user';
    const hash = hashText(`${role}:${text}`);
    if (hashes.has(hash)) continue;
    hashes.add(hash);
    chars += text.length;
  }

  const nextStored = { chars, hashes: Array.from(hashes).slice(-500) };
  saveStoredContext(nextStored);
  updateGauge(((chars / 4) / APPROX_CONTEXT_TOKENS) * 100);
}

function syncMicTrigger() {
  const source = document.querySelector<HTMLButtonElement>('.floating-composer .control-mic-button');
  const trigger = document.querySelector<HTMLButtonElement>('.mic-trigger');
  if (!trigger) return;
  const active = Boolean(source?.classList.contains('is-active'));
  const listening = Boolean(source?.classList.contains('is-listening'));
  const processing = Boolean(source?.classList.contains('is-processing'));
  trigger.classList.toggle('is-ready', active);
  trigger.classList.toggle('is-listening', listening);
  trigger.classList.toggle('is-processing', processing);
  trigger.setAttribute('aria-pressed', active ? 'true' : 'false');
  trigger.setAttribute('aria-label', micLabel(active));
  trigger.title = micLabel(active);
}

function forwardMicClick() {
  const source = document.querySelector<HTMLButtonElement>('.floating-composer .control-mic-button');
  if (!source) return;

  // The bottom disc is visually repurposed as the ×1/×2/×3 text-speed control.
  // Temporarily remove its selector so the dialogue-speed capture listener does
  // not consume this synthetic click; React still receives the button click and
  // executes the real microphone toggle.
  source.classList.remove('control-mic-button');
  try {
    source.click();
  } finally {
    source.classList.add('control-mic-button');
  }
  window.setTimeout(syncMicTrigger, 0);
}

function ensureMicTrigger(screen: HTMLElement) {
  let trigger = screen.querySelector<HTMLButtonElement>('.mic-trigger');
  if (trigger) return trigger;

  trigger = document.createElement('button');
  trigger.className = 'mic-trigger';
  trigger.type = 'button';
  trigger.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="3" width="7" height="12" rx="3.5"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6"/></svg>';
  trigger.addEventListener('click', forwardMicClick);
  screen.appendChild(trigger);
  syncMicTrigger();
  return trigger;
}

function tickHud() {
  const screen = document.querySelector<HTMLElement>('.companion-screen');
  if (!screen) return;
  ensureGauge(screen);
  ensureMicTrigger(screen);
  syncMicTrigger();
  scanContext();
}

export function installMobileHud() {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  window.addEventListener('nekogpt:context-percent', ((event: Event) => {
    const custom = event as CustomEvent<{ percent?: number }>;
    const value = Number(custom.detail?.percent);
    if (!Number.isFinite(value)) return;
    reportedPercent = clampPercent(value);
    updateGauge(reportedPercent);
  }) as EventListener);

  const start = () => {
    tickHud();
    if (intervalId) window.clearInterval(intervalId);
    intervalId = window.setInterval(tickHud, 700);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}