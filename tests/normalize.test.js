import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcriptToLetters, compareLetters, scoreAlternatives, scoreTyped, diffTarget, alignLetters } from '../js/normalize.js';

// [transcript, target, expected letters]
const CASES = [
  ['e n o u g h', 'enough', 'enough'],
  ['E N O U G H', 'enough', 'enough'],
  ['e-n-o-u-g-h', 'enough', 'enough'],
  ['E. N. O. U. G. H.', 'enough', 'enough'],
  ['enough e n o u g h enough', 'enough', 'enough'],
  ['enough ee en oh you gee aitch enough', 'enough', 'enough'],
  ['enough enough enough', 'enough', 'enough'],
  ['ess see eye double ess oh are ess', 'scissors', 'scissors'],
  ['s c i double s o r s', 'scissors', 'scissors'],
  ['double you e d n e s d a y', 'Wednesday', 'wednesday'],
  ['double u e d n e s d a y', 'Wednesday', 'wednesday'],
  ['k a n g a r double o', 'kangaroo', 'kangaroo'],
  ['kay ay en gee ay are oh oh', 'kangaroo', 'kangaroo'],
  ['l i zed a r d', 'lizard', 'lizard'],
  ['l i zee a r d', 'lizard', 'lizard'],
  ['why e l l o w', 'yellow', 'yellow'],
  ['y o you n g', 'young', 'young'],
  ['are e s t a you r a n t', 'restaurant', 'restaurant'],
  ['b o o k', 'book', 'book'],
  ['bee oh oh kay', 'book', 'book'],
  ['see a k e', 'cake', 'cake'],
  ['tea are e e', 'tree', 'tree'],
  ['aitch e l l o', 'hello', 'hello'],
  ['h a l f', 'half', 'half'],
  ['e ex i t', 'exit', 'exit'],
  ['b o ex', 'box', 'box'],
  ['queue you i c k', 'quick', 'quick'],
  ['m a t h s', 'maths', 'maths'],
  ['g r e why', 'grey', 'grey'],
  // Two-word entries: "space" or nothing between the words.
  ['ice cream i c e space c r e a m ice cream', 'ice cream', 'icecream'],
  ['i c e c r e a m', 'ice cream', 'icecream'],
  ['stomach ache s t o m a c h a c h e stomach ache', 'stomach ache', 'stomachache'],
  // Filler words.
  ['um e n o uh u g h', 'enough', 'enough'],
  // The target word itself in the middle is a fully spelled token.
  ['e nough', 'enough', 'enough'],
  // Target word that is also a filler/letter name.
  ['each e a c h each', 'each', 'each'],
  ['then t h e n then', 'then', 'then'],
  ['space s p a c e space', 'space', 'space'],
];

for (const [transcript, target, expected] of CASES) {
  test(`"${transcript}" -> ${expected}`, () => {
    assert.equal(transcriptToLetters(transcript, target), expected);
  });
}

test('exact match is correct', () => {
  assert.equal(compareLetters('enough', 'enough'), 'correct');
  assert.equal(compareLetters('icecream', 'ice cream'), 'correct');
  assert.equal(compareLetters('wednesday', 'Wednesday'), 'correct');
});

test('E-set and M/N differences ask for confirmation', () => {
  assert.equal(compareLetters('enoughd', 'enough'), 'wrong');
  assert.equal(compareLetters('emough', 'enough'), 'confirm');
  assert.equal(compareLetters('bood', 'book'), 'wrong'); // k is not in the E-set
  assert.equal(compareLetters('tree', 'tree'), 'correct');
  assert.equal(compareLetters('dree', 'tree'), 'confirm');
  assert.equal(compareLetters('lisard', 'lizard'), 'wrong');
  assert.equal(compareLetters('livard', 'lizard'), 'confirm');
  assert.equal(compareLetters('scissorb', 'scissors'), 'wrong');
});

test('real mistakes are wrong', () => {
  assert.equal(compareLetters('enuogh', 'enough'), 'wrong'); // ou/uo swap
  assert.equal(compareLetters('sciso rs', 'scissors'), 'wrong'); // missing double
  assert.equal(compareLetters('enouh', 'enough'), 'wrong'); // missing letter
  assert.equal(compareLetters('', 'enough'), 'wrong');
});

test('any alternative that matches wins', () => {
  const r = scoreAlternatives(['e n o you g h', 'e and o u g h', 'enough e n o u g h enough'], 'enough');
  assert.equal(r.result, 'correct');
  assert.equal(r.heard, 'enough');
});

test('confirm beats wrong across alternatives', () => {
  const r = scoreAlternatives(['t r e', 'dee are e e'], 'tree');
  assert.equal(r.result, 'confirm');
  assert.equal(r.heard, 'dree');
});

test('no transcript is wrong', () => {
  assert.equal(scoreAlternatives([], 'tree').result, 'wrong');
  assert.equal(scoreAlternatives(['', '  '], 'tree').result, 'wrong');
});

test('American spelling gets a note', () => {
  const r = scoreAlternatives(['c o l o r'], 'colour');
  assert.equal(r.result, 'wrong');
  assert.equal(r.americanNote, 'British spelling: colour');
  assert.equal(scoreTyped('favorite', 'favourite').americanNote, 'British spelling: favourite');
});

test('typed input ignores case and spaces', () => {
  assert.equal(scoreTyped(' Ice Cream ', 'ice cream').result, 'correct');
  assert.equal(scoreTyped('icecream', 'ice cream').result, 'correct');
  assert.equal(scoreTyped('wensday', 'Wednesday').result, 'wrong');
});

test('diff marks missed letters', () => {
  const mark = (t, h) => diffTarget(t, h).map((x) => (x.ok ? x.ch : x.ch.toUpperCase())).join('');
  assert.equal(mark('scissors', 'sciso rs'), 'sciSsors');
  assert.equal(mark('enough', 'enuf'), 'enOuGH');
  assert.equal(mark('enough', 'enoughh'), 'enougH');
  assert.equal(mark('ice cream', 'icecrem'), 'ice creAm');
  assert.equal(mark('tree', 'tree'), 'tree');
});

test('live preview never shows the word or whole-word chunks', () => {
  const live = (tr, w) => transcriptToLetters(tr, w, { live: true });
  assert.equal(live('restaurant', 'restaurant'), '');
  assert.equal(live('restaurant r e s', 'restaurant'), 'res');
  assert.equal(live('enough e nough', 'enough'), 'e');
  assert.equal(live('s c i double s', 'scissors'), 'sciss');
});

test('align shows missing and extra letters', () => {
  const show = (t, h) => alignLetters(t, h).map((c) => (c.gap ? '_' : `${c.t ?? '-'}${c.h ?? '-'}`)).join(' ');
  assert.equal(show('enough', 'enuf'), 'ee nn o- uu g- hf');
  assert.equal(show('book', 'boook'), 'bb -o oo oo kk');
  assert.equal(show('ice cream', 'icecream'), 'ii cc ee _ cc rr ee aa mm');
  assert.equal(alignLetters('tree', 'tree').every((c) => c.ok), true);
  assert.equal(alignLetters('Wednesday', 'wednesday').map((c) => c.t).join(''), 'Wednesday');
  assert.equal(alignLetters('Wednesday', 'wednesday').every((c) => c.ok), true);
});
