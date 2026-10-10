// Decks and session picking (Leitner boxes 1–5, 0 = never asked).
import { wordState } from './store.js';

export const RANGES = [
  ['A–B', 'ab'], ['C–D', 'cd'], ['E–F', 'ef'], ['G–I', 'ghi'], ['J–M', 'jklm'],
  ['N–R', 'nopqr'], ['S', 's'], ['T–V', 'tuv'], ['W–Z', 'wxyz'],
];

// How likely a word in each box is to be picked: mostly 1–2, some 3, rarely 4–5.
const BOX_WEIGHT = { 0: 3, 1: 8, 2: 5, 3: 2, 4: 0.6, 5: 0.25 };

export function buildDecks(data, progress) {
  const all = data.words;
  const focus = data.focus.map((f) => f.word);
  const mistakes = all.filter((w) => {
    const s = wordState(progress, w);
    return s.wrong > 0 && s.box < 5;
  });
  const decks = [
    { id: 'focus', name: '⭐ Focus', hint: 'The circled words', words: focus },
    { id: 'mistakes', name: '🔁 Mistakes', hint: 'Words you got wrong before', words: mistakes },
    { id: 'all', name: '📚 All words', hint: 'The whole list', words: all },
  ];
  for (const [name, letters] of RANGES) {
    decks.push({ id: `range-${letters}`, name: `🔤 ${name}`, hint: `Words starting with ${name}`, words: all.filter((w) => letters.includes(w[0].toLowerCase())) });
  }
  return decks;
}

/** Focus first: until every focus word reaches box 3, the Focus deck is the default. */
export function defaultDeckId(data, progress) {
  const focusDone = data.focus.every((f) => wordState(progress, f.word).box >= 3);
  return focusDone ? 'all' : 'focus';
}

/** Weighted pick without replacement. `rand` is injectable for tests. */
export function pickSession(words, progress, size, rand = Math.random) {
  const pool = words.map((w) => ({ w, weight: BOX_WEIGHT[wordState(progress, w).box] ?? 1 }));
  const out = [];
  while (out.length < size && pool.length) {
    const total = pool.reduce((s, x) => s + x.weight, 0);
    let r = rand() * total;
    let i = 0;
    while (i < pool.length - 1 && r >= pool[i].weight) {
      r -= pool[i].weight;
      i++;
    }
    out.push(pool[i].w);
    pool.splice(i, 1);
  }
  return out;
}

export function stars(firstTryRight, total) {
  if (!total) return 0;
  const r = firstTryRight / total;
  return r >= 0.9 ? 3 : r >= 0.7 ? 2 : r >= 0.4 ? 1 : 0;
}
