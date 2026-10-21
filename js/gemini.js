// Gemini adapter for the translator provider interface:
//   translateSpeech({ audio: Uint8Array, mimeType, from, to }) -> { heard, translation, romanized }
//   synthesize({ text, lang, voice }) -> Uint8Array (WAV bytes)
// It calls the Gemini Interactions API straight from the browser with the
// user's own API key, so the app needs no server.

import { LANGUAGES } from './languages.js';
import { base64ToBytes, bytesToBase64, ensureWav } from './wav.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

export const DEFAULT_MODELS = {
  translate: 'gemini-3.8-flash',
  tts: 'gemini-3.8-flash-tts',
};

const TRANSLATION_SCHEMA = {
  type: 'object',
  properties: {
    heard: { type: 'string', description: 'Exact transcript of what the speaker said, in their own language and script.' },
    translation: { type: 'string', description: 'The translation, written in the target language and script.' },
    romanized: { type: 'string', description: 'Latin-letter pronunciation guide for any Tamil text, or empty.' },
  },
  required: ['heard', 'translation', 'romanized'],
};

// Gemini accepts these container names; browsers report some differently.
function geminiAudioMime(browserMime) {
  const base = (browserMime || '').split(';')[0].trim().toLowerCase();
  if (base === 'audio/mp4' || base === 'audio/x-m4a') return 'audio/m4a';
  if (base === 'video/webm') return 'audio/webm';
  return base || 'audio/webm';
}

export function buildTranslatePrompt(from, to) {
  const src = LANGUAGES[from];
  const dst = LANGUAGES[to];
  const tamil = src.romanize || dst.romanize;
  return [
    `You are a live interpreter between ${LANGUAGES.en.name} and ${LANGUAGES['ta-jaffna'].name} (Sri Lankan Tamil as spoken in Jaffna).`,
    `The attached audio is someone speaking ${src.name}. If they actually speak the other language, still transcribe it faithfully and translate into whichever language they did not speak.`,
    `1. "heard": transcribe exactly what was said, in the speaker's language and script${src.romanize ? ' (Tamil script)' : ''}.`,
    `2. "translation": translate the meaning into ${dst.name}, as something a person would naturally say out loud. Keep names, numbers and tone. Do not add explanations or notes.`,
    `   ${dst.writingGuide.split('\n').join('\n   ')}`,
    tamil
      ? `3. "romanized": a simple English-letter pronunciation guide for the Tamil side (the translation if it is Tamil, otherwise the transcript), e.g. "eppidi irukkiriyal?". `
      : `3. "romanized": empty string.`,
    `If the audio has no clear speech, return empty strings for all fields.`,
    `Reply with JSON only: {"heard": "...", "translation": "...", "romanized": "..."}`,
  ].join('\n');
}

// Collect text and audio parts from an Interactions response without
// depending on one exact shape. Thought/summary parts are skipped.
export function collectParts(response) {
  const texts = [];
  const audios = [];
  const roots = response?.steps ?? response?.outputs ?? response?.candidates ?? [response];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const type = node.type;
    if (type === 'thought' || type === 'thought_summary' || type === 'user_input' || node.thought === true) return;
    if (typeof node.text === 'string' && (!type || type === 'text' || type === 'model_output')) texts.push(node.text);
    const inline = node.inlineData ?? node.inline_data;
    if (inline?.data) audios.push({ data: inline.data, mimeType: inline.mimeType ?? inline.mime_type });
    else if (typeof node.data === 'string' && (type === 'audio' || /audio/.test(node.mime_type ?? node.mimeType ?? ''))) {
      audios.push({ data: node.data, mimeType: node.mime_type ?? node.mimeType });
    }
    for (const [k, v] of Object.entries(node)) {
      if (k !== 'text' && k !== 'data' && v && typeof v === 'object') walk(v);
    }
  };
  walk(roots);
  if (!texts.length && typeof response?.output_text === 'string') texts.push(response.output_text);
  return { text: texts.join(''), audios };
}

export function parseTranslation(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Gemini did not return a translation.');
  const obj = JSON.parse(text.slice(start, end + 1));
  return {
    heard: String(obj.heard ?? '').trim(),
    translation: String(obj.translation ?? '').trim(),
    romanized: String(obj.romanized ?? '').trim(),
  };
}

export class GeminiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createGeminiProvider({ getKey, models = DEFAULT_MODELS, fetchImpl = (...a) => fetch(...a) }) {
  async function call(body) {
    const key = getKey();
    if (!key) throw new GeminiError('Add your Gemini API key in Settings first.', 0);
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error?.message || `Gemini request failed (${res.status}).`;
      throw new GeminiError(msg, res.status);
    }
    return json;
  }

  // Optional fields (schema, thinking level, style annotations) help but are
  // not essential. If the API rejects the request shape, retry once without them.
  async function callWithFallback(full, minimal) {
    try {
      return await call(full);
    } catch (err) {
      if (err.status === 400) return call(minimal);
      throw err;
    }
  }

  return {
    async translateSpeech({ audio, mimeType, from, to }) {
      const input = [
        { type: 'text', text: buildTranslatePrompt(from, to) },
        { type: 'audio', data: bytesToBase64(audio), mime_type: geminiAudioMime(mimeType) },
      ];
      const full = {
        model: models.translate,
        store: false,
        input,
        response_format: { type: 'text', mime_type: 'application/json', schema: TRANSLATION_SCHEMA },
        generation_config: { temperature: 0.3, thinking_level: 'low' },
      };
      const minimal = { model: models.translate, input };
      const json = await callWithFallback(full, minimal);
      return parseTranslation(collectParts(json).text);
    },

    async synthesize({ text, lang, voice }) {
      const style = LANGUAGES[lang].ttsStyle;
      const voiceName = voice || LANGUAGES[lang].defaultVoice;
      const full = {
        model: models.tts,
        store: false,
        input: [{
          type: 'user_input',
          content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style }] }],
        }],
        response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice: voiceName }] },
      };
      const minimal = {
        model: models.tts,
        input: `Say this as ${style}:\n${text}`,
        response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice: voiceName }] },
      };
      const json = await callWithFallback(full, minimal);
      const { audios } = collectParts(json);
      if (!audios.length) throw new GeminiError('Gemini returned no audio.', 0);
      return ensureWav(base64ToBytes(audios[0].data));
    },
  };
}
