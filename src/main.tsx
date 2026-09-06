import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installDialogueEffects } from './dialogue-effects';
import { installDialogueWindow } from './dialogue-window';
import { installLive2DDragSmoothing } from './live2d-drag-smoothing';
import { installMobileHistoryPull } from './mobile-history-pull';
import { installMobileHud } from './mobile-hud';
import './styles.css';
import './dialogue-reference.css';
import './dialogue-effects.css';
import './dialogue-message-layout.css';
import './runtime-polish.css';
import './mobile-hud.css';
import './mobile-history-pull.css';
import './vintage-chat-tint.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}

installDialogueWindow();
installLive2DDragSmoothing();
installMobileHud();
installMobileHistoryPull();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

installDialogueEffects();
