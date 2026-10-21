// UI wiring: two mic buttons, a conversation log and a settings sheet.
// The translator is any object with translateSpeech() and synthesize();
// Gemini is the real one, ?demo swaps in the fake.

import { LANGUAGES, VOICES, otherSide } from './languages.js';
import { createGeminiProvider, DEFAULT_MODELS } from './gemini.js';
import { createFakeProvider } from './fake-provider.js';
import { record, releaseMic } from './recorder.js';
import * as speaker from './audio.js';

const STORE_KEY = 'kathai.settings.v1';
const DEMO = new URLSearchParams(location.search).has('demo');

const DEFAULTS = {
  apiKey: '',
  voice_en: LANGUAGES.en.defaultVoice,
  'voice_ta-jaffna': LANGUAGES['ta-jaffna'].defaultVoice,
  autoStop: true,
  pauseMs: '900',
  autoPlay: true,
  showRomanized: true,
  translateModel: DEFAULT_MODELS.translate,
  ttsModel: DEFAULT_MODELS.tts,
};

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* private mode: keep in memory */ }
}

let settings = loadSettings();
let provider = makeProvider();

function makeProvider() {
  if (DEMO) return createFakeProvider();
  return createGeminiProvider({
    getKey: () => settings.apiKey.trim(),
    models: { translate: settings.translateModel || DEFAULT_MODELS.translate, tts: settings.ttsModel || DEFAULT_MODELS.tts },
  });
}

// ---- DOM ----
const $ = (sel, root = document) => root.querySelector(sel);
const log = $('#log');
const empty = $('#empty');
const statusEl = $('#status');
const statusText = $('#statusText');
const meterFill = $('#meterFill');
const mics = [...document.querySelectorAll('.mic')];
const dialog = $('#settings');
const form = $('#settingsForm');
const tpl = $('#bubbleTpl');

function setStatus(text, mode = 'idle') {
  statusText.textContent = text;
  statusEl.dataset.mode = mode;
}

function refreshKeyHint() {
  $('#keyHint').hidden = DEMO || !!settings.apiKey.trim();
  document.body.classList.toggle('hide-roman', !settings.showRomanized);
}

// ---- Conversation state ----
let recording = null; // { side, handle }

function updateMics() {
  for (const b of mics) {
    const side = b.dataset.side;
    b.classList.toggle('listening', recording?.side === side);
    b.disabled = !!recording && recording.side !== side;
    b.setAttribute('aria-pressed', String(recording?.side === side));
  }
}

function addBubble(side) {
  empty.hidden = true;
  const el = tpl.content.firstElementChild.cloneNode(true);
  el.dataset.side = side;
  el.classList.add('pending');
  $('.translation', el).textContent = '…';
  $('.meta', el).textContent = `${LANGUAGES[side].name} → ${LANGUAGES[otherSide(side)].name}`;
  log.append(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return el;
}

// Make (if needed) and play the voice for a message. New voices stream: the
// first piece plays while the rest is still being made. Replays use the saved clip.
async function speak(el, msg, timing) {
  el.classList.add('speaking');
  try {
    if (msg.wav) {
      setStatus('Speaking…', 'speaking');
      await speaker.play(msg.wav);
      return;
    }
    setStatus('Getting voice…', 'working');
    const player = speaker.createStreamPlayer();
    const wav = await provider.synthesize({
      text: msg.translation,
      lang: msg.to,
      voice: settings[`voice_${msg.to}`],
      onChunk: (pcm) => {
        if (!player.received) {
          setStatus('Speaking…', 'speaking');
          if (timing) { timing.voice = performance.now(); showTiming(el, timing); }
        }
        player.push(pcm);
      },
    }).catch((err) => { player.stop(); throw err; });
    msg.wav = wav;
    if (player.received) {
      player.end();
      await player.done;
    } else {
      // The provider answered in one piece instead of streaming.
      player.stop();
      if (timing) { timing.voice = performance.now(); showTiming(el, timing); }
      setStatus('Speaking…', 'speaking');
      await speaker.play(wav);
    }
  } finally {
    el.classList.remove('speaking');
    if (!recording && statusEl.dataset.mode !== 'listening') setStatus('Ready');
  }
}

// Seconds from the end of recording to the translation text, and to the
// first sound. (The pause-detection wait before that is not included.)
function showTiming(el, t) {
  const sec = (ms) => `${(ms / 1000).toFixed(1)}s`;
  const parts = [];
  if (t.text) parts.push(`text ${sec(t.text - t.start)}`);
  if (t.voice) parts.push(`voice ${sec(t.voice - t.start)}`);
  $('.timing', el).textContent = parts.join(' · ');
}

function showResult(el, msg) {
  const t = $('.translation', el);
  t.textContent = msg.translation;
  t.lang = LANGUAGES[msg.to].htmlLang;
  const h = $('.heard', el);
  h.textContent = msg.heard || '';
  h.lang = LANGUAGES[msg.from].htmlLang;
  $('.romanized', el).textContent = msg.romanized || '';
  $('.replay', el).hidden = false;
  el.classList.remove('pending');
  el.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

async function translate(el, msg) {
  el.classList.add('pending');
  el.classList.remove('failed', 'missed');
  $('.retry', el).hidden = true;
  $('.timing', el).textContent = '';
  setStatus('Translating…', 'working');
  const timing = { start: performance.now() };
  let speaking = null;

  // Called as soon as the translation is known, which with streaming is
  // before the transcript and pronunciation guide have finished arriving.
  const begin = (translation) => {
    if (speaking) return;
    msg.translation = translation;
    timing.text = performance.now();
    showResult(el, msg);
    showTiming(el, timing);
    if (!settings.autoPlay) return;
    speaking = speak(el, msg, timing).catch((err) => {
      console.error(err);
      setStatus(`No voice: ${err.message || 'speech failed'}. Tap Play to retry.`, 'error');
    });
  };

  let r;
  try {
    r = await provider.translateSpeech({ audio: msg.audio, mimeType: msg.mimeType, from: msg.from, to: msg.to, onTranslation: begin });
  } catch (err) {
    console.error(err);
    if (speaking) return; // the voice is already going; keep what we have
    el.classList.remove('pending');
    el.classList.add('failed');
    $('.translation', el).textContent = err.message || 'Something went wrong.';
    $('.retry', el).hidden = false;
    setStatus('Translation failed', 'error');
    return;
  }
  el.classList.remove('pending');
  if (!r.heard && !r.translation) {
    $('.translation', el).textContent = msg.from === 'en' ? "Didn't catch that. Try again?" : 'சரியாக் கேக்கேல்ல. திருப்பிச் சொல்லுங்கோ?';
    el.classList.add('missed');
    setStatus('Ready');
    return;
  }
  const early = msg.translation;
  Object.assign(msg, r);
  if (early && early !== r.translation) msg.translation = early; // keep text matching the voice
  showResult(el, msg);
  begin(msg.translation);
  if (speaking) await speaking;
  else if (statusEl.dataset.mode === 'working') setStatus('Ready');
}

async function onMic(side) {
  // Taps are the only moment mobile browsers let us unlock sound.
  speaker.unlock().catch(() => {});

  if (recording) {
    if (recording.side === side) recording.handle.stop();
    return;
  }
  if (!DEMO && !settings.apiKey.trim()) {
    openSettings();
    return;
  }

  speaker.prepareForRecording();
  provider.warmUp(); // open the connection while the person is still talking
  let handle;
  try {
    handle = await record({
      autoStop: settings.autoStop,
      silenceMs: Number(settings.pauseMs) || 900,
      onLevel: (l) => { meterFill.style.transform = `scaleX(${l.toFixed(3)})`; },
    });
  } catch (err) {
    console.error(err);
    const denied = err?.name === 'NotAllowedError';
    setStatus(denied ? 'Microphone blocked. Allow it in your browser settings.' : (err.message || 'Could not start the microphone.'), 'error');
    return;
  }
  recording = { side, handle };
  updateMics();
  setStatus(side === 'en' ? 'Listening… tap again to finish' : 'கேக்கிறன்… முடிஞ்சா திரும்ப அமத்துங்கோ', 'listening');

  let clip;
  try {
    clip = await handle.done;
  } catch (err) {
    setStatus(err.message || 'Recording failed.', 'error');
    return;
  } finally {
    recording = null;
    updateMics();
  }

  if (clip.ms < 500 || clip.audio.length < 1500) {
    setStatus('Too short. Tap, then speak.', 'error');
    return;
  }

  const msg = { from: side, to: otherSide(side), audio: clip.audio, mimeType: clip.mimeType };
  const el = addBubble(side);
  $('.replay', el).addEventListener('click', () => {
    speaker.unlock().catch(() => {});
    speak(el, msg).catch((err) => setStatus(err.message || 'Could not play.', 'error'));
  });
  $('.retry', el).addEventListener('click', () => translate(el, msg));
  await translate(el, msg);
}

for (const b of mics) b.addEventListener('click', () => onMic(b.dataset.side));

// ---- Settings ----
for (const lang of ['en', 'ta-jaffna']) {
  const sel = form.elements[`voice_${lang}`];
  for (const v of VOICES) sel.append(new Option(v, v));
}

function openSettings() {
  for (const [k, v] of Object.entries(settings)) {
    const input = form.elements[k];
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = !!v;
    else input.value = v;
  }
  dialog.showModal();
}

dialog.addEventListener('close', () => {
  const next = { ...settings };
  for (const k of Object.keys(DEFAULTS)) {
    const input = form.elements[k];
    if (!input) continue;
    next[k] = input.type === 'checkbox' ? input.checked : input.value.trim();
  }
  settings = next;
  saveSettings(settings);
  provider = makeProvider();
  refreshKeyHint();
});

$('#settingsBtn').addEventListener('click', openSettings);
document.querySelectorAll('[data-open-settings]').forEach((b) => b.addEventListener('click', openSettings));
$('#clearBtn').addEventListener('click', () => {
  log.querySelectorAll('.bubble').forEach((b) => b.remove());
  empty.hidden = false;
  dialog.close();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    recording?.handle.stop();
    speaker.stop();
    releaseMic();
  }
});

if (DEMO) document.body.classList.add('demo');
refreshKeyHint();
updateMics();
setStatus(DEMO ? 'Demo mode (no API key needed)' : 'Ready');
