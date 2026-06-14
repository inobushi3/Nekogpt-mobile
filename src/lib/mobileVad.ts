export const MOBILE_MIC_SPEECH_LEVEL = 0.034;
export const MOBILE_MIC_SPEECH_CONFIRM_MS = 240;
export const MOBILE_MIC_SILENCE_AFTER_SPEECH_MS = 2600;
export const MOBILE_MIC_MIN_UTTERANCE_MS = 800;
export const MOBILE_MIC_MIN_ACTIVE_SPEECH_MS = 360;
export const MOBILE_MIC_TTS_COOLDOWN_MS = 650;
export const MOBILE_MIC_MAX_RECORDING_MS = 45_000;

export type MobileVadState = {
  speechDetected: boolean;
  silenceStartedAt: number | null;
  speechCandidateStartedAt: number | null;
  noiseFloor: number;
  recordingStartedAt: number;
};

export type MobileVadDecision = {
  shouldStop: boolean;
  discard: boolean;
  speechLevel: number;
};

export function createMobileVadState(startedAt = 0): MobileVadState {
  return {
    speechDetected: false,
    silenceStartedAt: null,
    speechCandidateStartedAt: null,
    noiseFloor: 0.012,
    recordingStartedAt: startedAt,
  };
}

export function resetMobileVadState(state: MobileVadState, startedAt: number) {
  state.speechDetected = false;
  state.silenceStartedAt = null;
  state.speechCandidateStartedAt = null;
  state.noiseFloor = 0.012;
  state.recordingStartedAt = startedAt;
}

export function getMobileSpeechLevel(state: MobileVadState) {
  return Math.max(
    MOBILE_MIC_SPEECH_LEVEL,
    Math.min(0.052, state.noiseFloor * 2.2 + 0.012),
  );
}

export function updateMobileVad(
  state: MobileVadState,
  level: number,
  now: number,
  lastTtsPlaybackEndedAt = 0,
): MobileVadDecision {
  const inTtsCooldown = now - lastTtsPlaybackEndedAt < MOBILE_MIC_TTS_COOLDOWN_MS;
  if (!state.speechDetected && state.speechCandidateStartedAt === null && !inTtsCooldown && level < 0.055) {
    state.noiseFloor = state.noiseFloor * 0.96 + level * 0.04;
  }

  const speechLevel = getMobileSpeechLevel(state);
  if (!inTtsCooldown && level >= speechLevel) {
    if (state.speechCandidateStartedAt === null) state.speechCandidateStartedAt = now;
    if (now - state.speechCandidateStartedAt >= MOBILE_MIC_SPEECH_CONFIRM_MS) {
      state.speechDetected = true;
      state.silenceStartedAt = null;
    }
  } else if (state.speechDetected) {
    state.speechCandidateStartedAt = null;
    if (state.silenceStartedAt === null) state.silenceStartedAt = now;
    if (now - state.silenceStartedAt >= MOBILE_MIC_SILENCE_AFTER_SPEECH_MS) {
      return { shouldStop: true, discard: false, speechLevel };
    }
  } else {
    state.speechCandidateStartedAt = null;
  }

  if (now - state.recordingStartedAt >= MOBILE_MIC_MAX_RECORDING_MS) {
    return { shouldStop: true, discard: !state.speechDetected, speechLevel };
  }

  return { shouldStop: false, discard: false, speechLevel };
}

export function hasUsefulMobileSpeech(samples: Float32Array, sampleRate: number) {
  if (!samples.length || !sampleRate) return true;
  const durationMs = (samples.length / sampleRate) * 1000;
  if (durationMs < MOBILE_MIC_MIN_UTTERANCE_MS) return false;

  const windowSize = Math.max(256, Math.floor(sampleRate * 0.08));
  const step = Math.max(128, Math.floor(windowSize / 2));
  const stepDurationMs = (step / sampleRate) * 1000;
  let peak = 0;
  let bestWindowRms = 0;
  let activeWindows = 0;

  for (let offset = 0; offset < samples.length; offset += step) {
    const end = Math.min(samples.length, offset + windowSize);
    let sum = 0;
    let localPeak = 0;
    for (let index = offset; index < end; index += 1) {
      const sample = Math.abs(samples[index] || 0);
      localPeak = Math.max(localPeak, sample);
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / Math.max(1, end - offset));
    peak = Math.max(peak, localPeak);
    bestWindowRms = Math.max(bestWindowRms, rms);
    if (rms >= 0.01 || localPeak >= 0.06) activeWindows += 1;
  }

  const activeSpeechMs = activeWindows * stepDurationMs;
  return peak >= 0.045
    && bestWindowRms >= 0.01
    && activeSpeechMs >= MOBILE_MIC_MIN_ACTIVE_SPEECH_MS;
}
