import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installDialogueEffects } from './dialogue-effects';
import { installDialogueWindow } from './dialogue-window';
import { installLive2DDragSmoothing } from './live2d-drag-smoothing';
import { installLive2DResilience } from './live2d-resilience';
import { installMobileHistoryPull } from './mobile-history-pull';
import { installMobileHud } from './mobile-hud';
import './styles.css';
import './background-static.css';
import './dialogue-reference.css';
import './dialogue-effects.css';
import './dialogue-animation-fix.css';
import './dialogue-message-layout.css';
import './runtime-polish.css';
import './mobile-hud.css';
import './mobile-history-pull.css';
import './send-button-polish.css';
import './live2d-responsive.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}

installDialogueWindow();
installLive2DDragSmoothing();
installLive2DResilience();
installMobileHud();
installMobileHistoryPull();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

installDialogueEffects();
