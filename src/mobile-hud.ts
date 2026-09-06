const CONTEXT_TOKEN_RATIO = 4;
const CONTEXT_MESSAGE_OVERHEAD_CHARS = 16;
const CONTEXT_LIMIT_TOKENS = 8_000;
const CONTEXT_LIMIT_CHARS = CONTEXT_LIMIT_TOKENS * CONTEXT_TOKEN_RATIO;
const ATTACHMENT_IMAGE_CONTEXT_CHARS = 360;
const ATTACHMENT_PDF_CONTEXT_CHARS = 1_200;
const ATTACHMENT_FILE_CONTEXT_CHARS = 520;

type ContextAttachment = {
  mimeType?: string;
  text?: string;
};

type ContextMessage = {
  role: 'user' | 'assistant';
  content: string;
  attachments?: ContextAttachment[];
};

type RpcSignal = {
  method?: string;
  result?: unknown;
};

let installed = false;
let intervalId = 0;
let contextMessages: ContextMessage[] = [];

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeContextText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function estimateAttachmentContextChars(attachment: ContextAttachment) {
  const extractedText = normalizeContextText(attachment.text);
  if (extractedText) return extractedText.length + CONTEXT_MESSAGE_OVERHEAD_CHARS;
  const mimeType = normalizeContextText(attachment.mimeType).toLowerCase();
  if (mimeType.startsWith('image/')) return ATTACHMENT_IMAGE_CONTEXT_CHARS;
  if (mimeType === 'application/pdf') return ATTACHMENT_PDF_CONTEXT_CHARS;
  return ATTACHMENT_FILE_CONTEXT_CHARS;
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
      const content = normalizeContextText(message.content);
      const attachments = Array.isArray(message.attachments)
        ? message.attachments.map((item) => {
            const attachment = item && typeof item === 'object' ? item as Record<string, unknown> : {};
            return {
              mimeType: normalizeContextText(attachment.mimeType),
              text: normalizeContextText(attachment.text),
            };
          })
        : undefined;
      return role && content ? { role, content, attachments } : null;
    })
    .filter((message): message is ContextMessage => Boolean(message));
}

function applyHistory(value: unknown) {
  contextMessages = normalizeContextMessages(value);
  scanContext();
}

function estimateCurrentContextChars() {
  return contextMessages.reduce((total, message) => {
    const textChars = normalizeContextText(message.content).length + CONTEXT_MESSAGE_OVERHEAD_CHARS;
    const attachmentChars = (message.attachments || [])
      .reduce((sum, attachment) => sum + estimateAttachmentContextChars(attachment), 0);
    return total + textChars + attachmentChars;
  }, 0);
}

function scanContext() {
  const chars = estimateCurrentContextChars();
  updateGauge((chars / CONTEXT_LIMIT_CHARS) * 100);
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
  if (message.type === 'chat.history') applyHistory(message.payload);
}

function handleRpcSignal(event: Event) {
  const signal = (event as CustomEvent<RpcSignal>).detail || {};
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
