export const MAX_TEXT_CHARACTERS = 500_000;
export const MAX_FINDINGS_PER_CATEGORY = 1_000;
export const MAX_VISIBLE_PREVIEW_CHARACTERS = 60_000;
const MAX_DECODED_CHARACTERS = 2_000;

// Categories decide which rule removes a character: invisible and joiner (remove-zero-width),
// directional (remove-directional), payload (remove-invisible-payloads), space (replace-non-breaking-spaces)
// and line-break (normalise-line-endings).
const invisibleCharacters = new Map([
  [0x00a0, ['non-breaking space', 'space']],
  [0x00ad, ['soft hyphen', 'invisible']],
  [0x034f, ['combining grapheme joiner', 'invisible']],
  [0x061c, ['Arabic letter mark', 'directional']],
  [0x115f, ['Hangul choseong filler', 'invisible']],
  [0x1160, ['Hangul jungseong filler', 'invisible']],
  [0x1680, ['Ogham space mark', 'space']],
  [0x17b4, ['Khmer inherent vowel aq', 'invisible']],
  [0x17b5, ['Khmer inherent vowel aa', 'invisible']],
  [0x180e, ['Mongolian vowel separator', 'invisible']],
  [0x2000, ['en quad', 'space']],
  [0x2001, ['em quad', 'space']],
  [0x2002, ['en space', 'space']],
  [0x2003, ['em space', 'space']],
  [0x2004, ['three-per-em space', 'space']],
  [0x2005, ['four-per-em space', 'space']],
  [0x2006, ['six-per-em space', 'space']],
  [0x2007, ['figure space', 'space']],
  [0x2008, ['punctuation space', 'space']],
  [0x2009, ['thin space', 'space']],
  [0x200a, ['hair space', 'space']],
  [0x200b, ['zero-width space', 'invisible']],
  [0x200c, ['zero-width non-joiner', 'joiner']],
  [0x200d, ['zero-width joiner', 'joiner']],
  [0x200e, ['left-to-right mark', 'directional']],
  [0x200f, ['right-to-left mark', 'directional']],
  [0x2028, ['line separator', 'line-break']],
  [0x2029, ['paragraph separator', 'line-break']],
  [0x202a, ['left-to-right embedding', 'directional']],
  [0x202b, ['right-to-left embedding', 'directional']],
  [0x202c, ['pop directional formatting', 'directional']],
  [0x202d, ['left-to-right override', 'directional']],
  [0x202e, ['right-to-left override', 'directional']],
  [0x202f, ['narrow no-break space', 'space']],
  [0x205f, ['medium mathematical space', 'space']],
  [0x2060, ['word joiner', 'invisible']],
  [0x2061, ['function application', 'invisible']],
  [0x2062, ['invisible times', 'invisible']],
  [0x2063, ['invisible separator', 'invisible']],
  [0x2064, ['invisible plus', 'invisible']],
  [0x2066, ['left-to-right isolate', 'directional']],
  [0x2067, ['right-to-left isolate', 'directional']],
  [0x2068, ['first strong isolate', 'directional']],
  [0x2069, ['pop directional isolate', 'directional']],
  [0x206a, ['inhibit symmetric swapping', 'invisible']],
  [0x206b, ['activate symmetric swapping', 'invisible']],
  [0x206c, ['inhibit Arabic form shaping', 'invisible']],
  [0x206d, ['activate Arabic form shaping', 'invisible']],
  [0x206e, ['national digit shapes', 'invisible']],
  [0x206f, ['nominal digit shapes', 'invisible']],
  [0x3164, ['Hangul filler', 'invisible']],
  [0xfeff, ['zero-width no-break space', 'invisible']],
  [0xffa0, ['halfwidth Hangul filler', 'invisible']],
  [0xfff9, ['interlinear annotation anchor', 'invisible']],
  [0xfffa, ['interlinear annotation separator', 'invisible']],
  [0xfffb, ['interlinear annotation terminator', 'invisible']],
  [0xfffc, ['object replacement character', 'invisible']]
]);

// Visible format characters that attach to following digits in Arabic, Syriac and Kaithi text.
const prependedMarks = /[\u0600-\u0605\u06DD\u070F\u0890\u0891\u08E2\u{110BD}\u{110CD}]/u;
const formatCharacter = /\p{Cf}/u;
const invisibleCandidates = /[\u00A0\u00AD\u034F\u061C\u115F\u1160\u1680\u17B4\u17B5\u180E\u2000-\u200F\u2028-\u202F\u205F-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFC\p{Cf}\u{E0100}-\u{E01EF}]/gu;
const emojiBeforeJoiner = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u20E3]/u;
const emojiAfterJoiner = /\p{Extended_Pictographic}/u;
const joiningScript = /[\p{scx=Arabic}\p{scx=Syriac}\p{scx=Nko}\p{scx=Mongolian}\p{scx=Devanagari}\p{scx=Bengali}\p{scx=Gurmukhi}\p{scx=Gujarati}\p{scx=Oriya}\p{scx=Tamil}\p{scx=Telugu}\p{scx=Kannada}\p{scx=Malayalam}\p{scx=Sinhala}]/u;
const baseCharacter = /[^\s\p{Cc}\p{Cf}]/u;

const isVariationSelector = (codePoint) => (codePoint >= 0xfe00 && codePoint <= 0xfe0f) || (codePoint >= 0xe0100 && codePoint <= 0xe01ef);
const isTagCharacter = (codePoint) => codePoint >= 0xe0000 && codePoint <= 0xe007f;

export function formatCodePoint(codePoint) {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

function characterBefore(text, index) {
  if (index <= 0) return '';
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(index - 2, index);
  }
  return text[index - 1];
}

function characterAt(text, index) {
  const codePoint = text.codePointAt(index);
  return codePoint === undefined ? '' : String.fromCodePoint(codePoint);
}

// Joiners are part of emoji sequences and of Arabic-script and Indic spelling; elsewhere they only hide.
function isMeaningfulJoiner(text, index, codePoint) {
  const before = characterBefore(text, index);
  const after = characterAt(text, index + 1);
  if (!before || !after) return false;
  if (codePoint === 0x200d && emojiBeforeJoiner.test(before) && emojiAfterJoiner.test(after)) return true;
  return joiningScript.test(before) && joiningScript.test(after);
}

function runEnd(text, start, predicate) {
  let index = start;
  while (index < text.length) {
    const codePoint = text.codePointAt(index);
    if (!predicate(codePoint)) break;
    index += codePoint > 0xffff ? 2 : 1;
  }
  return index;
}

function decodeTagRun(text, start, end) {
  let decoded = '';
  for (const character of text.slice(start, end)) {
    const codePoint = character.codePointAt(0);
    if (codePoint >= 0xe0020 && codePoint <= 0xe007e) decoded += String.fromCharCode(codePoint - 0xe0000);
  }
  return decoded;
}

function decodeSelectorRun(text, start, end) {
  const bytes = Array.from(text.slice(start, end), (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 0xfe0f ? codePoint - 0xfe00 : codePoint - 0xe0100 + 16;
  });
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return '';
  }
}

function truncateDecoded(value) {
  const characters = Array.from(value);
  return characters.length > MAX_DECODED_CHARACTERS ? `${characters.slice(0, MAX_DECODED_CHARACTERS).join('')}…` : value;
}

function* runCharacters(text, start, end, name, category) {
  for (let index = start; index < end;) {
    const codePoint = text.codePointAt(index);
    const length = codePoint > 0xffff ? 2 : 1;
    yield { type: 'character', offset: index, length, codePoint, name: name(codePoint), category };
    index += length;
  }
}

// Yields every invisible or unusual character that deserves attention, in text order. Runs of tag
// characters or variation selectors that carry hidden data are announced before their characters.
function* invisibleEvents(text) {
  invisibleCandidates.lastIndex = 0;
  for (let match = invisibleCandidates.exec(text); match; match = invisibleCandidates.exec(text)) {
    const offset = match.index;
    const codePoint = text.codePointAt(offset);
    if (isTagCharacter(codePoint)) {
      const end = runEnd(text, offset, isTagCharacter);
      invisibleCandidates.lastIndex = end;
      const run = text.slice(offset, end);
      // A black flag followed by tag letters and a cancel tag is a subdivision flag emoji, such as Scotland's.
      if (characterBefore(text, offset) === '\u{1F3F4}' && /^[\u{E0020}-\u{E007E}]+\u{E007F}$/u.test(run)) continue;
      yield { type: 'run', offset, end, kind: 'tag characters', count: Array.from(run).length, decoded: truncateDecoded(decodeTagRun(text, offset, end)) };
      yield* runCharacters(text, offset, end, (point) => (point === 0xe0001 ? 'language tag' : point === 0xe007f ? 'cancel tag' : 'tag character'), 'payload');
    } else if (isVariationSelector(codePoint)) {
      const end = runEnd(text, offset, isVariationSelector);
      invisibleCandidates.lastIndex = end;
      const count = Array.from(text.slice(offset, end)).length;
      // One selector after a visible character chooses how that character is drawn, as in ❤\uFE0F.
      if (count === 1 && baseCharacter.test(characterBefore(text, offset))) continue;
      if (count > 1) yield { type: 'run', offset, end, kind: 'variation selectors', count, decoded: truncateDecoded(decodeSelectorRun(text, offset, end)) };
      yield* runCharacters(text, offset, end, () => 'variation selector', 'payload');
    } else {
      const known = invisibleCharacters.get(codePoint);
      if (known && known[1] === 'joiner' && isMeaningfulJoiner(text, offset, codePoint)) continue;
      if (!known && (prependedMarks.test(match[0]) || !formatCharacter.test(match[0]))) continue;
      const [name, category] = known ?? [codePoint >= 0x1d173 && codePoint <= 0x1d17a ? 'musical formatting character' : 'format character', 'invisible'];
      yield { type: 'character', offset, length: match[0].length, codePoint, name, category };
    }
  }
}

function rewriteInvisible(value, categories, replacement = '') {
  let output = '';
  let index = 0;
  for (const event of invisibleEvents(value)) {
    if (event.type !== 'character' || !categories.has(event.category)) continue;
    output += value.slice(index, event.offset) + replacement;
    index = event.offset + event.length;
  }
  return index === 0 ? value : output + value.slice(index);
}

// Adds 1-based line and column numbers, counting columns in code points and treating CR, LF and CRLF as one break each.
function addPositions(text, findings) {
  const pending = findings.filter((finding) => typeof finding.offset === 'number').sort((first, second) => first.offset - second.offset);
  let index = 0;
  let line = 1;
  let column = 1;
  let afterCarriageReturn = false;
  for (const finding of pending) {
    while (index < finding.offset) {
      const code = text.charCodeAt(index);
      if (code === 0x0a) {
        if (!afterCarriageReturn) {
          line += 1;
          column = 1;
        }
        afterCarriageReturn = false;
        index += 1;
      } else if (code === 0x0d) {
        line += 1;
        column = 1;
        afterCarriageReturn = true;
        index += 1;
      } else {
        afterCarriageReturn = false;
        const next = text.charCodeAt(index + 1);
        index += code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? 2 : 1;
        column += 1;
      }
    }
    finding.line = line;
    finding.column = column;
  }
}

function collector() {
  const items = [];
  let total = 0;
  return {
    items,
    add(item) {
      total += 1;
      if (items.length < MAX_FINDINGS_PER_CATEGORY) items.push(item);
    },
    get omitted() {
      return total - items.length;
    }
  };
}

export function validateText(value) {
  if (typeof value !== 'string') throw new TypeError('Clipboard material must be text.');
  if (value.length > MAX_TEXT_CHARACTERS) throw new RangeError(`Text is limited to ${MAX_TEXT_CHARACTERS.toLocaleString('en-AU')} characters.`);
  return value.replace(/\0/g, '\uFFFD');
}

export function inspectText(value) {
  const text = validateText(value);
  const hidden = collector();
  const hiddenText = collector();
  for (const event of invisibleEvents(text)) {
    if (event.type === 'run') {
      hiddenText.add({ offset: event.offset, length: event.end - event.offset, characters: event.count, kind: event.kind, decoded: event.decoded });
    } else hidden.add({ offset: event.offset, codePoint: formatCodePoint(event.codePoint), name: event.name });
  }

  const warningDefinitions = [
    { id: 'aws-access-key', label: 'Likely AWS access key identifier', expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu },
    { id: 'github-token', label: 'Likely GitHub-style token', expression: /\bgh[opusr]_[A-Za-z0-9]{20,255}\b/gu },
    { id: 'bearer-token', label: 'Likely bearer credential', expression: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/giu },
    { id: 'private-key', label: 'Private key header', expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu }
  ];
  const secretWarnings = [];
  let secretWarningTotal = 0;
  for (const definition of warningDefinitions) {
    for (const match of text.matchAll(definition.expression)) {
      secretWarningTotal += 1;
      if (secretWarnings.length < MAX_FINDINGS_PER_CATEGORY) {
        secretWarnings.push({
          id: definition.id,
          label: definition.label,
          offset: match.index ?? 0,
          length: match[0].length,
          disclosure: 'Pattern match only; review the original text. The matched value is not copied into this warning.'
        });
      }
    }
  }
  const terminalControls = [];
  let terminalControlTotal = 0;
  for (const match of text.matchAll(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]|\u001b(?:\[[0-?]*[ -/]*[@-~])?/gu)) {
    terminalControlTotal += 1;
    if (terminalControls.length < MAX_FINDINGS_PER_CATEGORY) {
      terminalControls.push({
        offset: match.index ?? 0,
        codePoint: `U+${(match[0].codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`,
        label: match[0].startsWith('\u001b') ? 'terminal escape sequence' : 'control character'
      });
    }
  }
  const formulaLines = [];
  let formulaLineTotal = 0;
  for (const [index, sourceLine] of text.split(/\r\n?|\n/u).entries()) {
    if (!/^[=+@-]/u.test(sourceLine.trimStart())) continue;
    formulaLineTotal += 1;
    if (formulaLines.length < MAX_FINDINGS_PER_CATEGORY) {
      formulaLines.push({ line: index + 1, label: 'Formula-like line begins with =, +, - or @.' });
    }
  }
  const multilineCommand = text.includes('\n') && text.split('\n').filter((line) => line.trim()).length > 1;
  addPositions(text, [...hidden.items, ...hiddenText.items, ...secretWarnings, ...terminalControls]);
  return {
    characters: text.length,
    bytes: new TextEncoder().encode(text).length,
    lines: text ? text.split(/\r\n?|\n/u).length : 0,
    hidden: hidden.items,
    hiddenText: hiddenText.items,
    secretWarnings,
    terminalControls,
    formulaLines,
    omittedFindings: {
      hidden: hidden.omitted,
      hiddenText: hiddenText.omitted,
      likelySecrets: Math.max(0, secretWarningTotal - secretWarnings.length),
      terminalControls: Math.max(0, terminalControlTotal - terminalControls.length),
      formulaLines: Math.max(0, formulaLineTotal - formulaLines.length)
    },
    multilineCommand,
    limitation: 'Pattern checks can produce false positives and can miss secrets or harmful instructions.'
  };
}

const namedEntities = new Map(Object.entries({
  amp: '&', AMP: '&', lt: '<', LT: '<', gt: '>', GT: '>', quot: '"', QUOT: '"', apos: "'",
  nbsp: '\u00A0', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', zwnj: '\u200C', zwj: '\u200D', lrm: '\u200E', rlm: '\u200F', shy: '\u00AD',
  copy: '©', COPY: '©', reg: '®', REG: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–', minus: '−',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›',
  bull: '•', middot: '·', times: '×', divide: '÷', deg: '°', plusmn: '±', micro: 'µ', para: '¶', sect: '§',
  cent: '¢', pound: '£', yen: '¥', euro: '€', frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³', iexcl: '¡', iquest: '¿'
}));

// Numeric references in 0x80–0x9F are read as Windows-1252, as browsers do.
const windows1252 = new Map([
  [0x80, 0x20ac], [0x82, 0x201a], [0x83, 0x0192], [0x84, 0x201e], [0x85, 0x2026], [0x86, 0x2020], [0x87, 0x2021],
  [0x88, 0x02c6], [0x89, 0x2030], [0x8a, 0x0160], [0x8b, 0x2039], [0x8c, 0x0152], [0x8e, 0x017d], [0x91, 0x2018],
  [0x92, 0x2019], [0x93, 0x201c], [0x94, 0x201d], [0x95, 0x2022], [0x96, 0x2013], [0x97, 0x2014], [0x98, 0x02dc],
  [0x99, 0x2122], [0x9a, 0x0161], [0x9b, 0x203a], [0x9c, 0x0153], [0x9e, 0x017e], [0x9f, 0x0178]
]);

function decodeEntities(value, reserved = '') {
  return value.replace(/&(?:#(\d{1,7})|#[xX]([0-9A-Fa-f]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/gu, (entity, decimal, hexadecimal, name) => {
    if (name) return namedEntities.get(name) ?? entity;
    let codePoint = decimal ? Number.parseInt(decimal, 10) : Number.parseInt(hexadecimal, 16);
    codePoint = windows1252.get(codePoint) ?? codePoint;
    if (codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return '\uFFFD';
    const character = String.fromCodePoint(codePoint);
    return character === reserved ? '\uFFFD' : character;
  });
}

const htmlElements = new Set(`a abbr address area article aside audio b base bdi bdo big blockquote body br button canvas caption
  center cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure font
  footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu
  meta meter nav nobr noscript object ol optgroup option output p param picture pre progress q rp rt ruby s samp script search
  section select slot small source span strike strong style sub summary sup svg table tbody td template textarea tfoot th
  thead time title tr track tt u ul var video wbr`.split(/\s+/u));
const blockElements = new Set(`address article aside blockquote details dialog dl fieldset figure footer form h1 h2 h3 h4 h5 h6
  header hgroup hr main nav ol p pre section table ul`.split(/\s+/u));
const lineElements = new Set(['caption', 'dd', 'div', 'dt', 'figcaption', 'legend', 'li', 'option', 'summary', 'tr']);
const cellElements = new Set(['td', 'th']);
const droppedContentElements = new Set(['head', 'script', 'style', 'template']);

function isElementName(name) {
  const lower = name.toLowerCase();
  if (name.includes(':')) return name === lower; // Office markup such as <o:p>
  if (name.includes('-')) return name === lower; // custom elements
  // Mixed-case names such as List<Object> are code, not markup.
  return htmlElements.has(lower) && (name === lower || name === name.toUpperCase());
}

const tagStart = /<(\/?)([A-Za-z][A-Za-z0-9-]*(?::[A-Za-z][A-Za-z0-9-]*)?)(?=[\s/>])/uy;
const declarationStart = /<[!?][A-Za-z]/uy;
const droppedContentEnd = /<\/(head|script|style|template)(?=[\s/>])/giu;

function findTagEnd(text, index) {
  let quote = '';
  for (; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '>') return index + 1;
    else if (character === '<') return -1;
  }
  return -1;
}

function readTag(text, start) {
  if (text.startsWith('<!--', start)) {
    const close = text.indexOf('-->', start + 4);
    return close === -1 ? null : { kind: 'comment', end: close + 3 };
  }
  if (text.startsWith('<![CDATA[', start)) {
    const close = text.indexOf(']]>', start + 9);
    return close === -1 ? null : { kind: 'cdata', end: close + 3, text: text.slice(start + 9, close) };
  }
  declarationStart.lastIndex = start;
  if (declarationStart.test(text)) {
    const end = findTagEnd(text, start + 2);
    return end === -1 ? null : { kind: 'declaration', end };
  }
  tagStart.lastIndex = start;
  const match = tagStart.exec(text);
  if (!match || !isElementName(match[2])) return null;
  const end = findTagEnd(text, tagStart.lastIndex);
  if (end === -1) return null;
  const name = match[2].toLowerCase();
  const closing = match[1] === '/';
  const tag = { kind: 'element', name, closing, end, resumeAt: end };
  if (!closing && droppedContentElements.has(name) && text[end - 2] !== '/') {
    droppedContentEnd.lastIndex = end;
    for (let found = droppedContentEnd.exec(text); found; found = droppedContentEnd.exec(text)) {
      if (found[1].toLowerCase() !== name) continue;
      const closeEnd = findTagEnd(text, droppedContentEnd.lastIndex);
      if (closeEnd !== -1) tag.resumeAt = closeEnd;
      break;
    }
  }
  return tag;
}

function isStructural(token) {
  return token.kind === 'element' && (token.name === 'br' || blockElements.has(token.name) || lineElements.has(token.name)
    || cellElements.has(token.name) || droppedContentElements.has(token.name));
}

// Markdown code spans and fenced blocks are set aside so that markup inside them survives.
function protectMarkdownCode(value) {
  let sentinel = 0xe000;
  while (value.includes(String.fromCharCode(sentinel))) sentinel += 1;
  const mark = String.fromCharCode(sentinel);
  const saved = [];
  const keep = (segment) => `${mark}${saved.push(segment) - 1}${mark}`;
  const text = value
    .replace(/^ {0,3}((`|~)\2{2,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1\2*[ \t]*\r?$|(?![\s\S]))/gmu, keep)
    .replace(/(?<!`)(`+)(?!`)((?:[^\n]|\n(?![ \t]*\r?\n))+?)(?<!`)\1(?!`)/gu, keep);
  const restore = (output) => output.replace(new RegExp(`${mark}(\\d+)${mark}`, 'gu'), (_, index) => saved[Number(index)]);
  return { text, mark, restore };
}

function stripHtml(value) {
  const { text, mark, restore } = protectMarkdownCode(value);
  const tokens = [];
  let textStart = 0;
  let index = 0;
  for (let next = text.indexOf('<', index); next !== -1; next = text.indexOf('<', index)) {
    const tag = readTag(text, next);
    if (!tag) {
      index = next + 1;
      continue;
    }
    if (next > textStart) tokens.push({ kind: 'text', text: text.slice(textStart, next) });
    tokens.push(tag);
    index = textStart = tag.resumeAt ?? tag.end;
  }
  if (textStart < text.length) tokens.push({ kind: 'text', text: text.slice(textStart) });
  if (!tokens.some(({ kind }) => kind !== 'text')) return restore(decodeEntities(text, mark));

  const output = [];
  let lineHasContent = false;
  const append = (segment) => {
    if (!segment) return;
    output.push(segment);
    const lastBreak = Math.max(segment.lastIndexOf('\n'), segment.lastIndexOf('\r'));
    const tail = lastBreak === -1 ? segment : segment.slice(lastBreak + 1);
    lineHasContent = lastBreak === -1 ? lineHasContent || /[^ \t]/u.test(tail) : /[^ \t]/u.test(tail);
  };
  tokens.forEach((token, position) => {
    if (token.kind === 'text') {
      const previous = tokens[position - 1];
      const next = tokens[position + 1];
      // Whitespace between tags is source formatting when either neighbour is structural.
      if (/^[ \t\r\n\f]*$/u.test(token.text) && previous && next && previous.kind !== 'text' && next.kind !== 'text'
        && (isStructural(previous) || isStructural(next))) return;
      append(decodeEntities(token.text, mark));
    } else if (token.kind === 'cdata') append(token.text);
    else if (token.kind === 'element') {
      if (token.name === 'br' || blockElements.has(token.name)) append('\n');
      else if (lineElements.has(token.name) && lineHasContent) append('\n');
      else if (cellElements.has(token.name) && !token.closing && lineHasContent) append('\t');
    }
  });
  const tidied = output.join('')
    .replace(/(^|\r\n|\r|\n)[ \t]+(?=\r\n|\r|\n|$)/gu, '$1')
    .replace(/(\r\n|\r|\n)(?:\r\n|\r|\n){2,}/gu, '$1$1')
    .replace(/^[ \t\r\n]+|[ \t\r\n]+$/gu, '');
  return restore(tidied);
}

const trackingParameters = new RegExp(`^(?:${[
  'utm_[a-z0-9_]+', 'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'srsltid', 'msclkid', 'yclid', 'twclid', 'ttclid',
  'li_fat_id', 'igshid', 'igsh', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp', 'hsctatracking',
  'mkt_tok', 'oly_anon_id', 'oly_enc_id', 'vero_id', 'vero_conv', 'wickedid', 'rb_clickid', 's_cid', '_ga', '_gl'
].join('|')})$`, 'iu');

// Parameters that only mean tracking on particular sites; elsewhere they may carry meaning.
const siteTrackingParameters = [
  { host: /(?:^|\.)(?:youtube\.com|youtu\.be)$/u, key: /^(?:si|feature)$/u },
  { host: /(?:^|\.)spotify\.com$/u, key: /^si$/u },
  { host: /(?:^|\.)(?:twitter\.com|x\.com)$/u, key: /^(?:s|t|ref_src|ref_url)$/u },
  { host: /(?:^|\.)linkedin\.com$/u, key: /^(?:trk|trackingid|lipi|refid)$/iu },
  { host: /(?:^|\.)amazon\.[a-z.]+$/u, key: /^(?:ref_?|pd_rd_[a-z]+|pf_rd_[a-z]+|qid|sr|crid|sprefix|content-id)$/iu }
];

function isTrackingParameter(key, host) {
  return trackingParameters.test(key) || siteTrackingParameters.some((site) => site.host.test(host) && site.key.test(key));
}

function hostOf(base) {
  const authority = base.slice(base.indexOf('//') + 2).split(/[/\\]/u)[0];
  return authority.slice(authority.lastIndexOf('@') + 1).replace(/:\d*$/u, '').replace(/\.$/u, '').toLowerCase();
}

function count(value, character) {
  let total = 0;
  for (const item of value) if (item === character) total += 1;
  return total;
}

// Sentence punctuation and unbalanced closing brackets after a URL belong to the surrounding text.
function splitTrailingPunctuation(raw) {
  let end = raw.length;
  while (end > 0) {
    const character = raw[end - 1];
    const opening = { ')': '(', ']': '[' }[character];
    if ('.,;:!?*'.includes(character) || (opening && count(raw.slice(0, end), opening) < count(raw.slice(0, end), character))) end -= 1;
    else break;
  }
  return [raw.slice(0, end), raw.slice(end)];
}

function decodeKey(key) {
  try {
    return decodeURIComponent(key.replace(/\+/gu, ' '));
  } catch {
    return key;
  }
}

// The query is edited as raw text so that everything else in the URL stays byte for byte.
function removeTrackingFromUrl(raw) {
  const [url, trailing] = splitTrailingPunctuation(raw);
  const hashIndex = url.indexOf('#');
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
  const queryIndex = beforeHash.indexOf('?');
  if (queryIndex === -1) return raw;
  const base = beforeHash.slice(0, queryIndex);
  const query = beforeHash.slice(queryIndex + 1);
  const separator = query.includes('&amp;') ? '&amp;' : '&';
  const host = hostOf(base);
  const pairs = query.split(separator);
  const kept = pairs.filter((pair) => !isTrackingParameter(decodeKey(pair.split('=')[0]), host));
  if (kept.length === pairs.length) return raw;
  const remaining = kept.filter(Boolean);
  return `${base}${remaining.length ? `?${remaining.join(separator)}` : ''}${hash}${trailing}`;
}

function removeTracking(value) {
  return value.replace(/\bhttps?:\/\/[^\s<>"'`]+/giu, removeTrackingFromUrl);
}

const ruleDefinitions = new Map(Object.entries({
  'strip-html': { label: 'Remove HTML markup', transform: stripHtml },
  'remove-tracking': { label: 'Remove common tracking parameters', transform: removeTracking },
  'remove-zero-width': { label: 'Remove zero-width and invisible formatting characters', transform: (value) => rewriteInvisible(value, new Set(['invisible', 'joiner'])) },
  'remove-directional': { label: 'Remove directional formatting characters', transform: (value) => rewriteInvisible(value, new Set(['directional'])) },
  'remove-invisible-payloads': { label: 'Remove hidden tag-character and variation-selector text', transform: (value) => rewriteInvisible(value, new Set(['payload'])) },
  'strip-terminal-controls': { label: 'Remove terminal control sequences', transform: (value) => value.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~])?/gu, '').replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '') },
  'normalise-line-endings': { label: 'Normalise line endings', transform: (value) => value.replace(/\r\n?|[\u2028\u2029]/gu, '\n') },
  'replace-non-breaking-spaces': { label: 'Replace non-breaking and unusual spaces', transform: (value) => rewriteInvisible(value, new Set(['space']), ' ') },
  'normalise-smart-quotes': { label: 'Normalise smart quotes', transform: (value) => value.replace(/[\u2018\u2019]/gu, "'").replace(/[\u201C\u201D]/gu, '"') },
  'trim-trailing-space': { label: 'Trim trailing whitespace', transform: (value) => value.replace(/[ \t]+$/gmu, '') }
}));

export const RULES = Object.freeze([...ruleDefinitions].map(([id, definition]) => Object.freeze({ id, label: definition.label })));

export const BUILT_IN_RECIPES = Object.freeze([
  { id: 'plain-text', name: 'Plain text', rules: ['strip-html', 'replace-non-breaking-spaces', 'normalise-line-endings'] },
  { id: 'clean-markdown', name: 'Clean Markdown for an issue', rules: ['strip-html', 'remove-tracking', 'remove-zero-width', 'remove-directional', 'remove-invisible-payloads', 'replace-non-breaking-spaces', 'normalise-line-endings', 'trim-trailing-space'] },
  { id: 'safe-terminal', name: 'Review for terminal', rules: ['strip-terminal-controls', 'remove-zero-width', 'remove-directional', 'remove-invisible-payloads', 'replace-non-breaking-spaces', 'normalise-line-endings', 'trim-trailing-space'] },
  { id: 'clean-links', name: 'Remove tracking from links', rules: ['remove-tracking'] },
  { id: 'remove-invisible', name: 'Remove invisible characters', rules: ['remove-zero-width', 'remove-directional', 'remove-invisible-payloads', 'replace-non-breaking-spaces', 'normalise-line-endings'] },
  { id: 'normalise-typography', name: 'Normalise typography', rules: ['replace-non-breaking-spaces', 'normalise-smart-quotes', 'normalise-line-endings'] }
].map((recipe) => Object.freeze({ ...recipe, rules: Object.freeze(recipe.rules) })));

function truncateCodePoints(value, limit) {
  const characters = Array.from(value);
  return characters.length > limit ? characters.slice(0, limit).join('') : value;
}

function generatedRecipeId() {
  const unique = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `custom-${unique}`;
}

export function validateRecipe(value) {
  if (!value || typeof value !== 'object') throw new TypeError('A recipe must be an object.');
  const name = typeof value.name === 'string' ? truncateCodePoints(value.name.trim(), 80) : '';
  if (!name) throw new RangeError('A recipe needs a name.');
  if (!Array.isArray(value.rules) || value.rules.length === 0) throw new RangeError('Select at least one recipe rule.');
  const rules = [...new Set(value.rules)];
  for (const id of rules) {
    if (typeof id !== 'string') throw new TypeError('Recipe rules must be identified by text.');
    if (!ruleDefinitions.has(id)) throw new RangeError(`Unknown transformation rule: ${id}`);
  }
  const id = typeof value.id === 'string' && value.id.trim() ? truncateCodePoints(value.id.trim(), 100) : generatedRecipeId();
  return { id, name, rules };
}

export function applyRecipe(value, recipeValue) {
  const original = validateText(value);
  const recipe = validateRecipe(recipeValue);
  let output = original;
  const edits = [];
  for (const ruleId of recipe.rules) {
    const before = output;
    const rule = ruleDefinitions.get(ruleId);
    output = rule.transform(output);
    edits.push({
      ruleId,
      label: rule.label,
      changed: before !== output,
      before,
      after: output,
      characterDelta: output.length - before.length
    });
  }
  return { input: original, output, recipe, edits, inspection: inspectText(original), outputInspection: inspectText(output) };
}

function visiblePlainText(value) {
  return value.replace(/\t/gu, '⟦tab U+0009⟧').replace(/\r/gu, '⟦carriage return U+000D⟧');
}

export function visibleText(value) {
  const text = validateText(value);
  let output = '';
  let index = 0;
  let truncated = false;
  for (const event of invisibleEvents(text)) {
    if (output.length >= MAX_VISIBLE_PREVIEW_CHARACTERS) {
      truncated = true;
      break;
    }
    if (event.offset < index) continue;
    output += visiblePlainText(text.slice(index, event.offset));
    if (event.type === 'run') {
      output += `⟦${event.count.toLocaleString('en-AU')} ${event.kind}${event.decoded ? ` hiding “${event.decoded}”` : ''}⟧`;
      index = event.end;
    } else {
      output += `⟦${event.name} ${formatCodePoint(event.codePoint)}⟧`;
      index = event.offset + event.length;
    }
  }
  // One character past the limit is enough to tell whether anything was left out.
  if (!truncated) output += visiblePlainText(text.slice(index, index + MAX_VISIBLE_PREVIEW_CHARACTERS + 1));
  if (truncated || output.length > MAX_VISIBLE_PREVIEW_CHARACTERS) {
    output = `${output.slice(0, MAX_VISIBLE_PREVIEW_CHARACTERS)}\n⟦preview truncated at ${MAX_VISIBLE_PREVIEW_CHARACTERS.toLocaleString('en-AU')} characters⟧`;
  }
  return output;
}
