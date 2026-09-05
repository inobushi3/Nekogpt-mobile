import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installDialogueEffects } from './dialogue-effects';
import { installDialogueWindow } from './dialogue-window';
import { installLive2DDragSmoothing } from './live2d-drag-smoothing';
import './styles.css';
import './dialogue-reference.css';
import './dialogue-effects.css';
import './dialogue-message-layout.css';
import './runtime-polish.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}

installDialogueWindow();
installLive2DDragSmoothing();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

installDialogueEffects();
