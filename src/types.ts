export type ConnectionPhase = 'disconnected' | 'connecting' | 'connected' | 'error';

export type MobileChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  subtitle?: string;
  emotion?: string;
  attachments?: MobileChatAttachment[];
};

export type MobileChatAttachment = {
  id: string;
  name: string;
  mimeType: string;
  data: string;
  text?: string;
};

export type CompanionChatHistory = {
  sessionId: string;
  title: string;
  assistantName: string;
  assistantAvatarUrl: string;
  messages: MobileChatMessage[];
};

export type CompanionPersonaSummary = {
  id: string;
  name: string;
  active: boolean;
};

export type CompanionPersonaList = {
  activePersonaId: string;
  personas: CompanionPersonaSummary[];
  history?: CompanionChatHistory;
};

export type CompanionSnapshot = {
  appName: string;
  version: string;
  modelId: string;
  modelName: string;
  modelFile: string;
  provider: string;
  ttsEnabled: boolean;
  visionEnabled: boolean;
};

export type CompanionTtsAudio = {
  mimeType: string;
  data: string;
  text?: string;
  subtitle?: string;
  emotion?: string;
  durationMs?: number;
};

export type VisionImage = {
  mimeType: 'image/png';
  data: string;
  width: number;
  height: number;
  capturedAt: number;
  captureMode: 'webcam';
  sourceId: string;
  sourceName: string;
};

export type VisionVideo = {
  mimeType: 'video/webm' | 'video/mp4' | 'video/mpeg' | 'video/quicktime' | 'video/mov';
  data: string;
  durationMs?: number;
  capturedAt: number;
  captureMode: 'webcam';
  sourceId: string;
  sourceName: string;
};

export type RpcResponse = {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type RelayMessage = {
  type: string;
  id?: string;
  method?: string;
  params?: unknown;
  payload?: unknown;
  [key: string]: unknown;
};

export type Live2DBundleMetadata = {
  transferId: string;
  totalChunks: number;
  byteLength: number;
  modelFile: string;
  modelId: string;
  modelName: string;
};

export type Live2DBundle = Live2DBundleMetadata & {
  bytes: Uint8Array;
};

export type Live2DTouchPayload = {
  area: string;
  hitAreas: string[];
  normalizedX: number;
  normalizedY: number;
  interaction: 'touch' | 'head-pat';
};

export type Live2DTouchReaction = {
  text?: string;
  emotion?: string;
  targetLocale?: string;
  speak?: boolean;
};
