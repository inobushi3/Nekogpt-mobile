const BACKGROUND_VIDEO_CLASS = 'companion-background-video';
const BACKGROUND_VIDEO_SRC = '/night-scene-animated.mp4';

let installed = false;
let observer: MutationObserver | null = null;

function ensureBackgroundVideo() {
  const screen = document.querySelector<HTMLElement>('.companion-screen');
  if (!screen) return false;

  let video = screen.querySelector<HTMLVideoElement>(`.${BACKGROUND_VIDEO_CLASS}`);
  if (!video) {
    video = document.createElement('video');
    video.className = BACKGROUND_VIDEO_CLASS;
    video.src = BACKGROUND_VIDEO_SRC;
    video.autoplay = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('aria-hidden', 'true');
    video.setAttribute('tabindex', '-1');
    video.setAttribute('disablepictureinpicture', '');
    screen.prepend(video);
  }

  video.muted = true;
  if (video.paused) void video.play().catch(() => undefined);
  return true;
}

function retryBackgroundVideo() {
  if (ensureBackgroundVideo()) return;
  window.requestAnimationFrame(retryBackgroundVideo);
}

export function installBackgroundVideo() {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  const start = () => {
    retryBackgroundVideo();
    observer = new MutationObserver(() => ensureBackgroundVideo());
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') ensureBackgroundVideo();
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
