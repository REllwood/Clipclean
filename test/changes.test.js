import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUILT_IN_RECIPES, applyRecipe, describeChanges } from '../src/core.js';
import { SAMPLE_TEXT } from '../src/sample.js';

test('changes on individual lines are listed with their line numbers', () => {
  const { hunks, omitted } = describeChanges('one\ntwo\u200B\nthree\nfour\u200B', 'one\ntwo\nthree\nfour');
  assert.deepEqual(hunks.map(({ line, before, after }) => [line, before, after]), [[2, 'two\u200B', 'two'], [4, 'four\u200B', 'four']]);
  assert.equal(omitted, 0);
});

test('line ending changes show the carriage returns that were removed', () => {
  const { hunks } = describeChanges('a\r\nb\r\nc', 'a\nb\nc');
  assert.deepEqual(hunks.map(({ before }) => before), ['a\r', 'b\r']);
});

test('changes that add or remove lines become one hunk around the difference', () => {
  const { hunks } = describeChanges('keep\n<p>one</p><p>two</p>\nend', 'keep\none\n\ntwo\nend');
  assert.deepEqual(hunks, [{ line: 2, lines: 1, addedLines: 3, before: '<p>one</p><p>two</p>', after: 'one\n\ntwo' }]);
});

test('inserted and removed lines do not make the following lines look changed', () => {
  assert.deepEqual(describeChanges('one\ntwo\nthree\nfour', 'zero\none\ntwo\nthree\nfour').hunks, [{ line: 1, lines: 0, addedLines: 1, before: '', after: 'zero' }]);
  assert.deepEqual(describeChanges('<p>A</p>\nB\nC\n', 'A\n\nB\nC').hunks, [
    { line: 1, lines: 1, addedLines: 2, before: '<p>A</p>', after: 'A\n' },
    { line: 4, lines: 1, addedLines: 0, before: '', after: '' }
  ]);
});

test('long change lists and long lines are capped', () => {
  const before = Array.from({ length: 80 }, (_, index) => `line ${index}\u200B`).join('\n');
  const { hunks, omitted } = describeChanges(before, before.replaceAll('\u200B', ''));
  assert.equal(hunks.length, 50);
  assert.equal(omitted, 30);
  const [long] = describeChanges('x'.repeat(5_000), 'y'.repeat(5_000)).hunks;
  assert.equal(Array.from(long.before).length, 2_001);
  assert.ok(long.before.endsWith('…'));
});

test('the built-in sample matches the fixture and exercises every kind of finding', () => {
  assert.equal(readFileSync(new URL('../fixtures/release-note.txt', import.meta.url), 'utf8'), SAMPLE_TEXT);
  const { inspection, output, outputInspection } = applyRecipe(SAMPLE_TEXT, BUILT_IN_RECIPES.find(({ id }) => id === 'clean-markdown'));
  assert.ok(inspection.hidden.length > 0);
  assert.ok(inspection.hiddenText.length > 0);
  assert.ok(inspection.secretWarnings.length > 0);
  assert.ok(inspection.terminalControls.length > 0);
  assert.ok(inspection.formulaLines.length > 0);
  assert.equal(outputInspection.hiddenText.length, 0);
  assert.doesNotMatch(output, /utm_source/u);
});
