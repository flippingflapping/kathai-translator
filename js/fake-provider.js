// A stand-in provider with canned answers and a short beep, so the UI can be
// tried and tested without an API key. Open the app with ?demo to use it.

import { pcmToWav } from './wav.js';

const SAMPLES = {
  en: { heard: 'Hello, how are you?', translation: 'வணக்கம், எப்பிடி இருக்கிறியள்?', romanized: 'vanakkam, eppidi irukkiriyal?' },
  'ta-jaffna': { heard: 'ஓம், நான் நல்லா இருக்கிறன்.', translation: "Yes, I'm doing well.", romanized: 'om, naan nalla irukkiran.' },
};

function beep(ms = 400, hz = 660, rate = 24000) {
  const n = Math.floor((rate * ms) / 1000);
  const pcm = new Uint8Array(n * 2);
  const v = new DataView(pcm.buffer);
  for (let i = 0; i < n; i++) v.setInt16(i * 2, Math.sin((2 * Math.PI * hz * i) / rate) * 8000, true);
  return pcmToWav(pcm, rate);
}

export function createFakeProvider({ delayMs = 300 } = {}) {
  const wait = () => new Promise((r) => setTimeout(r, delayMs));
  return {
    async translateSpeech({ from }) {
      await wait();
      return { ...SAMPLES[from] };
    },
    async synthesize() {
      await wait();
      return beep();
    },
  };
}
