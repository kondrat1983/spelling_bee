// Short feedback sounds made with WebAudio, so there are no audio files to load.
let ctx = null;

function context() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

function tone(freq, start, dur, type = 'sine', vol = 0.18) {
  const c = context();
  if (!c) return;
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export const sound = {
  enabled: true,
  /** Call from a tap: iOS only allows audio after a user gesture. */
  unlock() {
    try { context()?.resume(); } catch { /* ignore */ }
  },
  good() {
    if (!this.enabled) return;
    try { tone(660, 0, 0.12); tone(880, 0.1, 0.18); } catch { /* ignore */ }
  },
  bad() {
    if (!this.enabled) return;
    try { tone(220, 0, 0.25, 'triangle', 0.15); } catch { /* ignore */ }
  },
  fanfare() {
    if (!this.enabled) return;
    try { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.2)); } catch { /* ignore */ }
  },
};
