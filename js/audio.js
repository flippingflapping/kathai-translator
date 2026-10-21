// Speaker output through one shared Web Audio context. Mobile browsers only
// allow sound after a tap, so unlock() must run inside a tap handler; after
// that, translated speech can play when it arrives.

let ctx = null;
let current = null;

export function audioContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

// iOS 17+: without this, Web Audio is silenced by the ring/silent switch.
function setSession(type) {
  try {
    if (navigator.audioSession) navigator.audioSession.type = type;
  } catch { /* older browsers have no audioSession */ }
}

export async function unlock() {
  const c = audioContext();
  if (c.state !== 'running') await c.resume();
  // A silent one-sample buffer fully unlocks output on older iOS.
  const src = c.createBufferSource();
  src.buffer = c.createBuffer(1, 1, 22050);
  src.connect(c.destination);
  src.start(0);
}

export function stop() {
  if (current) {
    try { current.stop(); } catch { /* already stopped */ }
    current = null;
  }
}

// Plays 16-bit mono PCM pieces as they arrive, each scheduled right after the
// last so speech starts with the first piece and has no gaps.
//   push(bytes)  add a piece      end()  no more pieces
//   done         resolves when the last piece finishes (or on stop)
//   received     true once any audio was pushed
export function createStreamPlayer({ sampleRate = 24000, leadSeconds = 0.12 } = {}) {
  stop();
  setSession('playback');
  const c = audioContext();
  if (c.state !== 'running') c.resume().catch(() => {});
  const sources = new Set();
  let nextAt = 0;
  let ended = false;
  let stopped = false;
  let finish;
  const done = new Promise((r) => { finish = r; });
  const settle = () => {
    if (stopped || (ended && sources.size === 0)) finish();
  };

  const player = {
    received: false,
    done,
    push(bytes) {
      if (stopped || bytes.length < 2) return;
      player.received = true;
      const n = bytes.length >> 1;
      const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
      const buf = c.createBuffer(1, n, sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < n; i++) ch[i] = view.getInt16(i * 2, true) / 32768;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      // A small lead on the first piece (or after running dry) absorbs
      // network jitter between pieces.
      if (nextAt < c.currentTime + 0.02) nextAt = c.currentTime + leadSeconds;
      src.start(nextAt);
      nextAt += buf.duration;
      sources.add(src);
      src.onended = () => { sources.delete(src); settle(); };
    },
    end() {
      ended = true;
      settle();
    },
    stop() {
      stopped = true;
      for (const s of sources) { try { s.stop(); } catch { /* not started */ } }
      sources.clear();
      settle();
    },
  };
  current = player;
  done.then(() => { if (current === player) current = null; });
  return player;
}

export async function play(wavBytes) {
  stop();
  setSession('playback');
  const c = audioContext();
  if (c.state !== 'running') await c.resume();
  const buffer = await c.decodeAudioData(wavBytes.slice().buffer);
  return new Promise((resolve) => {
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.connect(c.destination);
    src.onended = () => {
      if (current === src) current = null;
      resolve();
    };
    current = src;
    src.start();
  });
}

export function prepareForRecording() {
  stop();
  setSession('play-and-record');
}
