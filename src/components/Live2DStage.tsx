import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import type { AppLanguage } from '../i18n';
import { t } from '../i18n';
import type {
  CompanionLive2DAction,
  CompanionLive2DState,
  Live2DBundle,
  Live2DTouchPayload,
} from '../types';
import { loadModelBundle } from '../live2d/modelBundle';
import { loadLive2DRuntime } from '../live2d/runtime';

type Live2DStageProps = {
  bundle: Live2DBundle | null;
  language: AppLanguage;
  emotion: string;
  emotionTrigger?: number;
  companionState?: CompanionLive2DState | null;
  speaking: boolean;
  listening?: boolean;
  audioLevel: number;
  onLoaded?: () => void;
  onLoadError?: (message: string) => void;
  onTouch?: (payload: Live2DTouchPayload) => void;
};

type PointerStart = {
  x: number;
  y: number;
  at: number;
  multiTouch: boolean;
};

const PARAMETER_IDS = {
  mouthOpen: ['ParamMouthOpenY', 'PARAM_MOUTH_OPEN_Y'],
  mouthForm: ['ParamMouthForm', 'PARAM_MOUTH_FORM', 'ParamMouthX', 'MouthForm'],
  angleX: ['ParamAngleX', 'PARAM_ANGLE_X', 'ParamHeadAngleX', 'HeadAngleX', 'AngleX'],
  angleY: ['ParamAngleY', 'PARAM_ANGLE_Y', 'ParamHeadAngleY', 'HeadAngleY', 'AngleY'],
  angleZ: ['ParamAngleZ', 'PARAM_ANGLE_Z', 'ParamHeadAngleZ', 'HeadAngleZ', 'AngleZ'],
  bodyX: ['ParamBodyAngleX', 'PARAM_BODY_ANGLE_X', 'ParamTorsoAngleX', 'BodyAngleX', 'BodyX'],
  bodyY: ['ParamBodyAngleY', 'PARAM_BODY_ANGLE_Y', 'ParamTorsoAngleY', 'BodyAngleY', 'BodyY'],
  bodyZ: ['ParamBodyAngleZ', 'PARAM_BODY_ANGLE_Z', 'ParamBodyRotateZ', 'BodyAngleZ', 'BodyZ'],
  eyeBallX: ['ParamEyeBallX', 'PARAM_EYE_BALL_X', 'EyeBallX'],
  eyeBallY: ['ParamEyeBallY', 'PARAM_EYE_BALL_Y', 'EyeBallY'],
  eyeLOpen: ['ParamEyeLOpen', 'PARAM_EYE_L_OPEN', 'ParamEyeLeftOpen', 'EyeLOpen', 'LeftEyeOpen'],
  eyeROpen: ['ParamEyeROpen', 'PARAM_EYE_R_OPEN', 'ParamEyeRightOpen', 'EyeROpen', 'RightEyeOpen'],
  eyeSmile: ['ParamEyeSmile', 'PARAM_EYE_SMILE', 'EyeSmile'],
  browLY: ['ParamBrowLY', 'PARAM_BROW_L_Y', 'ParamBrowLForm', 'BrowLY'],
  browRY: ['ParamBrowRY', 'PARAM_BROW_R_Y', 'ParamBrowRForm', 'BrowRY'],
  breath: ['ParamBreath', 'PARAM_BREATH'],
};

const MIN_STAGE_ZOOM = 0.3;
const MAX_STAGE_ZOOM = 18;
const LIVE2D_FORCE_PRIORITY = 3;
const LIVE2D_MAX_FPS = 60;
const LIVE2D_AUDIO_MOTION_TAU = Math.PI * 2;

type Live2DSpeechSource = 'speaking' | 'listening';

type Live2DAudioMotionSettings = {
  enabled: boolean;
  intensity: number;
  speed: number;
  bodyFollowRatio: number;
  volumeThreshold: number;
  smoothing: number;
};

type Live2DAudioMotionOscillator = {
  ids: string[];
  freqRatio: number;
  amplitude: number;
  isBody: boolean;
};

const LIVE2D_SPEAKING_MOTION_DEFAULTS: Live2DAudioMotionSettings = {
  enabled: true,
  intensity: 0.55,
  speed: 2,
  bodyFollowRatio: 0.5,
  volumeThreshold: 0.02,
  smoothing: 0.85,
};

const LIVE2D_LISTENING_MOTION_DEFAULTS: Live2DAudioMotionSettings = {
  enabled: true,
  intensity: 0.8,
  speed: 1.4,
  bodyFollowRatio: 0.4,
  volumeThreshold: 0.008,
  smoothing: 0.88,
};

const LIVE2D_AUDIO_MOTION_OSCILLATORS_SPEAKING: Live2DAudioMotionOscillator[] = [
  { ids: PARAMETER_IDS.angleY, freqRatio: 1, amplitude: 6, isBody: false },
  { ids: PARAMETER_IDS.angleY, freqRatio: 2.3, amplitude: 3, isBody: false },
  { ids: PARAMETER_IDS.angleX, freqRatio: 0.7, amplitude: 4, isBody: false },
  { ids: PARAMETER_IDS.angleX, freqRatio: 1.6, amplitude: 2, isBody: false },
  { ids: PARAMETER_IDS.angleZ, freqRatio: 0.5, amplitude: 3, isBody: false },
  { ids: PARAMETER_IDS.angleZ, freqRatio: 1.3, amplitude: 1.5, isBody: false },
  { ids: PARAMETER_IDS.bodyX, freqRatio: 0.35, amplitude: 3, isBody: true },
  { ids: PARAMETER_IDS.bodyY, freqRatio: 0.5, amplitude: 2, isBody: true },
];

const LIVE2D_AUDIO_MOTION_OSCILLATORS_LISTENING: Live2DAudioMotionOscillator[] = [
  { ids: PARAMETER_IDS.angleY, freqRatio: 1, amplitude: 8, isBody: false },
  { ids: PARAMETER_IDS.angleY, freqRatio: 1.8, amplitude: 4, isBody: false },
  { ids: PARAMETER_IDS.angleX, freqRatio: 0.6, amplitude: 3, isBody: false },
  { ids: PARAMETER_IDS.angleX, freqRatio: 1.4, amplitude: 1.5, isBody: false },
  { ids: PARAMETER_IDS.angleZ, freqRatio: 0.45, amplitude: 2, isBody: false },
  { ids: PARAMETER_IDS.angleZ, freqRatio: 1.1, amplitude: 1, isBody: false },
  { ids: PARAMETER_IDS.bodyX, freqRatio: 0.3, amplitude: 2.5, isBody: true },
  { ids: PARAMETER_IDS.bodyY, freqRatio: 0.4, amplitude: 2, isBody: true },
];

const LIVE2D_EMOTION_CANDIDATES: Record<string, string[]> = {
  neutral: ['neutral', 'normal', 'idle', 'default'],
  happy: ['happy', 'smile', 'smiling', 'joy', 'laugh', 'laughing', 'excited', 'feliz', 'alegre'],
  sad: ['sad', 'sadness', 'cry', 'crying', 'tears', 'triste'],
  angry: ['angry', 'mad', 'anger', 'annoyed', 'upset', 'brava', 'raiva'],
  surprised: ['surprised', 'surprise', 'shock', 'shocked', 'wow'],
  shy: ['shy', 'blush', 'embarrassed', 'flustered', '照れ'],
  love: ['love', 'heart', 'affection', 'loving', 'koi'],
  fear: ['fear', 'scared', 'afraid', 'panic', 'medo'],
  speaking: ['talk', 'talking', 'speak', 'speaking'],
  listening: ['listen', 'listening', 'idle', 'thinking'],
  delighted: ['delighted', 'happy', 'smile'],
  satisfied: ['satisfied', 'happy', 'smile'],
  proud: ['proud', 'happy', 'smile'],
  impressed: ['impressed', 'surprised', 'happy'],
  confident: ['confident', 'happy', 'smile'],
  victory: ['victory', 'happy'],
  dance: ['dance', 'happy'],
  clap: ['clap', 'happy'],
  depressed: ['depressed', 'sad'],
  disappointed: ['disappointed', 'sad'],
  regretful: ['regretful', 'sad'],
  lonely: ['lonely', 'sad'],
  furious: ['furious', 'angry'],
  frustrated: ['frustrated', 'angry'],
  fighting: ['fighting', 'angry'],
  disagree: ['disagree', 'angry'],
  shakehead: ['shakehead', 'shake_head', 'disagree', 'angry'],
  question: ['question', 'curious', 'thinking', 'surprised'],
  curious: ['curious', 'question', 'thinking', 'surprised'],
  confused: ['confused', 'thinking', 'surprised'],
  doubtful: ['doubtful', 'thinking', 'surprised'],
  thinking: ['thinking', 'question', 'curious', 'surprised'],
  teasing: ['teasing', 'shy', 'smile'],
  smug: ['smug', 'shy', 'smile'],
  caring: ['caring', 'love', 'happy'],
  heartbox: ['heartbox', 'heart', 'love'],
  hearteyes: ['hearteyes', 'heart', 'love'],
  kiss: ['kiss', 'love'],
  worried: ['worried', 'fear', 'scared'],
  concerned: ['concerned', 'fear', 'worried'],
  bored: ['bored', 'neutral', 'idle'],
  tired: ['tired', 'sleepy', 'neutral'],
  sleepy: ['sleepy', 'tired', 'neutral'],
  relieved: ['relieved', 'happy', 'relaxed'],
  wave: ['wave', 'happy'],
  nod: ['nod', 'agree', 'happy'],
  agree: ['agree', 'nod', 'happy'],
  bow: ['bow', 'happy'],
  yawn: ['yawn', 'tired', 'neutral'],
  sigh: ['sigh', 'tired', 'neutral'],
  stretch: ['stretch', 'neutral'],
  facepalm: ['facepalm', 'angry', 'frustrated'],
  point: ['point', 'surprised'],
  shrug: ['shrug', 'neutral'],
  excited: ['excited', 'happy', 'smile'],
  laugh: ['laugh', 'laughing', 'happy', 'smile'],
  mad: ['mad', 'angry'],
  shocked: ['shocked', 'surprised'],
  embarrassed: ['embarrassed', 'shy', 'blush'],
  blush: ['blush', 'shy', 'embarrassed'],
  waiting: ['waiting', 'idle', 'neutral'],
  scared: ['scared', 'fear', 'afraid'],
  sick: ['sick', 'tired', 'neutral'],
  dark: ['dark', 'angry', 'fighting'],
  shake_head: ['shake_head', 'shakehead', 'disagree', 'angry'],
  reset: ['reset', 'neutral', 'default'],
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampOptionalNumber(value: unknown, fallback: number, min: number, max: number) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? clamp(numberValue, min, max) : fallback;
}

function getAudioMotionSettings(state: CompanionLive2DState | null | undefined, source: Live2DSpeechSource): Live2DAudioMotionSettings {
  const defaults = source === 'listening'
    ? LIVE2D_LISTENING_MOTION_DEFAULTS
    : LIVE2D_SPEAKING_MOTION_DEFAULTS;
  const prefix = source === 'listening' ? 'listeningMotion' : 'speakingMotion';

  return {
    enabled: typeof state?.[`${prefix}Enabled` as keyof CompanionLive2DState] === 'boolean'
      ? Boolean(state?.[`${prefix}Enabled` as keyof CompanionLive2DState])
      : defaults.enabled,
    intensity: clampOptionalNumber(state?.[`${prefix}Intensity` as keyof CompanionLive2DState], defaults.intensity, 0, 1),
    speed: clampOptionalNumber(state?.[`${prefix}Speed` as keyof CompanionLive2DState], defaults.speed, 0.5, 5),
    bodyFollowRatio: clampOptionalNumber(state?.[`${prefix}BodyFollow` as keyof CompanionLive2DState], defaults.bodyFollowRatio, 0, 1),
    volumeThreshold: clampOptionalNumber(state?.[`${prefix}VolumeThreshold` as keyof CompanionLive2DState], defaults.volumeThreshold, 0, 1),
    smoothing: clampOptionalNumber(state?.[`${prefix}Smoothing` as keyof CompanionLive2DState], defaults.smoothing, 0, 1),
  };
}

type Live2DParameterRef = {
  id: string;
  index: number | null;
};

function normalizeLive2DKey(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function emotionCandidates(emotion: string) {
  const normalized = normalizeLive2DKey(emotion);
  const mapped = LIVE2D_EMOTION_CANDIDATES[normalized] || [];
  return [...new Set([normalized, ...mapped.map(normalizeLive2DKey)].filter(Boolean))];
}

function collectDefinitionNames(definition: unknown) {
  if (!definition || typeof definition !== 'object') return [];
  const record = definition as Record<string, unknown>;
  return ['Name', 'name', 'File', 'file', 'fileName', 'Expression', 'expression']
    .flatMap((key) => typeof record[key] === 'string' ? [String(record[key])] : [])
    .filter(Boolean);
}

function definitionMatches(definition: unknown, candidates: string[]) {
  const names = collectDefinitionNames(definition).map(normalizeLive2DKey).filter(Boolean);
  return names.some((name) => candidates.some((candidate) => name === candidate || name.includes(candidate) || candidate.includes(name)));
}

async function applyModelExpression(model: any, emotion: string) {
  const candidates = emotionCandidates(emotion);
  if (!candidates.length || typeof model?.expression !== 'function') return false;

  for (const candidate of candidates) {
    try {
      const result = await model.expression(candidate);
      if (result !== false) return true;
    } catch {}
  }

  const definitions = model?.internalModel?.motionManager?.expressionManager?.definitions
    || model?.internalModel?.settings?.expressions
    || [];
  if (!Array.isArray(definitions)) return false;

  const matchIndex = definitions.findIndex((definition: unknown) => definitionMatches(definition, candidates));
  if (matchIndex < 0) return false;
  try {
    const result = await model.expression(matchIndex);
    return result !== false;
  } catch {
    return false;
  }
}

function getMotionDefinitions(model: any): Record<string, unknown[]> {
  const definitions = model?.internalModel?.motionManager?.definitions
    || model?.internalModel?.settings?.motions
    || {};
  return definitions && typeof definitions === 'object' ? definitions as Record<string, unknown[]> : {};
}

function findNamedMotionTarget(model: any, preset: string) {
  const normalizedPreset = normalizeLive2DKey(preset);
  if (!normalizedPreset) return null;
  const definitions = getMotionDefinitions(model);
  const groups = Object.keys(definitions);
  for (const group of groups) {
    const normalizedGroup = normalizeLive2DKey(group);
    if (
      normalizedGroup === normalizedPreset
      || normalizedGroup.includes(normalizedPreset)
      || normalizedPreset.includes(normalizedGroup)
    ) {
      return { group, index: 0 };
    }
    const groupDefinitions = Array.isArray(definitions[group]) ? definitions[group] : [];
    const index = groupDefinitions.findIndex((definition) => definitionMatches(definition, [normalizedPreset]));
    if (index >= 0) return { group, index };
  }
  return null;
}

async function applyModelNamedMotion(model: any, preset: string) {
  if (typeof model?.motion !== 'function') return false;
  const target = findNamedMotionTarget(model, preset);
  if (!target) return false;
  try {
    const result = await model.motion(target.group, target.index, LIVE2D_FORCE_PRIORITY, { resetExpression: false });
    return result !== false;
  } catch {
    return false;
  }
}

function getMappedLive2DSignalValue(mapping: Record<string, string> | undefined, signal: string) {
  const normalizedSignal = normalizeLive2DKey(signal);
  if (!mapping || !normalizedSignal) return '';
  for (const [key, value] of Object.entries(mapping)) {
    if (normalizeLive2DKey(key) !== normalizedSignal) continue;
    const cleanValue = String(value || '').trim();
    if (cleanValue) return cleanValue;
  }
  return '';
}

function findEmotionMotionTarget(model: any, emotion: string) {
  const candidates = emotionCandidates(emotion);
  if (!candidates.length) return null;
  const definitions = getMotionDefinitions(model);
  const groups = Object.keys(definitions);
  for (const group of groups) {
    const normalizedGroup = normalizeLive2DKey(group);
    if (candidates.some((candidate) => normalizedGroup === candidate || normalizedGroup.includes(candidate) || candidate.includes(normalizedGroup))) {
      return { group, index: 0 };
    }
    const groupDefinitions = Array.isArray(definitions[group]) ? definitions[group] : [];
    const index = groupDefinitions.findIndex((definition) => definitionMatches(definition, candidates));
    if (index >= 0) return { group, index };
  }
  return null;
}

async function applyModelEmotionMotion(model: any, emotion: string) {
  if (typeof model?.motion !== 'function') return false;
  const target = findEmotionMotionTarget(model, emotion);
  if (!target) return false;
  try {
    const result = await model.motion(target.group, target.index, LIVE2D_FORCE_PRIORITY, { resetExpression: false });
    return result !== false;
  } catch {
    return false;
  }
}

function normalizeParameterId(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeParameterIndex(value: unknown) {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function getCoreLive2DModel(model: any) {
  return model?.internalModel?.coreModel || model?.internalModel?.model || model?.coreModel || null;
}

function live2DIdToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.s === 'string') return record.s;
    if (typeof record.id === 'string') return record.id;
    if (typeof record.name === 'string') return record.name;
    try {
      const getString = (value as { getString?: () => unknown }).getString;
      const stringValue = typeof getString === 'function' ? getString.call(value) : null;
      if (typeof stringValue === 'string') return stringValue;
      if (stringValue && typeof stringValue === 'object' && typeof (stringValue as { s?: unknown }).s === 'string') {
        return (stringValue as { s: string }).s;
      }
    } catch {
      // Fall through to String coercion below.
    }
  }
  const coerced = String(value || '');
  return coerced === '[object Object]' ? '' : coerced;
}

function getLive2DParameterIds(coreModel: any) {
  const ids: string[] = [];
  const addId = (value: unknown) => {
    const id = live2DIdToString(value).trim();
    if (id && !ids.includes(id)) ids.push(id);
  };
  const addIds = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(addId);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(addId);
    }
  };

  const parameterCount = normalizeParameterIndex(coreModel?.getParameterCount?.());
  if (parameterCount !== null && typeof coreModel?.getParameterId === 'function') {
    for (let index = 0; index < parameterCount; index += 1) {
      try {
        addId(coreModel.getParameterId(index));
      } catch {
        // Some runtimes throw while the model is warming up.
      }
    }
  }

  addIds(coreModel?.parameters?.ids);
  addIds(coreModel?._parameterIds);
  addIds(coreModel?.parameterIds);
  addIds(coreModel?._model?._parameterIds);
  addIds(coreModel?._model?.parameters?.ids);
  return ids;
}

function getLive2DParameterIndex(coreModel: any, internalModel: any, id: string) {
  const idsToTry: unknown[] = [id];
  try {
    if (typeof internalModel?.getIdSafe === 'function') idsToTry.unshift(internalModel.getIdSafe(id));
  } catch {
    // Safe Cubism ids are optional.
  }

  const indexMethods = [
    { owner: coreModel, method: coreModel?.getParameterIndex },
    { owner: coreModel, method: coreModel?.getParamIndex },
    { owner: internalModel, method: internalModel?.getParameterIndex },
    { owner: internalModel, method: internalModel?.getParamIndex },
  ];

  for (const { owner, method } of indexMethods) {
    if (typeof method !== 'function') continue;
    for (const candidate of idsToTry) {
      try {
        const index = normalizeParameterIndex(method.call(owner, candidate));
        if (index !== null) return index;
      } catch {
        // Try next API.
      }
    }
  }

  const normalizedId = normalizeParameterId(id);
  const listedIndex = getLive2DParameterIds(coreModel).findIndex((listedId) => normalizeParameterId(listedId) === normalizedId);
  return listedIndex >= 0 ? listedIndex : null;
}

function resolveParameter(model: any, id: string): Live2DParameterRef | null {
  const coreModel = getCoreLive2DModel(model);
  if (!coreModel || !id) return null;
  return {
    id,
    index: getLive2DParameterIndex(coreModel, model?.internalModel, id),
  };
}

function getParameterIdsToTry(model: any, parameter: Live2DParameterRef) {
  const ids: unknown[] = [parameter.id];
  try {
    if (typeof model?.internalModel?.getIdSafe === 'function') ids.unshift(model.internalModel.getIdSafe(parameter.id));
  } catch {
    // Safe Cubism ids are optional.
  }
  return ids;
}

function setParameter(model: any, id: string, value: number, weight = 1) {
  const core = getCoreLive2DModel(model);
  const parameter = resolveParameter(model, id);
  if (!core || !parameter || !Number.isFinite(value)) return false;

  if (parameter.index !== null && typeof core.setParameterValueByIndex === 'function') {
    try {
      core.setParameterValueByIndex(parameter.index, value, weight);
      return true;
    } catch {}
  }

  if (parameter.index !== null && typeof core.setParamFloat === 'function') {
    try {
      core.setParamFloat(parameter.index, value);
      return true;
    } catch {}
  }

  for (const candidate of getParameterIdsToTry(model, parameter)) {
    if (typeof core.setParameterValueById === 'function') {
      try {
        core.setParameterValueById(candidate, value, weight);
        return true;
      } catch {}
    }
    if (typeof core.setParamFloat === 'function') {
      try {
        core.setParamFloat(candidate, value);
        return true;
      } catch {}
    }
  }

  return false;
}

function addParameter(model: any, id: string, value: number, weight = 1) {
  const core = getCoreLive2DModel(model);
  const parameter = resolveParameter(model, id);
  if (!core || !parameter || !Number.isFinite(value)) return false;

  if (parameter.index !== null && typeof core.addParameterValueByIndex === 'function') {
    try {
      core.addParameterValueByIndex(parameter.index, value, weight);
      return true;
    } catch {}
  }

  for (const candidate of getParameterIdsToTry(model, parameter)) {
    if (typeof core.addParameterValueById === 'function') {
      try {
        core.addParameterValueById(candidate, value, weight);
        return true;
      } catch {}
    }
  }

  return setParameter(model, id, value, weight);
}

function setParameters(model: any, ids: string[], value: number, weight = 1) {
  for (const id of ids) {
    if (setParameter(model, id, value, weight)) return true;
  }
  return false;
}

function addParameters(model: any, ids: string[], value: number, weight = 1) {
  for (const id of ids) {
    if (addParameter(model, id, value, weight)) return true;
  }
  return false;
}

function applyAudioMotionOscillators(
  model: any,
  oscillators: Live2DAudioMotionOscillator[],
  config: Live2DAudioMotionSettings,
  phaseSeconds: number,
  smoothedVolume: number,
) {
  if (!config.enabled || smoothedVolume < 0.005) return;

  oscillators.forEach((oscillator) => {
    const bodyScale = oscillator.isBody ? config.bodyFollowRatio : 1;
    const value = Math.sin(phaseSeconds * oscillator.freqRatio * config.speed * LIVE2D_AUDIO_MOTION_TAU)
      * oscillator.amplitude
      * config.intensity
      * smoothedVolume
      * bodyScale;
    addParameters(model, oscillator.ids, value, 1);
  });
}

function normalizeHitArea(value: unknown) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function inferFallbackArea(normalizedX: number, normalizedY: number) {
  if (normalizedY < 0.2) return 'head';
  if (normalizedY < 0.42) return Math.abs(normalizedX - 0.5) < 0.22 ? 'face' : 'hair';
  if (normalizedY < 0.68) return Math.abs(normalizedX - 0.5) < 0.22 ? 'body' : 'arm';
  return Math.abs(normalizedX - 0.5) < 0.25 ? 'lower body' : 'leg';
}

function pickPrimaryHitArea(hitAreas: string[]) {
  const priority = [
    /chest|breast|bust|boob|mune|oppai|peito|seio|busto/i,
    /hip|waist|thigh|leg|lower|private|groin|butt|coxa|quadril|cintura|perna/i,
    /head|face|hair|ear|eye|mouth|cabeca|cabelo|rosto|orelha|olho|boca|atama|kami/i,
    /hand|arm|shoulder|mao|mão|braco|braço|ombro/i,
    /body|torso|belly|stomach|neck|corpo|barriga|pesco/i,
  ];
  for (const pattern of priority) {
    const match = hitAreas.find((area) => pattern.test(area));
    if (match) return match;
  }
  return hitAreas[0] || '';
}

function isHeadArea(value: string) {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return /\b(?:head|face|hair|ear|eye|mouth|forehead|cabeca|cabelo|rosto|orelha|olho|boca|testa|atama|kami|kao)\b/.test(normalized);
}

export function Live2DStage({
  bundle,
  language,
  emotion,
  emotionTrigger = 0,
  companionState = null,
  speaking,
  listening = false,
  audioLevel,
  onLoaded,
  onLoadError,
  onTouch,
}: Live2DStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<any>(null);
  const modelRef = useRef<any>(null);
  const baseScaleRef = useRef(1);
  const modelBoundsRef = useRef({ width: 1, height: 1, centerX: 0, centerY: 0 });
  const transformRef = useRef({ x: 0, y: 0, zoom: 1 });
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pointerStartsRef = useRef(new Map<number, PointerStart>());
  const lastGestureRef = useRef<{ x: number; y: number; distance: number } | null>(null);
  const lastTapRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const lastAppliedEmotionRef = useRef('');
  const lastCompanionActionKeyRef = useRef('');
  const companionActionTimerRef = useRef<number | null>(null);
  const companionActionTokenRef = useRef(0);
  const companionStateRef = useRef<CompanionLive2DState | null>(companionState);
  const liveStateRef = useRef({ emotion, companionState, speaking, listening, audioLevel });
  const frameStateRef = useRef({
    mouth: 0,
    speaking: 0,
    listening: 0,
    speakingPhase: Math.random(),
    listeningPhase: Math.random(),
    speakingVolume: 0,
    listeningVolume: 0,
    lastFrameAt: 0,
  });
  const [status, setStatus] = useState(t(language, 'live2d.status.waiting'));
  const [dragging, setDragging] = useState(false);
  const [touchPulse, setTouchPulse] = useState<{
    id: number;
    x: number;
    y: number;
    affectionate: boolean;
  } | null>(null);

  companionStateRef.current = companionState;
  liveStateRef.current = { emotion, companionState, speaking, listening, audioLevel };

  function clearCompanionActionTimer() {
    if (companionActionTimerRef.current === null) return;
    window.clearTimeout(companionActionTimerRef.current);
    companionActionTimerRef.current = null;
  }

  function getCompanionStateAction(state = companionStateRef.current): CompanionLive2DAction | null {
    if (!state || state.stateEnabled === false) return null;
    const action = state.live2dAction;
    if (!action || (action.kind !== 'expression' && action.kind !== 'motion')) return null;
    const value = String(action.value || '').trim();
    if (!value) return null;
    return {
      ...action,
      value,
      intervalMs: Math.min(30_000, Math.max(1500, Number(action.intervalMs) || 10_000)),
    };
  }

  function getCompanionStateActionKey(state = companionStateRef.current) {
    const action = getCompanionStateAction(state);
    if (!action) return '';
    return [
      state?.currentStateId || action.stateId || '',
      action.kind,
      action.value,
      action.intervalMs || 10_000,
    ].join(':');
  }

  async function applyCompanionStateAction(action: CompanionLive2DAction) {
    const model = modelRef.current;
    if (!model) return false;
    if (action.kind === 'expression') return applyModelExpression(model, action.value);
    return applyModelNamedMotion(model, action.value);
  }

  function stopCompanionStateActionLoop() {
    companionActionTokenRef.current += 1;
    clearCompanionActionTimer();
    lastCompanionActionKeyRef.current = '';
  }

  function startCompanionStateActionLoop(force = false) {
    const model = modelRef.current;
    const state = companionStateRef.current;
    const action = getCompanionStateAction(state);
    if (!model || !action) {
      stopCompanionStateActionLoop();
      return;
    }

    const actionKey = getCompanionStateActionKey(state);
    if (!force && lastCompanionActionKeyRef.current === actionKey && companionActionTimerRef.current !== null) return;
    lastCompanionActionKeyRef.current = actionKey;
    companionActionTokenRef.current += 1;
    const token = companionActionTokenRef.current;
    clearCompanionActionTimer();

    const run = () => {
      if (token !== companionActionTokenRef.current || model !== modelRef.current) return;
      void applyCompanionStateAction(action).finally(() => {
        if (token !== companionActionTokenRef.current || model !== modelRef.current) return;
        companionActionTimerRef.current = window.setTimeout(run, action.intervalMs || 10_000);
      });
    };

    run();
  }

  function applyLive2DEmotionSignal(rawEmotion: string, force = false) {
    const normalizedEmotion = normalizeLive2DKey(rawEmotion);
    const model = modelRef.current;
    if (!model || !normalizedEmotion || (!force && lastAppliedEmotionRef.current === normalizedEmotion)) return;
    lastAppliedEmotionRef.current = normalizedEmotion;
    void (async () => {
      const state = companionStateRef.current;
      const mappedMotion = getMappedLive2DSignalValue(state?.motionMap, normalizedEmotion);
      if (mappedMotion && await applyModelNamedMotion(model, mappedMotion)) return;
      const mappedExpression = getMappedLive2DSignalValue(state?.expressionMap, normalizedEmotion);
      if (mappedExpression && await applyModelExpression(model, mappedExpression)) return;
      await applyModelEmotionMotion(model, normalizedEmotion);
      await applyModelExpression(model, normalizedEmotion);
    })();
  }

  function applyLive2DFrame(model: any) {
    const state = liveStateRef.current;
    const frame = frameStateRef.current;
    const nowMs = performance.now();
    const now = nowMs / 1000;
    const elapsedSeconds = frame.lastFrameAt ? Math.min((nowMs - frame.lastFrameAt) / 1000, 0.1) : 0.016;
    frame.lastFrameAt = nowMs;
    const speakingConfig = getAudioMotionSettings(state.companionState, 'speaking');
    const listeningConfig = getAudioMotionSettings(state.companionState, 'listening');
    const normalizedEmotion = normalizeLive2DKey(
      state.companionState?.emotion
      || state.companionState?.expression
      || state.emotion
    );
    const smile = /happy|joy|love|excited|feliz|amor/.test(normalizedEmotion) ? 0.85 : 0;
    const eyeSmile = /happy|joy|love|excited|laugh|hearteyes|heartbox/.test(normalizedEmotion) ? 0.55 : 0;
    const worried = /sad|fear|triste|medo/.test(normalizedEmotion) ? -0.65 : 0;
    const angry = /angry|brava|raiva/.test(normalizedEmotion) ? -0.4 : 0;
    const targetSpeaking = state.speaking ? 1 : 0;
    const targetListening = state.listening && !state.speaking ? 1 : 0;
    const targetMouth = state.speaking
      ? clamp(Number(state.audioLevel) || 0.32, 0.04, 1)
      : 0;

    frame.speaking += (targetSpeaking - frame.speaking) * 0.2;
    frame.listening += (targetListening - frame.listening) * 0.18;
    frame.mouth += (targetMouth - frame.mouth) * (targetMouth > frame.mouth ? 0.62 : 0.34);

    const smoothVolume = (current: number, target: number, config: Live2DAudioMotionSettings) => {
      const gatedTarget = target > config.volumeThreshold ? target : 0;
      const rise = 1 - 0.5 * config.smoothing;
      const fall = 1 - config.smoothing;
      return current + (gatedTarget - current) * (gatedTarget > current ? rise : fall);
    };

    const speakingVolumeTarget = state.speaking ? clamp(Number(state.audioLevel) || 0.42, 0, 1) : 0;
    const listeningVolumeTarget = targetListening
      ? Math.max(clamp(Number(state.audioLevel) || 0, 0, 1), 0.45)
      : 0;
    frame.speakingVolume = smoothVolume(frame.speakingVolume, speakingVolumeTarget, speakingConfig);
    frame.listeningVolume = smoothVolume(frame.listeningVolume, listeningVolumeTarget, listeningConfig);
    frame.speakingPhase += elapsedSeconds;
    frame.listeningPhase += elapsedSeconds;

    const speak = speakingConfig.enabled ? frame.speaking * speakingConfig.intensity : 0;
    const listen = listeningConfig.enabled ? frame.listening * listeningConfig.intensity : 0;
    const active = Math.max(speak, listen);
    const speakNod = Math.sin(now * 4.25 * speakingConfig.speed) * speak;
    const listenSway = Math.sin(now * 1.85 * listeningConfig.speed) * listen;
    const idleWeight = clamp(1 - active * 0.42, 0.45, 1);
    const idleSlow = Math.sin(now * 1.35);
    const idleTiny = Math.sin(now * 0.72 + 1.6);
    const breathWave = Math.sin(now * 2.05);
    const breath = 0.52 + breathWave * 0.24;
    const blinkPhase = (now * 1000) % 4650;
    const blinkCloseMs = 72;
    const blinkOpenMs = 96;
    const blinkValue = blinkPhase < blinkCloseMs
      ? 1 - blinkPhase / blinkCloseMs
      : blinkPhase < blinkCloseMs + blinkOpenMs
        ? (blinkPhase - blinkCloseMs) / blinkOpenMs
        : 1;

    setParameters(model, PARAMETER_IDS.mouthOpen, frame.mouth, 1);
    setParameters(model, PARAMETER_IDS.eyeLOpen, blinkValue, 0.65);
    setParameters(model, PARAMETER_IDS.eyeROpen, blinkValue, 0.65);
    addParameters(model, PARAMETER_IDS.mouthForm, smile + worried * 0.25, 0.8);
    addParameters(model, PARAMETER_IDS.browLY, worried + angry, 0.65);
    addParameters(model, PARAMETER_IDS.browRY, worried + angry, 0.65);
    addParameters(model, PARAMETER_IDS.eyeSmile, eyeSmile, 0.55);
    addParameters(model, PARAMETER_IDS.breath, breath, 0.75);
    addParameters(model, PARAMETER_IDS.angleX, idleSlow * 4.8 * idleWeight + listenSway * 7.5 + Math.sin(now * 4.2) * 2.6 * speak, 0.9);
    addParameters(model, PARAMETER_IDS.angleY, breathWave * 2.3 * idleWeight + Math.sin(now * 3.1) * 3.4 * listen + speakNod * 2.4, 0.85);
    addParameters(model, PARAMETER_IDS.angleZ, idleTiny * 3.2 * idleWeight + Math.sin(now * 2.1) * 4.1 * listen + Math.sin(now * 5.8) * 1.8 * speak, 0.84);
    addParameters(model, PARAMETER_IDS.bodyX, idleSlow * 3.8 * idleWeight + listenSway * 4.3 + Math.sin(now * 3.8) * 1.8 * speak, 0.78);
    addParameters(model, PARAMETER_IDS.bodyY, breathWave * 2.4 * idleWeight + Math.sin(now * 2.4) * 2.3 * listen + Math.abs(speakNod) * 1.1, 0.75);
    addParameters(model, PARAMETER_IDS.bodyZ, idleTiny * 2.6 * idleWeight + Math.sin(now * 1.8) * 2.8 * listen, 0.72);
    addParameters(model, PARAMETER_IDS.eyeBallX, Math.sin(now * 0.85) * 0.18 * idleWeight + Math.sin(now * 1.9) * 0.26 * listen, 0.65);
    addParameters(model, PARAMETER_IDS.eyeBallY, Math.sin(now * 0.68 + 0.4) * 0.08 * idleWeight + 0.1 * listen + Math.sin(now * 2.8) * 0.08 * speak, 0.58);
    applyAudioMotionOscillators(
      model,
      LIVE2D_AUDIO_MOTION_OSCILLATORS_SPEAKING,
      speakingConfig,
      frame.speakingPhase,
      frame.speakingVolume,
    );
    applyAudioMotionOscillators(
      model,
      LIVE2D_AUDIO_MOTION_OSCILLATORS_LISTENING,
      listeningConfig,
      frame.listeningPhase,
      frame.listeningVolume,
    );
  }

  function applyTransform() {
    const model = modelRef.current;
    const container = containerRef.current;
    if (!model || !container) return;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const transform = transformRef.current;
    const panFactor = Math.max(0.85, transform.zoom * 0.75);
    transform.x = Math.max(-width * panFactor, Math.min(width * panFactor, transform.x));
    transform.y = Math.max(-height * panFactor, Math.min(height * panFactor, transform.y));
    model.scale?.set?.(baseScaleRef.current * transform.zoom);
    model.pivot?.set?.(modelBoundsRef.current.centerX, modelBoundsRef.current.centerY);
    model.position?.set?.(width / 2 + transform.x, height / 2 + height * 0.04 + transform.y);
  }

  function fitModel(reset = false) {
    const container = containerRef.current;
    if (!container) return;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    baseScaleRef.current = Math.min(
      (width * 0.92) / modelBoundsRef.current.width,
      (height * 0.9) / modelBoundsRef.current.height,
    );
    if (reset) transformRef.current = { x: 0, y: 0, zoom: 1 };
    applyTransform();
  }

  function getGesture() {
    const points = [...pointersRef.current.values()];
    if (!points.length) return null;
    if (points.length === 1) return { x: points[0].x, y: points[0].y, distance: 0 };
    const first = points[0];
    const second = points[1];
    return {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
      distance: Math.hypot(second.x - first.x, second.y - first.y),
    };
  }

  function getTouchPayload(clientX: number, clientY: number): Omit<Live2DTouchPayload, 'interaction'> | null {
    const model = modelRef.current;
    const app = appRef.current;
    const canvas = canvasRef.current;
    if (!model || !canvas) return null;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const screenWidth = Number(app?.screen?.width) || canvas.clientWidth || rect.width;
    const screenHeight = Number(app?.screen?.height) || canvas.clientHeight || rect.height;
    const worldX = ((clientX - rect.left) / rect.width) * screenWidth;
    const worldY = ((clientY - rect.top) / rect.height) * screenHeight;
    const bounds = model.getBounds?.();
    if (
      !bounds
      || worldX < bounds.x
      || worldX > bounds.x + bounds.width
      || worldY < bounds.y
      || worldY > bounds.y + bounds.height
    ) {
      return null;
    }

    const normalizedX = Math.max(0, Math.min(1, (worldX - bounds.x) / Math.max(1, bounds.width)));
    const normalizedY = Math.max(0, Math.min(1, (worldY - bounds.y) / Math.max(1, bounds.height)));
    let hitAreas: string[] = [];
    try {
      if (typeof model.hitTest === 'function') {
        hitAreas = (model.hitTest(worldX, worldY) || [])
          .map(normalizeHitArea)
          .filter(Boolean);
      }
    } catch {
      hitAreas = [];
    }
    if (!hitAreas.length) hitAreas = [inferFallbackArea(normalizedX, normalizedY)];
    hitAreas = [...new Set(hitAreas)];
    return {
      area: pickPrimaryHitArea(hitAreas),
      hitAreas,
      normalizedX,
      normalizedY,
    };
  }

  function registerTap(clientX: number, clientY: number) {
    const now = Date.now();
    const previous = lastTapRef.current;
    lastTapRef.current = { at: now, x: clientX, y: clientY };
    if (
      !previous
      || now - previous.at > 430
      || Math.hypot(clientX - previous.x, clientY - previous.y) > 48
    ) {
      return;
    }

    lastTapRef.current = null;
    const payload = getTouchPayload(clientX, clientY);
    if (!payload) return;
    const affectionate = [payload.area, ...payload.hitAreas].some(isHeadArea);
    const rect = containerRef.current?.getBoundingClientRect();
    setTouchPulse({
      id: now,
      x: clientX - (rect?.left || 0),
      y: clientY - (rect?.top || 0),
      affectionate,
    });
    window.setTimeout(() => {
      setTouchPulse((current) => current?.id === now ? null : current);
    }, 700);
    onTouch?.({
      ...payload,
      interaction: affectionate ? 'head-pat' : 'touch',
    });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pointerStartsRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      at: Date.now(),
      multiTouch: pointersRef.current.size > 1,
    });
    if (pointersRef.current.size > 1) {
      pointerStartsRef.current.forEach((start) => {
        start.multiTouch = true;
      });
    }
    lastGestureRef.current = getGesture();
    setDragging(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const next = getGesture();
    const previous = lastGestureRef.current;
    if (!next || !previous) {
      lastGestureRef.current = next;
      return;
    }
    transformRef.current.x += next.x - previous.x;
    transformRef.current.y += next.y - previous.y;
    if (next.distance > 0 && previous.distance > 0) {
      transformRef.current.zoom = clamp(
        transformRef.current.zoom * (next.distance / previous.distance),
        MIN_STAGE_ZOOM,
        MAX_STAGE_ZOOM,
      );
    }
    lastGestureRef.current = next;
    applyTransform();
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const transform = transformRef.current;
    const previousZoom = transform.zoom;
    const nextZoom = clamp(previousZoom * Math.exp(-event.deltaY * 0.0015), MIN_STAGE_ZOOM, MAX_STAGE_ZOOM);
    if (nextZoom === previousZoom) return;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2 + rect.height * 0.04;
    const localX = event.clientX - centerX - transform.x;
    const localY = event.clientY - centerY - transform.y;
    const ratio = nextZoom / previousZoom;
    transform.x -= localX * (ratio - 1);
    transform.y -= localY * (ratio - 1);
    transform.zoom = nextZoom;
    applyTransform();
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const start = pointerStartsRef.current.get(event.pointerId);
    if (start) {
      const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      const duration = Date.now() - start.at;
      if (!start.multiTouch && distance <= 14 && duration <= 340) {
        registerTap(event.clientX, event.clientY);
      }
    }
    pointerStartsRef.current.delete(event.pointerId);
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    lastGestureRef.current = getGesture();
    if (!pointersRef.current.size) setDragging(false);
  }

  useEffect(() => {
    applyLive2DEmotionSignal(
      companionState?.emotion || companionState?.expression || emotion,
      emotionTrigger > 0
    );
  }, [emotion, emotionTrigger, companionState?.emotion, companionState?.expression]);

  useEffect(() => {
    const motion = String(companionState?.motion || '').trim();
    const model = modelRef.current;
    if (!motion || !model) return;
    void applyModelNamedMotion(model, motion);
  }, [companionState?.motion]);

  useEffect(() => {
    startCompanionStateActionLoop();
  }, [
    companionState?.stateEnabled,
    companionState?.currentStateId,
    companionState?.live2dAction?.kind,
    companionState?.live2dAction?.value,
    companionState?.live2dAction?.intervalMs,
  ]);

  useEffect(() => {
    const ticker = appRef.current?.ticker;
    if (!ticker) return;
    const maxFps = clampOptionalNumber(companionState?.maxFps, LIVE2D_MAX_FPS, 30, LIVE2D_MAX_FPS);
    ticker.maxFPS = maxFps;
    ticker.minFPS = Math.min(12, maxFps);
    ticker.start?.();
  }, [companionState?.maxFps]);

  useEffect(() => {
    if (!bundle || !containerRef.current || !canvasRef.current) return;
    let disposed = false;
    let app: any = null;
    let loadedBundle: Awaited<ReturnType<typeof loadModelBundle>> | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let beforeModelUpdateHandler: (() => void) | null = null;

    void (async () => {
      try {
        setStatus(t(language, 'live2d.status.loading'));
        loadedBundle = await loadModelBundle(bundle);
        const { PIXI, engine } = await loadLive2DRuntime();
        if (disposed) return;
        app = new PIXI.Application();
        appRef.current = app;
        await app.init({
          canvas: canvasRef.current!,
          resizeTo: containerRef.current!,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          powerPreference: 'high-performance',
        });
        if (app.ticker) {
          const maxFps = clampOptionalNumber(companionStateRef.current?.maxFps, LIVE2D_MAX_FPS, 30, LIVE2D_MAX_FPS);
          app.ticker.maxFPS = maxFps;
          app.ticker.minFPS = Math.min(12, maxFps);
          app.ticker.start?.();
        }
        if (PIXI.Ticker?.shared) {
          PIXI.Ticker.shared.maxFPS = clampOptionalNumber(companionStateRef.current?.maxFps, LIVE2D_MAX_FPS, 30, LIVE2D_MAX_FPS);
        }
        const model = await engine.Live2DModel.from(loadedBundle.modelUrl, {
          autoUpdate: true,
          autoFocus: false,
          autoHitTest: false,
        });
        if (disposed) {
          model.destroy?.({ children: true });
          return;
        }
        modelRef.current = model;
        beforeModelUpdateHandler = () => applyLive2DFrame(model);
        model.internalModel?.on?.('beforeModelUpdate', beforeModelUpdateHandler);
        app.stage.addChild(model);
        const bounds = model.getLocalBounds?.();
        modelBoundsRef.current = {
          width: Math.max(1, bounds?.width || model.width || 1),
          height: Math.max(1, bounds?.height || model.height || 1),
          centerX: Number(bounds?.x || 0) + Math.max(1, bounds?.width || model.width || 1) / 2,
          centerY: Number(bounds?.y || 0) + Math.max(1, bounds?.height || model.height || 1) / 2,
        };
        fitModel(true);
        resizeObserver = new ResizeObserver(() => fitModel());
        resizeObserver.observe(containerRef.current!);
        setStatus('');
        lastAppliedEmotionRef.current = '';
        applyLive2DEmotionSignal(
          companionStateRef.current?.emotion
          || companionStateRef.current?.expression
          || liveStateRef.current.emotion
        );
        startCompanionStateActionLoop(true);
        onLoaded?.();
      } catch (error) {
        const message = error instanceof Error ? error.message : t(language, 'live2d.error.load');
        setStatus(message);
        onLoadError?.(message);
      }
    })();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      if (beforeModelUpdateHandler) {
        modelRef.current?.internalModel?.off?.('beforeModelUpdate', beforeModelUpdateHandler);
        modelRef.current?.internalModel?.removeListener?.('beforeModelUpdate', beforeModelUpdateHandler);
      }
      stopCompanionStateActionLoop();
      modelRef.current?.destroy?.({ children: true });
      modelRef.current = null;
      appRef.current = null;
      app?.destroy?.(true);
      loadedBundle?.dispose();
    };
  }, [bundle]);

  return (
    <div
      ref={containerRef}
      className={`live2d-stage ${dragging ? 'live2d-stage--dragging' : ''}`}
      aria-label="Live2D"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onWheel={handleWheel}
    >
      <canvas ref={canvasRef} />
      {status && (
        <div className="live2d-stage__status">
          <span className="status-orb" />
          <span>{status}</span>
        </div>
      )}
      {touchPulse && (
        <span
          key={touchPulse.id}
          className={`live2d-touch-feedback ${touchPulse.affectionate ? 'is-affectionate' : ''}`}
          style={{ left: touchPulse.x, top: touchPulse.y }}
          aria-hidden="true"
        >
          {touchPulse.affectionate ? '♥' : ''}
        </span>
      )}
      <div className="live2d-stage__glow" />
    </div>
  );
}
