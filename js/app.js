import { scoreAlternatives, scoreTyped, alignLetters, lettersOnly, transcriptToLetters } from './normalize.js';
import * as store from './store.js';
import { buildDecks, defaultDeckId, pickSession, stars } from './decks.js';
import * as speech from './speech.js';
import { sound } from './sound.js';
import { mountBee, setMood } from './bee.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['onboarding', 'home', 'decks-screen', 'play', 'end', 'settings', 'parent'];
const REQUEUE_GAP = 3;   // a missed word comes back after this many words
const MAX_REQUEUE = 2;   // ...at most this many times per session
const PRAISE = ['Brilliant!', 'Correct!', 'Well done!', 'Great!', 'Super!', 'Spot on!', 'Fantastic!'];

let data = { words: [], focus: [] };
let hints = {};
let progress = store.loadProgress();
let settings = store.loadSettings();
let session = null;
let listener = null;
let spellToken = 0;      // bumps to cancel a running letter-by-letter spell-out or a pending auto-listen

// ---------- helpers ----------

function show(screen) {
  for (const s of SCREENS) $(s).hidden = s !== screen;
  window.scrollTo(0, 0);
}

function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

function save() {
  if (!store.saveProgress(progress)) toast('Progress could not be saved on this device');
}

function saveSettings() {
  store.saveSettings(settings);
  sound.enabled = settings.sounds !== false;
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}

function spaced(letters) {
  return [...letters].join('-');
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function maskWord(text, word) {
  if (!text) return '';
  const parts = String(word).split(' ').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return text.replace(new RegExp(`\\b${parts.join('\\s*')}\\w*`, 'gi'), '_____');
}

function bee(id, mood) {
  const slot = $(id);
  if (slot) mountBee(slot, mood);
}

// ---------- letter tiles ----------

function tile(ch, cls = '') {
  return el('span', { class: `tile ${cls}`.trim() }, ch || '');
}

function setColumns(box, n) {
  box.style.setProperty('--n', String(Math.max(1, n)));
}

/** Live tiles while the child spells: add only the new letters so they "drop in". */
function renderLive(box, letters) {
  if (letters.length < box.children.length || [...box.children].some((c, i) => c.textContent !== letters[i])) {
    box.replaceChildren();
  }
  for (let i = box.children.length; i < letters.length; i++) box.append(tile(letters[i], 'in'));
  setColumns(box, letters.length);
}

/** The two rows: what the child said, and the correct spelling, aligned column by column. */
function renderCompare(target, heard, { showYou = true, showWord = true, allOk = false } = {}) {
  const you = $('fb-you');
  const word = $('fb-word');
  you.replaceChildren();
  word.replaceChildren();
  $('fb-you-row').hidden = !showYou;
  word.parentElement.hidden = !showWord;
  if (!showWord) {
    // Only the heard letters (used when asking "did you say…?": never reveal the answer).
    for (const ch of heard) you.append(tile(ch));
    setColumns(you, heard.length);
    return;
  }
  const cols = alignLetters(target, showYou ? heard : lettersOnly(target));
  for (const c of cols) {
    if (c.gap) {
      you.append(tile('', 'gap'));
      word.append(tile('', 'gap'));
      continue;
    }
    const ok = allOk || c.ok;
    you.append(c.h === null ? tile('', 'empty') : tile(c.h, ok ? 'ok' : 'miss'));
    word.append(c.t === null ? tile('', 'empty') : tile(c.t, ok ? 'ok' : 'miss'));
  }
  setColumns(you, cols.length);
  setColumns(word, cols.length);
}

// ---------- home ----------

function currentDeck() {
  const decks = buildDecks(data, progress);
  const chosen = decks.find((d) => d.id === settings.deckId && d.words.length);
  return chosen || decks.find((d) => d.id === defaultDeckId(data, progress));
}

function greeting() {
  const h = new Date().getHours();
  const hello = h < 12 ? 'Good morning!' : h < 18 ? 'Good afternoon!' : 'Good evening!';
  if (!progress.days.length) return `${hello} Ready for your first words?`;
  if (progress.days.includes(store.today())) return 'Nice work today! One more round?';
  return store.streak(progress) > 0 ? `${hello} Keep your streak going!` : `${hello} Let's practise!`;
}

function renderHome() {
  const total = data.words.length;
  const learned = store.learnedCount(progress, data.words);
  $('learned').textContent = learned;
  $('total').textContent = total;
  $('learned-bar').style.width = `${total ? (100 * learned) / total : 0}%`;
  $('greeting').textContent = greeting();
  const st = store.streak(progress);
  const days = progress.days.length;
  $('streak').textContent = st > 0
    ? `🔥 ${plural(st, 'day')} in a row · ${plural(days, 'day')} of practice`
    : days ? `${plural(days, 'day')} of practice` : '';
  $('streak').hidden = !$('streak').textContent;

  const deck = currentDeck();
  const n = Math.min(Number(settings.sessionSize) || 20, deck.words.length);
  $('start-sub').textContent = `${deck.name} · ${plural(n, 'word')}`;
  bee('home-bee', 'idle');
}

function renderDecks() {
  const decks = buildDecks(data, progress);
  const auto = decks.find((d) => d.id === defaultDeckId(data, progress));
  const rows = [{ id: '', name: '✨ Smart pick', hint: `Focus words first, then all words. Today: ${auto.name.replace(/^\S+ /, '')}.`, words: auto.words }, ...decks];
  $('decks').replaceChildren(...rows.map((d) => {
    const learned = store.learnedCount(progress, d.words);
    const b = el('button', { type: 'button', class: 'deck', role: 'radio', 'aria-checked': String(d.id === (settings.deckId || '')), 'data-deck': d.id || 'auto' },
      el('b', {}, d.name),
      el('small', {}, d.id ? `${learned} / ${d.words.length}` : ''),
      el('span', { class: 'deck-hint' }, d.hint || ''));
    if (d.id) {
      const fill = el('div', { class: 'bar-fill' });
      fill.style.width = `${d.words.length ? (100 * learned) / d.words.length : 0}%`;
      b.append(el('div', { class: 'bar' }, fill));
    }
    if (!d.words.length) b.disabled = true;
    b.addEventListener('click', () => {
      settings.deckId = d.id;
      saveSettings();
      renderHome();
      show('home');
    });
    return b;
  }));
}

// ---------- onboarding ----------

let onbStep = 0;
let onbListener = null;

function lastOnbStep() {
  return speech.sttAvailable ? 2 : 1;
}

function showOnboarding() {
  onbStep = 0;
  renderOnboarding();
  show('onboarding');
}

function renderOnboarding() {
  document.querySelectorAll('.onb-step').forEach((s, i) => { s.hidden = i !== onbStep; });
  document.querySelectorAll('.onb-dots span').forEach((d, i) => {
    d.classList.toggle('on', i === onbStep);
    d.hidden = i > lastOnbStep();
  });
  $('onb-next').textContent = onbStep >= lastOnbStep() ? "Let's go! 🚀" : 'Next ▶';
  const slot = document.querySelector(`.onb-step[data-step="${onbStep}"] .bee-slot`);
  if (slot) mountBee(slot, slot.dataset.bee);
}

function onboardingNext() {
  sound.unlock();
  onbListener?.abort();
  onbListener = null;
  if (onbStep >= lastOnbStep()) return finishOnboarding();
  onbStep++;
  renderOnboarding();
  if (onbStep === 1) speech.speak('Say the word. Spell it. Say it again.', settings.rate);
}

function finishOnboarding() {
  onbListener?.abort();
  onbListener = null;
  speech.stopSpeaking();
  settings.onboarded = true;
  saveSettings();
  renderHome();
  show('home');
}

function onboardingMic() {
  if (onbListener) { onbListener.stop(); return; }
  sound.unlock();
  const tiles = $('onb-tiles');
  tiles.replaceChildren();
  $('onb-mic').textContent = '👂 Listening… tap when done';
  $('onb-mic-msg').textContent = '';
  const slot = document.querySelector('.onb-step[data-step="2"] .bee-slot');
  onbListener = new speech.Listener();
  onbListener.start({
    onInterim: (t) => renderLive(tiles, transcriptToLetters(t, 'cat', { live: true })),
    onDone: ({ candidates, error }) => {
      onbListener = null;
      $('onb-mic').textContent = '🎤 Try again';
      if (error) {
        $('onb-mic-msg').textContent = 'The microphone is blocked. Allow it for this site in Safari (aA → Website Settings), or use Type mode.';
        setMood(slot, 'sad');
        return;
      }
      const r = scoreAlternatives(candidates, 'cat');
      if (r.result === 'correct') {
        $('onb-mic-msg').textContent = '🎉 Perfect! I heard c-a-t. You are ready!';
        setMood(slot, 'happy');
        sound.good();
      } else {
        $('onb-mic-msg').textContent = r.heard
          ? `I heard: ${spaced(r.heard)}. That's OK. Speak clearly, with a short pause between letters.`
          : "I didn't hear anything. Try again a bit louder.";
        setMood(slot, 'think');
      }
    },
  });
}

// ---------- session ----------

function startSession({ exam = false, words = null } = {}) {
  sound.unlock();
  const deck = currentDeck();
  const list = words || pickSession(deck.words, progress, Number(settings.sessionSize) || 20);
  if (!list.length) { toast('No words in this deck yet'); return; }
  session = {
    exam,
    deckId: deck.id,
    words: list,
    queue: [...list],
    pos: 0,
    requeued: {},
    first: {},       // word -> true/false/'skip' on the first try
    mode: settings.inputMode,
    combo: 0,
    bestCombo: 0,
    autoBlocked: false,
    current: null,
    answered: false,
  };
  show('play');
  $('exam-badge').hidden = !exam;
  $('h-slow').hidden = exam;
  $('h-skip').hidden = exam;
  $('hints').style.gridTemplateColumns = `repeat(${exam ? 3 : 5}, 1fr)`;
  renderCombo();
  nextWord();
}

function renderProgress() {
  const total = session.words.length;
  const done = Object.keys(session.first).length;
  $('session-bar').style.width = `${(100 * done) / total}%`;
  const extra = session.queue.length - session.pos - (total - done) - (session.answered ? 1 : 0);
  $('counter').textContent = `${Math.min(done + (session.answered ? 0 : 1), total)} / ${total}${extra > 0 ? ` · 🔁 ${extra}` : ''}`;
}

function renderCombo(popIt = false) {
  const c = session.combo;
  $('combo').textContent = c >= 2 ? `🔥 ${c}` : '';
  if (popIt && c >= 2) {
    $('combo').classList.remove('pop');
    void $('combo').offsetWidth;
    $('combo').classList.add('pop');
  }
}

function nextWord() {
  stopAll();
  if (session.pos >= session.queue.length) return endSession();
  const word = session.current = session.queue[session.pos];
  session.answered = false;
  session.lastWrong = null;
  renderProgress();
  $('status').textContent = 'Listen…';
  $('hint-text').hidden = true;
  $('feedback').hidden = true;
  $('card').classList.remove('shake');
  $('live-tiles').replaceChildren();
  renderDots(word);
  showAnswerUI();
  bee('play-bee', 'idle');
  $('peek-word').hidden = true;
  $('peek-word').textContent = word;
  $('type-input').value = '';
  startTimer();
  speakThenAnswer(() => speech.speak(word, settings.rate));
}

/** Speak (word, sentence…), then hand the turn to the child; in voice mode the mic starts by itself. */
async function speakThenAnswer(say) {
  const word = session.current;
  stopListening(true);
  const token = ++spellToken;
  $('mic').classList.toggle('waiting', session.mode === 'voice');
  $('mic-label').textContent = '';
  await say();
  if (token !== spellToken || session?.current !== word || session.answered) return;
  $('mic').classList.remove('waiting');
  $('status').textContent = promptText();
  if (session.mode === 'type') $('type-input').focus();
  if (session.mode !== 'voice') return;
  if (settings.autoListen !== false && !session.autoBlocked) {
    await speech.pause(250);
    if (token === spellToken && session?.current === word && !session.answered) startListening({ auto: true });
  } else {
    $('mic-label').textContent = 'Tap 🎤, then say the word, spell it, say it again';
  }
}

function promptText() {
  if (session.mode === 'voice') return 'Your turn!';
  if (session.mode === 'type') return 'Type the word';
  return 'Spell it to your parent';
}

function renderDots(word) {
  const dots = $('dots');
  dots.replaceChildren();
  dots.hidden = !settings.showDots;
  if (!settings.showDots) return;
  for (const ch of word) dots.append(el('span', ch === ' ' ? { class: 'gap' } : {}));
}

function showAnswerUI() {
  const m = session.mode;
  $('voice-ui').hidden = m !== 'voice';
  $('type-ui').hidden = m !== 'type';
  $('parent-ui').hidden = m !== 'parent';
  setListening(false);
  for (const id of ['h-repeat', 'h-slow', 'h-sentence', 'h-meaning', 'h-skip']) $(id).disabled = false;
  const h = hintFor(session.current);
  $('h-sentence').disabled = !h?.sentence;
  $('h-meaning').disabled = !h?.meaning;
}

function hideAnswerUI() {
  $('voice-ui').hidden = true;
  $('type-ui').hidden = true;
  $('parent-ui').hidden = true;
  $('live-tiles').replaceChildren();
}

function stopAll() {
  spellToken++;
  speech.stopSpeaking();
  stopListening(true);
  stopTimer();
}

// ---------- timer (exam only) ----------

function startTimer() {
  stopTimer();
  const secs = Number(settings.examTimer) || 0;
  if (!session.exam || !secs) { $('timer').hidden = true; return; }
  const endAt = Date.now() + secs * 1000;
  $('timer').hidden = false;
  const tick = () => {
    const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    $('timer').textContent = `⏱ ${left}`;
    if (left > 0) return;
    stopTimer();
    if (session.answered) return;
    if (session.mode === 'voice' && listener) listener.stop();
    else if (session.mode === 'type') submitTyped(true);
    else applyResult(false, { heard: '', note: '⏱ Time is up' });
  };
  tick();
  session.timer = setInterval(tick, 250);
}

function stopTimer() {
  if (session?.timer) clearInterval(session.timer);
  if (session) session.timer = null;
}

// ---------- voice ----------

function setListening(on) {
  $('mic').classList.toggle('listening', on);
  $('mic').setAttribute('aria-label', on ? 'Stop listening' : 'Tap and spell');
  if (on) $('mic-label').textContent = 'Say the word · pause · spell it · say it again';
}

function startListening({ auto = false } = {}) {
  if (session.answered) return;
  if (listener) { listener.stop(); return; }   // tap while listening = done
  sound.unlock();
  spellToken++;
  speech.stopSpeaking();
  $('mic').classList.remove('waiting');
  const word = session.current;
  const tiles = $('live-tiles');
  tiles.replaceChildren();
  listener = new speech.Listener();
  setListening(true);
  bee('play-bee', 'listen');
  $('status').textContent = '🎤 Spell it!';
  listener.start({
    onInterim: (t) => renderLive(tiles, transcriptToLetters(t, word, { live: true })),
    onDone: ({ candidates, error }) => {
      listener = null;
      setListening(false);
      if (session?.current !== word || session.answered) return;
      if (error) {
        if (auto) {
          // iOS may refuse to start the mic without a tap: fall back to tapping.
          session.autoBlocked = true;
          bee('play-bee', 'idle');
          $('status').textContent = promptText();
          $('mic-label').textContent = 'Tap 🎤, then say the word, spell it, say it again';
          return;
        }
        toast('The microphone is not allowed. Switching to Type mode.', 4000);
        session.mode = 'type';
        settings.inputMode = 'type';
        saveSettings();
        showAnswerUI();
        $('status').textContent = promptText();
        return;
      }
      handleVoice(candidates);
    },
  });
}

function stopListening(abort = false) {
  if (!listener) return;
  if (abort) listener.abort();
  else listener.stop();
  listener = null;
  setListening(false);
}

function handleVoice(candidates) {
  const word = session.current;
  const r = scoreAlternatives(candidates, word);
  if (candidates.length) {
    store.logTranscript(progress, { word, mode: 'voice', candidates: candidates.slice(0, 8), heard: r.heard, result: r.result });
    save();
  }
  if (!candidates.length || !r.heard) {
    // Nothing heard: not a mistake. Wait for a tap (auto-listen would just time out again).
    bee('play-bee', 'think');
    $('live-tiles').replaceChildren();
    $('status').textContent = "I didn't hear you";
    $('mic-label').textContent = 'Tap 🎤 and spell it a bit louder';
    return;
  }
  if (r.result === 'correct') return applyResult(true, { heard: r.heard });
  if (r.result === 'confirm') {
    hideAnswerUI();
    bee('play-bee', 'think');
    $('status').textContent = 'Did you say…';
    // Show the reading in the child's favour (the letters only differ in sounds that are easy to mishear).
    showFeedback({ icon: '👂', compare: { target: word, heard: lettersOnly(word), showWord: false }, youLabel: 'I think I heard', confirm: true });
    session.pendingConfirm = r;
    return;
  }
  applyResult(false, { heard: r.heard, note: r.americanNote, retryAllowed: !session.exam });
}

// ---------- type / parent ----------

function submitTyped(timeUp = false) {
  if (session.answered) return;
  const r = scoreTyped($('type-input').value, session.current);
  if (!r.heard && !timeUp) { $('type-input').focus(); return; }
  applyResult(r.result === 'correct', { heard: r.heard, note: r.americanNote });
}

// ---------- results ----------

function applyResult(ok, { heard = '', note = '', retryAllowed = false } = {}) {
  if (session.answered) return;
  session.answered = true;
  stopTimer();
  spellToken++;
  const word = session.current;
  const firstTry = !(word in session.first);
  if (firstTry) session.first[word] = ok;
  store.recordAnswer(progress, word, ok, { heard, mode: session.mode, updateBox: firstTry || !ok });
  save();
  hideAnswerUI();

  if (ok) {
    renderProgress();
    session.combo++;
    session.bestCombo = Math.max(session.bestCombo, session.combo);
    renderCombo(true);
    if ([5, 10, 15, 20].includes(session.combo)) toast(`${session.combo} in a row! 🔥`);
    sound.good();
    bee('play-bee', 'happy');
    $('status').textContent = PRAISE[Math.floor(Math.random() * PRAISE.length)];
    showFeedback({ icon: '✅', compare: { target: word, heard: lettersOnly(word), showYou: false, allOk: true }, next: true });
    setTimeout(() => { if (session?.current === word && session.answered) advance(); }, 1400);
    return;
  }

  session.combo = 0;
  renderCombo();
  sound.bad();
  bee('play-bee', 'sad');
  $('card').classList.add('shake');
  $('status').textContent = 'Not quite. Look:';
  showFeedback({
    icon: '❌',
    compare: { target: word, heard, showYou: !!heard },
    youLabel: session.mode === 'type' ? 'You typed' : 'I heard',
    note,
    next: true,
    retry: retryAllowed && session.mode === 'voice',
    retryLabel: '🙉 Misheard me',
  });
  session.lastWrong = { word, firstTry, requeuedAt: -1 };
  if (!session.exam) {
    const count = session.requeued[word] || 0;
    if (count < MAX_REQUEUE) {
      session.requeued[word] = count + 1;
      const at = Math.min(session.queue.length, session.pos + 1 + REQUEUE_GAP);
      session.queue.splice(at, 0, word);
      session.lastWrong.requeuedAt = at;
    }
    spellSlowly(word);
  }
  renderProgress();
}

async function spellSlowly(word) {
  const token = ++spellToken;
  const tiles = [...$('fb-word').children].filter((t) => !t.classList.contains('gap') && !t.classList.contains('empty'));
  await speech.speak(word, settings.slowRate);
  if (token !== spellToken) return;
  let k = -1;
  const tileAt = [...word].map((ch) => (ch === ' ' ? -1 : ++k));
  await speech.spellOut(word, settings.slowRate, (i) => {
    tiles.forEach((t, idx) => t.classList.toggle('now', i >= 0 && idx === tileAt[i]));
  }, () => token !== spellToken);
}

function showFeedback({ icon, compare = null, youLabel = 'You', note = '', confirm = false, next = false, retry = false, retryLabel = '🎤 Try again' }) {
  $('feedback').hidden = false;
  const i = $('fb-icon');
  i.textContent = icon;
  i.classList.remove('pop');
  void i.offsetWidth;
  i.classList.add('pop');
  $('fb-compare').hidden = !compare;
  if (compare) renderCompare(compare.target, compare.heard, compare);
  $('fb-you-label').textContent = youLabel;
  $('fb-heard').textContent = '';
  $('fb-note').textContent = note || '';
  $('fb-confirm').hidden = !confirm;
  $('fb-retry').hidden = !retry;
  $('retry').textContent = retryLabel;
  $('next').hidden = !next;
}

function advance() {
  if (!session) return;
  session.pos++;
  nextWord();
}

/**
 * "It misheard me" after a wrong voice answer: the speech engine was wrong, not the child.
 * Undo the mistake, keep the word in the queue so it is asked again later, and move on.
 */
function undoMishear() {
  const word = session.current;
  const lw = session.lastWrong;
  if (!session.answered || lw?.word !== word) return;
  const st = progress.words[word];
  if (st) {
    st.history.pop();
    st.wrong = Math.max(0, st.wrong - 1);
    st.box = st.prevBox ?? st.box;
  }
  if (lw.firstTry) delete session.first[word];
  if (lw.requeuedAt < 0) session.queue.splice(Math.min(session.queue.length, session.pos + 1 + REQUEUE_GAP), 0, word);
  session.lastWrong = null;
  save();
  toast('OK, not counted. This word will come again later.');
  advance();
}

function endSession() {
  stopAll();
  const total = session.words.length;
  const right = session.words.filter((w) => session.first[w] === true).length;
  const s = stars(right, total);
  const prev = [...(progress.sessions || [])].reverse().find((x) => !!x.exam === session.exam && x.total > 0);
  progress.sessions = [...(progress.sessions || []), { t: Date.now(), exam: session.exam, total, right, deck: session.deckId, bestCombo: session.bestCombo }].slice(-200);
  save();
  $('end-title').textContent = s === 3 ? 'Amazing! 🎉' : s === 2 ? 'Great job! 👏' : s === 1 ? 'Good work! 💪' : 'Keep practising! 💪';
  $('end-stars').replaceChildren(...[0, 1, 2].map((i) => el('span', {}, i < s ? '⭐' : '☆')));
  $('end-score').textContent = `${right} of ${total} right the first time`;
  // Only good news here: a worse score than last time is not mentioned.
  const notes = [];
  if (prev) {
    const now = right / total;
    const before = prev.right / prev.total;
    if (now > before + 0.001) notes.push(`Better than last time: ${prev.right}/${prev.total} → ${right}/${total} 📈`);
    else if (Math.abs(now - before) <= 0.001) notes.push('Same as last time. Keep going!');
  }
  if (session.bestCombo >= 3) notes.push(`Best run: 🔥 ${session.bestCombo} in a row`);
  $('end-compare').textContent = notes.join(' · ');
  const repeat = session.words.filter((w) => session.first[w] !== true);
  $('end-repeat').replaceChildren(...repeat.map((w) => el('button', { type: 'button', class: 'word-card', onclick: () => speech.speak(w, settings.rate) }, w)));
  $('end-repeat-wrap').hidden = !repeat.length;
  $('again').hidden = !repeat.length;
  session.repeat = repeat;
  show('end');
  bee('end-bee', s >= 2 ? 'happy' : s === 1 ? 'idle' : 'think');
  if (s >= 2) sound.fanfare();
}

// ---------- hints ----------

function hintFor(word) {
  return hints[word] || hints[word?.toLowerCase()] || null;
}

function showHint(kind) {
  const h = hintFor(session.current);
  if (!h) return;
  const text = kind === 'sentence' ? h.sentence : h.meaning;
  $('hint-text').hidden = false;
  $('hint-text').textContent = (kind === 'sentence' ? '📖 ' : '❓ ') + maskWord(text, session.current);
  if (session.answered) { spellToken++; speech.stopSpeaking(); speech.speak(text, settings.rate); return; }
  speakThenAnswer(() => speech.speak(text, settings.rate));
}

function repeatWord(slow) {
  const rate = slow ? settings.slowRate : settings.rate;
  if (session.answered) { spellToken++; speech.stopSpeaking(); speech.speak(session.current, rate); return; }
  $('status').textContent = slow ? '🐢 Listen…' : 'Listen…';
  bee('play-bee', 'idle');
  speakThenAnswer(() => speech.speak(session.current, rate));
}

// ---------- settings ----------

async function renderSettings() {
  for (const b of $('input-modes').querySelectorAll('button')) {
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(b.dataset.mode === settings.inputMode));
    b.disabled = b.dataset.mode === 'voice' && !speech.sttAvailable;
  }
  $('set-automic').checked = settings.autoListen !== false;
  $('set-automic').disabled = settings.inputMode !== 'voice';
  $('set-rate').value = settings.rate;
  $('set-slow').value = settings.slowRate;
  $('out-rate').textContent = settings.rate;
  $('out-slow').textContent = settings.slowRate;
  $('set-size').value = String(settings.sessionSize);
  $('set-dots').checked = !!settings.showDots;
  $('set-sounds').checked = settings.sounds !== false;
  $('set-timer').value = String(settings.examTimer);
  await speech.loadVoices();
  const sel = $('set-voice');
  const list = speech.englishVoices();
  sel.replaceChildren(...list.map((v) => el('option', { value: v.voiceURI }, `${v.name} (${v.lang})`)));
  const chosen = speech.chooseVoice(settings.voiceURI);
  if (chosen) sel.value = chosen.voiceURI;
  $('voice-note').textContent = list.length
    ? (list.some((v) => /en[-_]gb/i.test(v.lang)) ? '' : 'No British voice found. On iPhone: Settings → Accessibility → Spoken Content → Voices → English → add Daniel or Serena.')
    : 'No English voices found on this device.';
}

function bindSettings() {
  const upd = (fn) => () => { fn(); saveSettings(); };
  for (const b of $('input-modes').querySelectorAll('button')) {
    b.addEventListener('click', () => { settings.inputMode = b.dataset.mode; saveSettings(); renderSettings(); });
  }
  $('set-automic').addEventListener('change', upd(() => { settings.autoListen = $('set-automic').checked; }));
  $('set-voice').addEventListener('change', upd(() => { settings.voiceURI = $('set-voice').value; speech.chooseVoice(settings.voiceURI); }));
  $('set-rate').addEventListener('input', upd(() => { settings.rate = Number($('set-rate').value); $('out-rate').textContent = settings.rate; }));
  $('set-slow').addEventListener('input', upd(() => { settings.slowRate = Number($('set-slow').value); $('out-slow').textContent = settings.slowRate; }));
  $('set-size').addEventListener('change', upd(() => { settings.sessionSize = Number($('set-size').value); }));
  $('set-dots').addEventListener('change', upd(() => { settings.showDots = $('set-dots').checked; }));
  $('set-sounds').addEventListener('change', upd(() => { settings.sounds = $('set-sounds').checked; }));
  $('set-timer').addEventListener('change', upd(() => { settings.examTimer = Number($('set-timer').value); }));
  $('test-voice').addEventListener('click', () => speech.speak('Spell the word: beautiful.', settings.rate));
  $('show-tutorial').addEventListener('click', showOnboarding);
}

// ---------- parent ----------

function openParent() {
  const a = 3 + Math.floor(Math.random() * 7);
  const b = 12 + Math.floor(Math.random() * 18);
  $('gate').dataset.answer = String(a * b);
  $('gate-q').textContent = `Grown-ups only: ${a} × ${b} = ?`;
  $('gate-answer').value = '';
  $('gate').hidden = false;
  $('parent-body').hidden = true;
  show('parent');
}

function renderParent() {
  const words = data.words;
  const seen = words.filter((w) => progress.words[w]);
  const answers = seen.reduce((s, w) => s + progress.words[w].right + progress.words[w].wrong, 0);
  const boxes = [0, 0, 0, 0, 0, 0];
  for (const w of words) boxes[store.wordState(progress, w).box]++;
  $('parent-summary').textContent = `Practised ${seen.length} of ${words.length} words, ${answers} answers, ${progress.days.length} days. Boxes: new ${boxes[0]} · 1: ${boxes[1]} · 2: ${boxes[2]} · 3: ${boxes[3]} · 4: ${boxes[4]} · learned: ${boxes[5]}.`;

  const hardest = seen
    .map((w) => ({ w, ...progress.words[w] }))
    .filter((x) => x.wrong > 0)
    .sort((a, b) => b.wrong - a.wrong || a.box - b.box)
    .slice(0, 20);
  $('hardest').replaceChildren(...(hardest.length
    ? hardest.map((x) => el('li', {}, `${x.w} — ❌ ${x.wrong} · ✅ ${x.right} · box ${x.box}`))
    : [el('li', {}, 'No mistakes yet.')]));

  renderWordHistory();

  const tr = progress.transcripts.slice(-100).reverse();
  $('transcripts').replaceChildren(...(tr.length
    ? tr.map((x) => el('div', {},
      el('b', { class: x.result === 'correct' ? 'hist-ok' : 'hist-bad' }, `${x.word} `),
      `→ ${spaced(x.heard || '')} (${x.result}) `,
      el('br'),
      el('code', {}, (x.candidates || []).map((c) => `“${c}”`).join(' | '))))
    : [el('div', {}, 'No voice answers yet.')]));
}

function renderWordHistory() {
  const q = lettersOnly($('word-search').value);
  const box = $('word-history');
  if (!q) { box.replaceChildren(); return; }
  const matches = data.words.filter((w) => lettersOnly(w).startsWith(q)).slice(0, 8);
  box.replaceChildren(...matches.map((w) => {
    const st = store.wordState(progress, w);
    const hist = st.history.slice().reverse().map((h) => el('div', { class: h.ok ? 'hist-ok' : 'hist-bad' },
      `${new Date(h.t).toLocaleString()} ${h.ok ? '✅' : '❌'} ${h.heard ? spaced(h.heard) : ''} ${h.mode || ''}`));
    return el('div', { class: 'note' }, el('b', {}, `${w}: box ${st.box}, ✅ ${st.right}, ❌ ${st.wrong}`), ...hist);
  }));
}

function bindParent() {
  $('gate').addEventListener('submit', (e) => {
    e.preventDefault();
    if ($('gate-answer').value.trim() === $('gate').dataset.answer) {
      $('gate').hidden = true;
      $('parent-body').hidden = false;
      renderParent();
    } else {
      toast('Not quite!');
      $('gate-answer').value = '';
    }
  });
  $('word-search').addEventListener('input', renderWordHistory);
  $('export').addEventListener('click', () => {
    const blob = new Blob([store.exportJSON(progress)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `spelling-bee-progress-${store.today()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  $('copy-export').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(store.exportJSON(progress));
      $('sync-msg').textContent = 'Copied. Paste it into a note or message and save it as a .json file on the other device.';
    } catch {
      $('sync-msg').textContent = 'Copy is not allowed here; use Export.';
    }
  });
  $('import').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      progress = store.importJSON(progress, await f.text());
      save();
      renderParent();
      $('sync-msg').textContent = 'Imported and merged ✔';
    } catch (err) {
      $('sync-msg').textContent = `Could not import: ${err.message}`;
    }
    e.target.value = '';
  });
  $('reset').addEventListener('click', () => {
    if (!confirm('Delete all progress on this device?')) return;
    if (!confirm('Really? This cannot be undone. Export first if unsure.')) return;
    progress = store.emptyProgress();
    save();
    renderParent();
    toast('Progress reset');
  });
}

// ---------- wiring ----------

function goHome() {
  stopAll();
  session = null;
  renderHome();
  show('home');
}

function bind() {
  $('onb-next').addEventListener('click', onboardingNext);
  $('onb-skip').addEventListener('click', finishOnboarding);
  $('onb-mic').addEventListener('click', onboardingMic);

  $('start-practice').addEventListener('click', () => startSession());
  $('start-exam').addEventListener('click', () => startSession({ exam: true }));
  $('open-decks').addEventListener('click', () => { renderDecks(); show('decks-screen'); });
  $('open-settings').addEventListener('click', async () => { await renderSettings(); show('settings'); });
  $('open-parent').addEventListener('click', openParent);
  for (const b of document.querySelectorAll('.back')) b.addEventListener('click', goHome);

  $('quit').addEventListener('click', () => {
    const answered = Object.keys(session.first).length;
    if (!answered) return goHome();
    if (!confirm('Finish this session now?')) return;
    stopAll();
    session.words = session.words.filter((w) => w in session.first);
    endSession();
  });
  $('mic').addEventListener('click', () => startListening());
  $('type-ui').addEventListener('submit', (e) => { e.preventDefault(); submitTyped(); });
  $('peek').addEventListener('click', () => { $('peek-word').hidden = !$('peek-word').hidden; });
  $('parent-yes').addEventListener('click', () => applyResult(true, { heard: lettersOnly(session.current) }));
  $('parent-no').addEventListener('click', () => applyResult(false, {}));
  $('confirm-yes').addEventListener('click', () => { session.pendingConfirm = null; applyResult(true, { heard: lettersOnly(session.current) }); });
  $('confirm-no').addEventListener('click', () => {
    const r = session.pendingConfirm;
    session.pendingConfirm = null;
    applyResult(false, { heard: r?.heard || '' });
  });
  $('retry').addEventListener('click', undoMishear);
  $('next').addEventListener('click', advance);

  $('h-repeat').addEventListener('click', () => repeatWord(false));
  $('h-slow').addEventListener('click', () => repeatWord(true));
  $('h-sentence').addEventListener('click', () => showHint('sentence'));
  $('h-meaning').addEventListener('click', () => showHint('meaning'));
  $('h-skip').addEventListener('click', () => {
    const w = session.current;
    if (!(w in session.first)) session.first[w] = 'skip';
    session.combo = 0;
    renderCombo();
    advance();
  });

  $('again').addEventListener('click', () => startSession({ exam: false, words: session.repeat }));
  $('home-btn').addEventListener('click', goHome);
  bindSettings();
  bindParent();

  document.addEventListener('visibilitychange', () => { if (document.hidden) stopListening(true); });
}

async function loadJSON(url, fallback) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch {
    return fallback;
  }
}

async function init() {
  sound.enabled = settings.sounds !== false;
  data = await loadJSON('data/words.json', { words: [], focus: [] });
  hints = await loadJSON('data/hints.json', {});
  if (!speech.sttAvailable) {
    if (settings.inputMode === 'voice') settings.inputMode = 'type';
    $('stt-note').hidden = false;
    $('stt-note').textContent = 'Voice answers are not available in this browser, so we use Type mode. On iPhone/iPad use Safari; on a computer use Chrome or Safari.';
  }
  speech.loadVoices().then(() => speech.chooseVoice(settings.voiceURI));
  bind();
  if (!settings.onboarded) showOnboarding();
  else { renderHome(); show('home'); }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
