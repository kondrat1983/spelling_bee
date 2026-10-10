import { test, expect } from '@playwright/test';

// Speech is not available in CI: make speechSynthesis finish instantly.
async function stubSpeech(page, settings = { inputMode: 'type', sessionSize: 5, onboarded: true }) {
  await page.addInitScript((s) => {
    const fake = {
      speak(u) { setTimeout(() => u.onend && u.onend(), 5); },
      cancel() {},
      getVoices() { return []; },
      addEventListener() {},
    };
    Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
    if (s && !localStorage.getItem('sbt.settings.v1')) localStorage.setItem('sbt.settings.v1', JSON.stringify(s));
  }, settings);
}

// Fake speech recognition: answers once per word with window.__say(word).
async function stubRecognition(page) {
  await page.addInitScript(() => {
    class FakeRecognition {
      start() {
        const word = document.getElementById('peek-word').textContent;
        if (window.__spoken === word) { setTimeout(() => this.onend?.(), 200); return; }
        window.__spoken = word;
        const alts = window.__say(word);
        setTimeout(() => {
          const result = alts.map((t) => ({ transcript: t, confidence: 0.9 }));
          result.isFinal = true;
          this.onresult?.({ results: [result] });
        }, 20);
        // iOS-style: the engine stops by itself after a pause; the app must restart and keep the result.
        setTimeout(() => this.onend?.(), 60);
      }
      stop() { setTimeout(() => this.onend?.(), 5); }
      abort() { this.onend?.(); }
    }
    window.webkitSpeechRecognition = FakeRecognition;
    window.SpeechRecognition = FakeRecognition;
    window.__say = (w) => [`${w} ${[...w.replace(/ /g, '')].join(' ')} ${w}`];
  });
}

const progress = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('sbt.progress.v1')));

test('first launch shows the tutorial, then home', async ({ page }) => {
  await stubSpeech(page, null);
  await page.goto('/');
  await expect(page.locator('#onboarding')).toBeVisible();
  await page.click('#onb-next');
  await expect(page.locator('.ritual')).toBeVisible();
  await page.click('#onb-next');
  await page.click('#onb-next');
  await expect(page.locator('#home')).toBeVisible();
  await page.reload();
  await expect(page.locator('#home')).toBeVisible();
});

test('Type mode: a 5-word session, mistakes go to box 1, progress is saved', async ({ page }) => {
  await stubSpeech(page);
  await page.goto('/');
  await expect(page.locator('#total')).toHaveText('482');
  await expect(page.locator('#start-sub')).toContainText('Focus');

  await page.click('#start-practice');
  await expect(page.locator('#play')).toBeVisible();
  // The word itself is never visible to the child.
  await expect(page.locator('#peek-word')).toBeHidden();

  let wrongWord = null;
  const answered = [];
  for (let turn = 0; turn < 10; turn++) {
    if (await page.locator('#end').isVisible()) break;
    await expect(page.locator('#type-ui')).toBeVisible();
    const word = await page.locator('#peek-word').textContent();
    const makeMistake = answered.length === 1 && !wrongWord;
    await page.fill('#type-input', makeMistake ? `${word}x` : word);
    await page.click('#type-check');
    answered.push(word);
    if (makeMistake) {
      wrongWord = word;
      await expect(page.locator('#fb-icon')).toHaveText('❌');
      await expect(page.locator('#fb-word')).toHaveText(word.replace(/ /g, ''));
      await expect(page.locator('#fb-you .tile.miss')).toHaveCount(1); // the extra "x"
    } else {
      await expect(page.locator('#fb-icon')).toHaveText('✅');
    }
    await page.click('#next');
  }

  await expect(page.locator('#end')).toBeVisible();
  await expect(page.locator('#end-score')).toHaveText('4 of 5 right the first time');
  await expect(page.locator('#end-repeat .word-card')).toHaveText([wrongWord]);
  // The missed word came back once in the session.
  expect(answered.filter((w) => w === wrongWord)).toHaveLength(2);
  expect(answered).toHaveLength(6);

  let p = await progress(page);
  expect(p.words[wrongWord].box).toBe(1);
  expect(p.words[wrongWord].wrong).toBe(1);
  for (const w of answered.filter((x) => x !== wrongWord)) expect(p.words[w].box).toBe(2);

  // Progress survives a reload, and the mistake shows up in the Mistakes deck.
  await page.reload();
  p = await progress(page);
  expect(p.words[wrongWord].box).toBe(1);
  expect(Object.keys(p.words)).toHaveLength(5);
  await page.click('#open-decks');
  await expect(page.locator('[data-deck="mistakes"] small')).toHaveText('0 / 1');
});

test('Choose words: picking a deck changes the Start button', async ({ page }) => {
  await stubSpeech(page);
  await page.goto('/');
  await page.click('#open-decks');
  await page.click('[data-deck="range-ab"]');
  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('#start-sub')).toContainText('A–B');
  await page.click('#start-practice');
  const word = await page.locator('#peek-word').textContent();
  expect(word[0].toLowerCase()).toMatch(/[ab]/);
});

test('Parent mode and parent screen', async ({ page }) => {
  await stubSpeech(page);
  await page.goto('/');
  await page.click('#open-settings');
  await page.click('[data-mode="parent"]');
  await page.click('#settings .back');
  await page.click('#start-practice');
  await page.click('#parent-no');
  await expect(page.locator('#fb-icon')).toHaveText('❌');
  page.once('dialog', (d) => d.accept());
  await page.click('#quit');
  await expect(page.locator('#end')).toBeVisible();
  await page.click('#home-btn');

  await page.click('#open-parent');
  const q = await page.locator('#gate-q').textContent();
  const [, a, b] = q.match(/(\d+) × (\d+)/);
  await page.fill('#gate-answer', String(Number(a) * Number(b)));
  await page.click('#gate button');
  await expect(page.locator('#hardest li')).toHaveCount(1);
});

test('Voice mode: the mic starts by itself; E-set confusion asks to confirm', async ({ page }) => {
  await stubSpeech(page, { inputMode: 'voice', sessionSize: 5, onboarded: true });
  await stubRecognition(page);
  await page.goto('/');
  await page.click('#start-practice');

  // No tap needed: the word is spoken, then the app listens.
  await expect(page.locator('#fb-icon')).toHaveText('✅', { timeout: 8000 });
  await expect(page.locator('#combo')).toHaveText('');

  // Swap one letter for an E-set neighbour.
  await page.evaluate(() => {
    window.__say = (w) => {
      const letters = [...w.replace(/ /g, '').toLowerCase()];
      const i = letters.findIndex((c) => 'bdegptvz'.includes(c));
      if (i >= 0) letters[i] = letters[i] === 'b' ? 'p' : 'b';
      return [letters.join(' ')];
    };
  });
  await page.click('#next');
  const word = await page.locator('#peek-word').textContent();
  if (/[bdegptvz]/i.test(word)) {
    await expect(page.locator('#fb-confirm')).toBeVisible({ timeout: 8000 });
    // The question shows only what was heard, never the answer.
    await expect(page.locator('#fb-word')).toBeHidden();
    await page.click('#confirm-yes');
    await expect(page.locator('#fb-icon')).toHaveText('✅');
    await expect(page.locator('#combo')).toHaveText('🔥 2');
  }
  const p = await progress(page);
  expect(p.transcripts.length).toBeGreaterThanOrEqual(1);
});
