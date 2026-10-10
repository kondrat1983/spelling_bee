// Turns a speech-recognition transcript into letters and scores it against the target word.
// Pure functions only: used by the app and by tests/normalize.test.js.

// Spoken token -> letter. Tokens marked [?] in the spec are included but are guesses.
const LETTER_NAMES = {
  a: ['a', 'ay', 'eh', 'hey'],
  b: ['b', 'be', 'bee', 'bea', 'bi'],
  c: ['c', 'see', 'sea', 'si', 'cee', 'sie'],
  d: ['d', 'dee', 'de', 'di'],
  e: ['e', 'ee', 'ea'],
  f: ['f', 'eff', 'ef', 'if'],
  g: ['g', 'gee', 'ji', 'jee', 'gi'],
  h: ['h', 'aitch', 'haitch', 'age', 'each', 'eight'],
  i: ['i', 'eye', 'aye', 'ai'],
  j: ['j', 'jay', 'jey'],
  k: ['k', 'kay', 'okay', 'ok', 'cay', 'kaye'],
  l: ['l', 'el', 'ell', 'elle', 'al'],
  m: ['m', 'em', 'emm', 'am'],
  n: ['n', 'en', 'and', 'in', 'an', 'end', 'hen', 'ann', 'anne', 'inn'],
  o: ['o', 'oh', 'owe', 'ow', 'ooh', 'zero'],
  p: ['p', 'pee', 'pea', 'pe', 'pi', 'pie'],
  q: ['q', 'queue', 'cue', 'kyu', 'kew', 'que'],
  r: ['r', 'are', 'our', 'ar', 'ah', 'arr'],
  s: ['s', 'es', 'ess', 'ass', 'yes'],
  t: ['t', 'tea', 'tee', 'te', 'ti', 'tie'],
  u: ['u', 'you', 'yu', 'yo', 'ewe', 'yew'],
  v: ['v', 'vee', 've', 'vi', 'we'],
  w: ['w', 'dub', 'dubya', 'doubleyou', 'doubleu'],
  x: ['x', 'ex', 'ecks', 'eggs'],
  y: ['y', 'why', 'wye', 'wai'],
  z: ['z', 'zed', 'zee', 'said', 'zet', 'zedd'],
};

export const TOKEN_TO_LETTER = {};
for (const [letter, names] of Object.entries(LETTER_NAMES)) {
  for (const name of names) TOKEN_TO_LETTER[name] = letter;
}

// Number words the recogniser sometimes writes instead of letter names.
const DIGITS = { '0': 'o', '8': 'h' };

// Tokens that carry no letters ("um", "letter", "capital").
const FILLER = new Set(['um', 'umm', 'uh', 'er', 'erm', 'hmm', 'mm', 'the', 'letter', 'capital', 'small', 'then', 'comma', 'dash', 'hyphen']);

// Confusable sounds: a difference only inside one of these groups asks for confirmation.
const CONFUSABLE_GROUPS = ['bcdegptvz'];
// M and N: the engine mixes them up so often that asking every time is annoying, and
// a real M/N spelling mistake is almost unheard of. Treat them as the same letter.
const SAME_SOUND = ['mn'];
// How many confusable positions may differ before we call it a real mistake.
const MAX_CONFUSABLE = 2;

// American spellings that should get a "British: colour" note rather than silent ❌.
export const AMERICAN = { color: 'colour', favorite: 'favourite', gray: 'grey', math: 'maths', theater: 'theatre', center: 'centre' };

export function lettersOnly(s) {
  return String(s).toLowerCase().replace(/[^a-z]/g, '');
}

function tokenize(transcript) {
  return String(transcript)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function toLetter(tok) {
  if (tok in TOKEN_TO_LETTER) return TOKEN_TO_LETTER[tok];
  if (tok in DIGITS) return DIGITS[tok];
  return null;
}

/**
 * Transcript -> letters, e.g. "enough e n o u g h enough" -> "enough",
 * "ess see eye double ess oh are ess" -> "scissors".
 * `target` is used to drop the whole word said before and after the spelling.
 */
export function transcriptToLetters(transcript, target = '', { live = false } = {}) {
  let tokens = tokenize(transcript);
  const targetTokens = tokenize(target);
  const targetCompact = lettersOnly(target);

  const startsWith = (arr, pre) => pre.length > 0 && pre.length <= arr.length && pre.every((t, i) => arr[i] === t);
  const endsWith = (arr, suf) => startsWith(arr.slice(arr.length - suf.length), suf);

  // Say-before / say-after: only drop it if something is left to spell.
  if (startsWith(tokens, targetTokens) && tokens.length > targetTokens.length) tokens = tokens.slice(targetTokens.length);
  else if (tokens.length > 1 && tokens[0] === targetCompact) tokens = tokens.slice(1);
  if (endsWith(tokens, targetTokens) && tokens.length > targetTokens.length) tokens = tokens.slice(0, tokens.length - targetTokens.length);
  else if (tokens.length > 1 && tokens[tokens.length - 1] === targetCompact) tokens = tokens.slice(0, -1);

  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    // Live preview must never reveal the spelling: skip the word itself and whole-word chunks.
    if (tok === targetCompact) { if (!live) out += tok; continue; }
    if (FILLER.has(tok)) continue;
    // "space" separates two-word entries; spaces are ignored when comparing.
    if (tok === 'space') continue;
    if (tok === 'double' || tok === 'doubled') {
      const next = tokens[i + 1];
      if (next === undefined) continue;
      if (next === 'you' || next === 'u' || next === 'yu') { out += 'w'; i++; continue; }
      const l = toLetter(next);
      if (l) { out += l + l; i++; continue; }
      // "double ss"? take it literally.
      continue;
    }
    if (tok === 'triple') {
      const l = toLetter(tokens[i + 1] || '');
      if (l) { out += l + l + l; i++; }
      continue;
    }
    const letter = toLetter(tok);
    if (letter) { out += letter; continue; }
    // A fully spelled chunk ("nough") or a word: take its letters as written.
    if (!live) out += tok.replace(/[^a-z]/g, '');
  }
  return out;
}

function sameGroup(a, b) {
  return CONFUSABLE_GROUPS.some((g) => g.includes(a) && g.includes(b));
}

/**
 * Compare heard letters with the target.
 * Returns 'correct' | 'confirm' (only confusable letters differ) | 'wrong'.
 */
export function compareLetters(heard, target) {
  const t = lettersOnly(target);
  const h = lettersOnly(heard);
  if (h === t) return 'correct';
  if (h.length !== t.length || h.length === 0) return 'wrong';
  let diffs = 0;
  for (let i = 0; i < t.length; i++) {
    if (h[i] === t[i]) continue;
    if (SAME_SOUND.some((g) => g.includes(h[i]) && g.includes(t[i]))) continue;
    if (!sameGroup(h[i], t[i])) return 'wrong';
    diffs++;
  }
  if (diffs === 0) return 'correct';
  return diffs <= MAX_CONFUSABLE ? 'confirm' : 'wrong';
}

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/**
 * Score every recognition alternative; accept if any one matches.
 * Returns { result, heard, transcript, americanNote }.
 */
export function scoreAlternatives(transcripts, target) {
  const t = lettersOnly(target);
  const scored = transcripts
    .filter((s) => s && String(s).trim())
    .map((transcript) => {
      const heard = transcriptToLetters(transcript, target);
      return { transcript, heard, result: compareLetters(heard, target) };
    });
  if (scored.length === 0) return { result: 'wrong', heard: '', transcript: '', americanNote: null };
  const rank = { correct: 0, confirm: 1, wrong: 2 };
  scored.sort((a, b) => rank[a.result] - rank[b.result] || editDistance(a.heard, t) - editDistance(b.heard, t));
  const best = scored[0];
  const americanNote = best.result === 'wrong' && AMERICAN[best.heard] === t ? `British spelling: ${target}` : null;
  return { ...best, americanNote };
}

/** Score typed input (Type mode). Spaces/case ignored. */
export function scoreTyped(input, target) {
  const heard = lettersOnly(input);
  const result = heard === lettersOnly(target) ? 'correct' : 'wrong';
  const americanNote = result === 'wrong' && AMERICAN[heard] === lettersOnly(target) ? `British spelling: ${target}` : null;
  return { result, heard, transcript: input, americanNote };
}

/**
 * Which letters of the target were missed? Returns [{ch, ok}] for the target,
 * aligned with the heard letters by edit distance. Spaces are kept as-is.
 */
export function diffTarget(target, heard) {
  const t = String(target).toLowerCase();
  const tl = lettersOnly(t);
  const h = lettersOnly(heard);
  const n = tl.length, m = h.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (tl[i - 1] === h[j - 1] ? 0 : 1));
    }
  }
  const okAt = new Array(n).fill(false);
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (tl[i - 1] === h[j - 1] && dp[i][j] === dp[i - 1][j - 1]) { okAt[i - 1] = true; i--; j--; }
    else if (dp[i][j] === dp[i - 1][j - 1] + 1) { i--; j--; }
    else if (dp[i][j] === dp[i - 1][j] + 1) { i--; }
    else { j--; }
  }
  // Extra letters at the end (e.g. "enoughh") mark the last letter as wrong.
  const out = [];
  let k = 0;
  for (const ch of String(target)) {
    if (/[a-z]/i.test(ch)) { out.push({ ch, ok: okAt[k] }); k++; }
    else out.push({ ch, ok: true });
  }
  if (m > n && out.length) {
    const last = out.map((x, idx) => (/[a-z]/i.test(x.ch) ? idx : -1)).filter((x) => x >= 0).pop();
    out[last].ok = false;
  }
  return out;
}

/**
 * Align what was heard with the target, column by column, for the two-row
 * "you / correct" display. Each column is {t, h}: t = target letter (null if the
 * child added an extra letter), h = heard letter (null if missing), gap = word space.
 */
export function alignLetters(target, heard) {
  const t = lettersOnly(target);
  const h = lettersOnly(heard);
  const n = t.length, m = h.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (t[i - 1] === h[j - 1] ? 0 : 1));
    }
  }
  // Show the target with its own capitals ("Wednesday"); compare in lower case.
  const shown = [...String(target)].filter((ch) => /[a-z]/i.test(ch));
  const cols = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (t[i - 1] === h[j - 1] ? 0 : 1)) {
      cols.push({ t: t[i - 1], h: h[j - 1], ti: i - 1 }); i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      cols.push({ t: t[i - 1], h: null, ti: i - 1 }); i--;
    } else {
      cols.push({ t: null, h: h[j - 1], ti: i - 1 }); j--;
    }
  }
  cols.reverse();
  // Put the word spaces of two-word entries back ("ice cream").
  const spaceAfter = new Set();
  let k = -1;
  for (const ch of String(target)) {
    if (/[a-z]/i.test(ch)) k++;
    else if (ch === ' ') spaceAfter.add(k);
  }
  const out = [];
  cols.forEach((c, idx) => {
    out.push({ t: c.t === null ? null : shown[c.ti], h: c.h, ok: c.t !== null && c.t === c.h });
    const next = cols[idx + 1];
    if (c.t !== null && spaceAfter.has(c.ti) && !(next && next.t === null)) out.push({ gap: true });
  });
  return out;
}
