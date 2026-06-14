import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import type { AppLanguage } from '../i18n';
import { t } from '../i18n';
import type { Live2DBundle, Live2DTouchPayload } from '../types';
import { loadModelBundle } from '../live2d/modelBundle';
import { loadLive2DRuntime } from '../live2d/runtime';

type Live2DStageProps = {
  bundle: Live2DBundle | null;
  language: AppLanguage;
  emotion: string;
  emotionTrigger?: number;
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
  mouthForm: ['ParamMouthForm', 'PARAM_MOUTH_FORM'],
  angleX: ['ParamAngleX', 'PARAM_ANGLE_X'],
  angleY: ['ParamAngleY', 'PARAM_ANGLE_Y'],
  angleZ: ['ParamAngleZ', 'PARAM_ANGLE_Z'],
  bodyX: ['ParamBodyAngleX', 'PARAM_BODY_ANGLE_X'],
  bodyY: ['ParamBodyAngleY', 'PARAM_BODY_ANGLE_Y'],
  bodyZ: ['ParamBodyAngleZ', 'PARAM_BODY_ANGLE_Z'],
  eyeBallX: ['ParamEyeBallX', 'PARAM_EYE_BALL_X'],
  eyeBallY: ['ParamEyeBallY', 'PARAM_EYE_BALL_Y'],
  browLY: ['ParamBrowLY', 'PARAM_BROW_L_Y'],
  browRY: ['ParamBrowRY', 'PARAM_BROW_R_Y'],
  breath: ['ParamBreath', 'PARAM_BREATH'],
};

const MIN_STAGE_ZOOM = 0.3;
const MAX_STAGE_ZOOM = 18;
const LIVE2D_FORCE_PRIORITY = 3;
const LIVE2D_MAX_FPS = 60;

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

function resolveParameterId(model: any, id: string) {
  try {
    return model?.internalModel?.getIdSafe?.(id) || id;
  } catch {
    return id;
  }
}

function setParameter(model: any, id: string, value: number, weight = 1) {
  const core = model?.internalModel?.coreModel;
  try {
    core?.setParameterValueById?.(resolveParameterId(model, id), value, weight);
  } catch {
    // Models expose different parameter sets; unsupported parameters are ignored.
  }
}

function addParameter(model: any, id: string, value: number, weight = 1) {
  const core = model?.internalModel?.coreModel;
  try {
    core?.addParameterValueById?.(resolveParameterId(model, id), value, weight);
  } catch {
    // Models expose different parameter sets; unsupported parameters are ignored.
  }
}

function setParameters(model: any, ids: string[], value: number, weight = 1) {
  ids.forEach((id) => setParameter(model, id, value, weight));
}

function addParameters(model: any, ids: string[], value: number, weight = 1) {
  ids.forEach((id) => addParameter(model, id, value, weight));
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
  const liveStateRef = useRef({ emotion, speaking, listening, audioLevel });
  const frameStateRef = useRef({ mouth: 0, speaking: 0, listening: 0 });
  const [status, setStatus] = useState(t(language, 'live2d.status.waiting'));
  const [dragging, setDragging] = useState(false);
  const [touchPulse, setTouchPulse] = useState<{
    id: number;
    x: number;
    y: number;
    affectionate: boolean;
  } | null>(null);

  liveStateRef.current = { emotion, speaking, listening, audioLevel };

  function applyLive2DEmotionSignal(rawEmotion: string, force = false) {
    const normalizedEmotion = normalizeLive2DKey(rawEmotion);
    const model = modelRef.current;
    if (!model || !normalizedEmotion || (!force && lastAppliedEmotionRef.current === normalizedEmotion)) return;
    lastAppliedEmotionRef.current = normalizedEmotion;
    void (async () => {
      await applyModelEmotionMotion(model, normalizedEmotion);
      await applyModelExpression(model, normalizedEmotion);
    })();
  }

  function applyLive2DFrame(model: any) {
    const state = liveStateRef.current;
    const frame = frameStateRef.current;
    const now = performance.now() / 1000;
    const normalizedEmotion = state.emotion.toLowerCase();
    const smile = /happy|joy|love|excited|feliz|amor/.test(normalizedEmotion) ? 0.85 : 0;
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

    const speak = frame.speaking;
    const listen = frame.listening;
    const active = Math.max(speak, listen);
    const speakNod = Math.sin(now * 8.5) * speak;
    const listenSway = Math.sin(now * 2.6) * listen;
    const breath = 0.5 + Math.sin(now * 2.1) * 0.18;

    setParameters(model, PARAMETER_IDS.mouthOpen, frame.mouth, 1);
    addParameters(model, PARAMETER_IDS.mouthForm, smile + worried * 0.25, 0.8);
    addParameters(model, PARAMETER_IDS.browLY, worried + angry, 0.65);
    addParameters(model, PARAMETER_IDS.browRY, worried + angry, 0.65);
    addParameters(model, PARAMETER_IDS.breath, breath, 0.55);

    if (active > 0.01) {
      addParameters(model, PARAMETER_IDS.angleX, listenSway * 6 + Math.sin(now * 4.2) * 1.4 * speak, active);
      addParameters(model, PARAMETER_IDS.angleY, Math.sin(now * 3.1) * 2.8 * listen + speakNod * 1.8, active);
      addParameters(model, PARAMETER_IDS.angleZ, Math.sin(now * 2.1) * 3.4 * listen + Math.sin(now * 5.8) * 1.2 * speak, active);
      addParameters(model, PARAMETER_IDS.bodyX, listenSway * 3.2 + Math.sin(now * 3.8) * 1.1 * speak, active);
      addParameters(model, PARAMETER_IDS.bodyY, Math.sin(now * 2.4) * 1.7 * listen + Math.abs(speakNod) * 0.8, active);
      addParameters(model, PARAMETER_IDS.bodyZ, Math.sin(now * 1.8) * 2.2 * listen, active);
      addParameters(model, PARAMETER_IDS.eyeBallX, Math.sin(now * 1.9) * 0.22 * listen, active);
      addParameters(model, PARAMETER_IDS.eyeBallY, 0.08 * listen + Math.sin(now * 2.8) * 0.06 * speak, active);
    }
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
    applyLive2DEmotionSignal(emotion, emotionTrigger > 0);
  }, [emotion, emotionTrigger]);

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
          app.ticker.maxFPS = LIVE2D_MAX_FPS;
          app.ticker.minFPS = Math.min(app.ticker.minFPS || 30, LIVE2D_MAX_FPS);
          app.ticker.start?.();
        }
        if (PIXI.Ticker?.shared) {
          PIXI.Ticker.shared.maxFPS = LIVE2D_MAX_FPS;
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
        applyLive2DEmotionSignal(liveStateRef.current.emotion);
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
