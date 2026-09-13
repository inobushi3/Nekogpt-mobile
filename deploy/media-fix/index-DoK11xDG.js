import 'https://nekogpt-mobile-dfjdunl91-inobushi3s-projects.vercel.app/assets/index-DoK11xDG.js';

const notificationFadeStyle = document.createElement('style');
notificationFadeStyle.id = 'nekogpt-notification-fade-v3';
notificationFadeStyle.textContent = `
html body .companion-screen .notice,
html body .companion-screen .companion-status {
  position: relative !important;
  isolation: isolate !important;
  overflow: visible !important;
  padding: 2px 9px !important;
  background: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}

html body .companion-screen .notice::before,
html body .companion-screen .companion-status::before {
  content: '' !important;
  position: absolute !important;
  z-index: -1 !important;
  pointer-events: none !important;
  top: -5px !important;
  bottom: -5px !important;
  left: -15px !important;
  right: -15px !important;
  border: 0 !important;
  border-radius: 10px !important;
  background: rgba(7, 7, 10, 0.62) !important;
  -webkit-backdrop-filter: blur(10px) saturate(108%) !important;
  backdrop-filter: blur(10px) saturate(108%) !important;
  -webkit-mask-image: linear-gradient(
    90deg,
    transparent 0%,
    rgba(0, 0, 0, 0.35) 10%,
    #000 24%,
    #000 76%,
    rgba(0, 0, 0, 0.35) 90%,
    transparent 100%
  ) !important;
  mask-image: linear-gradient(
    90deg,
    transparent 0%,
    rgba(0, 0, 0, 0.35) 10%,
    #000 24%,
    #000 76%,
    rgba(0, 0, 0, 0.35) 90%,
    transparent 100%
  ) !important;
}
`;
document.head.appendChild(notificationFadeStyle);
