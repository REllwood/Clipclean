import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILT_IN_RECIPES, applyRecipe } from '../src/core.js';

const cleanLinks = BUILT_IN_RECIPES.find((item) => item.id === 'clean-links');
const clean = (value) => applyRecipe(value, cleanLinks).output;

test('URLs without tracking parameters are left exactly as written', () => {
  for (const value of [
    'https://Example.COM',
    'https://münchen.de/straße?q=hello%20world&flag',
    'Formula =HYPERLINK("https://example.test","label")',
    'https://example.test/?si=1&t=2&ref=home'
  ]) {
    const result = applyRecipe(value, cleanLinks);
    assert.equal(result.output, value);
    assert.equal(result.edits[0].changed, false);
  }
});

test('only the tracking pairs are removed and the rest of the query is untouched', () => {
  assert.equal(clean('https://x.test/?q=hello%20world&flag&utm_source=a'), 'https://x.test/?q=hello%20world&flag');
  assert.equal(clean('https://münchen.de/x?utm_medium=b'), 'https://münchen.de/x');
  assert.equal(clean('https://x.test/a?fbclid=1#section'), 'https://x.test/a#section');
  assert.equal(clean('https://x.test/?a=1&amp;utm_source=b&amp;c=2'), 'https://x.test/?a=1&amp;c=2');
  assert.equal(clean('https://x.test/?utm%5Fsource=1&UTM_Campaign=2&keep=3'), 'https://x.test/?keep=3');
});

test('surrounding punctuation and brackets stay with the text', () => {
  assert.equal(clean('(see https://x.test/?utm_source=a).'), '(see https://x.test/).');
  assert.equal(clean('[docs](https://x.test/page?utm_campaign=z&id=4)'), '[docs](https://x.test/page?id=4)');
  assert.equal(clean('https://en.wikipedia.org/wiki/Foo_(bar)?utm_source=x.'), 'https://en.wikipedia.org/wiki/Foo_(bar).');
  assert.equal(clean('**https://x.test/?gclid=9**'), '**https://x.test/**');
});

test('common ad and email tracking parameters are recognised', () => {
  for (const key of ['msclkid', 'igshid', 'srsltid', 'ttclid', 'twclid', '_hsenc', 'mc_eid', 'mkt_tok', 'li_fat_id', 'gbraid']) {
    assert.equal(clean(`https://x.test/?${key}=1&id=2`), 'https://x.test/?id=2', key);
  }
});

test('site-specific parameters are only removed on those sites', () => {
  assert.equal(clean('https://youtu.be/abc?si=XYZ&t=42'), 'https://youtu.be/abc?t=42');
  assert.equal(clean('https://www.youtube.com/watch?v=abc&si=XYZ&feature=shared'), 'https://www.youtube.com/watch?v=abc');
  assert.equal(clean('https://open.spotify.com/track/1?si=abc'), 'https://open.spotify.com/track/1');
  assert.equal(clean('https://x.com/user/status/1?s=20&t=abc'), 'https://x.com/user/status/1');
  assert.equal(clean('https://www.linkedin.com/in/someone?trk=feed&lipi=x'), 'https://www.linkedin.com/in/someone');
  assert.equal(clean('https://www.amazon.com.au/dp/B000?ref_=nav&pd_rd_w=1&th=1'), 'https://www.amazon.com.au/dp/B000?th=1');
});

test('malformed URLs never throw', () => {
  assert.equal(clean('http:// and https://?utm_source=1 and https://x.test/?%E0%A4%A=1&utm_source=2'), 'http:// and https:// and https://x.test/?%E0%A4%A=1');
});
