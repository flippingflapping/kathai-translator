import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSse, completedStringField } from '../js/sse.js';

function body(pieces) {
  const enc = new TextEncoder();
  return new ReadableStream({ start(c) { pieces.forEach((p) => c.enqueue(enc.encode(p))); c.close(); } });
}

test('reads events split across pieces, with CRLF and a final event without a blank line', async () => {
  const got = [];
  for await (const ev of readSse(body(['data: {"a":', '1}\r\n\r\nevent: x\ndata: {"b":2}\n\n', 'data: {"c":3}']))) got.push(ev);
  assert.deepEqual(got, [{ a: 1 }, { b: 2 }, { c: 3 }]);
});

test('a multi-byte character split between pieces survives', async () => {
  const bytes = new TextEncoder().encode('data: {"t":"தமிழ்"}\n\n');
  const stream = new ReadableStream({ start(c) { c.enqueue(bytes.subarray(0, 14)); c.enqueue(bytes.subarray(14)); c.close(); } });
  const got = [];
  for await (const ev of readSse(stream)) got.push(ev);
  assert.deepEqual(got, [{ t: 'தமிழ்' }]);
});

test('a string field is returned only once its closing quote arrives', () => {
  assert.equal(completedStringField('{"heard":"hi","translation":"வண', 'translation'), null);
  assert.equal(completedStringField('{"heard":"hi","translation":"say \\"ஓம்\\"",', 'translation'), 'say "ஓம்"');
  assert.equal(completedStringField('{"heard":"hi"', 'translation'), null);
});
