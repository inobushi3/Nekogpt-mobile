import type {
  ConnectionPhase,
  Live2DBundle,
  Live2DBundleMetadata,
  RelayMessage,
  RpcResponse,
} from '../types';
import { getSavedLanguage, t } from '../i18n';

type EventListener = (message: RelayMessage) => void;
type PhaseListener = (phase: ConnectionPhase, detail?: string) => void;

type PendingRpc = {
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

const RPC_TIMEOUT_MS = 90_000;
const BUNDLE_TIMEOUT_MS = 120_000;
const PAIRING_TIMEOUT_MS = 15_000;
export const DEFAULT_RELAY_URL = import.meta.env.VITE_NEKOGPT_RELAY_URL || 'ws://127.0.0.1:8787/connect';
const SAVED_RELAY_URL_KEY = 'nekogpt:relay-url';
const SAVED_PAIRING_CODE_KEY = 'nekogpt:pairing-code';

function copy(key: Parameters<typeof t>[1]) {
  return t(getSavedLanguage(), key);
}

function resumeTokenKey(pairingCode: string) {
  return `nekogpt:resume-token:${pairingCode.trim().toUpperCase()}`;
}

function normalizePairingCode(value: unknown) {
  return String(value || '').trim().toUpperCase();
}

export function getSavedConnectionConfig() {
  if (typeof localStorage === 'undefined') return null;
  const pairingCode = normalizePairingCode(localStorage.getItem(SAVED_PAIRING_CODE_KEY));
  if (!pairingCode) return null;
  return {
    relayUrl: localStorage.getItem(SAVED_RELAY_URL_KEY) || DEFAULT_RELAY_URL,
    pairingCode,
  };
}

function cleanRelayUrl(value: string) {
  const raw = value.trim() || DEFAULT_RELAY_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      throw new Error(copy('connection.error.invalidRelay'));
    }
    return url.toString();
  } catch (error) {
    if (raw !== DEFAULT_RELAY_URL) {
      localStorage.setItem(SAVED_RELAY_URL_KEY, DEFAULT_RELAY_URL);
    }
    if (error instanceof Error && error.message.includes('ws://')) throw error;
    throw new Error(copy('connection.error.invalidRelay'));
  }
}

function buildSocketUrl(relayUrl: string, pairingCode: string) {
  const url = new URL(cleanRelayUrl(relayUrl));
  url.searchParams.set('role', 'mobile');
  url.searchParams.set('room', pairingCode.trim().toUpperCase());
  url.searchParams.set('client', 'nekogpt-mobile');
  return url.toString();
}

function decodeBase64Chunks(chunks: string[], byteLength: number) {
  const joined = chunks.join('');
  const binary = atob(joined);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (byteLength && bytes.byteLength !== byteLength) {
    throw new Error(copy('connection.error.incompleteBundle'));
  }
  return bytes;
}

export class NekoConnection {
  private socket: WebSocket | null = null;
  private phaseListeners = new Set<PhaseListener>();
  private eventListeners = new Set<EventListener>();
  private pendingRpc = new Map<string, PendingRpc>();
  private pendingTransfers = new Map<string, PendingTransfer>();
  private approved = false;
  private pairingCode = '';
  private pairingTimer: number | null = null;

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN && this.approved;
  }

  onPhase(listener: PhaseListener) {
    this.phaseListeners.add(listener);
    return () => this.phaseListeners.delete(listener);
  }

  onEvent(listener: EventListener) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private emitPhase(phase: ConnectionPhase, detail?: string) {
    this.phaseListeners.forEach((listener) => listener(phase, detail));
  }

  private emitEvent(message: RelayMessage) {
    this.eventListeners.forEach((listener) => listener(message));
  }

  private clearPairingTimer() {
    if (this.pairingTimer === null) return;
    window.clearTimeout(this.pairingTimer);
    this.pairingTimer = null;
  }

  private startPairingTimer(socket: WebSocket) {
    this.clearPairingTimer();
    this.pairingTimer = window.setTimeout(() => {
      if (this.socket !== socket || this.approved) return;
      this.clearPairingTimer();
      this.socket = null;
      this.approved = false;
      this.rejectPending(new Error(copy('connection.error.desktopOffline')));
      this.emitPhase('error', copy('connection.error.desktopOffline'));
      socket.close(4004, 'desktop did not approve connection');
    }, PAIRING_TIMEOUT_MS);
  }

  connect(relayUrl: string, pairingCode: string) {
    this.disconnect();
    this.clearPairingTimer();
    this.approved = false;
    this.pairingCode = normalizePairingCode(pairingCode);
    let socketUrl = '';
    try {
      const cleanedRelayUrl = cleanRelayUrl(relayUrl);
      socketUrl = buildSocketUrl(cleanedRelayUrl, this.pairingCode);
      localStorage.setItem(SAVED_RELAY_URL_KEY, cleanedRelayUrl);
    } catch (error) {
      this.emitPhase('error', error instanceof Error ? error.message : String(error));
      return;
    }

    this.emitPhase('connecting');
    const socket = new WebSocket(socketUrl);
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.emitPhase('connecting');
      this.send({
        type: 'pair.request',
        payload: {
          deviceName: navigator.userAgent.includes('Mobile') ? 'Celular' : 'Navegador',
          userAgent: navigator.userAgent.slice(0, 240),
          resumeToken: localStorage.getItem(resumeTokenKey(this.pairingCode)) || '',
        },
      });
      this.startPairingTimer(socket);
    });

    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) return;
      if (typeof event.data !== 'string') return;
      try {
        this.handleMessage(JSON.parse(event.data) as RelayMessage);
      } catch {
        this.emitEvent({ type: 'protocol.error', payload: copy('connection.error.invalidProtocol') });
      }
    });

    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.clearPairingTimer();
      const wasApproved = this.approved;
      this.approved = false;
      this.socket = null;
      this.rejectPending(new Error(copy('connection.error.closed')));
      this.emitPhase('disconnected', wasApproved ? copy('connection.error.desktopOffline') : undefined);
    });

    socket.addEventListener('error', () => {
      if (this.socket !== socket) return;
      this.clearPairingTimer();
      this.emitPhase('error', copy('connection.error.unreachableRelay'));
    });
  }

  disconnect() {
    this.clearPairingTimer();
    this.approved = false;
    this.socket?.close(1000, 'client disconnect');
    this.socket = null;
    this.rejectPending(new Error(copy('connection.error.ended')));
    this.emitPhase('disconnected');
  }

  logout() {
    const activePairingCode = this.pairingCode;
    const savedPairingCode = typeof localStorage !== 'undefined'
      ? normalizePairingCode(localStorage.getItem(SAVED_PAIRING_CODE_KEY))
      : '';
    this.disconnect();
    if (activePairingCode) localStorage.removeItem(resumeTokenKey(activePairingCode));
    if (savedPairingCode && savedPairingCode !== activePairingCode) {
      localStorage.removeItem(resumeTokenKey(savedPairingCode));
    }
    localStorage.removeItem(SAVED_PAIRING_CODE_KEY);
    localStorage.removeItem(SAVED_RELAY_URL_KEY);
    this.pairingCode = '';
  }

  private rejectPending(error: Error) {
    this.pendingRpc.forEach((pending) => {
      window.clearTimeout(pending.timer);
      pending.reject(error);
    });
    this.pendingRpc.clear();

    this.pendingTransfers.forEach((pending) => {
      window.clearTimeout(pending.timer);
      pending.reject(error);
    });
    this.pendingTransfers.clear();
  }

  private handleMessage(message: RelayMessage) {
    if (message.type === 'relay.peer.left' && message.role === 'desktop') {
      this.approved = false;
      this.rejectPending(new Error(copy('connection.error.desktopOffline')));
      this.emitPhase('disconnected', copy('connection.error.desktopOffline'));
      this.socket?.close(4002, 'desktop offline');
      return;
    }
    if (message.type === 'pair.approved') {
      this.clearPairingTimer();
      const payload = message.payload && typeof message.payload === 'object'
        ? message.payload as Record<string, unknown>
        : {};
      const resumeToken = typeof payload.resumeToken === 'string' ? payload.resumeToken : '';
      if (this.pairingCode) {
        localStorage.setItem(SAVED_PAIRING_CODE_KEY, this.pairingCode);
      }
      if (resumeToken && this.pairingCode) {
        localStorage.setItem(resumeTokenKey(this.pairingCode), resumeToken);
      }
      this.approved = true;
      this.emitPhase('connected');
      this.emitEvent(message);
      return;
    }
    if (message.type === 'pair.rejected') {
      if (this.pairingCode) localStorage.removeItem(resumeTokenKey(this.pairingCode));
      this.emitPhase('error', String(message.error || copy('connection.error.rejected')));
      return;
    }
    if (message.type === 'session.revoked') {
      if (this.pairingCode) localStorage.removeItem(resumeTokenKey(this.pairingCode));
      localStorage.removeItem(SAVED_PAIRING_CODE_KEY);
      this.approved = false;
      this.rejectPending(new Error(copy('connection.error.revoked')));
      this.emitPhase('disconnected', copy('connection.error.revoked'));
      this.socket?.close(4003, 'session revoked');
      return;
    }
    if (message.type === 'rpc.response') {
      const response = message as RpcResponse & RelayMessage;
      const pending = response.id ? this.pendingRpc.get(response.id) : undefined;
      if (!pending || !response.id) return;
      window.clearTimeout(pending.timer);
      this.pendingRpc.delete(response.id);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new Error(response.error || copy('connection.error.rpcFailed')));
      return;
    }
    if (message.type === 'live2d.bundle.chunk') {
      const transferId = String(message.transferId || '');
      const pending = this.pendingTransfers.get(transferId);
      if (!pending) return;
      const index = Number(message.index);
      if (!Number.isInteger(index) || index < 0 || index >= pending.metadata.totalChunks) return;
      pending.chunks[index] = String(message.data || '');
      if (pending.chunks.filter(Boolean).length !== pending.metadata.totalChunks) return;

      window.clearTimeout(pending.timer);
      this.pendingTransfers.delete(transferId);
      try {
        pending.resolve({
          ...pending.metadata,
          bytes: decodeBase64Chunks(pending.chunks, pending.metadata.byteLength),
        });
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return;
    }
    this.emitEvent(message);
  }

  private send(message: RelayMessage) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(copy('connection.error.notConnected'));
    }
    this.socket.send(JSON.stringify(message));
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
