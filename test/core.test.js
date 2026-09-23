import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILT_IN_RECIPES, MAX_FINDINGS_PER_CATEGORY, applyRecipe, inspectText, validateRecipe, visibleText } from '../src/core.js';

const recipe = (id) => BUILT_IN_RECIPES.find((item) => item.id === id);

test('inspection labels hidden Unicode and terminal controls by position', () => {
  const inspection = inspectText('A\u200BB\u202EC\u001b[31mred\u001b[0m');
  assert.deepEqual(inspection.hidden.map(({ codePoint }) => codePoint), ['U+200B', 'U+202E']);
  assert.equal(inspection.terminalControls.length, 2);
  assert.match(visibleText('A\u200BB'), /zero-width space U\+200B/);
});

test('likely-secret checks warn without returning the matched credential', () => {
  const token = 'ghp_1234567890abcdefghijklmnop';
  const warning = inspectText(`Example only ${token}`).secretWarnings[0];
  assert.equal(warning.label, 'Likely GitHub-style token');
  assert.equal(JSON.stringify(warning).includes(token), false);
  assert.match(warning.disclosure, /Pattern match only/);
});

test('clean Markdown attributes every transformation and removes tracking parameters', () => {
  const source = '<p>News\u200B</p> https://example.test/post?utm_source=mail&keep=yes\r\n';
  const result = applyRecipe(source, recipe('clean-markdown'));
  assert.equal(result.output, 'News\n https://example.test/post?keep=yes');
  assert.equal(result.edits.length, recipe('clean-markdown').rules.length);
  assert.equal(result.edits.every(({ ruleId, label }) => Boolean(ruleId && label)), true);
  assert.equal(result.edits.some(({ ruleId, changed }) => ruleId === 'remove-tracking' && changed), true);
});

test('terminal recipe strips escape sequences and directional formatting without executing text', () => {
  const result = applyRecipe('echo safe\u202E\n\u001b[31mred\u001b[0m', recipe('safe-terminal'));
  assert.equal(result.output, 'echo safe\nred');
  assert.equal(result.output.includes('\u001b'), false);
});

test('recipes reject unknown, empty and duplicated rules safely', () => {
  assert.throws(() => validateRecipe({ name: '', rules: ['remove-tracking'] }), /needs a name/i);
  assert.throws(() => validateRecipe({ name: 'Bad', rules: ['execute-command'] }), /Unknown transformation rule/i);
  assert.deepEqual(validateRecipe({ name: 'Links', rules: ['remove-tracking', 'remove-tracking'], id: 'links' }).rules, ['remove-tracking']);
});

test('formula-like spreadsheet lines and multiline terminal text are warnings only', () => {
  const inspection = inspectText('=SUM(A1:A2)\n-2+3\necho next');
  assert.equal(inspection.formulaLines[0].line, 1);
  assert.equal(inspection.formulaLines[1].line, 2);
  assert.equal(inspection.multilineCommand, true);
});

test('large hidden-character inputs use linear positions and bounded finding records', () => {
  const inspection = inspectText(`start\n${'\u200B'.repeat(MAX_FINDINGS_PER_CATEGORY + 25)}`);
  assert.equal(inspection.hidden.length, MAX_FINDINGS_PER_CATEGORY);
  assert.equal(inspection.hidden[0].line, 2);
  assert.equal(inspection.hidden[0].column, 1);
  assert.equal(inspection.omittedFindings.hidden, 25);
});
