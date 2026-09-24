import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectText } from '../src/core.js';

// Sample credentials are assembled at run time so the source never contains a credential-shaped string.
const join = (...parts) => parts.join('');
const alnum = (length) => 'A1b2C3d4E5f6G7h8I9j0'.repeat(10).slice(0, length);
const ids = (value) => inspectText(value).secretWarnings.map(({ id }) => id);

test('current credential formats from common providers are recognised', () => {
  const cases = {
    'github-fine-grained-token': join('github_', 'pat_', alnum(22), '_', alnum(59)),
    'gitlab-token': join('glp', 'at-', alnum(20)),
    'anthropic-key': join('sk-', 'ant-', 'api03-', alnum(40)),
    'openai-key': join('sk-', 'proj-', alnum(40)),
    'slack-token': join('xox', 'b-', '123456789012-', alnum(24)),
    'slack-webhook': join('https://hooks.', 'slack.com/services/', 'T00000000/B00000000/', alnum(24)),
    'stripe-key': join('sk_', 'live_', alnum(24)),
    'google-api-key': join('AI', 'za', alnum(35)),
    'npm-token': join('np', 'm_', alnum(36)),
    'aws-access-key': join('AK', 'IA', 'ABCDEFGHIJ234567'),
    'aws-secret-key': join('aws_secret_', 'access_key = ', alnum(40)),
    jwt: join('ey', 'JhbGciOiJIUzI1NiJ9', '.ey', 'JzdWIiOiIxMjM0In0', '.', alnum(30)),
    'url-credentials': join('https://deploy:', 'hunter2', '@example.test/repo.git'),
    'basic-auth': join('Authorization: ', 'Basic ', 'dXNlcjpwYXNzd29yZA==')
  };
  for (const [id, value] of Object.entries(cases)) assert.deepEqual(ids(`value: ${value} end`), [id], id);
});

test('every private key header variant is recognised', () => {
  for (const kind of ['', 'RSA ', 'EC ', 'DSA ', 'OPENSSH ', 'ENCRYPTED ', 'PGP ']) {
    const block = kind === 'PGP ' ? ' BLOCK' : '';
    assert.deepEqual(ids(join('-----BEGIN ', kind, 'PRIVATE', ' KEY', block, '-----')), ['private-key'], kind);
  }
});

test('overlapping matches are reported once', () => {
  const jwt = join('ey', 'JhbGciOiJIUzI1NiJ9', '.ey', 'JzdWIiOiIxMjM0In0', '.', alnum(30));
  assert.deepEqual(ids(`Authorization: Bearer ${jwt}`), ['bearer-token']);
  assert.deepEqual(ids(join('sk-', 'ant-', 'api03-', alnum(40))), ['anthropic-key']);
});

test('bearer credentials include their base64 padding', () => {
  const [warning] = inspectText(join('Bearer ', alnum(20), '==')).secretWarnings;
  assert.equal(warning.length, 'Bearer '.length + 22);
});

test('ordinary words and identifiers are not mistaken for credentials', () => {
  for (const value of [
    'sk-reset-password-button-wrapper',
    'ask-questions-about-this-thing-1234567890',
    'Basic authentication is simple',
    'https://example.test/path@user',
    'mailto:someone@example.test',
    'AKIA is a prefix, not a key'
  ]) assert.deepEqual(ids(value), [], value);
});

test('warnings include a position but never the matched value', () => {
  const token = join('xox', 'p-', '123456789012-', alnum(24));
  const [warning] = inspectText(`first line\n  ${token}`).secretWarnings;
  assert.deepEqual([warning.line, warning.column], [2, 3]);
  assert.equal(JSON.stringify(warning).includes(token), false);
});
