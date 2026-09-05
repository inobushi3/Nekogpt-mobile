import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installDialogueEffects } from './dialogue-effects';
import { installDialogueWindow } from './dialogue-window';
import './styles.css';
import './dialogue-reference.css';
import './dialogue-effects.css';
import './dialogue-message-layout.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}

installDialogueWindow();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

installDialogueEffects();
