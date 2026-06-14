import { unzipSync } from 'fflate';
import type { Live2DBundle } from '../types';

type LoadedBundle = {
  modelUrl: string;
  dispose: () => void;
};

type UnknownRecord = Record<string, unknown>;

const TRANSPARENT_TEXTURE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function contentTypeFor(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  return 'application/octet-stream';
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Falha ao preparar uma textura Live2D.'));
    reader.readAsDataURL(blob);
  });
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

function rewriteModelSettings(modelJson: unknown, modelFile: string, urls: Map<string, string>): unknown {
  const baseDir = dirname(modelFile);
  const model = rewriteReferences(modelJson, baseDir, urls);
  if (!isRecord(model) || !isRecord(model.FileReferences)) return model;

  const fileReferences = model.FileReferences;
  const requireFile = (key: string) => {
    const url = resolveFileUrl(fileReferences[key], baseDir, urls);
    if (!url) throw new Error(`O modelo Live2D nÃ£o contÃ©m o arquivo obrigatÃ³rio "${key}".`);
    fileReferences[key] = url;
  };
  const optionalFile = (key: string) => {
    if (!(key in fileReferences)) return;
    const url = resolveFileUrl(fileReferences[key], baseDir, urls);
    if (url) fileReferences[key] = url;
    else delete fileReferences[key];
  };

  requireFile('Moc');

  const textures = Array.isArray(fileReferences.Textures)
    ? fileReferences.Textures
      .map((texture) => resolveFileUrl(texture, baseDir, urls))
      .filter((texture): texture is string => Boolean(texture))
    : [];
  if (!textures.length) throw new Error('O modelo Live2D nÃ£o contÃ©m texturas carregÃ¡veis.');
  fileReferences.Textures = textures;

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
          if ('Sound' in next) {
            const soundUrl = resolveFileUrl(next.Sound, baseDir, urls);
            if (soundUrl) next.Sound = soundUrl;
            else delete next.Sound;
          }
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
          if ('Sound' in next) {
            const soundUrl = resolveFileUrl(next.Sound, baseDir, urls);
            if (soundUrl) next.Sound = soundUrl;
            else delete next.Sound;
          }
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
  const files = unzipSync(bundle.bytes);
  const urls = new Map<string, string>();
  const createdUrls: string[] = [];

  await Promise.all(Object.entries(files).map(async ([fileName, bytes]) => {
    const normalized = normalizePath(fileName);
    if (!normalized || normalized === normalizePath(bundle.modelFile)) return;
    const contentType = contentTypeFor(normalized);
    const blob = new Blob([bytes], { type: contentType });
    const url = contentType.startsWith('image/')
      ? await blobToDataUrl(blob)
      : URL.createObjectURL(blob);
    urls.set(normalized.toLowerCase(), url);
    if (url.startsWith('blob:')) createdUrls.push(url);
  }));

  const modelFile = normalizePath(bundle.modelFile);
  const modelEntry = Object.entries(files).find(
    ([fileName]) => normalizePath(fileName).toLowerCase() === modelFile.toLowerCase(),
  );
  const modelBytes = modelEntry?.[1];
  if (!modelBytes) {
    createdUrls.forEach((url) => URL.revokeObjectURL(url));
    throw new Error(`O pacote não contém ${bundle.modelFile}.`);
  }

  const modelJson = JSON.parse(new TextDecoder().decode(modelBytes)) as unknown;
  const rewritten = rewriteModelSettingsForMobile(modelJson, modelFile, urls);
  const modelUrl = URL.createObjectURL(new Blob([JSON.stringify(rewritten)], { type: 'application/json' }));
  createdUrls.push(modelUrl);

  return {
    modelUrl,
    dispose: () => createdUrls.forEach((url) => URL.revokeObjectURL(url)),
  };
}
