import { scoreAlternatives, scoreTyped, diffTarget, lettersOnly } from './normalize.js';
import * as store from './store.js';
import { buildDecks, defaultDeckId, pickSession, stars } from './decks.js';
import * as speech from './speech.js';
import { sound } from './sound.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['home', 'play', 'end', 'settings', 'parent'];
const REQUEUE_GAP = 3;   // a missed word comes back after this many words
const MAX_REQUEUE = 2;   // ...at most this many times per session

let data = { words: [], focus: [] };
let hints = {};
let progress = store.loadProgress();
let settings = store.loadSettings();
let deckId = null;
let session = null;
let listener = null;
let spellToken = 0;      // bumps to cancel a running letter-by-letter spell-out

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

function maskWord(text, word) {
  if (!text) return '';
  const parts = String(word).split(' ').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return text.replace(new RegExp(`\\b${parts.join('\\s*')}\\w*`, 'gi'), '_____');
}

// ---------- home ----------

function renderHome() {
  const total = data.words.length;
  const learned = store.learnedCount(progress, data.words);
  $('learned').textContent = learned;
  $('total').textContent = total;
  $('learned-bar').style.width = `${total ? (100 * learned) / total : 0}%`;
  const st = store.streak(progress);
  const days = progress.days.length;
  $('streak').textContent = st > 0 ? `🔥 ${st} day${st > 1 ? 's' : ''} in a row · ${days} day${days > 1 ? 's' : ''} of practice` : days ? `${days} day${days > 1 ? 's' : ''} of practice. Let's go!` : 'First practice today? Let’s go!';

  const decks = buildDecks(data, progress);
  if (!deckId || !decks.some((d) => d.id === deckId)) deckId = defaultDeckId(data, progress);
  const box = $('decks');
  box.replaceChildren();
  for (const d of decks) {
    const learnedInDeck = store.learnedCount(progress, d.words);
    const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(d.id === deckId), 'data-deck': d.id }, d.name, el('small', {}, `${learnedInDeck}/${d.words.length}`));
    if (!d.words.length) b.disabled = true;
    b.addEventListener('click', () => { deckId = d.id; renderHome(); });
    box.append(b);
  }

  for (const b of $('input-modes').querySelectorAll('button')) {
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(b.dataset.mode === settings.inputMode));
    b.disabled = b.dataset.mode === 'voice' && !speech.sttAvailable;
  }
}

function setInputMode(mode) {
  settings.inputMode = mode;
  store.saveSettings(settings);
  renderHome();
}

// ---------- session ----------

function startSession({ exam = false, words = null } = {}) {
  sound.unlock();
  const deck = buildDecks(data, progress).find((d) => d.id === deckId);
  const list = words || pickSession(deck.words, progress, Number(settings.sessionSize) || 20);
  if (!list.length) { toast('No words in this deck yet'); return; }
  session = {
    exam,
    words: list,
    queue: [...list],
    pos: 0,
    requeued: {},
    first: {},       // word -> true/false/'skip' on the first try
    mode: settings.inputMode,
    current: null,
    answered: false,
  };
  show('play');
  $('exam-badge').hidden = !exam;
  $('h-slow').hidden = exam;
  $('h-skip').hidden = exam;
  $('hints').style.gridTemplateColumns = `repeat(${exam ? 3 : 5}, 1fr)`;
  nextWord();
}

function remaining() {
  return session.queue.length - session.pos;
}

function nextWord() {
  stopAll();
  if (session.pos >= session.queue.length) return endSession();
  const word = session.queue[session.pos];
  session.current = word;
  session.answered = false;
  session.lastWrong = null;
  const firstTimes = session.words.length;
  const done = Object.keys(session.first).length;
  $('counter').textContent = `${Math.min(done + 1, firstTimes)} / ${firstTimes}${remaining() > firstTimes - done ? ' 🔁' : ''}`;
  $('score').textContent = `✅ ${Object.values(session.first).filter((v) => v === true).length}`;
  $('status').textContent = 'Listen…';
  $('hint-text').hidden = true;
  $('feedback').hidden = true;
  $('card').classList.remove('shake');
  renderDots(word);
  showAnswerUI();
  $('peek-word').hidden = true;
  $('peek-word').textContent = word;
  $('type-input').value = '';
  startTimer();
  sayWord().then(() => {
    if (session?.current !== word || session.answered) return;
    $('status').textContent = promptText();
    if (session.mode === 'type') $('type-input').focus();
  });
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
  const h = hints[session.current] || hints[session.current?.toLowerCase()];
  $('h-sentence').disabled = !h?.sentence;
  $('h-meaning').disabled = !h?.meaning;
}

function hideAnswerUI() {
  $('voice-ui').hidden = true;
  $('type-ui').hidden = true;
  $('parent-ui').hidden = true;
}

async function sayWord(slow = false) {
  stopListening(true);
  $('status').textContent = slow ? '🐢 Listen…' : 'Listen…';
  await speech.speak(session.current, slow ? settings.slowRate : settings.rate);
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
    else if (session.mode === 'type') submitTyped();
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
  $('mic-done').hidden = !on;
  $('mic-label').textContent = on ? 'Listening… say the word, spell it, say it again' : 'Tap, then say the word, spell it, say it again';
}

function startListening() {
  if (session.answered) return;
  if (listener) { listener.stop(); return; }   // second tap = done
  sound.unlock();
  spellToken++;
  speech.stopSpeaking();
  const word = session.current;
  listener = new speech.Listener();
  setListening(true);
  $('status').textContent = '🎤 Listening…';
  listener.start({
    onInterim: () => { $('status').textContent = '🎤 Listening… 👂'; },
    onDone: ({ candidates, error }) => {
      listener = null;
      setListening(false);
      if (session?.current !== word || session.answered) return;
      if (error === 'not-allowed' || error === 'service-not-allowed' || error === 'unsupported') {
        toast('Microphone is not allowed. Switching to Type mode.', 4000);
        session.mode = 'type';
        setInputMode('type');
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
  store.logTranscript(progress, { word, mode: 'voice', candidates: candidates.slice(0, 8), heard: r.heard, result: r.result });
  save();
  if (!candidates.length || !r.heard) {
    // Nothing heard: not a mistake, let the child try again.
    $('status').textContent = "I didn't hear anything";
    hideAnswerUI();
    showFeedback({ icon: '🤔', word: '', heard: 'Try again a bit louder, or tap 🔊 to hear the word.', retry: true });
    return;
  }
  if (r.result === 'correct') return applyResult(true, { heard: r.heard });
  if (r.result === 'confirm') {
    hideAnswerUI();
    $('status').textContent = 'Did you say…';
    showFeedback({ icon: '👂', word: '', heard: `I heard: ${spaced(r.heard)}?`, confirm: true });
    session.pendingConfirm = r;
    return;
  }
  applyResult(false, { heard: r.heard, note: r.americanNote, retryAllowed: !session.exam });
}

// ---------- type / parent ----------

function submitTyped() {
  if (session.answered) return;
  const input = $('type-input').value;
  const r = scoreTyped(input, session.current);
  if (!r.heard && !session.exam) { $('type-input').focus(); return; }
  applyResult(r.result === 'correct', { heard: r.heard, note: r.americanNote });
}

// ---------- results ----------

function applyResult(ok, { heard = '', note = '', retryAllowed = false } = {}) {
  if (session.answered) return;
  session.answered = true;
  stopTimer();
  const word = session.current;
  const firstTry = !(word in session.first);
  if (firstTry) session.first[word] = ok;
  store.recordAnswer(progress, word, ok, { heard, mode: session.mode, updateBox: firstTry || !ok });
  save();
  hideAnswerUI();

  if (ok) {
    sound.good();
    $('status').textContent = ['Brilliant!', 'Correct!', 'Well done!', 'Great!', 'Super!'][Math.floor(Math.random() * 5)];
    showFeedback({ icon: '✅', word: renderWord(word, null), heard: '', next: true });
    setTimeout(() => { if (session?.current === word && session.answered) advance(); }, 1300);
    return;
  }

  sound.bad();
  $('card').classList.add('shake');
  $('status').textContent = 'Not quite. Look:';
  const heardText = !heard ? '' : session.mode === 'type' ? `You typed: ${heard}` : `I heard: ${spaced(heard)}`;
  showFeedback({ icon: '❌', word: renderWord(word, heard), heard: heardText, note, next: true, retry: retryAllowed && session.mode === 'voice', retryLabel: '🙉 It misheard me' });
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
}

function renderWord(word, heard) {
  const wrap = el('span');
  const marks = heard == null ? [...word].map((ch) => ({ ch, ok: true })) : diffTarget(word, heard);
  marks.forEach(({ ch, ok }) => wrap.append(el('span', ok ? {} : { class: 'miss' }, ch === ' ' ? ' ' : ch)));
  return wrap;
}

async function spellSlowly(word) {
  const token = ++spellToken;
  const spans = $('fb-word').querySelectorAll('span > span');
  await speech.speak(word, settings.slowRate);
  if (token !== spellToken) return;
  await speech.spellOut(word, settings.slowRate, (i) => {
    spans.forEach((s, k) => s.classList.toggle('now', k === i));
  }, () => token !== spellToken);
}

function showFeedback({ icon, word, heard = '', note = '', confirm = false, next = false, retry = false, retryLabel = '🎤 Try again' }) {
  $('feedback').hidden = false;
  const i = $('fb-icon');
  i.textContent = icon;
  i.classList.remove('pop');
  void i.offsetWidth;
  i.classList.add('pop');
  $('fb-word').replaceChildren(word || '');
  $('fb-heard').textContent = heard;
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
 * Retry button. Before an answer ("didn't hear anything"): listen again.
 * After a wrong voice answer ("It misheard me"): the speech engine was wrong, not the child.
 * Undo the mistake, keep the word in the queue so it is asked again later, and move on.
 */
function retryVoice() {
  const word = session.current;
  const lw = session.lastWrong;
  if (session.answered && lw?.word === word) {
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
    toast('OK, not counted. We will try this word again later.');
    advance();
    return;
  }
  session.answered = false;
  $('feedback').hidden = true;
  showAnswerUI();
  $('status').textContent = promptText();
  startListening();
}

function endSession() {
  stopAll();
  const total = session.words.length;
  const right = session.words.filter((w) => session.first[w] === true).length;
  const s = stars(right, total);
  progress.sessions = [...(progress.sessions || []), { t: Date.now(), exam: session.exam, total, right, deck: deckId }].slice(-200);
  save();
  $('end-title').textContent = s === 3 ? 'Amazing! 🎉' : s === 2 ? 'Great job! 👏' : s === 1 ? 'Good work! 💪' : 'Keep practising! 💪';
  $('end-stars').textContent = '⭐'.repeat(s) + '☆'.repeat(3 - s);
  $('end-score').textContent = `${right} of ${total} right the first time`;
  const repeat = session.words.filter((w) => session.first[w] !== true);
  const ul = $('end-repeat');
  ul.replaceChildren(...repeat.map((w) => el('li', {}, w)));
  $('end-repeat-wrap').hidden = !repeat.length;
  $('again').hidden = !repeat.length;
  session.repeat = repeat;
  if (s >= 2) sound.fanfare();
  show('end');
}

// ---------- hints ----------

function hintFor(word) {
  return hints[word] || hints[word.toLowerCase()] || null;
}

async function showHint(kind) {
  const h = hintFor(session.current);
  if (!h) return;
  stopListening(true);
  spellToken++;
  speech.stopSpeaking();
  const text = kind === 'sentence' ? h.sentence : h.meaning;
  $('hint-text').hidden = false;
  $('hint-text').textContent = (kind === 'sentence' ? '📖 ' : '❓ ') + maskWord(text, session.current);
  await speech.speak(text, settings.rate);
}

// ---------- settings ----------

async function renderSettings() {
  await speech.loadVoices();
  const sel = $('set-voice');
  const list = speech.englishVoices();
  sel.replaceChildren(...list.map((v) => el('option', { value: v.voiceURI }, `${v.name} (${v.lang})`)));
  const chosen = speech.chooseVoice(settings.voiceURI);
  if (chosen) sel.value = chosen.voiceURI;
  $('voice-note').textContent = list.length
    ? (list.some((v) => /en[-_]gb/i.test(v.lang)) ? '' : 'No British voice found. On iPhone: Settings → Accessibility → Spoken Content → Voices → English → add Daniel or Serena.')
    : 'No English voices found on this device.';
  $('set-rate').value = settings.rate;
  $('set-slow').value = settings.slowRate;
  $('out-rate').textContent = settings.rate;
  $('out-slow').textContent = settings.slowRate;
  $('set-size').value = String(settings.sessionSize);
  $('set-dots').checked = !!settings.showDots;
  $('set-timer').value = String(settings.examTimer);
}

function bindSettings() {
  const upd = (fn) => () => { fn(); store.saveSettings(settings); };
  $('set-voice').addEventListener('change', upd(() => { settings.voiceURI = $('set-voice').value; speech.chooseVoice(settings.voiceURI); }));
  $('set-rate').addEventListener('input', upd(() => { settings.rate = Number($('set-rate').value); $('out-rate').textContent = settings.rate; }));
  $('set-slow').addEventListener('input', upd(() => { settings.slowRate = Number($('set-slow').value); $('out-slow').textContent = settings.slowRate; }));
  $('set-size').addEventListener('change', upd(() => { settings.sessionSize = Number($('set-size').value); }));
  $('set-dots').addEventListener('change', upd(() => { settings.showDots = $('set-dots').checked; }));
  $('set-timer').addEventListener('change', upd(() => { settings.examTimer = Number($('set-timer').value); }));
  $('test-voice').addEventListener('click', () => speech.speak('Spell the word: beautiful.', settings.rate));
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
    .sort((a, b) => b.wrong - a.wrong || a.box - b.box || b.wrong / (b.right + b.wrong) - a.wrong / (a.right + a.wrong))
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

function bind() {
  $('start-practice').addEventListener('click', () => startSession());
  $('start-exam').addEventListener('click', () => startSession({ exam: true }));
  for (const b of $('input-modes').querySelectorAll('button')) b.addEventListener('click', () => setInputMode(b.dataset.mode));
  $('open-settings').addEventListener('click', async () => { await renderSettings(); show('settings'); });
  $('open-parent').addEventListener('click', openParent);
  for (const b of document.querySelectorAll('.back')) b.addEventListener('click', () => { renderHome(); show('home'); });

  $('quit').addEventListener('click', () => {
    const answered = Object.keys(session.first).length;
    if (answered && !confirm('Stop this session?')) return;
    stopAll();
    if (answered) {
      session.words = session.words.filter((w) => w in session.first);
      endSession();
    } else {
      session = null;
      renderHome();
      show('home');
    }
  });
  $('mic').addEventListener('click', startListening);
  $('mic-done').addEventListener('click', () => listener?.stop());
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
  $('retry').addEventListener('click', retryVoice);
  $('next').addEventListener('click', advance);

  $('h-repeat').addEventListener('click', () => { spellToken++; sayWord(false).then(() => { if (!session.answered) $('status').textContent = promptText(); }); });
  $('h-slow').addEventListener('click', () => { spellToken++; sayWord(true).then(() => { if (!session.answered) $('status').textContent = promptText(); }); });
  $('h-sentence').addEventListener('click', () => showHint('sentence'));
  $('h-meaning').addEventListener('click', () => showHint('meaning'));
  $('h-skip').addEventListener('click', () => {
    const w = session.current;
    if (!(w in session.first)) session.first[w] = 'skip';
    advance();
  });

  $('again').addEventListener('click', () => startSession({ exam: false, words: session.repeat }));
  $('home-btn').addEventListener('click', () => { session = null; renderHome(); show('home'); });
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
  data = await loadJSON('data/words.json', { words: [], focus: [] });
  hints = await loadJSON('data/hints.json', {});
  if (!speech.sttAvailable) {
    if (settings.inputMode === 'voice') settings.inputMode = 'type';
    $('stt-note').hidden = false;
    $('stt-note').textContent = 'Voice answers are not available in this browser, so we start in Type mode. On iPhone/iPad use Safari; on a computer use Chrome or Safari.';
  }
  speech.loadVoices().then(() => speech.chooseVoice(settings.voiceURI));
  bind();
  renderHome();
  show('home');
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
