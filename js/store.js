// Progress and settings in localStorage. Every access is wrapped: private mode or
// blocked storage must not break the app, it just won't remember.

const KEY = 'sbt.progress.v1';
const SETTINGS_KEY = 'sbt.settings.v1';
const MAX_TRANSCRIPTS = 500;
const MAX_HISTORY = 30;

export const DEFAULT_SETTINGS = {
  inputMode: 'voice', // voice | type | parent
  voiceURI: '',
  rate: 0.85,
  slowRate: 0.6,
  sessionSize: 20,
  showDots: false,
  examTimer: 0, // seconds per word, 0 = off
};

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function emptyProgress() {
  return { version: 1, words: {}, days: [], transcripts: [], sessions: [] };
}

export function loadProgress() {
  const p = read(KEY);
  if (!p || typeof p !== 'object' || !p.words) return emptyProgress();
  return { ...emptyProgress(), ...p };
}

export function saveProgress(p) {
  return write(KEY, p);
}

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...(read(SETTINGS_KEY) || {}) };
}

export function saveSettings(s) {
  return write(SETTINGS_KEY, s);
}

export function wordState(p, word) {
  return p.words[word] || { box: 0, right: 0, wrong: 0, history: [] };
}

/** Record an answer. Wrong -> box 1, right -> box + 1 (max 5). */
export function recordAnswer(p, word, ok, { heard = '', mode = '', updateBox = true } = {}) {
  const w = { ...wordState(p, word) };
  w.prevBox = w.box;
  if (updateBox) w.box = ok ? Math.min(5, Math.max(1, w.box) + 1) : 1;
  if (ok) w.right++;
  else w.wrong++;
  w.history = [...w.history, { t: Date.now(), ok, heard, mode }].slice(-MAX_HISTORY);
  p.words[word] = w;
  markToday(p);
  return w;
}

export function logTranscript(p, entry) {
  p.transcripts = [...p.transcripts, { t: Date.now(), ...entry }].slice(-MAX_TRANSCRIPTS);
}

export function today(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function markToday(p) {
  const t = today();
  if (!p.days.includes(t)) p.days = [...p.days, t];
}

/** Days in a row ending today or yesterday (missing today doesn't break it yet). */
export function streak(p, now = new Date()) {
  const days = new Set(p.days);
  const d = new Date(now);
  if (!days.has(today(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(today(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function learnedCount(p, words) {
  return words.filter((w) => wordState(p, w).box >= 5).length;
}

export function exportJSON(p) {
  return JSON.stringify({ app: 'spelling-bee-trainer', exported: new Date().toISOString(), progress: p }, null, 1);
}

/** Import progress. Merges per word, keeping the record with more answers. */
export function importJSON(current, text) {
  const data = JSON.parse(text);
  const incoming = data.progress || data;
  if (!incoming || typeof incoming.words !== 'object') throw new Error('Not a progress file');
  const merged = { ...emptyProgress(), ...current, words: { ...current.words } };
  for (const [word, st] of Object.entries(incoming.words)) {
    const mine = merged.words[word];
    const count = (s) => (s ? s.right + s.wrong : -1);
    if (count(st) > count(mine)) merged.words[word] = st;
  }
  merged.days = [...new Set([...(current.days || []), ...(incoming.days || [])])].sort();
  merged.transcripts = [...(current.transcripts || []), ...(incoming.transcripts || [])]
    .sort((a, b) => a.t - b.t)
    .slice(-MAX_TRANSCRIPTS);
  merged.sessions = [...(current.sessions || []), ...(incoming.sessions || [])].sort((a, b) => a.t - b.t).slice(-200);
  return merged;
}
