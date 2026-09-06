const DEFAULT_CONTEXT_CHARS = 32_000;
const LM_STUDIO_CONTEXT_CHARS = 14_000;
const MOBILE_CONTEXT_HISTORY_MESSAGES = 23;

type ContextMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type RpcSignal = {
  method?: string;
  result?: unknown;
};

let installed = false;
let intervalId = 0;
let providerLabel = '';
let contextMessages: ContextMessage[] = [];

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

function normalizeContextMessages(value: unknown): ContextMessage[] {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rawMessages = Array.isArray(source.messages) ? source.messages : [];
  return rawMessages
    .map((entry) => {
      const message = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
      const role = message.role === 'assistant' ? 'assistant' : message.role === 'user' ? 'user' : null;
      const content = typeof message.content === 'string' ? message.content.trim() : '';
      return role && content ? { role, content } : null;
    })
    .filter((message): message is ContextMessage => Boolean(message))
    .slice(-MOBILE_CONTEXT_HISTORY_MESSAGES);
}

function applyHistory(value: unknown) {
  contextMessages = normalizeContextMessages(value);
  scanContext();
}

function applySnapshot(value: unknown) {
  const snapshot = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (typeof snapshot.provider === 'string') providerLabel = snapshot.provider.trim();
  scanContext();
}

function contextLimitChars() {
  return /lm\s*studio/i.test(providerLabel)
    ? LM_STUDIO_CONTEXT_CHARS
    : DEFAULT_CONTEXT_CHARS;
}

function readOptimisticDomMessages() {
  const messages: ContextMessage[] = [];
  const lines = Array.from(
    document.querySelectorAll<HTMLElement>('.history-messages .app-message-line, .floating-messages .app-message-line'),
  );

  for (const line of lines) {
    if (line.classList.contains('is-dialogue-typing') || line.getAttribute('aria-busy') === 'true') continue;
    const content = Array.from(line.querySelectorAll<HTMLElement>('.app-message-content'))
      .map((node) => node.textContent || '')
      .join('\n')
      .trim();
    if (!content) continue;
    messages.push({
      role: line.classList.contains('app-message-line--assistant') ? 'assistant' : 'user',
      content,
    });
  }

  return messages;
}

function currentEffectiveMessages() {
  const combined = [...contextMessages];
  const known = new Set(combined.map((message) => hashText(`${message.role}:${message.content}`)));

  for (const message of readOptimisticDomMessages()) {
    const hash = hashText(`${message.role}:${message.content}`);
    if (known.has(hash)) continue;
    known.add(hash);
    combined.push(message);
  }

  return combined.slice(-MOBILE_CONTEXT_HISTORY_MESSAGES);
}

function scanContext() {
  const messages = currentEffectiveMessages();
  const chars = messages.reduce((total, message) => total + message.content.length + 16, 0);
  updateGauge((chars / contextLimitChars()) * 100);
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

function handleRelaySignal(event: Event) {
  const message = (event as CustomEvent<Record<string, unknown>>).detail || {};
  if (message.type === 'companion.snapshot' || message.type === 'companion.snapshot.updated') {
    applySnapshot(message.payload);
    return;
  }
  if (message.type === 'chat.history') {
    applyHistory(message.payload);
  }
}

function handleRpcSignal(event: Event) {
  const signal = (event as CustomEvent<RpcSignal>).detail || {};
  if (signal.method === 'companion.snapshot') {
    applySnapshot(signal.result);
    return;
  }
  if (signal.method === 'companion.chat.history') {
    applyHistory(signal.result);
    return;
  }
  if (signal.method === 'chat.send') {
    const result = signal.result && typeof signal.result === 'object'
      ? signal.result as Record<string, unknown>
      : {};
    if (result.history) applyHistory(result.history);
  }
}

function handlePhaseSignal(event: Event) {
  const detail = (event as CustomEvent<{ phase?: string }>).detail;
  if (detail?.phase !== 'disconnected') return;
  providerLabel = '';
  contextMessages = [];
  updateGauge(0);
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

  window.addEventListener('nekogpt:relay-message', handleRelaySignal as EventListener);
  window.addEventListener('nekogpt:rpc-response', handleRpcSignal as EventListener);
  window.addEventListener('nekogpt:connection-phase', handlePhaseSignal as EventListener);

  const start = () => {
    tickHud();
    if (intervalId) window.clearInterval(intervalId);
    intervalId = window.setInterval(tickHud, 400);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
