import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectText } from '../src/core.js';

const flagged = (value) => inspectText(value).formulaLines.length > 0;

test('spreadsheet formulas and DDE payloads are flagged', () => {
  for (const value of [
    '=SUM(A1:A2)',
    "=cmd|' /C calc'!A0",
    "+cmd|' /C calc'!A0",
    "-cmd|' /C calc'!A0",
    '@SUM(A1)',
    '-HYPERLINK("https://example.test")',
    '-2+3',
    '+(1)',
    '   =1+1',
    '= today'
  ]) assert.equal(flagged(value), true, value);
});

test('Markdown, diffs, options, mentions and numbers are not flagged', () => {
  for (const value of [
    '- Fixed a bug',
    '+ Added a feature',
    '---',
    '===',
    '--- a/src/core.js',
    '+++ b/src/core.js',
    '+  const x = 1;',
    '-rf /tmp/build',
    '--verbose',
    '@rhys can you take a look?',
    '+61 3 9999 9999',
    '-1',
    '-3.5'
  ]) assert.equal(flagged(value), false, value);
});

test('formulas in later cells of tab-separated rows are flagged with their cell', () => {
  const [first, second] = inspectText("name\t=cmd|' /C calc'!A0\nok\tfine\ta\tb\t-2+3").formulaLines;
  assert.deepEqual([first.line, first.cell], [1, 2]);
  assert.match(first.label, /cell 2 of a tab-separated line/);
  assert.deepEqual([second.line, second.cell], [2, 5]);
});

test('multi-line detection counts CR, LF and CRLF line breaks', () => {
  assert.equal(inspectText('echo one\recho two').multilineCommand, true);
  assert.equal(inspectText('echo one\r\necho two').multilineCommand, true);
  assert.equal(inspectText('echo one\n').multilineCommand, false);
  assert.equal(inspectText('echo one\n\n   \n').multilineCommand, false);
});
