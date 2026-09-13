import 'https://nekogpt-mobile-3kimvm8bp-inobushi3s-projects.vercel.app/assets/index-DoK11xDG.js';

const settingsGlassStyle = document.createElement('style');
settingsGlassStyle.id = 'nekogpt-settings-glass';
settingsGlassStyle.textContent = `
html body .companion-screen .settings-panel {
  border: 1px solid rgba(255, 255, 255, 0.14) !important;
  border-radius: 18px !important;
  background:
    linear-gradient(145deg, rgba(255,255,255,0.055), rgba(255,255,255,0.012) 42%, rgba(0,0,0,0.055)),
    rgba(10, 9, 12, 0.58) !important;
  box-shadow: 0 14px 42px rgba(0, 0, 0, 0.28) !important;
  -webkit-backdrop-filter: blur(24px) saturate(1.05) !important;
  backdrop-filter: blur(24px) saturate(1.05) !important;
  overflow: hidden !important;
}

html body .companion-screen .settings-panel,
html body .companion-screen .settings-panel * {
  color: rgba(255, 255, 255, 0.96) !important;
}

html body .companion-screen .settings-panel p,
html body .companion-screen .settings-panel small,
html body .companion-screen .settings-panel label,
html body .companion-screen .settings-panel span {
  color: rgba(255, 255, 255, 0.90) !important;
}

html body .companion-screen .settings-panel h1,
html body .companion-screen .settings-panel h2,
html body .companion-screen .settings-panel h3,
html body .companion-screen .settings-panel h4,
html body .companion-screen .settings-panel strong,
html body .companion-screen .settings-panel b {
  color: #ffffff !important;
}

html body .companion-screen .settings-panel .background-controls {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
  gap: 7px !important;
}

html body .companion-screen .settings-panel .camera-controls button,
html body .companion-screen .settings-panel .background-controls button,
html body .companion-screen .settings-panel .background-controls button:first-child {
  width: 100% !important;
  min-width: 0 !important;
  min-height: 38px !important;
  padding: 0 10px !important;
  color: rgba(255, 255, 255, 0.96) !important;
  background: rgba(18, 17, 22, 0.48) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: 10px !important;
  box-shadow: none !important;
  -webkit-backdrop-filter: blur(14px) saturate(1.05) !important;
  backdrop-filter: blur(14px) saturate(1.05) !important;
  font-size: 0.7rem !important;
  font-weight: 700 !important;
}

html body .companion-screen .settings-panel .camera-controls button.is-active {
  color: rgba(255, 255, 255, 0.98) !important;
  background: rgba(24, 30, 28, 0.58) !important;
  border: 1px solid rgba(83, 221, 167, 0.28) !important;
  box-shadow: none !important;
}

@media (max-width: 620px) {
  html body .companion-screen .settings-panel {
    border-radius: 17px !important;
    background:
      linear-gradient(145deg, rgba(255,255,255,0.055), rgba(255,255,255,0.012) 42%, rgba(0,0,0,0.055)),
      rgba(10, 9, 12, 0.54) !important;
    -webkit-backdrop-filter: blur(22px) saturate(1.02) !important;
    backdrop-filter: blur(22px) saturate(1.02) !important;
  }
}
`;
document.head.appendChild(settingsGlassStyle);

let pendingMediaSend = null;
let clearTimer = null;

const sentMediaSelector = '.app-message-line--user .app-message-attachments img, .app-message-line--user .app-message-attachments video';

function getComposer() {
  return document.querySelector('.floating-composer');
}

function composerHasMediaPreview() {
  const composer = getComposer();
  return Boolean(composer?.querySelector('.media-preview-card img, .media-preview-card video'));
}

function armMediaPreviewClear() {
  if (!composerHasMediaPreview()) return;

  const knownMedia = new WeakSet(document.querySelectorAll(sentMediaSelector));
  pendingMediaSend = {
    knownMedia,
    expiresAt: Date.now() + 15000,
  };
}

function clearComposerPreview() {
  const composer = getComposer();
  if (!composer) return;

  const preview = composer.querySelector('.media-preview-card');
  if (!preview) return;

  const removeButton = preview.querySelector('button');
  if (removeButton) {
    removeButton.click();
  } else {
    preview.remove();
  }

  composer.querySelectorAll('input[type="file"]').forEach((input) => {
    try {
      input.value = '';
    } catch {}
  });
}

function tryClearPreviewAfterSuccessfulSend() {
  if (!pendingMediaSend) return;

  if (Date.now() > pendingMediaSend.expiresAt) {
    pendingMediaSend = null;
    return;
  }

  const hasNewSentMedia = Array.from(document.querySelectorAll(sentMediaSelector)).some(
    (media) => !pendingMediaSend.knownMedia.has(media),
  );

  if (!hasNewSentMedia) return;

  pendingMediaSend = null;
  if (clearTimer) window.clearTimeout(clearTimer);
  clearTimer = window.setTimeout(() => {
    clearTimer = null;
    clearComposerPreview();
  }, 60);
}

document.addEventListener(
  'click',
  (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.floating-composer .send-paw-button')) {
      armMediaPreviewClear();
    }
  },
  true,
);

document.addEventListener(
  'keydown',
  (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.floating-composer')) {
      armMediaPreviewClear();
    }
  },
  true,
);

const root = document.getElementById('root');
if (root) {
  new MutationObserver(tryClearPreviewAfterSuccessfulSend).observe(root, {
    childList: true,
    subtree: true,
  });
}
