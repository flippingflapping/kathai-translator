// Read a server-sent events (SSE) response body as parsed JSON events.

export async function* readSse(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const parse = (block) => {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data || data === '[DONE]') return null;
    return JSON.parse(data);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
      const ev = parse(block);
      if (ev) yield ev;
    }
  }
  buf += decoder.decode();
  const last = buf.trim() && parse(buf);
  if (last) yield last;
}

// From a partial JSON text, return the value of a string field once its
// closing quote has arrived, or null if it is not complete yet.
export function completedStringField(partial, field) {
  const m = new RegExp(`"${field}"\\s*:\\s*"`).exec(partial);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  for (let i = start + 1; i < partial.length; i++) {
    if (partial[i] === '\\') { i++; continue; }
    if (partial[i] === '"') return JSON.parse(partial.slice(start, i + 1));
  }
  return null;
}
