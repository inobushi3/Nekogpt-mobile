import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { ConnectionGate } from './components/ConnectionGate';
import { Live2DStage } from './components/Live2DStage';
import { type AppLanguage, getSavedLanguage, saveLanguage, t } from './i18n';
import { DEFAULT_RELAY_URL, getSavedConnectionConfig, NekoConnection } from './lib/connection';
import {
  createMobileVadState,
  hasUsefulMobileSpeech,
  MOBILE_MIC_MAX_RECORDING_MS,
  MOBILE_MIC_TTS_COOLDOWN_MS,
  resetMobileVadState,
  updateMobileVad,
} from './lib/mobileVad';
import type {
  CompanionChatHistory,
  CompanionLive2DState,
  CompanionSnapshot,
  CompanionTtsAudio,
  ConnectionPhase,
  Live2DBundle,
  MobileChatAttachment,
  Live2DTouchPayload,
  Live2DTouchReaction,
  MobileChatMessage,
  RelayMessage,
  VisionImage,
  VisionVideo,
} from './types';

type CameraMode = 'off' | 'user' | 'environment';
type MobileBackground = { mode: 'none' } | { mode: 'image'; dataUrl: string; name?: string };
type PendingMobileMedia = {
  id: string;
  kind: 'image' | 'video';
  name: string;
  mimeType: string;
  previewUrl: string;
  attachment: MobileChatAttachment;
  visionImage: VisionImage;
  visionVideo?: VisionVideo;
};

const BACKGROUND_STORAGE_KEY = 'nekogpt:mobile-background';
const MAX_BACKGROUND_DIMENSION = 1600;
const MAX_MOBILE_MEDIA_BYTES = 18 * 1024 * 1024;
const MOBILE_VISION_FRAME_MAX_DIMENSION = 1280;
const SILENT_MOBILE_UNLOCK_AUDIO_URL = 'data:audio/wav;base64,UklGRgQCAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YeABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const SUPPORTED_MOBILE_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const SUPPORTED_MOBILE_VIDEO_MIME_TYPES = new Set(['video/webm', 'video/mp4', 'video/mpeg', 'video/quicktime', 'video/mov']);
type BrowserAudioContext = typeof AudioContext;

type MobileTtsPlaybackItem = {
  source: Blob | string;
  durationMs: number;
  text?: string;
  subtitle?: string;
  emotion?: string;
  activeUrl?: string;
  revokeActiveUrl?: boolean;
};

type AudioPlaybackCallbacks = {
  onAudioUnlockChange?: (unlocked: boolean) => void;
  onUnlockRequired?: () => void;
  onPlaybackStart?: (item: MobileTtsPlaybackItem) => void;
  onPlaybackEnd?: (item: MobileTtsPlaybackItem, reason: 'ended' | 'blocked' | 'error' | 'stopped') => void;
  onPlaybackBlocked?: (error: unknown) => void;
  onPlaybackError?: (error: unknown) => void;
  onAudioLevel?: (level: number) => void;
};

function getBrowserAudioContextClass(): BrowserAudioContext | null {
  return window.AudioContext
    || (window as typeof window & { webkitAudioContext?: BrowserAudioContext }).webkitAudioContext
    || null;
}

function createNotAllowedAudioError() {
  try {
    return new DOMException('Audio playback requires a user gesture.', 'NotAllowedError');
  } catch {
    return new Error('Audio playback requires a user gesture.');
  }
}

function isNotAllowedAudioError(error: unknown) {
  return error instanceof DOMException
    ? error.name === 'NotAllowedError'
    : error instanceof Error && /notallowed|gesture|permission/i.test(error.message);
}

function rmsToMobileTtsMouthOpen(rms: number) {
  const normalized = Math.min(1, Math.max(0, (rms - 0.018) / 0.18));
  return Math.min(1, Math.max(0.02, normalized));
}

class AudioPlaybackManager {
  private context: AudioContext | null = null;
  private player: HTMLAudioElement | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private callbacks: AudioPlaybackCallbacks = {};
  private queue: MobileTtsPlaybackItem[] = [];
  private current: MobileTtsPlaybackItem | null = null;
  private levelFrame: number | null = null;
  private syntheticFrame: number | null = null;
  private playing = false;
  private audioUnlocked = false;

  setCallbacks(callbacks: AudioPlaybackCallbacks) {
    this.callbacks = callbacks;
    callbacks.onAudioUnlockChange?.(this.audioUnlocked);
  }

  isUnlocked() {
    return this.audioUnlocked;
  }

  private setUnlocked(unlocked: boolean) {
    if (this.audioUnlocked === unlocked) return;
    this.audioUnlocked = unlocked;
    this.callbacks.onAudioUnlockChange?.(unlocked);
  }

  private getContext() {
    const AudioContextClass = getBrowserAudioContextClass();
    if (!AudioContextClass) return null;
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContextClass();
    }
    return this.context;
  }

  private getPlayer() {
    if (!this.player) {
      this.player = new Audio();
      this.player.preload = 'auto';
      this.player.setAttribute('playsinline', 'true');
    }
    return this.player;
  }

  private clearPlayerSource() {
    const player = this.player;
    if (!player) return;
    player.pause();
    player.removeAttribute('src');
    player.load();
  }

  private async resumeContext() {
    const context = this.getContext();
    if (!context || context.state === 'running') return true;
    try {
      await context.resume();
      return true;
    } catch (error) {
      if (isNotAllowedAudioError(error)) {
        this.setUnlocked(false);
        this.callbacks.onUnlockRequired?.();
      }
      return false;
    }
  }

  async unlockAudio() {
    if (this.audioUnlocked) return true;
    if (this.playing) return this.audioUnlocked;

    const contextReady = await this.resumeContext();
    const player = this.getPlayer();

    try {
      player.src = SILENT_MOBILE_UNLOCK_AUDIO_URL;
      player.currentTime = 0;
      await player.play();
      player.pause();
      player.currentTime = 0;
      this.clearPlayerSource();
      this.setUnlocked(contextReady || !this.context || this.context.state === 'running');
      return this.audioUnlocked;
    } catch {
      this.clearPlayerSource();
      this.setUnlocked(false);
      this.callbacks.onUnlockRequired?.();
      return false;
    }
  }

  async resumeAfterPageReturn() {
    if (!this.context || this.context.state !== 'suspended') return true;
    const resumed = await this.resumeContext();
    if (!resumed) this.callbacks.onUnlockRequired?.();
    return resumed;
  }

  playTTS(source: Blob | string, details: Omit<MobileTtsPlaybackItem, 'source' | 'activeUrl' | 'revokeActiveUrl'>) {
    this.queue.push({ ...details, source });
    void this.drainQueue();
  }

  stopAll() {
    this.queue = [];
    if (this.current) this.finishCurrent('stopped');
    this.stopLevelMonitoring();
    this.clearPlayerSource();
  }

  destroy() {
    this.stopAll();
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.source = null;
    this.analyser = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.player = null;
    this.setUnlocked(false);
    this.callbacks = {};
  }

  private async drainQueue() {
    if (this.playing) return;
    const item = this.queue.shift();
    if (!item) return;

    this.current = item;
    this.playing = true;
    this.callbacks.onPlaybackStart?.(item);

    const player = this.getPlayer();
    const activeUrl = typeof item.source === 'string' ? item.source : URL.createObjectURL(item.source);
    item.activeUrl = activeUrl;
    item.revokeActiveUrl = typeof item.source !== 'string';
    player.src = activeUrl;
    player.currentTime = 0;
    player.onended = () => this.finishCurrent('ended');
    player.onerror = () => {
      const error = player.error || new Error('TTS audio playback failed.');
      this.callbacks.onPlaybackError?.(error);
      this.finishCurrent('error');
    };

    try {
      const contextReady = await this.resumeContext();
      if (this.context && !contextReady) throw createNotAllowedAudioError();
      this.connectAudioGraph();
      this.startLevelMonitoring(item.durationMs);
      await player.play();
      this.setUnlocked(true);
    } catch (error) {
      this.setUnlocked(false);
      if (isNotAllowedAudioError(error)) {
        this.callbacks.onPlaybackBlocked?.(error);
        this.callbacks.onUnlockRequired?.();
        this.finishCurrent('blocked');
      } else {
        this.callbacks.onPlaybackError?.(error);
        this.finishCurrent('error');
      }
    }
  }

  private connectAudioGraph() {
    const context = this.getContext();
    if (!context) return;
    const player = this.getPlayer();
    if (!this.source) this.source = context.createMediaElementSource(player);
    if (!this.analyser) {
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.45;
      this.source.connect(this.analyser);
      this.analyser.connect(context.destination);
    }
  }

  private startLevelMonitoring(durationMs: number) {
    this.stopLevelMonitoring();
    const analyser = this.analyser;
    if (!analyser) {
      this.startSyntheticLevel(durationMs);
      return;
    }
    const samples = new Uint8Array(analyser.fftSize);
    let previousLevel = -1;
    const tick = () => {
      if (!this.playing || !this.current) return;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        sum += normalized * normalized;
      }
      const level = rmsToMobileTtsMouthOpen(Math.sqrt(sum / samples.length));
      if (Math.abs(level - previousLevel) >= 0.018) {
        previousLevel = level;
        this.callbacks.onAudioLevel?.(level);
      }
      this.levelFrame = window.requestAnimationFrame(tick);
    };
    tick();
  }

  private startSyntheticLevel(durationMs: number) {
    const startedAt = performance.now();
    const tick = () => {
      if (!this.playing || !this.current) return;
      const elapsed = performance.now() - startedAt;
      if (elapsed <= durationMs) {
        const wave = Math.abs(Math.sin(elapsed / 92));
        this.callbacks.onAudioLevel?.(0.18 + wave * 0.46);
      }
      this.syntheticFrame = window.requestAnimationFrame(tick);
    };
    tick();
  }

  private stopLevelMonitoring() {
    if (this.levelFrame !== null) {
      window.cancelAnimationFrame(this.levelFrame);
      this.levelFrame = null;
    }
    if (this.syntheticFrame !== null) {
      window.cancelAnimationFrame(this.syntheticFrame);
      this.syntheticFrame = null;
    }
  }

  private finishCurrent(reason: 'ended' | 'blocked' | 'error' | 'stopped') {
    const item = this.current;
    if (!item) return;
    const player = this.player;
    this.stopLevelMonitoring();
    if (player) {
      player.onended = null;
      player.onerror = null;
      player.pause();
      player.removeAttribute('src');
      player.load();
    }
    if (item.revokeActiveUrl && item.activeUrl) URL.revokeObjectURL(item.activeUrl);
    this.current = null;
    this.playing = false;
    this.callbacks.onPlaybackEnd?.(item, reason);
    if (this.queue.length) void this.drainQueue();
  }
}

const audioPlaybackManager = new AudioPlaybackManager();

function getSavedBackground(): MobileBackground {
  try {
    const raw = localStorage.getItem(BACKGROUND_STORAGE_KEY);
    if (!raw) return { mode: 'none' };
    const parsed = JSON.parse(raw) as Partial<MobileBackground>;
    if (parsed.mode === 'image' && typeof parsed.dataUrl === 'string' && parsed.dataUrl.startsWith('data:image/')) {
      return {
        mode: 'image',
        dataUrl: parsed.dataUrl,
        ...(typeof parsed.name === 'string' && parsed.name ? { name: parsed.name } : {}),
      };
    }
  } catch {
    localStorage.removeItem(BACKGROUND_STORAGE_KEY);
  }
  return { mode: 'none' };
}

function saveBackground(background: MobileBackground) {
  if (background.mode === 'none') {
    localStorage.removeItem(BACKGROUND_STORAGE_KEY);
    return;
  }
  localStorage.setItem(BACKGROUND_STORAGE_KEY, JSON.stringify(background));
}

function readFileAsDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid image data.'));
    });
    reader.addEventListener('error', () => reject(reader.error || new Error('Could not read image.')));
    reader.readAsDataURL(file);
  });
}

function loadBackgroundImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error('Could not decode image.')), { once: true });
    image.src = dataUrl;
  });
}

async function canvasToBackgroundDataUrl(canvas: HTMLCanvasElement) {
  if (!canvas.toBlob) return canvas.toDataURL('image/jpeg', 0.84);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.84));
  if (!blob) return canvas.toDataURL('image/jpeg', 0.84);
  return readFileAsDataUrl(blob);
}

async function prepareBackgroundImage(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('Invalid image file.');
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadBackgroundImage(dataUrl);
  const maxSide = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const scale = maxSide > MAX_BACKGROUND_DIMENSION ? MAX_BACKGROUND_DIMENSION / maxSide : 1;
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return dataUrl;
  context.drawImage(image, 0, 0, width, height);
  return canvasToBackgroundDataUrl(canvas);
}

const MOBILE_EMOTION_ALIASES: Record<string, string> = {
  neutral: 'neutral',
  idle: 'neutral',
  calm: 'neutral',
  relaxed: 'neutral',
  happy: 'happy',
  joy: 'happy',
  smile: 'happy',
  smiling: 'happy',
  laugh: 'happy',
  laughing: 'happy',
  excited: 'happy',
  delighted: 'happy',
  satisfied: 'happy',
  proud: 'happy',
  impressed: 'happy',
  confident: 'happy',
  victory: 'happy',
  dance: 'happy',
  clap: 'happy',
  feliz: 'happy',
  alegre: 'happy',
  sad: 'sad',
  sadness: 'sad',
  depressed: 'sad',
  disappointed: 'sad',
  regretful: 'sad',
  lonely: 'sad',
  cry: 'sad',
  crying: 'sad',
  triste: 'sad',
  angry: 'angry',
  mad: 'angry',
  furious: 'angry',
  annoyed: 'angry',
  frustrated: 'angry',
  upset: 'angry',
  fighting: 'angry',
  disagree: 'angry',
  shake_head: 'angry',
  shakehead: 'angry',
  brava: 'angry',
  bravo: 'angry',
  raiva: 'angry',
  surprised: 'surprised',
  surprise: 'surprised',
  shocked: 'surprised',
  shock: 'surprised',
  question: 'surprised',
  curious: 'surprised',
  confused: 'surprised',
  doubtful: 'surprised',
  thinking: 'surprised',
  shy: 'shy',
  blush: 'shy',
  embarrassed: 'shy',
  flustered: 'shy',
  teasing: 'shy',
  smug: 'shy',
  love: 'love',
  loving: 'love',
  affection: 'love',
  caring: 'love',
  heartbox: 'love',
  hearteyes: 'love',
  kiss: 'love',
  fear: 'fear',
  scared: 'fear',
  afraid: 'fear',
  worried: 'fear',
  concerned: 'fear',
  medo: 'fear',
  bored: 'neutral',
  tired: 'neutral',
  sleepy: 'neutral',
  sick: 'neutral',
  relieved: 'happy',
  wave: 'happy',
  nod: 'happy',
  agree: 'happy',
  bow: 'happy',
  yawn: 'neutral',
  sigh: 'neutral',
  stretch: 'neutral',
  facepalm: 'angry',
  point: 'surprised',
  shrug: 'neutral',
  listening: 'listening',
  speaking: 'speaking',
  laughter: 'happy',
  sighing: 'neutral',
  chuckling: 'happy',
  sobbing: 'sad',
  screaming: 'angry',
  whispering: 'neutral',
  very_excited: 'happy',
  warm_and_happy: 'happy',
  slightly_sad: 'sad',
  extremely_angry: 'angry',
  in_a_hurry_tone: 'surprised',
  confirmation_en: 'happy',
  question_en: 'surprised',
  question_ah: 'surprised',
  question_oh: 'surprised',
  question_ei: 'surprised',
  question_yi: 'surprised',
  surprise_ah: 'surprised',
  surprise_oh: 'surprised',
  surprise_wa: 'surprised',
  surprise_yo: 'surprised',
  dissatisfaction_hnn: 'angry',
};

const MOBILE_LIVE2D_SIGNAL_SET = new Set([
  'neutral', 'happy', 'excited', 'laugh', 'sad', 'depressed', 'mad', 'angry', 'furious', 'annoyed',
  'frustrated', 'disappointed', 'shocked', 'surprised', 'confused', 'bored', 'tired', 'sleepy', 'sick',
  'relieved', 'embarrassed', 'caring', 'proud', 'impressed', 'smug', 'confident', 'teasing', 'shy',
  'curious', 'question', 'thinking', 'doubtful', 'waiting', 'worried', 'scared', 'concerned', 'fighting',
  'heartbox', 'hearteyes', 'blush', 'dark', 'love', 'wave', 'nod', 'shake_head', 'clap', 'point', 'shrug',
  'bow', 'yawn', 'sigh', 'stretch', 'facepalm', 'kiss', 'victory', 'dance', 'agree', 'disagree', 'reset',
  'speaking', 'listening',
]);

const MOBILE_LIVE2D_TAG_PATTERN = /(?:\[(?:emotion|emo|expression|face|mood)?\s*:?\s*([a-zA-Z0-9_ -]+?)\]|\{(?:emotion|expression|mood)\s*:\s*["']?([a-zA-Z0-9_ -]+?)["']?\}|<\s*(?:emotion|expression|mood)\s*[:=]\s*["']?([a-zA-Z0-9_ -]+?)["']?\s*\/?>|<nekogpt-state[^>]*>[\s\S]*?"emotion"\s*:\s*"([^"]{2,48})"[\s\S]*?<\/nekogpt-state>)/gi;

function normalizeMobileEmotion(value: unknown) {
  const token = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]+/g, '');
  if (MOBILE_LIVE2D_SIGNAL_SET.has(token)) return token;
  return MOBILE_EMOTION_ALIASES[token] || '';
}

function detectMobileEmotionFromText(text: unknown) {
  const raw = String(text || '');
  MOBILE_LIVE2D_TAG_PATTERN.lastIndex = 0;
  let match = MOBILE_LIVE2D_TAG_PATTERN.exec(raw);
  while (match) {
    const emotion = normalizeMobileEmotion(match[1] || match[2] || match[3] || match[4]);
    if (emotion) return emotion;
    match = MOBILE_LIVE2D_TAG_PATTERN.exec(raw);
  }
  return '';
}

function cleanMobileLive2DText(text: string) {
  MOBILE_LIVE2D_TAG_PATTERN.lastIndex = 0;
  return text
    .replace(MOBILE_LIVE2D_TAG_PATTERN, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatMobileError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || '');
  const message = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();

  if (/sobrecarregado|overloaded|500|internal server|internal error|internal error encountered|503|unavailable/i.test(message)) {
    return 'O provedor de IA está instável agora. Tente novamente em instantes.';
  }
  return message || 'Não foi possível completar a ação no NekoGPT.';
}

function normalizeMobileMediaMimeType(file: File) {
  const mimeType = file.type.split(';', 1)[0].trim().toLowerCase();
  if (mimeType) return mimeType;
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webm') return 'video/webm';
  if (extension === 'mp4') return 'video/mp4';
  if (extension === 'mpeg' || extension === 'mpg') return 'video/mpeg';
  if (extension === 'mov') return 'video/quicktime';
  return '';
}

function dataUrlBase64(dataUrl: string) {
  return dataUrl.replace(/^data:[^,]+,/i, '').replace(/\s+/g, '');
}

function canvasToVisionImage(canvas: HTMLCanvasElement, sourceId: string, sourceName: string): VisionImage {
  return {
    mimeType: 'image/png',
    data: dataUrlBase64(canvas.toDataURL('image/png')),
    width: canvas.width,
    height: canvas.height,
    capturedAt: Date.now(),
    captureMode: 'webcam',
    sourceId,
    sourceName,
  };
}

function drawScaledVisionFrame(
  drawable: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  sourceId: string,
  sourceName: string,
) {
  const safeWidth = Math.max(1, sourceWidth);
  const safeHeight = Math.max(1, sourceHeight);
  const maxSide = Math.max(safeWidth, safeHeight);
  const scale = maxSide > MOBILE_VISION_FRAME_MAX_DIMENSION ? MOBILE_VISION_FRAME_MAX_DIMENSION / maxSide : 1;
  const width = Math.max(1, Math.round(safeWidth * scale));
  const height = Math.max(1, Math.round(safeHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(t(getSavedLanguage(), 'app.error.mediaRead'));
  context.drawImage(drawable, 0, 0, width, height);
  return canvasToVisionImage(canvas, sourceId, sourceName);
}

async function createVisionImageFromImageFile(file: File) {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadBackgroundImage(dataUrl);
  return drawScaledVisionFrame(
    image,
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
    'mobile-file',
    file.name || 'Mobile image',
  );
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: 'loadeddata' | 'seeked') {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve();
    }, 2500);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener(eventName, onEvent);
      video.removeEventListener('error', onError);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(t(getSavedLanguage(), 'app.error.mediaRead')));
    };
    video.addEventListener(eventName, onEvent, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

async function createVisionImageFromVideoFile(file: File, previewUrl: string) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.src = previewUrl;
  await waitForVideoEvent(video, 'loadeddata');
  const durationMs = Number.isFinite(video.duration) && video.duration > 0
    ? Math.round(video.duration * 1000)
    : undefined;
  if (Number.isFinite(video.duration) && video.duration > 0.35) {
    video.currentTime = Math.min(0.35, video.duration / 3);
    await waitForVideoEvent(video, 'seeked').catch(() => undefined);
  }
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 360;
  return {
    durationMs,
    visionImage: drawScaledVisionFrame(video, width, height, 'mobile-video-frame', file.name || 'Mobile video'),
  };
}

async function prepareMobileMedia(file: File): Promise<PendingMobileMedia> {
  const mimeType = normalizeMobileMediaMimeType(file);
  const image = SUPPORTED_MOBILE_IMAGE_MIME_TYPES.has(mimeType);
  const video = SUPPORTED_MOBILE_VIDEO_MIME_TYPES.has(mimeType);
  if (!image && !video) throw new Error(t(getSavedLanguage(), 'app.error.mediaUnsupported'));
  if (file.size > MAX_MOBILE_MEDIA_BYTES) throw new Error(t(getSavedLanguage(), 'app.error.mediaTooLarge'));

  const previewUrl = URL.createObjectURL(file);
  try {
    const mediaDataUrl = await readFileAsDataUrl(file);
    const attachment: MobileChatAttachment = {
      id: crypto.randomUUID(),
      name: file.name || (image ? 'image' : 'video'),
      mimeType,
      data: dataUrlBase64(mediaDataUrl),
    };

    if (image) {
      return {
        id: crypto.randomUUID(),
        kind: 'image',
        name: file.name || 'image',
        mimeType,
        previewUrl,
        attachment,
        visionImage: await createVisionImageFromImageFile(file),
      };
    }

    const { durationMs, visionImage } = await createVisionImageFromVideoFile(file, previewUrl);
    return {
      id: crypto.randomUUID(),
      kind: 'video',
      name: file.name || 'video',
      mimeType,
      previewUrl,
      attachment,
      visionImage,
      visionVideo: {
        mimeType: mimeType as VisionVideo['mimeType'],
        data: attachment.data,
        ...(durationMs ? { durationMs } : {}),
        capturedAt: Date.now(),
        captureMode: 'webcam',
        sourceId: 'mobile-video',
        sourceName: file.name || 'Mobile video',
      },
    };
  } catch (error) {
    URL.revokeObjectURL(previewUrl);
    throw error;
  }
}

function normalizeMobileChatAttachments(input: unknown): MobileChatAttachment[] {
  if (!Array.isArray(input)) return [];
  return input
    .flatMap((item) => {
      const value = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const name = typeof value.name === 'string' && value.name.trim()
        ? value.name.trim().slice(0, 160)
        : 'media';
      const mimeType = typeof value.mimeType === 'string' ? value.mimeType.trim().toLowerCase().slice(0, 120) : '';
      const rawData = typeof value.data === 'string' ? value.data.trim() : '';
      const data = rawData.replace(/^data:[^,]+,/i, '').replace(/\s+/g, '');
      if (!/^(?:image|video)\//i.test(mimeType) || !data || !/^[A-Za-z0-9+/=]+$/.test(data)) return [];
      return [{
        id: typeof value.id === 'string' && value.id ? value.id.slice(0, 120) : crypto.randomUUID(),
        name,
        mimeType,
        data,
        ...(typeof value.text === 'string' && value.text ? { text: value.text.slice(0, 120_000) } : {}),
      }];
    })
    .slice(0, 5);
}

function createMessage(
  role: MobileChatMessage['role'],
  content: string,
  options: { attachments?: MobileChatAttachment[]; subtitle?: string; emotion?: string } = {},
): MobileChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
    ...(options.subtitle ? { subtitle: options.subtitle } : {}),
    ...(options.emotion ? { emotion: options.emotion } : {}),
    ...(options.attachments?.length ? { attachments: options.attachments } : {}),
  };
}

function normalizeHistory(input: unknown, language: AppLanguage = getSavedLanguage()): CompanionChatHistory {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const messages = Array.isArray(value.messages)
    ? value.messages.flatMap((item) => {
      const message = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const content = typeof message.content === 'string' ? message.content.trim() : '';
      if (!content) return [];
      const role = message.role === 'assistant' ? 'assistant' as const : 'user' as const;
      const attachments = normalizeMobileChatAttachments(message.attachments);
      return [{
        id: typeof message.id === 'string' && message.id ? message.id : crypto.randomUUID(),
        role,
        content: role === 'assistant' ? cleanMobileLive2DText(content) || content : content,
        createdAt: typeof message.createdAt === 'string' ? message.createdAt : new Date().toISOString(),
        ...(typeof message.subtitle === 'string' && message.subtitle ? { subtitle: message.subtitle } : {}),
        ...(typeof message.emotion === 'string' && message.emotion ? { emotion: message.emotion } : {}),
        ...(attachments.length ? { attachments } : {}),
      }];
    })
    : [];
  return {
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : '',
    title: typeof value.title === 'string' ? value.title : t(language, 'app.chat.emptyTitle'),
    assistantName: typeof value.assistantName === 'string' && value.assistantName.trim()
      ? value.assistantName.trim()
      : 'NekoGPT',
    assistantAvatarUrl: typeof value.assistantAvatarUrl === 'string' && value.assistantAvatarUrl.startsWith('data:image/')
      ? value.assistantAvatarUrl
      : '',
    messages,
  };
}

function detectLatestAssistantHistoryEmotion(input: unknown) {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  if (!Array.isArray(value.messages)) return '';
  for (let index = value.messages.length - 1; index >= 0; index -= 1) {
    const message = value.messages[index] && typeof value.messages[index] === 'object'
      ? value.messages[index] as Record<string, unknown>
      : {};
    if (message.role !== 'assistant' || typeof message.content !== 'string') continue;
    const emotion = normalizeMobileEmotion(message.emotion)
      || detectMobileEmotionFromText(message.content);
    if (emotion) return emotion;
  }
  return '';
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').replace(/^data:[^,]+,/, ''));
    reader.onerror = () => reject(reader.error || new Error(t(getSavedLanguage(), 'app.error.audioRead')));
    reader.readAsDataURL(blob);
  });
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function encodePcmWav(samples: Float32Array, sampleRate: number) {
  const wavBuffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(wavBuffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (const value of samples) {
    const sample = Math.max(-1, Math.min(1, value));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([wavBuffer], { type: 'audio/wav' });
}

async function convertAudioBlobToWav(blob: Blob) {
  const AudioContextClass = window.AudioContext
    || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error(t(getSavedLanguage(), 'app.error.audioDecode'));
  }

  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData((await blob.arrayBuffer()).slice(0));
    const sampleRate = decoded.sampleRate;
    const sampleCount = decoded.length;
    const channelCount = Math.max(1, decoded.numberOfChannels);
    const channels = Array.from(
      { length: channelCount },
      (_, index) => decoded.getChannelData(index),
    );
    const samples = new Float32Array(sampleCount);
    for (let index = 0; index < sampleCount; index += 1) {
      let sample = 0;
      for (const channel of channels) sample += channel[index] || 0;
      samples[index] = sample / channelCount;
    }
    return encodePcmWav(samples, sampleRate);
  } finally {
    await context.close().catch(() => undefined);
  }
}

function chooseAudioMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
  return candidates.find((candidate) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) || '';
}

function getPairingCodeFromUrl() {
  return '';
}

function formatMessageTime(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function attachmentDataUrl(attachment: MobileChatAttachment) {
  return `data:${attachment.mimeType};base64,${attachment.data}`;
}

function splitAssistantMessage(content: string) {
  const parts = content.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : [content];
}

function estimateMobileTtsDurationMs(text: string) {
  const cleanText = text.replace(/\s+/g, ' ').trim();
  const words = cleanText ? cleanText.split(' ').length : 0;
  return Math.max(1200, Math.min(45_000, words * 360 + cleanText.length * 18));
}

function normalizeTtsAudioPayload(input: unknown): CompanionTtsAudio | null {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  let mimeType = typeof value.mimeType === 'string' ? value.mimeType.trim() : '';
  let data = typeof value.data === 'string' ? value.data.trim() : '';
  const dataUrlMatch = data.match(/^data:([^;,]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    mimeType = mimeType || dataUrlMatch[1];
    data = dataUrlMatch[2];
  }
  if (!/^audio\/[a-z0-9.+-]+$/i.test(mimeType)) return null;
  if (!data || !/^[A-Za-z0-9+/=]+$/.test(data)) return null;
  return {
    mimeType,
    data,
    text: typeof value.text === 'string' ? value.text : '',
    subtitle: typeof value.subtitle === 'string' ? value.subtitle : '',
    emotion: typeof value.emotion === 'string' ? value.emotion : '',
    durationMs: Number(value.durationMs) > 0 ? Number(value.durationMs) : undefined,
  };
}

function cleanMobileStateString(value: unknown, maxLength = 180) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeMobileStateNumber(value: unknown, fallback: number | undefined, min: number, max: number) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, numberValue));
}

function normalizeMobileStringMap(value: unknown) {
  const result: Record<string, string> = {};
  if (!value || typeof value !== 'object') return result;
  Object.entries(value as Record<string, unknown>).slice(0, 80).forEach(([key, entry]) => {
    const cleanKey = cleanMobileStateString(key, 80);
    const cleanValue = cleanMobileStateString(entry, 180);
    if (cleanKey && cleanValue) result[cleanKey] = cleanValue;
  });
  return result;
}

function normalizeCompanionLive2DState(input: unknown, fallback: CompanionLive2DState | null = null): CompanionLive2DState | null {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const source = value.live2d && typeof value.live2d === 'object'
    ? {
        ...(value.live2d as Record<string, unknown>),
        ...(value.emotion !== undefined ? { emotion: value.emotion } : {}),
        ...(value.expression !== undefined ? { expression: value.expression } : {}),
        ...(value.motion !== undefined ? { motion: value.motion } : {}),
      }
    : value;
  if (!Object.keys(source).length) return fallback;

  const actionSource = source.live2dAction && typeof source.live2dAction === 'object'
    ? source.live2dAction as Record<string, unknown>
    : null;
  const actionKind = actionSource?.kind === 'expression' || actionSource?.kind === 'motion'
    ? actionSource.kind
    : null;
  const actionValue = cleanMobileStateString(actionSource?.value, 180);
  const intervalMs = Number(actionSource?.intervalMs);

  const next: CompanionLive2DState = {
    ...(fallback || {}),
    currentStateId: cleanMobileStateString(source.currentStateId, 80) || fallback?.currentStateId,
    currentStateName: cleanMobileStateString(source.currentStateName, 120) || fallback?.currentStateName,
    stateEnabled: typeof source.stateEnabled === 'boolean' ? source.stateEnabled : fallback?.stateEnabled,
    stateMode: cleanMobileStateString(source.stateMode, 40) || fallback?.stateMode,
    live2dAction: actionKind && actionValue
      ? {
          stateId: cleanMobileStateString(actionSource?.stateId, 80) || cleanMobileStateString(source.currentStateId, 80),
          kind: actionKind,
          value: actionValue,
          intervalMs: Number.isFinite(intervalMs) && intervalMs > 0 ? Math.min(30_000, Math.max(1500, intervalMs)) : 10_000,
        }
      : (actionSource || 'live2dAction' in source) ? null : fallback?.live2dAction || null,
    expressionMap: 'expressionMap' in source ? normalizeMobileStringMap(source.expressionMap) : fallback?.expressionMap,
    motionMap: 'motionMap' in source ? normalizeMobileStringMap(source.motionMap) : fallback?.motionMap,
    expressionPreset: cleanMobileStateString(source.expressionPreset, 180) || fallback?.expressionPreset,
    motionPreset: cleanMobileStateString(source.motionPreset, 180) || fallback?.motionPreset,
    autoExpressionsEnabled: typeof source.autoExpressionsEnabled === 'boolean'
      ? source.autoExpressionsEnabled
      : fallback?.autoExpressionsEnabled,
    autoMotionsEnabled: typeof source.autoMotionsEnabled === 'boolean'
      ? source.autoMotionsEnabled
      : fallback?.autoMotionsEnabled,
    maxFps: normalizeMobileStateNumber(source.maxFps, fallback?.maxFps, 30, 60),
    speakingMotionEnabled: typeof source.speakingMotionEnabled === 'boolean'
      ? source.speakingMotionEnabled
      : fallback?.speakingMotionEnabled,
    speakingMotionIntensity: normalizeMobileStateNumber(source.speakingMotionIntensity, fallback?.speakingMotionIntensity, 0, 1),
    speakingMotionSpeed: normalizeMobileStateNumber(source.speakingMotionSpeed, fallback?.speakingMotionSpeed, 0.5, 5),
    speakingMotionBodyFollow: normalizeMobileStateNumber(source.speakingMotionBodyFollow, fallback?.speakingMotionBodyFollow, 0, 1),
    speakingMotionVolumeThreshold: normalizeMobileStateNumber(source.speakingMotionVolumeThreshold, fallback?.speakingMotionVolumeThreshold, 0, 1),
    speakingMotionSmoothing: normalizeMobileStateNumber(source.speakingMotionSmoothing, fallback?.speakingMotionSmoothing, 0, 1),
    listeningMotionEnabled: typeof source.listeningMotionEnabled === 'boolean'
      ? source.listeningMotionEnabled
      : fallback?.listeningMotionEnabled,
    listeningMotionIntensity: normalizeMobileStateNumber(source.listeningMotionIntensity, fallback?.listeningMotionIntensity, 0, 1),
    listeningMotionSpeed: normalizeMobileStateNumber(source.listeningMotionSpeed, fallback?.listeningMotionSpeed, 0.5, 5),
    listeningMotionBodyFollow: normalizeMobileStateNumber(source.listeningMotionBodyFollow, fallback?.listeningMotionBodyFollow, 0, 1),
    listeningMotionVolumeThreshold: normalizeMobileStateNumber(source.listeningMotionVolumeThreshold, fallback?.listeningMotionVolumeThreshold, 0, 1),
    listeningMotionSmoothing: normalizeMobileStateNumber(source.listeningMotionSmoothing, fallback?.listeningMotionSmoothing, 0, 1),
    emotion: normalizeMobileEmotion(source.emotion) || normalizeMobileEmotion(source.expression) || fallback?.emotion,
    expression: cleanMobileStateString(source.expression, 120) || fallback?.expression,
    motion: cleanMobileStateString(source.motion, 180) || fallback?.motion,
    updatedAt: Number(source.updatedAt) > 0 ? Number(source.updatedAt) : Date.now(),
  };

  return next;
}

function base64ToBlob(data: string, mimeType: string) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

type ChatMessageViewProps = {
  message: MobileChatMessage;
  assistantName: string;
  assistantAvatarUrl: string;
  openHistoryLabel: string;
  onOpenHistory?: () => void;
};

function ChatMessageView({
  message,
  assistantName,
  assistantAvatarUrl,
  openHistoryLabel,
  onOpenHistory,
}: ChatMessageViewProps) {
  const assistant = message.role === 'assistant';
  const parts = assistant ? splitAssistantMessage(message.content) : [message.content];
  const bubbles = parts.map((part, index) => {
    const content = (
      <>
        <span className="app-message-content">{part}</span>
        {assistant && index === parts.length - 1 && message.subtitle && (
          <span className="app-message-subtitle">{message.subtitle}</span>
        )}
        {index === parts.length - 1 && message.attachments?.length ? (
          <span className="app-message-attachments">
            {message.attachments.map((attachment) => (
              <span key={attachment.id} className="app-message-attachment">
                {attachment.mimeType.startsWith('image/') ? (
                  <img src={attachmentDataUrl(attachment)} alt={attachment.name} />
                ) : attachment.mimeType.startsWith('video/') ? (
                  <video src={attachmentDataUrl(attachment)} muted playsInline preload="metadata" controls />
                ) : null}
                <span className="app-message-attachment-name">{attachment.name}</span>
              </span>
            ))}
          </span>
        ) : null}
        {index === parts.length - 1 && (
          <time className="app-message-time">{formatMessageTime(message.createdAt)}</time>
        )}
      </>
    );
    return onOpenHistory ? (
      <button
        key={`${message.id}-${index}`}
        type="button"
        className={`app-message-bubble app-message-bubble--${message.role}`}
        onClick={onOpenHistory}
        aria-label={openHistoryLabel}
      >
        {content}
      </button>
    ) : (
      <div key={`${message.id}-${index}`} className={`app-message-bubble app-message-bubble--${message.role}`}>
        {content}
      </div>
    );
  });

  if (!assistant) {
    return (
      <div className="app-message-line app-message-line--user">
        <div className="app-message-stack app-message-stack--user">{bubbles}</div>
      </div>
    );
  }

  return (
    <div className="app-message-line app-message-line--assistant">
      <div className="app-assistant-row">
        <span className="app-assistant-avatar" aria-hidden="true">
          <img src={assistantAvatarUrl || '/neko-mark.svg'} alt="" />
        </span>
        <div className="app-message-stack app-message-stack--assistant">
          <span className="app-assistant-author">{assistantName}</span>
          {bubbles}
        </div>
      </div>
    </div>
  );
}

function PawIcon() {
  return (
    <img className="paw-icon" src="/neko-paw-button-cropped.png" alt="" aria-hidden="true" />
  );
}

function MediaIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m21.1 11.6-8.8 8.8a6 6 0 0 1-8.5-8.5l9.4-9.4a4.1 4.1 0 0 1 5.8 5.8l-9.3 9.3a2.2 2.2 0 0 1-3.1-3.1l8.2-8.2" />
    </svg>
  );
}

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4Z" />
      {!muted && (
        <>
          <path d="M16 9a4.2 4.2 0 0 1 0 6" />
          <path d="M18.5 6.5a7.8 7.8 0 0 1 0 11" />
        </>
      )}
      {muted && <path className="sound-icon__slash" d="M4.8 4.8 19.2 19.2" />}
    </svg>
  );
}

export default function App() {
  const connection = useMemo(() => new NekoConnection(), []);
  const initialLanguage = useMemo(() => getSavedLanguage(), []);
  const [language, setLanguage] = useState<AppLanguage>(initialLanguage);
  const [phase, setPhase] = useState<ConnectionPhase>('disconnected');
  const [phaseDetail, setPhaseDetail] = useState('');
  const [bundle, setBundle] = useState<Live2DBundle | null>(null);
  const [bundleProgress, setBundleProgress] = useState('');
  const [chatHistory, setChatHistory] = useState<CompanionChatHistory>(() => normalizeHistory({}, initialLanguage));
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [emotion, setEmotion] = useState('neutral');
  const [emotionTrigger, setEmotionTrigger] = useState(0);
  const [companionLive2DState, setCompanionLive2DState] = useState<CompanionLive2DState | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioUnlocked, setAudioUnlocked] = useState(() => audioPlaybackManager.isUnlocked());
  const [voiceUnlockVisible, setVoiceUnlockVisible] = useState(false);
  const [notice, setNotice] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState<CameraMode>('off');
  const [cameraPosition, setCameraPosition] = useState({ x: 14, y: 72 });
  const [background, setBackground] = useState<MobileBackground>(() => getSavedBackground());
  const [pendingMedia, setPendingMedia] = useState<PendingMobileMedia | null>(null);
  const [bundleRequestVersion, setBundleRequestVersion] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const cameraFloatRef = useRef<HTMLDivElement>(null);
  const cameraDragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraModeRef = useRef<CameraMode>('off');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const pcmSampleRateRef = useRef(0);
  const pcmProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmSilentGainRef = useRef<GainNode | null>(null);
  const micEnabledRef = useRef(false);
  const transcribingRef = useRef(false);
  const pendingMicRestartRef = useRef(false);
  const discardRecordingRef = useRef(false);
  const voiceCycleTimerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const silenceFrameRef = useRef<number | null>(null);
  const mobileVadRef = useRef(createMobileVadState());
  const speechTimerRef = useRef<number | null>(null);
  const mobileTtsActiveRef = useRef(false);
  const suspendMicForTtsRef = useRef(false);
  const restartMicAfterTtsRef = useRef(false);
  const lastTtsPlaybackEndedAtRef = useRef(0);
  const historyScrollRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<MobileChatMessage[]>(chatHistory.messages);
  const companionLive2DStateRef = useRef<CompanionLive2DState | null>(null);
  const sendingRef = useRef(false);
  const bundleRetryCountRef = useRef(0);
  const bundleRetryTimerRef = useRef<number | null>(null);
  const touchReactionInFlightRef = useRef(false);

  messagesRef.current = chatHistory.messages;
  companionLive2DStateRef.current = companionLive2DState;
  sendingRef.current = sending;
  transcribingRef.current = transcribing;
  cameraModeRef.current = cameraMode;

  const relayUrl = DEFAULT_RELAY_URL;
  const pairingCode = getPairingCodeFromUrl();

  const copy = (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) => t(language, key, vars);

  function applyMobileEmotion(value: unknown, fallback = '') {
    const nextEmotion = normalizeMobileEmotion(value) || normalizeMobileEmotion(fallback);
    if (!nextEmotion) return;
    setEmotion(nextEmotion);
    setEmotionTrigger((current) => current + 1);
  }

  function applyCompanionLive2DState(value: unknown) {
    const nextState = normalizeCompanionLive2DState(value, companionLive2DStateRef.current);
    if (!nextState) return;
    companionLive2DStateRef.current = nextState;
    setCompanionLive2DState(nextState);
    const nextEmotion = normalizeMobileEmotion(nextState.emotion)
      || normalizeMobileEmotion(nextState.expression);
    if (nextEmotion) applyMobileEmotion(nextEmotion);
  }

  useEffect(() => {
    saveLanguage(language);
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => () => {
    if (pendingMedia?.previewUrl) URL.revokeObjectURL(pendingMedia.previewUrl);
  }, [pendingMedia?.previewUrl]);

  useEffect(() => {
    const unsubscribePhase = connection.onPhase((nextPhase, detail) => {
      setPhase(nextPhase);
      setPhaseDetail(detail || '');
    });
    const unsubscribeEvent = connection.onEvent((message) => handleCompanionEvent(message));
    return () => {
      unsubscribePhase();
      unsubscribeEvent();
    };
  }, [connection]);

  useEffect(() => {
    const savedConnection = getSavedConnectionConfig();
    if (!savedConnection) return;
    connection.connect(savedConnection.relayUrl, savedConnection.pairingCode);
  }, [connection]);

  useEffect(() => {
    audioPlaybackManager.setCallbacks({
      onAudioUnlockChange: (unlocked) => {
        setAudioUnlocked(unlocked);
        if (unlocked) setVoiceUnlockVisible(false);
      },
      onUnlockRequired: () => {
        setVoiceUnlockVisible(true);
      },
      onPlaybackStart: beginMobileTtsVisualState,
      onPlaybackEnd: finishMobileTtsVisualState,
      onPlaybackBlocked: () => {
        setNotice(t(language, 'app.error.ttsBlocked'));
      },
      onPlaybackError: () => {
        setNotice(t(language, 'app.error.ttsPlayback'));
      },
      onAudioLevel: setAudioLevel,
    });
    return () => audioPlaybackManager.setCallbacks({});
  }, [language]);

  useEffect(() => {
    const verifyAudioAfterReturn = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      void audioPlaybackManager.resumeAfterPageReturn()
        .then((resumed) => {
          setAudioUnlocked(audioPlaybackManager.isUnlocked());
          if (!resumed) setVoiceUnlockVisible(true);
        });
    };
    document.addEventListener('visibilitychange', verifyAudioAfterReturn);
    window.addEventListener('pageshow', verifyAudioAfterReturn);
    return () => {
      document.removeEventListener('visibilitychange', verifyAudioAfterReturn);
      window.removeEventListener('pageshow', verifyAudioAfterReturn);
    };
  }, []);

  useEffect(() => {
    if (phase !== 'connected') return;
    let cancelled = false;

    void connection.rpc<CompanionChatHistory>('companion.chat.history')
      .then((history) => {
        if (!cancelled) setChatHistory(normalizeHistory(history, language));
      })
      .catch((error) => {
        if (!cancelled) setNotice(formatMobileError(error));
      });

    return () => {
      cancelled = true;
    };
  }, [connection, language, phase]);

  useEffect(() => {
    if (phase !== 'connected') return;
    let cancelled = false;

    const refreshSnapshot = () => {
      void connection.rpc<CompanionSnapshot>('companion.snapshot', undefined, 12_000)
        .then((snapshot) => {
          if (cancelled) return;
          applyCompanionLive2DState(snapshot.live2d || snapshot);
        })
        .catch(() => undefined);
    };

    refreshSnapshot();
    const timer = window.setInterval(refreshSnapshot, 3500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [connection, phase]);

  useEffect(() => {
    if (phase !== 'connected') {
      setBundle(null);
      setCompanionLive2DState(null);
      setListening(false);
      setSpeaking(false);
      bundleRetryCountRef.current = 0;
      if (cameraStreamRef.current) stopCamera();
      if (micEnabledRef.current || recorderStreamRef.current) {
        micEnabledRef.current = false;
        setMicEnabled(false);
        stopRecording(true);
        recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
        recorderStreamRef.current = null;
        cleanupVoiceDetection();
      }
      return;
    }
    let cancelled = false;
    setBundleProgress(bundleRequestVersion
      ? t(language, 'app.status.live2dRetrying')
      : t(language, 'app.status.live2dReceiving'));

    void connection.requestLive2DBundle()
      .then((nextBundle) => {
        if (!cancelled) {
          setBundle(nextBundle);
          setBundleProgress(t(language, 'app.status.live2dPreparing'));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          scheduleLive2DRetry(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bundleRequestVersion, connection, language, phase]);

  useEffect(() => {
    if (!historyOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const node = historyScrollRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [chatHistory.messages, historyOpen]);

  useEffect(() => () => {
    stopCamera();
    cleanupVoiceDetection();
    stopMobileTtsPlayback(false);
    micEnabledRef.current = false;
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioPlaybackManager.destroy();
    if (speechTimerRef.current !== null) window.clearTimeout(speechTimerRef.current);
    if (bundleRetryTimerRef.current !== null) window.clearTimeout(bundleRetryTimerRef.current);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = cameraStreamRef.current;
    if (cameraMode !== 'off' && cameraStreamRef.current) {
      void video.play().catch(() => undefined);
    }
  }, [cameraMode]);

  function stopMobileTtsPlayback(updateState = true) {
    audioPlaybackManager.stopAll();
    mobileTtsActiveRef.current = false;
    if (updateState) {
      setSpeaking(false);
      setAudioLevel(0);
    }
  }

  async function requestAudioUnlock() {
    const unlocked = await audioPlaybackManager.unlockAudio();
    setAudioUnlocked(unlocked);
    setVoiceUnlockVisible(!unlocked);
    if (unlocked) setNotice('');
    return unlocked;
  }

  function beginMobileTtsVisualState(item: MobileTtsPlaybackItem) {
    if (speechTimerRef.current !== null) {
      window.clearTimeout(speechTimerRef.current);
      speechTimerRef.current = null;
    }
    pauseMicrophoneForMobileTts();
    mobileTtsActiveRef.current = true;
    setListening(false);
    setSpeaking(true);
    setAudioLevel(0.24);
    const payloadEmotion = normalizeMobileEmotion(item.emotion)
      || detectMobileEmotionFromText(`${item.text || ''}\n${item.subtitle || ''}`);
    if (payloadEmotion) applyMobileEmotion(payloadEmotion);
  }

  function finishMobileTtsVisualState() {
    mobileTtsActiveRef.current = false;
    lastTtsPlaybackEndedAtRef.current = performance.now();
    setSpeaking(false);
    setAudioLevel(0);
    resumeMicrophoneAfterMobileTts();
  }

  function playMobileTtsAudio(payload: CompanionTtsAudio) {
    const durationMs = payload.durationMs || estimateMobileTtsDurationMs(payload.subtitle || payload.text || '');
    audioPlaybackManager.playTTS(base64ToBlob(payload.data, payload.mimeType), {
      durationMs,
      text: payload.text,
      subtitle: payload.subtitle,
      emotion: payload.emotion,
    });
  }

  function handleCompanionEvent(message: RelayMessage) {
    if (message.type === 'companion.snapshot' || message.type === 'companion.snapshot.updated') {
      applyCompanionLive2DState(message.payload);
      return;
    }
    if (message.type === 'companion.live2d.state' || message.type === 'live2d.state') {
      applyCompanionLive2DState(message.payload || message);
      return;
    }
    if (message.type === 'chat.history') {
      const historyEmotion = detectLatestAssistantHistoryEmotion(message.payload);
      setChatHistory(normalizeHistory(message.payload, language));
      if (historyEmotion) applyMobileEmotion(historyEmotion);
      return;
    }
    if (message.type === 'live2d.expression') {
      const payload = message.payload as Record<string, unknown> | undefined;
      applyCompanionLive2DState(payload || message);
      applyMobileEmotion(payload?.emotion || message.emotion, 'neutral');
      return;
    }
    if (message.type === 'tts.audio') {
      const payload = normalizeTtsAudioPayload(message.payload);
      if (payload) void playMobileTtsAudio(payload);
      return;
    }
    if (message.type === 'live2d.speech') {
      const payload = (message.payload || {}) as Record<string, unknown>;
      if (payload.live2d) applyCompanionLive2DState(payload);
      const source = payload.source === 'listening' || payload.listening === true ? 'listening' : 'speaking';
      const payloadEmotion = normalizeMobileEmotion(payload.emotion)
        || detectMobileEmotionFromText(`${payload.text || ''}\n${payload.subtitle || ''}`);
      if (payloadEmotion) applyMobileEmotion(payloadEmotion);
      if (source === 'listening') {
        const active = payload.active !== false;
        setListening(active);
        if (!mobileTtsActiveRef.current && !active) setAudioLevel(0);
        return;
      }
      if (mobileTtsActiveRef.current && source === 'speaking') return;
      const active = payload.active !== false;
      setListening(false);
      setSpeaking(active);
      setAudioLevel(Number(payload.mouthOpen) || (active ? 0.42 : 0));
      if (speechTimerRef.current !== null) window.clearTimeout(speechTimerRef.current);
      if (active && Number(payload.durationMs) > 0) {
        speechTimerRef.current = window.setTimeout(() => {
          if (mobileTtsActiveRef.current) return;
          setSpeaking(false);
          setAudioLevel(0);
        }, Number(payload.durationMs) + 180);
      }
      return;
    }
    if (message.type === 'companion.notice') {
      const noticeMessage = String((message.payload as Record<string, unknown> | undefined)?.message || '');
      setNotice(noticeMessage ? formatMobileError(noticeMessage) : '');
    }
  }

  function scheduleLive2DRetry(message: string) {
    setNotice(message);
    if (bundleRetryCountRef.current >= 2) {
      setBundleProgress('');
      return;
    }
    bundleRetryCountRef.current += 1;
    if (bundleRetryTimerRef.current !== null) {
      window.clearTimeout(bundleRetryTimerRef.current);
    }
    setBundleProgress(copy('app.status.live2dReconnecting', { count: bundleRetryCountRef.current }));
    bundleRetryTimerRef.current = window.setTimeout(() => {
      setBundle(null);
      setBundleRequestVersion((value) => value + 1);
    }, 900);
  }

  function handleLive2DLoaded() {
    bundleRetryCountRef.current = 0;
    setBundleProgress('');
  }

  async function sendMessage(messageText = input) {
    const clean = messageText.trim();
    const activeMedia = pendingMedia;
    if ((!clean && !activeMedia) || sendingRef.current) return;
    void requestAudioUnlock();
    const previousMessages = messagesRef.current;
    const userMessageText = clean || copy('app.chat.mediaOnlyMessage');
    const mediaAttachments = activeMedia ? [activeMedia.attachment] : [];
    const optimisticMessages = [...previousMessages, createMessage('user', userMessageText, { attachments: mediaAttachments })];
    messagesRef.current = optimisticMessages;
    setChatHistory((current) => ({ ...current, messages: optimisticMessages }));
    if (messageText === input) setInput('');
    sendingRef.current = true;
    setSending(true);
    setNotice('');

    let visionImage: VisionImage | null = activeMedia?.visionImage || null;
    const visionVideo = activeMedia?.visionVideo;
    if (!visionImage && cameraModeRef.current !== 'off') {
      visionImage = captureVisionFrame();
      if (!visionImage) setNotice(copy('app.status.cameraPreparing'));
    }

    try {
      const result = await connection.rpc<{
        content: string;
        emotion?: string;
        history?: CompanionChatHistory;
      }>('chat.send', {
        text: clean || userMessageText,
        language,
        visionImage,
        visionVideo,
        attachments: mediaAttachments,
      });
      if (result.history) {
        const nextHistory = normalizeHistory(result.history, language);
        messagesRef.current = nextHistory.messages;
        setChatHistory(nextHistory);
      } else {
        const nextMessages = [...messagesRef.current, createMessage('assistant', cleanMobileLive2DText(result.content) || result.content)];
        messagesRef.current = nextMessages;
        setChatHistory((current) => ({ ...current, messages: nextMessages }));
      }
      if (activeMedia) setPendingMedia((current) => current?.id === activeMedia.id ? null : current);
      const resultEmotion = normalizeMobileEmotion(result.emotion) || detectMobileEmotionFromText(result.content);
      if (resultEmotion) applyMobileEmotion(resultEmotion);
    } catch (error) {
      messagesRef.current = previousMessages;
      setChatHistory((current) => ({ ...current, messages: previousMessages }));
      setNotice(formatMobileError(error));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function handleLive2DTouch(payload: Live2DTouchPayload) {
    if (touchReactionInFlightRef.current) return;
    touchReactionInFlightRef.current = true;
    try {
      const result = await connection.rpc<Live2DTouchReaction>('live2d.touch', payload);
      if (result.emotion) applyMobileEmotion(result.emotion);
      const content = result.text?.trim();
      if (content) {
        const nextMessages = [...messagesRef.current, createMessage('assistant', content)];
        messagesRef.current = nextMessages;
        setChatHistory((current) => ({ ...current, messages: nextMessages }));
      }
      setNotice('');
    } catch (error) {
      setNotice(formatMobileError(error));
    } finally {
      touchReactionInFlightRef.current = false;
    }
  }

  async function startCamera(mode: Exclude<CameraMode, 'off'>) {
    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice(copy('app.error.cameraUnsupported'));
      return;
    }
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setCameraMode(mode);
      setNotice('');
    } catch (error) {
      stopCamera();
      setNotice(error instanceof Error ? formatMobileError(error) : copy('app.error.cameraDenied'));
    }
  }

  function stopCamera() {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraMode('off');
  }

  async function handleBackgroundImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    let dataUrl = '';
    try {
      dataUrl = await prepareBackgroundImage(file);
    } catch {
      setNotice(copy('app.error.backgroundRead'));
      return;
    }
    const nextBackground: MobileBackground = { mode: 'image', dataUrl, name: file.name };
    try {
      saveBackground(nextBackground);
    } catch {
      setNotice(copy('app.error.backgroundSave'));
      return;
    }
    setBackground(nextBackground);
  }

  function clearBackground() {
    const nextBackground: MobileBackground = { mode: 'none' };
    saveBackground(nextBackground);
    setBackground(nextBackground);
  }

  function handleLogout() {
    setSettingsOpen(false);
    setHistoryOpen(false);
    disableMicrophone();
    stopCamera();
    stopMobileTtsPlayback();
    if (bundleRetryTimerRef.current !== null) {
      window.clearTimeout(bundleRetryTimerRef.current);
      bundleRetryTimerRef.current = null;
    }
    bundleRetryCountRef.current = 0;
    const emptyHistory = normalizeHistory({}, language);
    messagesRef.current = emptyHistory.messages;
    sendingRef.current = false;
    setBundle(null);
    setBundleProgress('');
    setChatHistory(emptyHistory);
    setInput('');
    setPendingMedia(null);
    setSending(false);
    setListening(false);
    setSpeaking(false);
    setAudioLevel(0);
    setNotice('');
    connection.logout();
  }

  async function handleMediaInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    try {
      const media = await prepareMobileMedia(file);
      setPendingMedia(media);
      setNotice('');
    } catch (error) {
      setNotice(error instanceof Error ? formatMobileError(error) : copy('app.error.mediaRead'));
    }
  }

  function clearPendingMedia() {
    setPendingMedia(null);
  }

  function handleCameraPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (cameraMode === 'off') return;
    const rect = event.currentTarget.getBoundingClientRect();
    cameraDragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCameraPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = cameraDragRef.current;
    const node = cameraFloatRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !node) return;
    const margin = 8;
    const maxX = Math.max(margin, window.innerWidth - node.offsetWidth - margin);
    const maxY = Math.max(margin, window.innerHeight - node.offsetHeight - margin);
    setCameraPosition({
      x: Math.max(margin, Math.min(maxX, event.clientX - drag.offsetX)),
      y: Math.max(margin, Math.min(maxY, event.clientY - drag.offsetY)),
    });
  }

  function handleCameraPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (cameraDragRef.current?.pointerId !== event.pointerId) return;
    cameraDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function captureVisionFrame(): VisionImage | null {
    const video = videoRef.current;
    const activeCameraMode = cameraModeRef.current;
    if (!video || activeCameraMode === 'off' || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) return null;
    const scale = Math.min(1, 960 / sourceWidth);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0, width, height);
    return {
      mimeType: 'image/png',
      data: canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''),
      width,
      height,
      capturedAt: Date.now(),
      captureMode: 'webcam',
      sourceId: `mobile-camera-${activeCameraMode}`,
      sourceName: activeCameraMode === 'user' ? copy('app.status.cameraUserActive') : copy('app.status.cameraEnvironmentActive'),
    };
  }

  function cleanupVoiceDetection() {
    if (silenceFrameRef.current !== null) {
      window.cancelAnimationFrame(silenceFrameRef.current);
      silenceFrameRef.current = null;
    }
    if (voiceCycleTimerRef.current !== null) {
      window.clearTimeout(voiceCycleTimerRef.current);
      voiceCycleTimerRef.current = null;
    }
    pcmProcessorRef.current?.disconnect();
    pcmProcessorRef.current = null;
    pcmSilentGainRef.current?.disconnect();
    pcmSilentGainRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    resetMobileVadState(mobileVadRef.current, 0);
  }

  function startSilenceDetection(stream: MediaStream) {
    const AudioContextClass = getBrowserAudioContextClass();
    voiceCycleTimerRef.current = window.setTimeout(() => {
      stopRecording(!mobileVadRef.current.speechDetected);
    }, MOBILE_MIC_MAX_RECORDING_MS);
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const silentGain = context.createGain();
    silentGain.gain.value = 0;
    source.connect(analyser);
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(context.destination);
    processor.onaudioprocess = (event) => {
      const channelCount = Math.max(1, event.inputBuffer.numberOfChannels);
      const chunk = new Float32Array(event.inputBuffer.length);
      for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
        const channel = event.inputBuffer.getChannelData(channelIndex);
        for (let sampleIndex = 0; sampleIndex < chunk.length; sampleIndex += 1) {
          chunk[sampleIndex] += (channel[sampleIndex] || 0) / channelCount;
        }
      }
      pcmChunksRef.current.push(chunk);
    };
    const samples = new Uint8Array(analyser.fftSize);
    audioContextRef.current = context;
    pcmProcessorRef.current = processor;
    pcmSilentGainRef.current = silentGain;
    pcmSampleRateRef.current = context.sampleRate;
    void context.resume().catch(() => undefined);
    resetMobileVadState(mobileVadRef.current, performance.now());

    const analyze = () => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state !== 'recording') return;
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        energy += normalized * normalized;
      }
      const level = Math.sqrt(energy / samples.length);
      const now = performance.now();
      const decision = updateMobileVad(mobileVadRef.current, level, now, lastTtsPlaybackEndedAtRef.current);
      if (decision.shouldStop) {
        stopRecording(decision.discard);
        return;
      }
      silenceFrameRef.current = window.requestAnimationFrame(analyze);
    };
    silenceFrameRef.current = window.requestAnimationFrame(analyze);
  }

  function pauseMicrophoneForMobileTts() {
    if (!micEnabledRef.current) return;
    suspendMicForTtsRef.current = true;
    restartMicAfterTtsRef.current = true;
    pendingMicRestartRef.current = false;
    if (recorderRef.current?.state === 'recording') stopRecording(true);
  }

  function resumeMicrophoneAfterMobileTts() {
    suspendMicForTtsRef.current = false;
    if (!restartMicAfterTtsRef.current) return;
    restartMicAfterTtsRef.current = false;
    if (micEnabledRef.current) {
      window.setTimeout(() => void startRecordingCycle(), MOBILE_MIC_TTS_COOLDOWN_MS);
    }
  }

  async function enableMicrophone() {
    void requestAudioUnlock();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setNotice(copy('app.error.microphoneUnsupported'));
      return;
    }
    micEnabledRef.current = true;
    setMicEnabled(true);
    setNotice('');
    pendingMicRestartRef.current = false;
    await startRecordingCycle();
  }

  async function startRecordingCycle() {
    if (!micEnabledRef.current || recorderRef.current?.state === 'recording') return;
    if (mobileTtsActiveRef.current || suspendMicForTtsRef.current) {
      restartMicAfterTtsRef.current = true;
      return;
    }
    if (transcribingRef.current) {
      pendingMicRestartRef.current = true;
      return;
    }
    pendingMicRestartRef.current = false;
    try {
      let stream = recorderStreamRef.current;
      if (!stream?.active || !stream.getAudioTracks().some((track) => track.readyState === 'live')) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: { ideal: true },
            noiseSuppression: { ideal: true },
            autoGainControl: { ideal: true },
            channelCount: { ideal: 1 },
          },
        });
        if (!micEnabledRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.getAudioTracks().forEach((track) => {
          track.addEventListener('ended', () => {
            if (!micEnabledRef.current) return;
            recorderStreamRef.current = null;
            if (!recorderRef.current || recorderRef.current.state === 'inactive') {
              window.setTimeout(() => void startRecordingCycle(), 300);
            }
          }, { once: true });
        });
        recorderStreamRef.current = stream;
      }
      const mimeType = chooseAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recorderChunksRef.current = [];
      pcmChunksRef.current = [];
      pcmSampleRateRef.current = 0;
      discardRecordingRef.current = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size) recorderChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        if (!micEnabledRef.current) return;
        pendingMicRestartRef.current = true;
        stopRecording(true);
      };
      recorder.onstop = () => {
        const discard = discardRecordingRef.current;
        const blob = new Blob(recorderChunksRef.current, {
          type: recorder.mimeType || mimeType || 'audio/webm',
        });
        const pcmChunks = pcmChunksRef.current;
        const pcmLength = pcmChunks.reduce((total, chunk) => total + chunk.length, 0);
        const pcmSamples = new Float32Array(pcmLength);
        let pcmOffset = 0;
        for (const chunk of pcmChunks) {
          pcmSamples.set(chunk, pcmOffset);
          pcmOffset += chunk.length;
        }
        const pcmSampleRate = pcmSampleRateRef.current;
        recorderChunksRef.current = [];
        pcmChunksRef.current = [];
        pcmSampleRateRef.current = 0;
        recorderRef.current = null;
        cleanupVoiceDetection();
        setRecording(false);
        void handleRecordingStopped(blob, discard, pcmSamples, pcmSampleRate);
      };
      recorder.start(250);
      setRecording(true);
      startSilenceDetection(stream);
    } catch (error) {
      micEnabledRef.current = false;
      setMicEnabled(false);
      recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
      recorderStreamRef.current = null;
      setNotice(error instanceof Error ? formatMobileError(error) : copy('app.error.microphoneDenied'));
    }
  }

  function stopRecording(discard = false) {
    const recorder = recorderRef.current;
    discardRecordingRef.current = discard;
    if (recorder?.state === 'recording') recorder.stop();
    setRecording(false);
  }

  function disableMicrophone() {
    micEnabledRef.current = false;
    pendingMicRestartRef.current = false;
    suspendMicForTtsRef.current = false;
    restartMicAfterTtsRef.current = false;
    setMicEnabled(false);
    stopRecording(true);
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    recorderStreamRef.current = null;
    cleanupVoiceDetection();
    setNotice('');
  }

  async function handleRecordingStopped(
    blob: Blob,
    discard: boolean,
    pcmSamples: Float32Array,
    pcmSampleRate: number,
  ) {
    const usefulSpeech = hasUsefulMobileSpeech(pcmSamples, pcmSampleRate);
    if (!discard && usefulSpeech && (pcmSamples.length || blob.size)) {
      await transcribeRecording(blob, pcmSamples, pcmSampleRate);
    }
    if (micEnabledRef.current && !suspendMicForTtsRef.current && !mobileTtsActiveRef.current) {
      window.setTimeout(() => void startRecordingCycle(), 180);
    }
  }

  async function transcribeRecording(blob: Blob, pcmSamples: Float32Array, pcmSampleRate: number) {
    transcribingRef.current = true;
    setTranscribing(true);
    setNotice('');
    try {
      const wavBlob = pcmSamples.length && pcmSampleRate
        ? encodePcmWav(pcmSamples, pcmSampleRate)
        : await convertAudioBlobToWav(blob);
      const result = await connection.rpc<{ text: string }>('voice.transcribe', {
        mimeType: 'audio/wav',
        data: await blobToBase64(wavBlob),
      });
      const transcript = result.text?.trim();
      if (!transcript) {
        setNotice(copy('app.error.sttEmpty'));
        return;
      }
      setNotice('');
      await sendMessage(transcript);
    } catch (error) {
      setNotice(formatMobileError(error));
    } finally {
      transcribingRef.current = false;
      setTranscribing(false);
      if (micEnabledRef.current && pendingMicRestartRef.current) {
        pendingMicRestartRef.current = false;
        window.setTimeout(() => void startRecordingCycle(), 120);
      }
    }
  }

  if (phase !== 'connected') {
    return (
      <ConnectionGate
        phase={phase}
        detail={phaseDetail}
        defaultRelayUrl={relayUrl}
        defaultPairingCode={pairingCode}
        language={language}
        onLanguageChange={setLanguage}
        onConnect={(url, code) => {
          void requestAudioUnlock();
          connection.connect(url, code);
        }}
      />
    );
  }

  const visibleMessages = chatHistory.messages.slice(-2);
  const companionStyle = background.mode === 'image'
    ? ({ '--mobile-background-image': `url("${background.dataUrl}")` } as CSSProperties)
    : undefined;
  return (
    <main className={`companion-screen ${background.mode === 'image' ? 'has-mobile-background' : ''}`} style={companionStyle}>
      <Live2DStage
        bundle={bundle}
        language={language}
        emotion={emotion}
        emotionTrigger={emotionTrigger}
        companionState={companionLive2DState}
        speaking={speaking}
        listening={listening || recording || transcribing}
        audioLevel={audioLevel}
        onLoaded={handleLive2DLoaded}
        onLoadError={scheduleLive2DRetry}
        onTouch={(payload) => void handleLive2DTouch(payload)}
      />

      <div
        ref={cameraFloatRef}
        className={`floating-camera ${cameraMode === 'off' ? 'is-hidden' : ''}`}
        style={{ left: cameraPosition.x, top: cameraPosition.y }}
        onPointerDown={handleCameraPointerDown}
        onPointerMove={handleCameraPointerMove}
        onPointerUp={handleCameraPointerEnd}
        onPointerCancel={handleCameraPointerEnd}
        aria-hidden={cameraMode === 'off'}
      >
        <video ref={videoRef} className="floating-camera__video" playsInline muted />
        <span className="floating-camera__label">
          <i />
          {cameraMode === 'user' ? copy('app.camera.user') : copy('app.camera.environment')}
        </span>
      </div>

      <button
        className={`settings-trigger ${settingsOpen ? 'is-open' : ''}`}
        type="button"
        onClick={() => setSettingsOpen((value) => !value)}
        aria-label={copy('app.settings.aria')}
        aria-expanded={settingsOpen}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
          <path d="m19.2 13.6 1.3 1-.2 1.5-1.6.6a7.7 7.7 0 0 1-1 1.7l.2 1.7-1.3.9-1.4-1a8 8 0 0 1-2 .6l-.6 1.6h-1.5l-.6-1.6a8 8 0 0 1-2-.6l-1.4 1-1.3-.9.2-1.7a7.7 7.7 0 0 1-1-1.7l-1.6-.6-.2-1.5 1.3-1a8 8 0 0 1 0-2l-1.3-1 .2-1.5L5 7.5a7.7 7.7 0 0 1 1-1.7L5.8 4l1.3-.9 1.4 1a8 8 0 0 1 2-.6l.6-1.6h1.5l.6 1.6a8 8 0 0 1 2 .6l1.4-1 1.3.9-.2 1.7a7.7 7.7 0 0 1 1 1.7l1.6.6.2 1.5-1.3 1a8 8 0 0 1 0 2Z" />
        </svg>
      </button>

      <button
        className={`audio-trigger ${audioUnlocked ? 'is-ready' : 'is-muted'} ${speaking ? 'is-playing' : ''}`}
        type="button"
        onClick={() => void requestAudioUnlock()}
        aria-label={audioUnlocked ? copy('app.audio.ready') : copy('app.audio.unlock')}
        aria-pressed={audioUnlocked}
      >
        <SoundIcon muted={!audioUnlocked} />
      </button>

      <aside className={`settings-panel ${settingsOpen ? 'is-open' : ''}`} aria-hidden={!settingsOpen}>
        <section className="settings-section">
          <div className="settings-panel__header">
            <div>
              <strong>{copy('app.settings.visionTitle')}</strong>
              <span>{cameraMode === 'off' ? copy('app.settings.visionOff') : copy('app.settings.visionOn')}</span>
            </div>
            <i className={cameraMode === 'off' ? '' : 'is-live'} />
          </div>
          <div className="camera-controls">
            <button
              className={cameraMode === 'user' ? 'is-active' : ''}
              type="button"
              onClick={() => cameraMode === 'user' ? stopCamera() : void startCamera('user')}
            >
              {copy('app.camera.user')}
            </button>
            <button
              className={cameraMode === 'environment' ? 'is-active' : ''}
              type="button"
              onClick={() => cameraMode === 'environment' ? stopCamera() : void startCamera('environment')}
            >
              {copy('app.camera.environment')}
            </button>
          </div>
          <p>{copy('app.settings.visionDescription')}</p>
        </section>

        <section className="settings-section">
          <div className="settings-panel__header">
            <div>
              <strong>{copy('app.settings.backgroundTitle')}</strong>
              <span>{background.mode === 'image' ? copy('app.settings.backgroundOn') : copy('app.settings.backgroundOff')}</span>
            </div>
            <i className={background.mode === 'image' ? 'is-live' : ''} />
          </div>
          <div className="background-controls">
            <button type="button" onClick={() => backgroundInputRef.current?.click()}>
              {copy('app.background.choose')}
            </button>
            <button type="button" disabled={background.mode === 'none'} onClick={clearBackground}>
              {copy('app.background.clear')}
            </button>
          </div>
          <input
            ref={backgroundInputRef}
            className="background-file-input"
            type="file"
            accept="image/*"
            onChange={(event) => void handleBackgroundImageChange(event)}
          />
          <p>{copy('app.settings.backgroundDescription')}</p>
        </section>

        <section className="settings-section settings-section--logout">
          <button type="button" className="settings-logout" onClick={handleLogout}>
            {copy('app.settings.logout')}
          </button>
        </section>

      </aside>

      {bundleProgress && (
        <div className="companion-status">
          <span className="status-orb" />
          <span>{bundleProgress}</span>
        </div>
      )}

      <section className="floating-chat" aria-label={copy('app.chat.aria')}>
        <div className="floating-messages" aria-live="polite">
          {!visibleMessages.length && !sending && (
            <p className="floating-hint">{copy('app.chat.hint')}</p>
          )}
          {visibleMessages.map((message) => (
            <ChatMessageView
              key={message.id}
              message={message}
              assistantName={chatHistory.assistantName}
              assistantAvatarUrl={chatHistory.assistantAvatarUrl}
              openHistoryLabel={copy('app.history.openMessage')}
              onOpenHistory={() => setHistoryOpen(true)}
            />
          ))}
          {sending && (
            <div className="app-thinking" aria-label={copy('app.chat.thinking')}>
              <span />
              <span />
              <span />
            </div>
          )}
        </div>

        <form className="floating-composer" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
          {pendingMedia && (
            <div className="media-preview-strip">
              <div className="media-preview-card">
                {pendingMedia.kind === 'image' ? (
                  <img src={pendingMedia.previewUrl} alt="" />
                ) : (
                  <video src={pendingMedia.previewUrl} muted playsInline preload="metadata" />
                )}
                <span>{pendingMedia.name}</span>
                <button type="button" onClick={clearPendingMedia} aria-label={copy('app.chat.removeMedia')}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m7 7 10 10M17 7 7 17" />
                  </svg>
                </button>
              </div>
            </div>
          )}
          <div className="composer-field">
            <input
              value={input}
              onChange={(event) => setInput(event.currentTarget.value)}
              placeholder={transcribing ? copy('app.chat.transcribing') : copy('app.chat.placeholder')}
              aria-label={copy('app.chat.input')}
            />
            <input
              ref={mediaInputRef}
              className="media-file-input"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,video/webm,video/mp4,video/mpeg,video/quicktime,video/mov,image/*,video/*"
              onChange={(event) => void handleMediaInputChange(event)}
            />
            <button
              className="attach-media-button"
              type="button"
              onClick={() => mediaInputRef.current?.click()}
              aria-label={copy('app.chat.attachMedia')}
              disabled={sending}
            >
              <MediaIcon />
            </button>
            <button className="send-paw-button" type="submit" disabled={(!input.trim() && !pendingMedia) || sending} aria-label={copy('app.chat.send')}>
              <PawIcon />
            </button>
          </div>
          <button
            className={`control-mic-button ${micEnabled ? 'is-active' : 'is-muted'} ${recording ? 'is-listening' : ''} ${transcribing ? 'is-processing' : ''}`}
            type="button"
            onClick={() => micEnabled ? disableMicrophone() : void enableMicrophone()}
            aria-label={micEnabled ? copy('app.chat.micDisable') : copy('app.chat.micEnable')}
            aria-pressed={micEnabled}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="8.5" y="3" width="7" height="12" rx="3.5" />
              <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" />
            </svg>
          </button>
        </form>
      </section>

      {historyOpen && (
        <section className="history-overlay" aria-label={copy('app.history.aria')}>
          <header className="history-header">
            <div>
              <span>{copy('app.history.title')}</span>
              <strong>{chatHistory.title || copy('app.chat.emptyTitle')}</strong>
            </div>
            <button type="button" onClick={() => setHistoryOpen(false)} aria-label={copy('app.history.close')}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </header>
          <div ref={historyScrollRef} className="history-messages">
            {chatHistory.messages.map((message) => (
              <ChatMessageView
                key={message.id}
                message={message}
                assistantName={chatHistory.assistantName}
                assistantAvatarUrl={chatHistory.assistantAvatarUrl}
                openHistoryLabel={copy('app.history.openMessage')}
              />
            ))}
          </div>
        </section>
      )}

      {voiceUnlockVisible && (
        <button className="voice-unlock-overlay" type="button" onClick={() => void requestAudioUnlock()}>
          <SoundIcon muted />
          <span>{copy('app.audio.unlock')}</span>
        </button>
      )}

      {notice && (
        <button className="notice" type="button" onClick={() => setNotice('')}>
          {notice}
        </button>
      )}
    </main>
  );
}
