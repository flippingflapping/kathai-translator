// A stand-in provider with canned answers and a short beep, so the UI can be
// tried and tested without an API key. Open the app with ?demo to use it.
// It streams like the real one: the translation is announced early and the
// beep arrives in pieces.

import { pcmToWav } from './wav.js';

const SAMPLES = {
  en: { heard: 'Hello, how are you?', translation: 'வணக்கம், எப்பிடி இருக்கிறியள்?', romanized: 'vanakkam, eppidi irukkiriyal?' },
  'ta-jaffna': { heard: 'ஓம், நான் நல்லா இருக்கிறன்.', translation: "Yes, I'm doing well.", romanized: 'om, naan nalla irukkiran.' },
};

function beepPcm(ms = 600, hz = 660, rate = 24000) {
  const n = Math.floor((rate * ms) / 1000);
  const pcm = new Uint8Array(n * 2);
  const v = new DataView(pcm.buffer);
  for (let i = 0; i < n; i++) v.setInt16(i * 2, Math.sin((2 * Math.PI * hz * i) / rate) * 8000, true);
  return pcm;
}

export function createFakeProvider({ delayMs = 300 } = {}) {
  const wait = (ms = delayMs) => new Promise((r) => setTimeout(r, ms));
  return {
    warmUp() {},
    async translateSpeech({ from, onTranslation }) {
      await wait();
      onTranslation?.(SAMPLES[from].translation);
      await wait(150);
      return { ...SAMPLES[from] };
    },
    async synthesize({ onChunk }) {
      await wait();
      const pcm = beepPcm();
      if (onChunk) {
        const piece = 4800; // 0.1 s
        for (let o = 0; o < pcm.length; o += piece) {
          onChunk(pcm.subarray(o, o + piece));
          await wait(40);
        }
      }
      return pcmToWav(pcm);
    },
  };
}
