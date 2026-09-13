type StoredAttachment = {
  key: string;
  content: string;
  occurrenceFromEnd: number;
  kind: 'image' | 'video';
  src: string;
};

const storedAttachments = new Map<string, StoredAttachment>();
let restoreQueued = false;

function getUserLines() {
  return Array.from(document.querySelectorAll<HTMLElement>('.app-message-line--user'));
}

function getMessageContent(line: HTMLElement) {
  return line.querySelector<HTMLElement>('.app-message-content')?.textContent?.trim() || '';
}

function getOccurrenceFromEnd(lines: HTMLElement[], index: number, content: string) {
  let occurrence = 0;
  for (let cursor = lines.length - 1; cursor > index; cursor -= 1) {
    if (getMessageContent(lines[cursor]) === content) occurrence += 1;
  }
  return occurrence;
}

function captureAttachments() {
  const lines = getUserLines();
  lines.forEach((line, index) => {
    const content = getMessageContent(line);
    if (!content) return;
    const media = line.querySelector<HTMLImageElement | HTMLVideoElement>('.app-message-attachments img, .app-message-attachments video');
    if (!media?.src || media.closest('.nekogpt-persisted-attachments')) return;
    const occurrenceFromEnd = getOccurrenceFromEnd(lines, index, content);
    const kind = media.tagName === 'VIDEO' ? 'video' : 'image';
    const key = `${content}\u0000${occurrenceFromEnd}`;
    storedAttachments.set(key, { key, content, occurrenceFromEnd, kind, src: media.src });
  });
}

function findTargetLine(item: StoredAttachment) {
  const matches = getUserLines().filter((line) => getMessageContent(line) === item.content);
  return matches[matches.length - 1 - item.occurrenceFromEnd] || null;
}

function restoreAttachments() {
  restoreQueued = false;
  captureAttachments();

  for (const item of storedAttachments.values()) {
    const line = findTargetLine(item);
    if (!line || line.querySelector('.app-message-attachments')) continue;
    const bubble = line.querySelector<HTMLElement>('.app-message-bubble--user');
    if (!bubble) continue;

    const wrapper = document.createElement('span');
    wrapper.className = 'app-message-attachments nekogpt-persisted-attachments';
    const attachment = document.createElement('span');
    attachment.className = 'app-message-attachment';

    if (item.kind === 'video') {
      const video = document.createElement('video');
      video.src = item.src;
      video.muted = true;
      video.playsInline = true;
      video.controls = true;
      video.preload = 'metadata';
      attachment.appendChild(video);
    } else {
      const image = document.createElement('img');
      image.src = item.src;
      image.alt = '';
      attachment.appendChild(image);
    }

    wrapper.appendChild(attachment);
    bubble.appendChild(wrapper);
  }
}

function queueRestore() {
  if (restoreQueued) return;
  restoreQueued = true;
  window.requestAnimationFrame(restoreAttachments);
}

export function installMediaAttachmentPersistence() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const root = document.getElementById('root');
  if (!root) return;

  const observer = new MutationObserver(queueRestore);
  observer.observe(root, { childList: true, subtree: true });
  queueRestore();
}
