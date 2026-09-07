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

type Live2DController = {
  dispatch: (value: unknown) => void;
  bundleProgress: string;
};

let installed = false;
let activeModelIdentity = '';
let refreshInFlight = false;
let loadingWatcher = 0;
let safetyWatcher = 0;

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

function findLive2DController(): Live2DController | null {
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
      const bundleProgress = hooks[6]?.memoizedState;
      const version = hooks[28]?.memoizedState;
      const dispatch = hooks[28]?.queue?.dispatch;
      if (
        typeof phase === 'string'
        && ['connected', 'connecting', 'disconnected', 'error'].includes(phase)
        && typeof version === 'number'
        && typeof dispatch === 'function'
      ) {
        return {
          dispatch,
          bundleProgress: typeof bundleProgress === 'string' ? bundleProgress : '',
        };
      }
    }

    if (fiber.sibling) stack.push(fiber.sibling);
    if (fiber.child) stack.push(fiber.child);
  }

  return null;
}

function ensureSwitchOverlay() {
  const shellOverlay = document.querySelector<HTMLElement>('.live2d-switch-mask');
  if (shellOverlay) return shellOverlay;

  let overlay = document.querySelector<HTMLElement>('.live2d-switch-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.className = 'live2d-switch-overlay';
  overlay.innerHTML = `
    <span class="live2d-switch-overlay__spinner" aria-hidden="true"></span>
    <span class="live2d-switch-overlay__label">Trocando de modelo</span>
  `;
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: '14px',
    background: 'rgba(10, 9, 15, 0.82)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    color: '#fff6e8',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: '16px',
    fontWeight: '600',
    letterSpacing: '0.01em',
    pointerEvents: 'all',
  });

  const spinner = overlay.querySelector<HTMLElement>('.live2d-switch-overlay__spinner');
  if (spinner) {
    Object.assign(spinner.style, {
      width: '28px',
      height: '28px',
      borderRadius: '999px',
      border: '3px solid rgba(255, 246, 232, 0.24)',
      borderTopColor: '#fff6e8',
      animation: 'live2dSwitchSpin 0.8s linear infinite',
    });
  }

  if (!document.getElementById('live2d-switch-overlay-style')) {
    const style = document.createElement('style');
    style.id = 'live2d-switch-overlay-style';
    style.textContent = '@keyframes live2dSwitchSpin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
  }

  document.body.appendChild(overlay);
  return overlay;
}

function showSwitchOverlay() {
  const overlay = ensureSwitchOverlay();
  if (overlay.classList.contains('live2d-switch-mask')) {
    overlay.classList.add('is-active');
  } else {
    overlay.style.display = 'flex';
  }
}

function hideSwitchOverlay() {
  const shellOverlay = document.querySelector<HTMLElement>('.live2d-switch-mask');
  if (shellOverlay) shellOverlay.classList.remove('is-active');

  const fallbackOverlay = document.querySelector<HTMLElement>('.live2d-switch-overlay');
  if (fallbackOverlay) fallbackOverlay.style.display = 'none';
}

function finishSwap() {
  refreshInFlight = false;
  if (loadingWatcher) {
    window.clearInterval(loadingWatcher);
    loadingWatcher = 0;
  }
  hideSwitchOverlay();
}

function watchLoadingState() {
  if (loadingWatcher) window.clearInterval(loadingWatcher);
  const startedAt = Date.now();
  let sawReactLoading = false;
  let readyTicks = 0;

  loadingWatcher = window.setInterval(() => {
    const controller = findLive2DController();
    const hasCompanionScreen = Boolean(document.querySelector('.companion-screen'));
    const elapsed = Date.now() - startedAt;
    const progress = controller?.bundleProgress || '';

    if (progress) {
      sawReactLoading = true;
      readyTicks = 0;
    } else if (hasCompanionScreen && sawReactLoading) {
      readyTicks += 1;
    } else if (hasCompanionScreen && elapsed > 3500) {
      readyTicks += 1;
    }

    // The App clears bundleProgress in handleLive2DLoaded(). Three clean ticks
    // avoid hiding the overlay during the short "preparing" -> mounted transition.
    if (readyTicks >= 3 || elapsed > 15_000) {
      finishSwap();
    }
  }, 100);
}

function requestHotSwap(attempt = 0) {
  if (refreshInFlight && attempt === 0) return;
  if (attempt === 0) {
    refreshInFlight = true;
    showSwitchOverlay();
  }

  const controller = findLive2DController();
  if (!controller) {
    if (attempt < 12) {
      window.setTimeout(() => requestHotSwap(attempt + 1), 80);
      return;
    }
    finishSwap();
    return;
  }

  controller.dispatch((current: unknown) => (Number(current) || 0) + 1);
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
  if (detail?.phase === 'connected' && refreshInFlight) {
    showSwitchOverlay();
    return;
  }
  if (detail?.phase !== 'disconnected') return;
  if (refreshInFlight) return;
  activeModelIdentity = '';
  hideSwitchOverlay();
}

export function installLive2DModelSync() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('nekogpt:rpc-response', handleRpcResponse as EventListener);
  window.addEventListener('nekogpt:relay-message', handleRelayMessage as EventListener);
  window.addEventListener('nekogpt:connection-phase', handleConnectionPhase as EventListener);

  // Safety net for the production shell: never let a stale swap mask remain
  // visible after the hot-swap state has already finished.
  safetyWatcher = window.setInterval(() => {
    if (!refreshInFlight) hideSwitchOverlay();
  }, 500);

  window.addEventListener('pagehide', () => {
    if (safetyWatcher) window.clearInterval(safetyWatcher);
  }, { once: true });
}
