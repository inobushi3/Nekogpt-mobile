type RpcSignal = {
  method?: string;
  result?: unknown;
};

type RelaySignal = {
  type?: string;
  payload?: unknown;
};

let installed = false;
let activeModelIdentity = '';
let reloadScheduled = false;

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function snapshotIdentity(value: unknown) {
  const snapshot = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const modelId = clean(snapshot.modelId);
  const modelFile = clean(snapshot.modelFile);
  if (!modelId || !modelFile) return '';
  return `${modelId}\u0000${modelFile}`;
}

function acceptSnapshot(value: unknown) {
  const nextIdentity = snapshotIdentity(value);
  if (!nextIdentity) return;

  if (!activeModelIdentity) {
    activeModelIdentity = nextIdentity;
    return;
  }

  if (nextIdentity === activeModelIdentity || reloadScheduled) return;

  activeModelIdentity = nextIdentity;
  reloadScheduled = true;

  // The Live2D bundle is requested during app startup. Reloading here makes the
  // existing mobile connection request the newly selected desktop model bundle.
  window.setTimeout(() => window.location.reload(), 90);
}

function handleRpcResponse(event: Event) {
  const signal = (event as CustomEvent<RpcSignal>).detail || {};
  if (signal.method === 'companion.snapshot') acceptSnapshot(signal.result);
}

function handleRelayMessage(event: Event) {
  const signal = (event as CustomEvent<RelaySignal>).detail || {};
  if (signal.type === 'companion.snapshot' || signal.type === 'companion.snapshot.updated') {
    acceptSnapshot(signal.payload);
  }
}

function handleConnectionPhase(event: Event) {
  const detail = (event as CustomEvent<{ phase?: string }>).detail;
  if (detail?.phase !== 'disconnected') return;
  activeModelIdentity = '';
  reloadScheduled = false;
}

export function installLive2DModelSync() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('nekogpt:rpc-response', handleRpcResponse as EventListener);
  window.addEventListener('nekogpt:relay-message', handleRelayMessage as EventListener);
  window.addEventListener('nekogpt:connection-phase', handleConnectionPhase as EventListener);
}
