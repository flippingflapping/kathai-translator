import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiProvider, collectParts, parseTranslation } from '../js/gemini.js';
import { isWav, pcmToWav, bytesToBase64 } from '../js/wav.js';

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const r = responses.shift();
    return { ok: r.status === 200, status: r.status, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}

const ok = (body) => ({ status: 200, body });

test('translateSpeech sends audio with the key and returns the parsed translation', async () => {
  const fetchImpl = fakeFetch([ok({
    steps: [
      { type: 'thought', content: [{ type: 'text', text: 'thinking {not json}' }] },
      { type: 'model_output', content: [{ type: 'text', text: '{"heard":"Hello","translation":"வணக்கம்","romanized":"vanakkam"}' }] },
    ],
  })]);
  const p = createGeminiProvider({ getKey: () => 'k123', fetchImpl });
  const r = await p.translateSpeech({ audio: new Uint8Array([1, 2, 3]), mimeType: 'audio/mp4', from: 'en', to: 'ta-jaffna' });

  assert.deepEqual(r, { heard: 'Hello', translation: 'வணக்கம்', romanized: 'vanakkam' });
  const { headers, body } = fetchImpl.calls[0];
  assert.equal(headers['x-goog-api-key'], 'k123');
  const audio = body.input.find((i) => i.type === 'audio');
  assert.equal(audio.mime_type, 'audio/m4a'); // iOS records mp4; Gemini wants m4a
  assert.equal(audio.data, bytesToBase64(new Uint8Array([1, 2, 3])));
  assert.match(body.input[0].text, /Jaffna/);
  assert.match(body.input[0].text, /ஓம்/); // dialect guide reaches the prompt
});

test('a rejected request shape is retried once without optional fields', async () => {
  const fetchImpl = fakeFetch([
    { status: 400, body: { error: { message: 'Unknown field thinking_level' } } },
    ok({ outputs: [{ type: 'text', text: '```json\n{"heard":"ஓம்","translation":"Yes","romanized":"om"}\n```' }] }),
  ]);
  const p = createGeminiProvider({ getKey: () => 'k', fetchImpl });
  const r = await p.translateSpeech({ audio: new Uint8Array([9]), mimeType: 'audio/webm;codecs=opus', from: 'ta-jaffna', to: 'en' });
  assert.equal(r.translation, 'Yes');
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(fetchImpl.calls[1].body.generation_config, undefined);
});

test('other errors are surfaced with the API message', async () => {
  const fetchImpl = fakeFetch([{ status: 403, body: { error: { message: 'API key not valid' } } }]);
  const p = createGeminiProvider({ getKey: () => 'bad', fetchImpl });
  await assert.rejects(p.translateSpeech({ audio: new Uint8Array([1]), mimeType: 'audio/webm', from: 'en', to: 'ta-jaffna' }), /API key not valid/);
  assert.equal(fetchImpl.calls.length, 1);
});

test('missing key fails before any network call', async () => {
  const fetchImpl = fakeFetch([]);
  const p = createGeminiProvider({ getKey: () => '', fetchImpl });
  await assert.rejects(p.synthesize({ text: 'hi', lang: 'en' }), /API key/);
  assert.equal(fetchImpl.calls.length, 0);
});

test('synthesize returns WAV bytes, wrapping raw PCM when needed', async () => {
  const pcm = new Uint8Array(480).fill(7);
  const fetchImpl = fakeFetch([ok({ steps: [{ content: [{ type: 'audio', mime_type: 'audio/l16', data: bytesToBase64(pcm) }] }] })]);
  const p = createGeminiProvider({ getKey: () => 'k', fetchImpl });
  const wav = await p.synthesize({ text: 'வணக்கம்', lang: 'ta-jaffna', voice: 'Aoede' });
  assert.ok(isWav(wav));
  assert.equal(wav.length, 44 + 480);
  const body = fetchImpl.calls[0].body;
  assert.equal(body.model, 'gemini-3.8-flash-tts');
  assert.equal(body.generation_config.speech_config[0].voice, 'Aoede');
  assert.match(body.input[0].content[0].annotations[0].style, /Jaffna/);
});

test('synthesize passes WAV through unchanged and reads the older inlineData shape', async () => {
  const wav = pcmToWav(new Uint8Array(100));
  const fetchImpl = fakeFetch([ok({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: bytesToBase64(wav) } }] } }] })]);
  const p = createGeminiProvider({ getKey: () => 'k', fetchImpl });
  assert.deepEqual(await p.synthesize({ text: 'hi', lang: 'en' }), wav);
});

test('empty speech parses to empty strings; non-JSON text is an error', () => {
  assert.deepEqual(parseTranslation('{"heard":"","translation":"","romanized":""}'), { heard: '', translation: '', romanized: '' });
  assert.throws(() => parseTranslation('sorry, no'), /did not return/);
  assert.equal(collectParts({ output_text: 'x' }).text, 'x');
});
