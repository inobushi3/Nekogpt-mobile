import { t, getSavedLanguage } from '../i18n';
import type {
  CompanionChatHistory,
  CompanionLive2DState,
  CompanionSnapshot,
  CompanionTtsAudio,
  Live2DBundle,
  Live2DBundleMetadata,
  RelayMessage,
} from '../types';

export const DEFAULT_RELAY_URL = import.meta.env.VITE_RELAY_URL || 'wss://nekogpt-mobile-relay.inobushi3.workers.dev';
const SESSION_STORAGE_KEY = 'nekogpt:mobile-session';
const RPC_TIMEOUT_MS = 20_000;
const BUNDLE_TIMEOUT_MS = 90_000;

export type ConnectionConfig = {
  relayUrl: string;
  code: string;
};

type PendingRpc = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: number;
};

type PendingTransfer = {
  metadata: Live2DBundleMetadata;
  chunks: string[];
  resolve: (bundle: Live2DBundle) => void;
  reject: (error: Error) => void;
  timer: number;
};

type StoredSession = {
  relayUrl: string;
  code: string;
};

function copy(key: Parameters<typeof t>[1], vars?: Parameters<typeof t>[2]) {
  return t(getSavedLanguage(), key, vars);
}

function normalizeRelayUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_RELAY_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/^http/i, 'ws').replace(/\/$/, '');
  if (!/^wss?:\/\//i.test(trimmed)) return `wss://${trimmed.replace(/\/$/, '')}`;
  return trimmed.replace(/\/$/, '');
}

function normalizeCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

function dataUrlToBlob(dataUrl: string) {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl);
  if (!match) return null;
  const mimeType = match[1] || 'application/octet-stream';
  const base64 = Boolean(match[2]);
  const body = match[3] || '';
  try {
    const bytes = base64
      ? Uint8Array.from(atob(body), (char) => char.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(body));
    return new Blob([bytes], { type: mimeType });
  } catch {
    return null;
  }
}

function joinBase64Chunks(chunks: string[]) {
  return chunks.join('');
}

function decodeBase64Utf8(value: string) {
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function decodeTransferredBundle(metadata: Live2DBundleMetadata, chunks: string[]): Live2DBundle {
  const raw = decodeBase64Utf8(joinBase64Chunks(chunks));
  const parsed = JSON.parse(raw) as Live2DBundle;
  if (!parsed || typeof parsed !== 'object') throw new Error(copy('connection.error.bundleInvalid'));
  return parsed;
}

export function getSavedConnectionConfig(): ConnectionConfig {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return { relayUrl: DEFAULT_RELAY_URL, code: '' };
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    return {
      relayUrl: normalizeRelayUrl(typeof parsed.relayUrl === 'string' ? parsed.relayUrl : DEFAULT_RELAY_URL),
      code: normalizeCode(typeof parsed.code === 'string' ? parsed.code : ''),
    };
  } catch {
    return { relayUrl: DEFAULT_RELAY_URL, code: '' };
  }
}

function saveConnectionConfig(config: ConnectionConfig) {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
      relayUrl: normalizeRelayUrl(config.relayUrl),
      code: normalizeCode(config.code),
    } satisfies StoredSession));
  } catch {}
}

type NekoConnectionHandlers = {
  onOpen?: () => void;
  onClose?: (reason?: string) => void;
  onError?: (error: Error) => void;
  onApproved?: () => void;
  onDenied?: (message?: string) => void;
  onSnapshot?: (snapshot: CompanionSnapshot) => void;
  onChatHistory?: (history: CompanionChatHistory) => void;
  onLive2DState?: (state: CompanionLive2DState) => void;
  onTtsAudio?: (audio: CompanionTtsAudio) => void;
  onRelayMessage?: (message: RelayMessage) => void;
};

export class NekoConnection {
  private socket: WebSocket | null = null;
  private handlers: NekoConnectionHandlers;
  private config: ConnectionConfig | null = null;
  private approved = false;
  private pendingRpc = new Map<string, PendingRpc>();
  private pendingTransfers = new Map<string, PendingTransfer>();

  constructor(handlers: NekoConnectionHandlers = {}) {
    this.handlers = handlers;
  }

  setHandlers(handlers: NekoConnectionHandlers) {
    this.handlers = handlers;
  }

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN && this.approved;
  }

  connect(config: ConnectionConfig) {
    this.disconnect();
    const normalized: ConnectionConfig = {
      relayUrl: normalizeRelayUrl(config.relayUrl),
      code: normalizeCode(config.code),
    };
    this.config = normalized;
    saveConnectionConfig(normalized);

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(normalized.relayUrl);
      this.socket = socket;

      socket.addEventListener('open', () => {
        this.handlers.onOpen?.();
        this.send({ type: 'mobile.connect', code: normalized.code });
      });

      socket.addEventListener('message', async (event) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : await event.data.text();
          const message = JSON.parse(raw) as RelayMessage;
          this.handleMessage(message);
          if (message.type === 'mobile.approved') {
            this.approved = true;
            this.handlers.onApproved?.();
            if (!settled) {
              settled = true;
              resolve();
            }
          } else if (message.type === 'mobile.denied') {
            this.handlers.onDenied?.(typeof message.message === 'string' ? message.message : undefined);
            if (!settled) {
              settled = true;
              reject(new Error(typeof message.message === 'string' ? message.message : copy('connection.error.denied')));
            }
          }
        } catch (error) {
          this.handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      });

      socket.addEventListener('close', (event) => {
        this.approved = false;
        this.rejectAllPending(new Error(copy('connection.error.closed')));
        this.handlers.onClose?.(event.reason || undefined);
        if (!settled) {
          settled = true;
          reject(new Error(event.reason || copy('connection.error.closed')));
        }
      });

      socket.addEventListener('error', () => {
        const error = new Error(copy('connection.error.socket'));
        this.handlers.onError?.(error);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
    });
  }

  disconnect() {
    this.approved = false;
    if (this.socket) {
      try {
        this.socket.close();
      } catch {}
    }
    this.socket = null;
    this.rejectAllPending(new Error(copy('connection.error.closed')));
  }

  private rejectAllPending(error: Error) {
    for (const pending of this.pendingRpc.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRpc.clear();
    for (const transfer of this.pendingTransfers.values()) {
      window.clearTimeout(transfer.timer);
      transfer.reject(error);
    }
    this.pendingTransfers.clear();
  }

  private send(payload: unknown) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(payload));
  }

  private handleMessage(message: RelayMessage) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'rpc.response') {
      const id = typeof message.id === 'string' ? message.id : '';
      const pending = this.pendingRpc.get(id);
      if (!pending) return;
      window.clearTimeout(pending.timer);
      this.pendingRpc.delete(id);
      if (message.error) pending.reject(new Error(String(message.error)));
      else pending.resolve(message.result);
      return;
    }

    if (message.type === 'live2d.bundle.meta') {
      return;
    }

    if (message.type === 'live2d.bundle.chunk') {
      const transferId = typeof message.transferId === 'string' ? message.transferId : '';
      const transfer = this.pendingTransfers.get(transferId);
      if (!transfer) return;
      const index = Number(message.index);
      if (!Number.isInteger(index) || index < 0 || index >= transfer.chunks.length) return;
      transfer.chunks[index] = typeof message.data === 'string' ? message.data : '';
      if (transfer.chunks.every((chunk) => typeof chunk === 'string' && chunk.length > 0)) {
        window.clearTimeout(transfer.timer);
        this.pendingTransfers.delete(transferId);
        try {
          transfer.resolve(decodeTransferredBundle(transfer.metadata, transfer.chunks));
        } catch (error) {
          transfer.reject(error instanceof Error ? error : new Error(copy('connection.error.bundleInvalid')));
        }
      }
      return;
    }

    if (message.type === 'companion.snapshot') {
      this.handlers.onSnapshot?.(message.snapshot as CompanionSnapshot);
      return;
    }

    if (message.type === 'chat.history') {
      this.handlers.onChatHistory?.(message.history as CompanionChatHistory);
      return;
    }

    if (message.type === 'live2d.state') {
      this.handlers.onLive2DState?.(message.state as CompanionLive2DState);
      return;
    }

    if (message.type === 'tts.audio') {
      const payload = message.audio as CompanionTtsAudio;
      if (payload && typeof payload === 'object') {
        const data = typeof payload.data === 'string' ? payload.data : '';
        const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType : 'audio/mpeg';
        if (data) {
          const blob = dataUrlToBlob(`data:${mimeType};base64,${data}`);
          if (blob) this.handlers.onTtsAudio?.({ ...payload, blob });
          else this.handlers.onTtsAudio?.(payload);
        } else {
          this.handlers.onTtsAudio?.(payload);
        }
      }
      return;
    }

    this.handlers.onRelayMessage?.(message);
  }

  sendChatMessage(text: string, attachments?: unknown) {
    this.send({ type: 'chat.send', text, ...(attachments ? { attachments } : {}) });
  }

  sendVisionImage(payload: unknown) {
    this.send({ type: 'vision.image', image: payload });
  }

  sendVisionVideo(payload: unknown) {
    this.send({ type: 'vision.video', video: payload });
  }

  sendMicrophoneState(payload: unknown) {
    this.send({ type: 'microphone.state', ...((payload && typeof payload === 'object') ? payload : {}) });
  }

  sendTouch(payload: unknown) {
    this.send({ type: 'live2d.touch', ...((payload && typeof payload === 'object') ? payload : {}) });
  }

  rpc<T>(method: string, params?: unknown, timeoutMs = RPC_TIMEOUT_MS) {
    if (!this.connected) return Promise.reject(new Error(copy('connection.error.notApproved')));
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pendingRpc.delete(id);
        reject(new Error(`O comando ${method} excedeu o tempo limite.`));
      }, timeoutMs);
      this.pendingRpc.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.send({ type: 'rpc.request', id, method, params });
    });
  }

  async requestLive2DBundle() {
    const metadata = await this.rpc<Live2DBundleMetadata>('live2d.bundle', undefined, BUNDLE_TIMEOUT_MS);
    return new Promise<Live2DBundle>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pendingTransfers.delete(metadata.transferId);
        reject(new Error(copy('connection.error.bundleTimeout')));
      }, BUNDLE_TIMEOUT_MS);
      this.pendingTransfers.set(metadata.transferId, {
        metadata,
        chunks: new Array(metadata.totalChunks),
        resolve,
        reject,
        timer,
      });
      this.send({ type: 'live2d.bundle.ready', transferId: metadata.transferId });
    });
  }
}
