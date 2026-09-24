import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILT_IN_RECIPES, applyRecipe } from '../src/core.js';

const strip = (value) => applyRecipe(value, { name: 'Strip only', rules: ['strip-html'] }).output;
const recipe = (id) => BUILT_IN_RECIPES.find((item) => item.id === id);

test('text that is not HTML passes through unchanged', () => {
  for (const value of [
    'a < b and c > d',
    'See <https://example.com/docs> or write to <team@example.com>.',
    'List<Object>, Vec<u8> and Map<String, Integer> are generic types.',
    '> A Markdown quote\n>> nested',
    'x <= y && y >= z',
    'An unfinished <div',
    'An unfinished <!-- comment'
  ]) assert.equal(strip(value), value);
});

test('Markdown code spans and fenced blocks keep their markup', () => {
  const value = 'Use `<br>` here.\n\n```html\n<p class="x">Hi</p>\n\n\n\n<b>kept</b>\n```\n<p>Real</p>';
  assert.equal(strip(value), 'Use `<br>` here.\n\n```html\n<p class="x">Hi</p>\n\n\n\n<b>kept</b>\n```\n\nReal');
});

test('comments, declarations and quoted attributes are removed whole', () => {
  assert.equal(strip('x<!-- a > b -->y'), 'xy');
  assert.equal(strip('<!DOCTYPE html><p>Body</p>'), 'Body');
  assert.equal(strip('<a title="1>2" data-x=\'<b>\' href="/x">link</a>'), 'link');
  assert.equal(strip('<![CDATA[x < y]]>'), 'x < y');
});

test('script, style, head and template contents are dropped', () => {
  const value = '<head><title>Page</title><style>p{color:red}</style></head><p>Hi</p><script>alert("<b>")</script><template><i>t</i></template>';
  assert.equal(strip(value), 'Hi');
});

test('entities are decoded once, including numeric and Windows-1252 references', () => {
  assert.equal(strip('Use &amp;lt;div&amp;gt; literally'), 'Use &lt;div&gt; literally');
  assert.equal(strip('&lt;b&gt; &#8212; &#x1F600; &#150; &copy; &unknown; &#0; &#xD800;'), '<b> — 😀 – © &unknown; \uFFFD \uFFFD');
});

test('lists, tables and formatting whitespace become tidy lines', () => {
  assert.equal(strip('<ul>\n  <li>One</li>\n  <li>Two</li>\n</ul>'), 'One\nTwo');
  assert.equal(strip('<table>\n  <tr>\n    <td>a</td>\n    <td>b</td>\n  </tr>\n  <tr><td>c</td><td>d</td></tr>\n</table>'), 'a\tb\nc\td');
  assert.equal(strip('<p>First</p><p>Second</p>'), 'First\n\nSecond');
  assert.equal(strip('one<br>two<br/><br />three'), 'one\ntwo\n\nthree');
  assert.equal(strip('<b>bold</b> <i>italic</i>'), 'bold italic');
});

test('office, custom and upper-case elements are recognised', () => {
  assert.equal(strip('<P CLASS=MsoNormal>Hello<o:p></o:p></P>'), 'Hello');
  assert.equal(strip('<my-card>hi</my-card>'), 'hi');
});

test('mixed Markdown and HTML keeps its line structure', () => {
  const value = '<p>Release note</p>\nRead <a href="https://example.test">the changes</a>.\n- item one\n- item two';
  assert.equal(strip(value), 'Release note\n\nRead the changes.\n- item one\n- item two');
});

test('invisible characters are left for the rules that report them', () => {
  assert.equal(strip('\uFEFF<p>x</p>\u00A0'), '\uFEFF\nx\n\u00A0');
});

test('decoded non-breaking spaces do not survive the plain-text and Markdown recipes', () => {
  for (const id of ['plain-text', 'clean-markdown']) {
    const result = applyRecipe('<p>a&nbsp;b</p>', recipe(id));
    assert.equal(result.output, 'a b');
    assert.equal(result.outputInspection.hidden.length, 0);
  }
});

test('large inputs are processed in linear time', () => {
  const value = '<p>x</p>'.repeat(30_000) + '<a '.repeat(20_000) + '`'.repeat(3) + 'a < b '.repeat(20_000);
  const started = performance.now();
  strip(value);
  assert.ok(performance.now() - started < 2_000);
});
