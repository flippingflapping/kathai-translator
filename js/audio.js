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
