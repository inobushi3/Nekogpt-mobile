import assert from 'node:assert/strict';
import {
  createMobileVadState,
  hasUsefulMobileSpeech,
  MOBILE_MIC_MAX_RECORDING_MS,
  MOBILE_MIC_SILENCE_AFTER_SPEECH_MS,
  updateMobileVad,
} from '../src/lib/mobileVad.ts';

const SAMPLE_RATE = 16_000;
const FRAME_MS = 20;

function runTimeline(segments) {
  const state = createMobileVadState(0);
  let now = 0;
  let stopAt = null;
  let discard = null;
  for (const segment of segments) {
    for (let elapsed = 0; elapsed < segment.ms; elapsed += FRAME_MS) {
      const decision = updateMobileVad(state, segment.level, now, 0);
      if (decision.shouldStop) {
        stopAt = now;
        discard = decision.discard;
        return { stopAt, discard, state };
      }
      now += FRAME_MS;
    }
  }
  return { stopAt, discard, state };
}

function makeSamples(segments) {
  const total = segments.reduce((sum, segment) => sum + Math.round((segment.ms / 1000) * SAMPLE_RATE), 0);
  const samples = new Float32Array(total);
  let offset = 0;
  for (const segment of segments) {
    const count = Math.round((segment.ms / 1000) * SAMPLE_RATE);
    for (let index = 0; index < count; index += 1) {
      samples[offset + index] = Math.sin(index / 4) * segment.level;
    }
    offset += count;
  }
  return samples;
}

{
  const result = runTimeline([
    { ms: 900, level: 0.08 },
    { ms: 1500, level: 0.006 },
    { ms: 900, level: 0.075 },
    { ms: 2600 + MOBILE_MIC_SILENCE_AFTER_SPEECH_MS, level: 0.006 },
  ]);
  assert.equal(result.discard, false);
  assert.ok(result.stopAt !== null, 'phrase should eventually stop after final silence');
  assert.ok(result.stopAt > 900 + 1500 + 900, 'short pause inside phrase must not send early');
}

{
  const result = runTimeline([
    { ms: MOBILE_MIC_MAX_RECORDING_MS + 1000, level: 0.014 },
  ]);
  assert.equal(result.discard, true);
  assert.ok(result.stopAt !== null && result.stopAt >= MOBILE_MIC_MAX_RECORDING_MS, 'noise should discard only at max recording timeout');
}

{
  const shortTap = makeSamples([
    { ms: 220, level: 0.09 },
    { ms: 2500, level: 0.004 },
  ]);
  assert.equal(hasUsefulMobileSpeech(shortTap, SAMPLE_RATE), false, 'short tap/noise must not be useful speech');
}

{
  const phrase = makeSamples([
    { ms: 900, level: 0.08 },
    { ms: 400, level: 0.006 },
    { ms: 900, level: 0.075 },
  ]);
  assert.equal(hasUsefulMobileSpeech(phrase, SAMPLE_RATE), true, 'normal phrase should be useful speech');
}

console.log('mobile VAD tests passed');
