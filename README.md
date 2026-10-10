# 🐝 Spelling Bee Trainer

A small web app for practising a Spelling Bee out loud:

1. The app **says the word** (British English voice).
2. The child **says the word, spells it letter by letter, says the word again**.
3. The app **listens**, turns the speech into letters and checks them.
4. ✅ next word, or ❌ shows the correct spelling (wrong letters highlighted), spells it slowly and asks the word again later.

No accounts, no server, no ads. Progress stays on the device (`localStorage`); export/import moves it between iPhone and iPad.

## Use it

Open the GitHub Pages link in **Safari on iPhone/iPad** (or Chrome on a Mac), allow the microphone, and *Share → Add to Home Screen* to install it.

- First launch: a short tutorial with Buzz the bee (say → spell → say, “double s”, a microphone test). *Settings → Show the tutorial again*.
- Home: one big **▶ Start** (smart pick: Focus words first, then everything), **📚 Choose words** for a specific deck, **🏆 Exam**.
- **🎤 Voice**: after the word is spoken the mic starts by itself (can be turned off in Settings); letters appear as tiles while the child spells. It stops after a short silence, or tap the mic.
  If it misheard a letter that sounds alike (B/D/E/G/P/T/V/Z, M/N) it asks *“I heard e-n-o-u-g-h?”*. A wrong answer shows two aligned rows, *I heard* and *Correct*, with the wrong letters in red, then spells the word slowly. If the app misheard a right answer, tap **🙉 Misheard me**: the mistake is not counted.
  “double s” works for “ss”, “zed”/“zee” for Z.
- **⌨️ Type**: type instead of speaking (noisy room, or no speech recognition).
- Answer mode (Voice / Type / Parent) is in Settings.
- **🧑 Parent**: the app says the word, the child spells to a parent who taps ✅/❌ (👁 shows the word to the parent).
- Buttons: 🔊 Repeat · 🐢 Slower · 📖 Sentence · ❓ Meaning · ⏭ Skip.
- **Decks**: ⭐ Focus (the circled words, starts first), 🔁 Mistakes, All, letter ranges. 20 words per session (Settings).
- **Leitner boxes** 1–5: wrong → box 1, right → next box; box 5 = learned. Sessions mostly pick boxes 1–2.
- **🏆 Exam**: one try per word, only Repeat / Sentence / Meaning, optional timer (Settings).
- **🔒 Parent** screen (behind a maths question): hardest words, history per word, raw speech transcripts, export/import, reset.

## Edit the word list

`data/words.json`: `words` (sorted, one per line), `focus` (circled words). British spelling is kept (colour, favourite, grey, maths); American spellings get a “British spelling: …” note.
Hints (meaning + example sentence for every word) are in `data/hints.json`. The sentence is spoken; on screen the word is hidden as `_____`.

## Develop

```sh
npm install
npm start            # http://localhost:8080
npm test             # letter normaliser unit tests
npm run test:e2e     # Playwright: Type, Parent and (simulated) Voice sessions
```

Plain HTML/CSS/ES modules, no build step. Main files:

- `js/normalize.js`: transcript → letters (`"ess see eye double ess oh are ess"` → `scissors`), compare, diff. Letter map at the top.
- `js/speech.js`: `speechSynthesis` (prefers en-GB Daniel/Serena/Kate) and `SpeechRecognition` (`en-GB`, 5 alternatives, keeps listening through pauses).
- `js/decks.js`, `js/store.js`: decks, Leitner, progress, export/import.
- `js/bee.js`: the bee mascot (one SVG, moods via CSS).
- `sw.js`: offline cache (bump `CACHE` after big changes).

## Publish (GitHub Pages)

Settings → Pages → *Deploy from a branch* → `main` / `(root)`. HTTPS is required for the microphone.
