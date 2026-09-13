import 'https://nekogpt-mobile-3kimvm8bp-inobushi3s-projects.vercel.app/assets/index-DoK11xDG.js';

const settingsGlassStyle = document.createElement('style');
settingsGlassStyle.id = 'nekogpt-settings-glass';
settingsGlassStyle.textContent = `
html body .companion-screen .settings-panel {
  border: 1px solid rgba(255, 255, 255, 0.14) !important;
  border-radius: 18px !important;
  background:
    linear-gradient(145deg, rgba(255,255,255,0.055), rgba(255,255,255,0.012) 42%, rgba(0,0,0,0.055)),
    rgba(15, 13, 17, 0.42) !important;
  box-shadow: 0 14px 42px rgba(0, 0, 0, 0.22) !important;
  -webkit-backdrop-filter: blur(24px) saturate(1.05) !important;
  backdrop-filter: blur(24px) saturate(1.05) !important;
  overflow: hidden !important;
}

@media (max-width: 620px) {
  html body .companion-screen .settings-panel {
    border-radius: 17px !important;
    background:
      linear-gradient(145deg, rgba(255,255,255,0.055), rgba(255,255,255,0.012) 42%, rgba(0,0,0,0.055)),
      rgba(14, 12, 16, 0.38) !important;
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
