import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiProvider, collectParts, parseTranslation } from '../js/gemini.js';
import { isWav, pcmToWav, bytesToBase64 } from '../js/wav.js';

// Each response is { status, body } for JSON, or { status, sse: [string pieces] }
// for a streamed reply delivered in exactly those network pieces.
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body && JSON.parse(init.body) });
    const r = responses.shift();
    if (!r) throw new Error('unexpected request');
    const enc = new TextEncoder();
    const body = r.sse
      ? new ReadableStream({
        start(c) { r.sse.forEach((p) => c.enqueue(enc.encode(p))); c.close(); },
      })
      : null;
    return { ok: r.status === 200, status: r.status, body, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}

const ok = (body) => ({ status: 200, body });
const event = (delta) => `data: ${JSON.stringify({ event_type: 'step.delta', delta })}\n\n`;
const audioArgs = { audio: new Uint8Array([1, 2, 3]), mimeType: 'audio/mp4', from: 'en', to: 'ta-jaffna' };

test('translation streams, and the translation is handed over before the reply ends', async () => {
  const reply = '{"heard":"Hello","translation":"வணக்கம் \\"நண்பா\\"","romanized":"vanakkam"}';
  const cut = reply.indexOf('"romanized"');
  const fetchImpl = fakeFetch([{
    status: 200,
    sse: [
      event({ type: 'thought', text: 'thinking {"translation":"wrong"}' }),
      event({ type: 'text', text: reply.slice(0, 20) }).slice(0, 15), // event split across network pieces
      event({ type: 'text', text: reply.slice(0, 20) }).slice(15),
      event({ type: 'text', text: reply.slice(20, cut) }),
      event({ type: 'text', text: reply.slice(cut) }),
      'data: [DONE]\n\n',
    ],
  }]);
  const seen = [];
  const p = createGeminiProvider({ getKey: () => 'k123', fetchImpl });
  const r = await p.translateSpeech({ ...audioArgs, onTranslation: (t) => seen.push(t) });

  assert.deepEqual(r, { heard: 'Hello', translation: 'வணக்கம் "நண்பா"', romanized: 'vanakkam' });
  assert.deepEqual(seen, ['வணக்கம் "நண்பா"']);
  const { url, headers, body } = fetchImpl.calls[0];
  assert.match(url, /\?alt=sse$/);
  assert.equal(body.stream, true);
  assert.equal(body.generation_config.thinking_level, 'minimal');
  assert.equal(headers['x-goog-api-key'], 'k123');
  const audio = body.input.find((i) => i.type === 'audio');
  assert.equal(audio.mime_type, 'audio/m4a'); // iOS records mp4; Gemini wants m4a
  assert.equal(audio.data, bytesToBase64(new Uint8Array([1, 2, 3])));
  assert.match(body.input[0].text, /ஓம்/); // dialect guide reaches the prompt
});

test('if streaming is rejected, it falls back to a plain request, then to a minimal one', async () => {
  const fetchImpl = fakeFetch([
    { status: 400, body: { error: { message: 'stream not supported' } } },
    { status: 400, body: { error: { message: 'Unknown field thinking_level' } } },
    ok({ outputs: [{ type: 'text', text: '```json\n{"heard":"ஓம்","translation":"Yes","romanized":"om"}\n```' }] }),
  ]);
  const p = createGeminiProvider({ getKey: () => 'k', fetchImpl });
  const r = await p.translateSpeech({ ...audioArgs, from: 'ta-jaffna', to: 'en' });
  assert.equal(r.translation, 'Yes');
  assert.equal(fetchImpl.calls.length, 3);
  assert.equal(fetchImpl.calls[1].body.stream, undefined);
  assert.equal(fetchImpl.calls[2].body.generation_config, undefined);
});

test('a bad key is reported at once, with no fallback retries', async () => {
  const fetchImpl = fakeFetch([{ status: 403, body: { error: { message: 'API key not valid' } } }]);
  const p = createGeminiProvider({ getKey: () => 'bad', fetchImpl });
  await assert.rejects(p.translateSpeech(audioArgs), /API key not valid/);
  assert.equal(fetchImpl.calls.length, 1);
});

test('missing key fails before any network call', async () => {
  const fetchImpl = fakeFetch([]);
  const p = createGeminiProvider({ getKey: () => '', fetchImpl });
  await assert.rejects(p.synthesize({ text: 'hi', lang: 'en' }), /API key/);
  assert.equal(fetchImpl.calls.length, 0);
});

test('speech streams in even-sized PCM pieces and the full clip comes back as WAV', async () => {
  const pcm = Uint8Array.from({ length: 10 }, (_, i) => i + 1);
  const fetchImpl = fakeFetch([{
    status: 200,
    sse: [
      event({ type: 'audio', data: bytesToBase64(pcm.subarray(0, 3)) }), // odd length
      event({ type: 'audio', data: bytesToBase64(pcm.subarray(3, 10)) }),
    ],
  }]);
  const chunks = [];
  const p = createGeminiProvider({ getKey: () => 'k', fetchImpl });
  const wav = await p.synthesize({ text: 'வணக்கம்', lang: 'ta-jaffna', voice: 'Aoede', onChunk: (c) => chunks.push([...c]) });

  assert.ok(chunks.every((c) => c.length % 2 === 0));
  assert.deepEqual(chunks.flat(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(isWav(wav));
  assert.deepEqual([...wav.subarray(44)], [...pcm]);
  const body = fetchImpl.calls[0].body;
  assert.equal(body.model, 'gemini-3.8-flash-tts');
  assert.equal(body.stream, true);
  assert.equal(body.generation_config.speech_config[0].voice, 'Aoede');
  assert.match(body.input[0].content[0].annotations[0].style, /Jaffna/);
});

test('without a chunk listener, speech uses one plain request and wraps raw PCM', async () => {
  const pcm = new Uint8Array(480).fill(7);
  const fetchImpl = fakeFetch([ok({ steps: [{ content: [{ type: 'audio', mime_type: 'audio/l16', data: bytesToBase64(pcm) }] }] })]);
  const p = createGeminiProvider({ getKey: () => 'k', fetchImpl });
  const wav = await p.synthesize({ text: 'hi', lang: 'en' });
  assert.ok(isWav(wav));
  assert.equal(wav.length, 44 + 480);
  assert.equal(fetchImpl.calls[0].body.stream, undefined);
});

test('a stream that sends nothing falls back to a plain request (older inlineData shape)', async () => {
  const wav = pcmToWav(new Uint8Array(100));
  const fetchImpl = fakeFetch([
    { status: 200, sse: ['data: [DONE]\n\n'] },
    ok({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: bytesToBase64(wav) } }] } }] }),
  ]);
  const p = createGeminiProvider({ getKey: () => 'k', fetchImpl });
  assert.deepEqual(await p.synthesize({ text: 'hi', lang: 'en', onChunk: () => {} }), wav);
});

test('empty speech parses to empty strings; non-JSON text is an error', () => {
  assert.deepEqual(parseTranslation('{"heard":"","translation":"","romanized":""}'), { heard: '', translation: '', romanized: '' });
  assert.throws(() => parseTranslation('sorry, no'), /did not return/);
  assert.equal(collectParts({ output_text: 'x' }).text, 'x');
});
