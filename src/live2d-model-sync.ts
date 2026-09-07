type RpcSignal = {
  method?: string;
  result?: unknown;
};

type RelaySignal = {
  type?: string;
  payload?: unknown;
};

type ReactFiber = {
  child?: ReactFiber | null;
  sibling?: ReactFiber | null;
  memoizedState?: ReactHook | null;
};

type ReactHook = {
  memoizedState?: unknown;
  next?: ReactHook | null;
  queue?: {
    dispatch?: (value: unknown) => void;
  } | null;
};

let installed = false;
let activeModelIdentity = '';
let refreshInFlight = false;
let loadingWatcher = 0;

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

function collectHooks(fiber: ReactFiber) {
  const hooks: ReactHook[] = [];
  let hook = fiber.memoizedState || null;
  while (hook && hooks.length < 48) {
    hooks.push(hook);
    hook = hook.next || null;
  }
  return hooks;
}

function findBundleRefreshDispatch() {
  const root = document.getElementById('root') as (HTMLElement & Record<string, unknown>) | null;
  if (!root) return null;

  const containerKey = Object.keys(root).find((key) => key.startsWith('__reactContainer$'));
  const rootFiber = containerKey ? root[containerKey] as ReactFiber | undefined : undefined;
  if (!rootFiber) return null;

  const stack: ReactFiber[] = [rootFiber];
  while (stack.length) {
    const fiber = stack.pop();
    if (!fiber) continue;

    const hooks = collectHooks(fiber);
    if (hooks.length > 28) {
      const phase = hooks[3]?.memoizedState;
      const version = hooks[28]?.memoizedState;
      const dispatch = hooks[28]?.queue?.dispatch;
      if (
        typeof phase === 'string'
        && ['connected', 'connecting', 'disconnected', 'error'].includes(phase)
        && typeof version === 'number'
        && typeof dispatch === 'function'
      ) {
        return dispatch;
      }
    }

    if (fiber.sibling) stack.push(fiber.sibling);
    if (fiber.child) stack.push(fiber.child);
  }

  return null;
}

function forceLoadingLabel() {
  const status = document.querySelector<HTMLElement>('.companion-status');
  if (!status) return false;
  const labels = status.querySelectorAll<HTMLElement>('span');
  const label = labels.length > 1 ? labels[labels.length - 1] : null;
  if (label) label.textContent = 'Carregando modelo...';
  return true;
}

function watchLoadingState() {
  if (loadingWatcher) window.clearInterval(loadingWatcher);
  const startedAt = Date.now();
  let sawStatus = false;

  loadingWatcher = window.setInterval(() => {
    const hasStatus = forceLoadingLabel();
    if (hasStatus) sawStatus = true;

    if ((sawStatus && !hasStatus) || Date.now() - startedAt > 20_000) {
      window.clearInterval(loadingWatcher);
      loadingWatcher = 0;
      refreshInFlight = false;
    }
  }, 100);
}

function requestHotSwap(attempt = 0) {
  if (refreshInFlight && attempt === 0) return;
  if (attempt === 0) refreshInFlight = true;

  const dispatch = findBundleRefreshDispatch();
  if (!dispatch) {
    if (attempt < 12) {
      window.setTimeout(() => requestHotSwap(attempt + 1), 80);
      return;
    }
    refreshInFlight = false;
    return;
  }

  dispatch((current: unknown) => (Number(current) || 0) + 1);
  watchLoadingState();
}

function acceptSnapshot(value: unknown) {
  const nextIdentity = snapshotIdentity(value);
  if (!nextIdentity) return;

  if (!activeModelIdentity) {
    activeModelIdentity = nextIdentity;
    return;
  }

  if (nextIdentity === activeModelIdentity) return;
  activeModelIdentity = nextIdentity;
  requestHotSwap();
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
  refreshInFlight = false;
  if (loadingWatcher) {
    window.clearInterval(loadingWatcher);
    loadingWatcher = 0;
  }
}

export function installLive2DModelSync() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('nekogpt:rpc-response', handleRpcResponse as EventListener);
  window.addEventListener('nekogpt:relay-message', handleRelayMessage as EventListener);
  window.addEventListener('nekogpt:connection-phase', handleConnectionPhase as EventListener);
}
