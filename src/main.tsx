import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installDialogueEffects } from './dialogue-effects';
import './styles.css';
import './dialogue-reference.css';
import './dialogue-effects.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

installDialogueEffects();
