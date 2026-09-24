import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function run(argumentsList, input = '') {
  return spawnSync(process.execPath, [cli, ...argumentsList], { input, encoding: 'utf8' });
}

function runWithFile(argumentsList, contents) {
  const directory = mkdtempSync(join(tmpdir(), 'clipclean-'));
  const path = join(directory, 'input.txt');
  writeFileSync(path, contents);
  const descriptor = openSync(path, 'r');
  try {
    return spawnSync(process.execPath, [cli, ...argumentsList], { stdio: [descriptor, 'pipe', 'pipe'], encoding: 'utf8' });
  } finally {
    closeSync(descriptor);
    rmSync(directory, { recursive: true, force: true });
  }
}

test('multi-byte characters that straddle stdin chunk boundaries are decoded intact', () => {
  for (const padding of [65533, 65534, 65535, 65536]) {
    const result = runWithFile(['--inspect'], `${'a'.repeat(padding)}\u200Btail`);
    assert.equal(result.status, 0, result.stderr);
    const inspection = JSON.parse(result.stdout);
    assert.equal(inspection.hidden.length, 1, `zero-width space after ${padding} bytes`);
    assert.equal(inspection.characters, padding + 5);
  }
});

test('non-ASCII input round-trips byte for byte through a rule that leaves it alone', () => {
  const input = '😀 é 中文 \u{1F468}\u200D\u{1F469}\n'.repeat(12_000);
  const result = run(['--rules', 'trim-trailing-space'], input);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, input);
});

test('a built-in recipe is applied and a summary is written to standard error', () => {
  const result = run(['--recipe', 'clean-links'], 'https://example.test/?utm_source=mail&keep=1');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'https://example.test/?keep=1');
  assert.match(result.stderr, /Applied 1 named rule; 1 changed/);
});

test('the --recipe=<id> form is accepted', () => {
  const result = run(['--recipe=clean-links'], 'https://example.test/?utm_source=mail');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'https://example.test/');
});

test('--rules applies an ad hoc list of rules in order', () => {
  const result = run(['--rules', 'remove-zero-width, normalise-line-endings'], 'a\u200Bb\r\nc');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'ab\nc');
});

test('the output is flagged when it still contains likely secrets', () => {
  const result = run(['--recipe', 'clean-links'], 'token ghp_1234567890abcdefghijklmnop');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Warning: the output still contains 1 likely secret/);
});

test('usage errors exit with status 2 and explain themselves', () => {
  const cases = [
    [['--recipe'], /--recipe needs a value/],
    [['--recipe', 'nope'], /Unknown recipe “nope”/],
    [['--rules', 'execute-command'], /Unknown transformation rule: execute-command\. Run with --list/],
    [['--recipe', 'plain-text', '--rules', 'strip-html'], /either --recipe or --rules/],
    [['--inspect', '--recipe', 'plain-text'], /cannot be combined/],
    [['--inspect=yes'], /does not take a value/],
    [['--frobnicate'], /Unknown option “--frobnicate”/]
  ];
  for (const [argumentsList, message] of cases) {
    const result = run(argumentsList, 'text');
    assert.equal(result.status, 2, argumentsList.join(' '));
    assert.match(result.stderr, message);
  }
});

test('--help and --list print to standard output without reading input', () => {
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: clipclean/);
  const list = spawnSync(process.execPath, [cli, '--list'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(list.status, 0);
  assert.match(list.stdout, /clean-markdown/);
  assert.match(list.stdout, /remove-tracking/);
});

test('input over the character limit is rejected', () => {
  const result = run(['--inspect'], 'a'.repeat(500_001));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /exceeds the 500,000 character limit/);
});

test('a closed output pipe ends the process quietly', () => {
  const script = `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, [${JSON.stringify(cli)}, '--rules', 'trim-trailing-space'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.once('data', () => child.stdout.destroy());
    child.on('close', (code) => { process.stdout.write(JSON.stringify({ code, stderr })); });
    child.stdin.end('x'.repeat(400000));
  `;
  const outcome = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  const { code, stderr } = JSON.parse(outcome.stdout);
  assert.equal(code, 0);
  assert.doesNotMatch(stderr, /EPIPE|Error/);
});
