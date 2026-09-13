import 'https://nekogpt-mobile-9oyoosiyr-inobushi3s-projects.vercel.app/assets/index-DoK11xDG.js';

const DB_NAME = 'nekogpt-media-history-v1';
const DB_VERSION = 1;
const STORE_NAME = 'attachments';
const MAX_PERSISTED_ATTACHMENTS = 80;
const MAX_BLOB_BYTES = 32 * 1024 * 1024;

const storedAttachments = new Map();
const objectUrls = new Map();
const persistInFlight = new Set();
let restoreQueued = false;
let cacheLoaded = false;
let dbPromise = null;

const getUserLines = () => Array.from(document.querySelectorAll('.app-message-line--user'));
const getMessageContent = (line) => line.querySelector('.app-message-content')?.textContent?.trim() || '';

function getOccurrenceFromEnd(lines, index, content) {
  let occurrence = 0;
  for (let cursor = lines.length - 1; cursor > index; cursor -= 1) {
    if (getMessageContent(lines[cursor]) === content) occurrence += 1;
  }
  return occurrence;
}

function openDatabase() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB unavailable'));
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open media cache'));
  });

  return dbPromise;
}

async function readPersistedAttachments() {
  if (cacheLoaded) return;
  cacheLoaded = true;

  try {
    const db = await openDatabase();
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    for (const record of records) {
      if (record?.key && record?.content) storedAttachments.set(record.key, record);
    }
  } catch {
    // The chat still works normally when persistent browser storage is unavailable.
  }
}

async function prunePersistedAttachments(db) {
  try {
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    if (records.length <= MAX_PERSISTED_ATTACHMENTS) return;

    records.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const stale = records.slice(MAX_PERSISTED_ATTACHMENTS);
    await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const record of stale) store.delete(record.key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Best-effort cleanup only.
  }
}

async function savePersistedAttachment(record) {
  try {
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    void prunePersistedAttachments(db);
  } catch {
    // In-memory restoration remains available for this page session.
  }
}

async function persistMedia(item, src) {
  if (!src || persistInFlight.has(item.key)) return;
  persistInFlight.add(item.key);

  try {
    let blob = null;
    try {
      const response = await fetch(src);
      if (response.ok) {
        const candidate = await response.blob();
        if (candidate.size > 0 && candidate.size <= MAX_BLOB_BYTES) blob = candidate;
      }
    } catch {
      // Remote URLs may reject fetch/CORS; keep the URL as a fallback when possible.
    }

    const persistentSrc = blob || !src.startsWith('blob:') ? src : '';
    const record = {
      key: item.key,
      content: item.content,
      occurrenceFromEnd: item.occurrenceFromEnd,
      kind: item.kind,
      blob,
      src: persistentSrc,
      updatedAt: Date.now(),
    };

    storedAttachments.set(item.key, record);
    await savePersistedAttachment(record);
  } finally {
    persistInFlight.delete(item.key);
  }
}

function captureAttachments() {
  const lines = getUserLines();

  lines.forEach((line, index) => {
    const content = getMessageContent(line);
    if (!content) return;

    const media = line.querySelector('.app-message-attachments img, .app-message-attachments video');
    if (!media?.src || media.closest('.nekogpt-persisted-attachments')) return;

    const occurrenceFromEnd = getOccurrenceFromEnd(lines, index, content);
    const kind = media.tagName === 'VIDEO' ? 'video' : 'image';
    const key = `${content}\u0000${occurrenceFromEnd}`;
    const item = { key, content, occurrenceFromEnd, kind };

    // Keep an immediate session fallback while the Blob is being copied to IndexedDB.
    storedAttachments.set(key, {
      ...item,
      src: media.src,
      blob: null,
      updatedAt: Date.now(),
    });

    void persistMedia(item, media.currentSrc || media.src);
  });
}

function findTargetLine(item) {
  const matches = getUserLines().filter((line) => getMessageContent(line) === item.content);
  return matches[matches.length - 1 - item.occurrenceFromEnd] || null;
}

function getRestoredSource(item) {
  if (item.blob instanceof Blob && item.blob.size > 0) {
    if (!objectUrls.has(item.key)) objectUrls.set(item.key, URL.createObjectURL(item.blob));
    return objectUrls.get(item.key);
  }
  return item.src || '';
}

async function restoreAttachments() {
  restoreQueued = false;
  await readPersistedAttachments();
  captureAttachments();

  for (const item of storedAttachments.values()) {
    const line = findTargetLine(item);
    if (!line || line.querySelector('.app-message-attachments')) continue;

    const bubble = line.querySelector('.app-message-bubble--user');
    if (!bubble) continue;

    const source = getRestoredSource(item);
    if (!source) continue;

    // Hide the immersion-breaking placeholder immediately while restoring the media.
    const contentNode = line.querySelector('.app-message-content');
    if (contentNode) contentNode.style.display = 'none';

    const wrapper = document.createElement('span');
    wrapper.className = 'app-message-attachments nekogpt-persisted-attachments';
    wrapper.dataset.mediaKey = item.key;

    const attachment = document.createElement('span');
    attachment.className = 'app-message-attachment';

    if (item.kind === 'video') {
      const video = document.createElement('video');
      video.src = source;
      video.muted = true;
      video.playsInline = true;
      video.controls = true;
      video.preload = 'metadata';
      attachment.appendChild(video);
    } else {
      const image = document.createElement('img');
      image.src = source;
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
  requestAnimationFrame(() => void restoreAttachments());
}

const root = document.getElementById('root');
if (root) {
  new MutationObserver(queueRestore).observe(root, { childList: true, subtree: true });
  void readPersistedAttachments().finally(queueRestore);
}

window.addEventListener('pagehide', () => {
  captureAttachments();
});
