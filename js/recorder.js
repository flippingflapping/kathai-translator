// Microphone capture with MediaRecorder, plus a simple loudness check that
// can stop recording by itself once the speaker goes quiet.

import { audioContext } from './audio.js';

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
}

let stream = null;

async function getStream() {
  if (stream && stream.getAudioTracks().some((t) => t.readyState === 'live')) return stream;
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser cannot use the microphone here. Open the app over https (or localhost).');
  }
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  return stream;
}

// Free the mic (and the "recording" indicator) when the app is in the background.
export function releaseMic() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

// Starts recording. Returns { stop(), done } where done resolves to
// { audio: Uint8Array, mimeType, ms } once recording ends.
// onLevel(0..1) is called with the live loudness for the meter.
export async function record({ autoStop = true, silenceMs = 1500, maxMs = 30000, onLevel = () => {} } = {}) {
  const s = await getStream();
  const mimeType = pickMime();
  const rec = new MediaRecorder(s, mimeType ? { mimeType } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const ctx = audioContext();
  const source = ctx.createMediaStreamSource(s);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  const started = performance.now();
  let heardSpeech = false;
  let lastLoud = started;
  let raf = 0;
  let noise = 0.01;

  const stopNow = () => {
    if (rec.state !== 'inactive') rec.stop();
  };

  const tick = () => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const x of samples) sum += x * x;
    const rms = Math.sqrt(sum / samples.length);
    const now = performance.now();
    // Learn the room's background level in the first moments.
    if (now - started < 300) noise = Math.max(noise, rms);
    const loud = rms > Math.max(0.02, noise * 2.5);
    if (loud) {
      heardSpeech = true;
      lastLoud = now;
    }
    onLevel(Math.min(1, rms * 6));
    if (now - started > maxMs) return stopNow();
    if (autoStop && heardSpeech && now - lastLoud > silenceMs) return stopNow();
    raf = requestAnimationFrame(tick);
  };

  const done = new Promise((resolve, reject) => {
    rec.onerror = (e) => reject(e.error || new Error('Recording failed.'));
    rec.onstop = async () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      onLevel(0);
      const blob = new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' });
      resolve({
        audio: new Uint8Array(await blob.arrayBuffer()),
        mimeType: blob.type,
        ms: performance.now() - started,
      });
    };
  });

  rec.start(250);
  raf = requestAnimationFrame(tick);
  return { stop: stopNow, done };
}
