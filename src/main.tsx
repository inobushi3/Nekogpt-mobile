import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installDialogueEffects } from './dialogue-effects';
import { installDialogueWindow } from './dialogue-window';
import { installLive2DDragSmoothing } from './live2d-drag-smoothing';
import { installLive2DModelSync } from './live2d-model-sync';
import { installMobileHistoryPull } from './mobile-history-pull';
import { installMobileHud } from './mobile-hud';
import './styles.css';
import './connection-gate-polish.css';
import './background-static.css';
import './dialogue-reference.css';
import './dialogue-effects.css';
import './dialogue-animation-fix.css';
import './dialogue-message-layout.css';
import './runtime-polish.css';
import './mobile-hud.css';
import './mobile-history-pull.css';
import './send-button-polish.css';
import './typing-indicator.css';
import './connection-code-strip.css';
import './connection-status-hide.css';
import './settings-glass-visual-match.css';
import './connection-settings-round.css';
import './connection-options-panel.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const reloadKey = 'nekogpt:sw-v6-controller-reload';

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    try {
      if (sessionStorage.getItem(reloadKey) === '1') return;
      sessionStorage.setItem(reloadKey, '1');
    } catch {}
    window.location.reload();
  });

  void (async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        updateViaCache: 'none',
      });
      await registration.update();
    } catch {
      // The app must keep working even when service workers are unavailable.
    }
  })();
}

installDialogueWindow();
installLive2DDragSmoothing();
installLive2DModelSync();
installMobileHud();
installMobileHistoryPull();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

installDialogueEffects();
