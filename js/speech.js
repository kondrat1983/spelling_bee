// Text-to-speech (en-GB) and speech recognition wrappers.

const PREFERRED = ['daniel', 'serena', 'kate', 'arthur', 'martha', 'stephanie', 'oliver', 'google uk english female', 'google uk english male'];

const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
let voices = [];
let chosen = null;

export const ttsAvailable = !!synth;

function refreshVoices() {
  if (!synth) return;
  voices = synth.getVoices() || [];
}

export function loadVoices() {
  return new Promise((resolve) => {
    if (!synth) return resolve([]);
    refreshVoices();
    if (voices.length) return resolve(voices);
    const done = () => { refreshVoices(); resolve(voices); };
    synth.addEventListener?.('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

export function englishVoices() {
  const en = voices.filter((v) => /^en[-_]/i.test(v.lang));
  const gb = (v) => /en[-_]gb/i.test(v.lang);
  return en.sort((a, b) => Number(gb(b)) - Number(gb(a)) || a.name.localeCompare(b.name));
}

export function chooseVoice(uri) {
  const list = englishVoices();
  chosen = list.find((v) => v.voiceURI === uri)
    || PREFERRED.map((n) => list.find((v) => /en[-_]gb/i.test(v.lang) && v.name.toLowerCase().includes(n))).find(Boolean)
    || list.find((v) => /en[-_]gb/i.test(v.lang))
    || list[0]
    || null;
  return chosen;
}

export function stopSpeaking() {
  try { synth?.cancel(); } catch { /* ignore */ }
}

/** Speak and resolve when finished (or after a timeout: iOS sometimes drops `end`). */
export function speak(text, rate = 0.85) {
  return new Promise((resolve) => {
    if (!synth) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = chosen?.lang || 'en-GB';
    if (chosen) u.voice = chosen;
    u.rate = rate;
    let finished = false;
    const finish = () => { if (!finished) { finished = true; clearTimeout(timer); resolve(); } };
    const timer = setTimeout(finish, 1500 + text.length * 180 / rate);
    u.onend = finish;
    u.onerror = finish;
    synth.speak(u);
  });
}

// Letter names as a British voice should say them. Lower case on purpose:
// iOS reads a single capital as "capital E". A lone "a" can sound like "uh".
const SAY_LETTER = { a: 'ay', z: 'zed' };

/** Say a word letter by letter. `onLetter(i)` lets the UI highlight each letter. */
export async function spellOut(word, rate = 0.6, onLetter = () => {}, isCancelled = () => false) {
  const chars = [...word];
  for (let i = 0; i < chars.length; i++) {
    if (isCancelled()) return;
    const ch = chars[i].toLowerCase();
    onLetter(i);
    if (ch === ' ') { await pause(350); continue; }
    await speak(SAY_LETTER[ch] || ch, rate);
    await pause(120);
  }
  onLetter(-1);
}

export function pause(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- Speech recognition ----------

const Recognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : undefined;
export const sttAvailable = !!Recognition;

/**
 * Listen for one spelling attempt. Keeps listening through pauses between letters:
 * stops after `silenceMs` without new results, or when stop() is called.
 * If the engine ends on its own (iOS does this after a pause), it restarts and keeps the results.
 */
export class Listener {
  constructor({ silenceMs = 2600, firstSpeechMs = 9000, maxMs = 40000 } = {}) {
    this.opts = { silenceMs, firstSpeechMs, maxMs };
    this.rec = null;
    this.active = false;
  }

  start({ onInterim = () => {}, onDone = () => {} } = {}) {
    if (!Recognition) { onDone({ candidates: [], error: 'unsupported' }); return; }
    this.chunks = [];      // results from finished recognisers
    this.current = [];     // results from the running one: [[alt, alt...], ...]
    this.onInterim = onInterim;
    this.onDone = onDone;
    this.active = true;
    this.finished = false;
    this.heardAny = false;
    this.startedAt = Date.now();
    this.error = null;
    this.armTimer(this.opts.firstSpeechMs);
    this.maxTimer = setTimeout(() => this.stop(), this.opts.maxMs);
    this.launch();
  }

  launch() {
    const rec = new Recognition();
    rec.lang = 'en-GB';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 5;
    rec.onresult = (e) => {
      const list = [];
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        const alts = [];
        for (let j = 0; j < r.length; j++) alts.push(r[j].transcript);
        list.push(alts);
      }
      this.current = list;
      this.heardAny = true;
      this.armTimer(this.opts.silenceMs);
      this.onInterim(this.topTranscript());
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
        this.error = e.error;
        this.active = false;
      }
    };
    rec.onend = () => {
      this.chunks.push(...this.current);
      this.current = [];
      if (this.active) {
        // Ended by itself between letters: start again and keep what we have.
        try { this.launch(); return; } catch { /* fall through */ }
      }
      this.finish();
    };
    this.rec = rec;
    try { rec.start(); } catch (err) { this.error = String(err); this.active = false; this.finish(); }
  }

  armTimer(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.stop(), ms);
  }

  allResults() {
    return [...this.chunks, ...this.current];
  }

  topTranscript() {
    return this.allResults().map((a) => a[0]).join(' ');
  }

  /** Top transcript plus each variant with one result swapped for its alternative. */
  candidates() {
    const res = this.allResults();
    if (!res.length) return [];
    const top = res.map((a) => a[0]);
    const out = [top.join(' ')];
    res.forEach((alts, i) => {
      alts.slice(1).forEach((alt) => {
        const v = [...top];
        v[i] = alt;
        out.push(v.join(' '));
      });
    });
    return [...new Set(out)];
  }

  stop() {
    if (!this.rec) return;
    this.active = false;
    clearTimeout(this.timer);
    try { this.rec.stop(); } catch { this.finish(); }
    // Safety net if `end` never comes.
    clearTimeout(this.endTimer);
    this.endTimer = setTimeout(() => this.finish(), 1500);
  }

  abort() {
    this.onDone = () => {};
    this.active = false;
    clearTimeout(this.timer);
    try { this.rec?.abort(); } catch { /* ignore */ }
    this.finish();
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    clearTimeout(this.maxTimer);
    clearTimeout(this.endTimer);
    this.active = false;
    const done = this.onDone;
    this.onDone = () => {};
    done({ candidates: this.candidates(), error: this.error });
  }
}
