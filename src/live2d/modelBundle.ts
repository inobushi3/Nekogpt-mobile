import { unzipSync } from 'fflate';
import type { Live2DBundle } from '../types';

type LoadedBundle = {
  modelUrl: string;
  dispose: () => void;
};

type UnknownRecord = Record<string, unknown>;

const TRANSPARENT_TEXTURE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const LOW_MEMORY_ARCHIVE_LIMIT = 160 * 1024 * 1024;
const DEFAULT_ARCHIVE_LIMIT = 320 * 1024 * 1024;
const LOW_MEMORY_UNCOMPRESSED_LIMIT = 320 * 1024 * 1024;
const DEFAULT_UNCOMPRESSED_LIMIT = 700 * 1024 * 1024;

function contentTypeFor(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  return 'application/octet-stream';
}

function normalizePath(value: string) {
  const parts: string[] = [];
  value.replace(/\\/g, '/').split('/').forEach((part) => {
    if (!part || part === '.') return;
    if (part === '..') parts.pop();
    else parts.push(part);
  });
  return parts.join('/');
}

function dirname(value: string) {
  const normalized = normalizePath(value);
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(0, index) : '';
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAudioAsset(fileName: string) {
  return /\.(?:wav|mp3|ogg|m4a|aac|flac)$/i.test(fileName);
}

function looksLikeLocalAsset(value: string) {
  if (!value || /^(?:https?:|blob:|data:)/i.test(value)) return false;
  const clean = value.split(/[?#]/, 1)[0];
  return /\.(?:moc3?|png|jpe?g|webp|json|wav|mp3|ogg|m4a|aac|flac)$/i.test(clean);
}

function getDeviceMemoryGB() {
  if (typeof navigator === 'undefined') return 8;
  const value = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory);
  return Number.isFinite(value) && value > 0 ? value : 8;
}

function getBundleLimits() {
  const lowMemory = getDeviceMemoryGB() <= 4;
  return {
    archive: lowMemory ? LOW_MEMORY_ARCHIVE_LIMIT : DEFAULT_ARCHIVE_LIMIT,
    uncompressed: lowMemory ? LOW_MEMORY_UNCOMPRESSED_LIMIT : DEFAULT_UNCOMPRESSED_LIMIT,
  };
}

function addCollapsedPathVariants(paths: Set<string>, value: string) {
  const normalized = normalizePath(value);
  if (!normalized.includes('/')) return;
  paths.add(normalized.replace(/\//g, '_'));
  const parts = normalized.split('/');
  for (let index = 0; index < parts.length - 1; index += 1) {
    paths.add([
      ...parts.slice(0, index),
      `${parts[index]}_${parts.slice(index + 1).join('_')}`,
    ].filter(Boolean).join('/'));
  }
}

function referenceCandidates(value: string, baseDir: string) {
  const paths = new Set<string>();
  const normalized = normalizePath(value);
  if (normalized.startsWith('/')) {
    paths.add(normalizePath(normalized.replace(/^\/+/, '')));
  } else {
    paths.add(normalizePath(baseDir ? `${baseDir}/${normalized}` : normalized));
    paths.add(normalized);
  }
  [...paths].forEach((pathValue) => addCollapsedPathVariants(paths, pathValue));
  return [...paths];
}

function collectReferencedPaths(value: unknown, baseDir: string, paths: Set<string>) {
  if (typeof value === 'string') {
    if (!looksLikeLocalAsset(value) || isAudioAsset(value)) return;
    let cleanValue = value.split(/[?#]/, 1)[0];
    try {
      cleanValue = decodeURIComponent(cleanValue);
    } catch {}
    referenceCandidates(cleanValue, baseDir).forEach((candidate) => paths.add(candidate.toLowerCase()));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectReferencedPaths(item, baseDir, paths));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>)
      .forEach((item) => collectReferencedPaths(item, baseDir, paths));
  }
}

function resolveFileUrl(value: unknown, baseDir: string, urls: Map<string, string>) {
  if (typeof value !== 'string') return null;
  if (/^(?:https?:|blob:|data:)/i.test(value)) return value;
  const rawValue = value.split(/[?#]/, 1)[0];
  let cleanValue = rawValue;
  try {
    cleanValue = decodeURIComponent(rawValue);
  } catch {}
  for (const candidate of referenceCandidates(cleanValue, baseDir)) {
    const url = urls.get(candidate.toLowerCase());
    if (url) return url;
  }
  return null;
}

function rewriteReferences(value: unknown, baseDir: string, urls: Map<string, string>): unknown {
  if (typeof value === 'string') {
    const url = resolveFileUrl(value, baseDir, urls);
    if (url) return url;
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => rewriteReferences(item, baseDir, urls));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, rewriteReferences(item, baseDir, urls)])
    );
  }
  return value;
}

function rewriteModelSettingsForMobile(modelJson: unknown, modelFile: string, urls: Map<string, string>): unknown {
  const baseDir = dirname(modelFile);
  const model = rewriteReferences(modelJson, baseDir, urls);
  if (!isRecord(model) || !isRecord(model.FileReferences)) return model;

  const fileReferences = model.FileReferences;
  const requireFile = (key: string) => {
    const url = resolveFileUrl(fileReferences[key], baseDir, urls);
    if (!url) throw new Error(`O modelo Live2D nao contem o arquivo obrigatorio "${key}".`);
    fileReferences[key] = url;
  };
  const optionalFile = (key: string) => {
    if (!(key in fileReferences)) return;
    const url = resolveFileUrl(fileReferences[key], baseDir, urls);
    if (url) fileReferences[key] = url;
    else delete fileReferences[key];
  };

  requireFile('Moc');

  const textureUrls = Array.isArray(fileReferences.Textures)
    ? fileReferences.Textures.map((texture) => resolveFileUrl(texture, baseDir, urls))
    : [];
  const realTextureCount = textureUrls.filter(Boolean).length;
  if (!realTextureCount) throw new Error('O modelo Live2D nao contem texturas carregaveis.');
  fileReferences.Textures = textureUrls.map((texture) => texture || TRANSPARENT_TEXTURE_DATA_URL);

  ['Physics', 'Pose', 'DisplayInfo', 'UserData'].forEach(optionalFile);

  if (Array.isArray(fileReferences.Expressions)) {
    const expressions = fileReferences.Expressions
      .filter(isRecord)
      .map((expression) => {
        const url = resolveFileUrl(expression.File, baseDir, urls);
        return url ? { ...expression, File: url } : null;
      })
      .filter((expression): expression is UnknownRecord & { File: string } => Boolean(expression));
    if (expressions.length) fileReferences.Expressions = expressions;
    else delete fileReferences.Expressions;
  }

  if (isRecord(fileReferences.Motions)) {
    const motionGroups: UnknownRecord = {};
    Object.entries(fileReferences.Motions).forEach(([groupName, group]) => {
      if (!Array.isArray(group)) return;
      const motions = group
        .filter(isRecord)
        .map((motion) => {
          const url = resolveFileUrl(motion.File, baseDir, urls);
          if (!url) return null;
          const next = { ...motion, File: url };
          // Motion audio is intentionally omitted on mobile. The companion uses its
          // own TTS and retaining motion sounds can keep tens of MB alive for no gain.
          if ('Sound' in next) delete next.Sound;
          return next;
        })
        .filter((motion): motion is UnknownRecord & { File: string } => Boolean(motion));
      if (motions.length) motionGroups[groupName] = motions;
    });
    if (Object.keys(motionGroups).length) fileReferences.Motions = motionGroups;
    else delete fileReferences.Motions;
  }

  return model;
}

export async function loadModelBundle(bundle: Live2DBundle): Promise<LoadedBundle> {
  const limits = getBundleLimits();
  if (bundle.bytes.byteLength > limits.archive) {
    throw new Error('Este modelo Live2D e grande demais para carregar com seguranca neste dispositivo.');
  }

  const files = unzipSync(bundle.bytes);
  let uncompressedBytes = 0;
  for (const fileName of Object.keys(files)) {
    uncompressedBytes += files[fileName]?.byteLength || 0;
    if (uncompressedBytes > limits.uncompressed) {
      throw new Error('Este modelo Live2D usa memoria demais para este dispositivo.');
    }
  }

  const modelFile = normalizePath(bundle.modelFile);
  const modelFileKey = Object.keys(files).find(
    (fileName) => normalizePath(fileName).toLowerCase() === modelFile.toLowerCase(),
  );
  const modelBytes = modelFileKey ? files[modelFileKey] : undefined;
  if (!modelBytes) throw new Error(`O pacote não contém ${bundle.modelFile}.`);

  const modelJson = JSON.parse(new TextDecoder().decode(modelBytes)) as unknown;
  const baseDir = dirname(modelFile);
  const referencedPaths = new Set<string>();
  collectReferencedPaths(modelJson, baseDir, referencedPaths);

  const urls = new Map<string, string>();
  const createdUrls: string[] = [];

  try {
    // Process assets sequentially. The old Promise.all + FileReader data-URL path
    // duplicated every texture in memory at once and was the main source of tab
    // crashes on large models. Blob URLs keep one binary copy and are released on
    // model disposal.
    for (const fileName of Object.keys(files)) {
      const normalized = normalizePath(fileName);
      if (!normalized || normalized.toLowerCase() === modelFile.toLowerCase()) continue;
      if (isAudioAsset(normalized)) continue;
      if (referencedPaths.size && !referencedPaths.has(normalized.toLowerCase())) continue;

      const bytes = files[fileName];
      if (!bytes) continue;
      const blob = new Blob([bytes], { type: contentTypeFor(normalized) });
      const url = URL.createObjectURL(blob);
      urls.set(normalized.toLowerCase(), url);
      createdUrls.push(url);
    }

    const rewritten = rewriteModelSettingsForMobile(modelJson, modelFile, urls);
    const modelUrl = URL.createObjectURL(new Blob([JSON.stringify(rewritten)], { type: 'application/json' }));
    createdUrls.push(modelUrl);

    return {
      modelUrl,
      dispose: () => createdUrls.forEach((url) => URL.revokeObjectURL(url)),
    };
  } catch (error) {
    createdUrls.forEach((url) => URL.revokeObjectURL(url));
    throw error;
  }
}
