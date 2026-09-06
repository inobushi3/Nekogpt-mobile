import { unzipSync } from 'fflate';
import type { Live2DBundle } from '../types';

type LoadedBundle = {
  modelUrl: string;
  dispose: () => void;
};

type UnknownRecord = Record<string, unknown>;

type ArchiveEntry = {
  name: string;
  normalized: string;
  originalSize: number;
};

const TRANSPARENT_TEXTURE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const LOW_MEMORY_ARCHIVE_LIMIT = 140 * 1024 * 1024;
const DEFAULT_ARCHIVE_LIMIT = 320 * 1024 * 1024;
const LOW_MEMORY_UNCOMPRESSED_LIMIT = 240 * 1024 * 1024;
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

function isMobileDevice() {
  return typeof window !== 'undefined'
    && (window.innerWidth <= 820 || window.matchMedia?.('(pointer: coarse)').matches);
}

function getDeviceMemoryGB() {
  if (typeof navigator === 'undefined') return 8;
  const value = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory);
  return Number.isFinite(value) && value > 0 ? value : 8;
}

function getBundleLimits() {
  const lowMemory = isMobileDevice() && getDeviceMemoryGB() <= 4;
  return {
    archive: lowMemory ? LOW_MEMORY_ARCHIVE_LIMIT : DEFAULT_ARCHIVE_LIMIT,
    uncompressed: lowMemory ? LOW_MEMORY_UNCOMPRESSED_LIMIT : DEFAULT_UNCOMPRESSED_LIMIT,
  };
}

function getTextureLimit() {
  if (!isMobileDevice()) return 2048;
  return getDeviceMemoryGB() <= 4 ? 768 : 1024;
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

function listArchiveEntries(bytes: Uint8Array) {
  const entries: ArchiveEntry[] = [];
  unzipSync(bytes, {
    filter: (file) => {
      const normalized = normalizePath(file.name);
      if (normalized) {
        entries.push({
          name: file.name,
          normalized,
          originalSize: Math.max(0, Number(file.originalSize) || 0),
        });
      }
      return false;
    },
  });
  return entries;
}

function extractArchiveEntry(bytes: Uint8Array, entry: ArchiveEntry) {
  const extracted = unzipSync(bytes, {
    filter: (file) => file.name === entry.name,
  });
  return extracted[entry.name];
}

function getPngDimensions(bytes: Uint8Array) {
  if (bytes.byteLength < 24) return null;
  if (
    bytes[0] !== 137
    || bytes[1] !== 80
    || bytes[2] !== 78
    || bytes[3] !== 71
    || bytes[12] !== 73
    || bytes[13] !== 72
    || bytes[14] !== 68
    || bytes[15] !== 82
  ) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return width > 0 && height > 0 ? { width, height } : null;
}

async function createAssetBlob(fileName: string, bytes: Uint8Array) {
  const type = contentTypeFor(fileName);
  const ownedBytes = new Uint8Array(bytes);
  const original = new Blob([ownedBytes.buffer], { type });
  const textureLimit = getTextureLimit();
  if (!textureLimit || type !== 'image/png') return original;

  const dimensions = getPngDimensions(bytes);
  if (!dimensions || Math.max(dimensions.width, dimensions.height) <= textureLimit) return original;

  const ratio = textureLimit / Math.max(dimensions.width, dimensions.height);
  const width = Math.max(1, Math.round(dimensions.width * ratio));
  const height = Math.max(1, Math.round(dimensions.height * ratio));
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    if (Math.max(dimensions.width, dimensions.height) > 4096) {
      throw new Error(`A textura ${fileName} e grande demais para este celular.`);
    }
    return original;
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(original, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'medium',
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return original;
    context.drawImage(bitmap, 0, 0, width, height);
    const resized = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    canvas.width = 1;
    canvas.height = 1;
    if (resized) return resized;
  } catch {
    if (Math.max(dimensions.width, dimensions.height) > 4096) {
      throw new Error(`A textura ${fileName} e grande demais para este celular.`);
    }
  } finally {
    try {
      bitmap?.close();
    } catch {}
  }
  return original;
}

export async function loadModelBundle(bundle: Live2DBundle): Promise<LoadedBundle> {
  const limits = getBundleLimits();
  if (bundle.bytes.byteLength > limits.archive) {
    throw new Error('Este modelo Live2D e grande demais para carregar com seguranca neste dispositivo.');
  }

  // First pass reads ZIP metadata only. Nothing is decompressed here, so a model
  // with dozens of huge unused assets cannot immediately exhaust mobile memory.
  const archiveEntries = listArchiveEntries(bundle.bytes);
  const modelFile = normalizePath(bundle.modelFile);
  const modelEntry = archiveEntries.find(
    (entry) => entry.normalized.toLowerCase() === modelFile.toLowerCase(),
  );
  if (!modelEntry) throw new Error(`O pacote não contém ${bundle.modelFile}.`);

  // Extract only model3.json first so we know exactly which files the model uses.
  const modelBytes = extractArchiveEntry(bundle.bytes, modelEntry);
  if (!modelBytes) throw new Error(`O pacote não contém ${bundle.modelFile}.`);
  const modelJson = JSON.parse(new TextDecoder().decode(modelBytes)) as unknown;
  const baseDir = dirname(modelFile);
  const referencedPaths = new Set<string>();
  collectReferencedPaths(modelJson, baseDir, referencedPaths);

  const assetEntries = archiveEntries.filter((entry) => {
    if (entry.name === modelEntry.name || isAudioAsset(entry.normalized)) return false;
    return referencedPaths.has(entry.normalized.toLowerCase());
  });

  const retainedBytes = modelEntry.originalSize
    + assetEntries.reduce((total, entry) => total + entry.originalSize, 0);
  if (retainedBytes > limits.uncompressed) {
    throw new Error('Este modelo Live2D usa memoria demais para este dispositivo.');
  }

  const urls = new Map<string, string>();
  const createdUrls: string[] = [];

  try {
    // Each referenced asset is decompressed separately and released before the next
    // one. This avoids unzipSync keeping every texture/motion in RAM at the same time.
    for (const entry of assetEntries) {
      const bytes = extractArchiveEntry(bundle.bytes, entry);
      if (!bytes) continue;
      const blob = await createAssetBlob(entry.normalized, bytes);
      const url = URL.createObjectURL(blob);
      urls.set(entry.normalized.toLowerCase(), url);
      createdUrls.push(url);
      await Promise.resolve();
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
