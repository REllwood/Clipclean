export const MAX_TEXT_CHARACTERS = 500_000;
export const MAX_FINDINGS_PER_CATEGORY = 1_000;
export const MAX_VISIBLE_PREVIEW_CHARACTERS = 60_000;

const hiddenCharacters = new Map([
  [0x00a0, 'non-breaking space'],
  [0x200b, 'zero-width space'],
  [0x200c, 'zero-width non-joiner'],
  [0x200d, 'zero-width joiner'],
  [0x202a, 'left-to-right embedding'],
  [0x202b, 'right-to-left embedding'],
  [0x202c, 'pop directional formatting'],
  [0x202d, 'left-to-right override'],
  [0x202e, 'right-to-left override'],
  [0x2066, 'left-to-right isolate'],
  [0x2067, 'right-to-left isolate'],
  [0x2068, 'first strong isolate'],
  [0x2069, 'pop directional isolate'],
  [0xfeff, 'zero-width no-break space']
]);

export function validateText(value) {
  if (typeof value !== 'string') throw new TypeError('Clipboard material must be text.');
  if (value.length > MAX_TEXT_CHARACTERS) throw new RangeError(`Text is limited to ${MAX_TEXT_CHARACTERS.toLocaleString('en-AU')} characters.`);
  return value.replace(/\0/g, '\uFFFD');
}

export function inspectText(value) {
  const text = validateText(value);
  const hidden = [];
  let offset = 0;
  let line = 1;
  let column = 1;
  let hiddenTotal = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (hiddenCharacters.has(codePoint)) {
      hiddenTotal += 1;
      if (hidden.length < MAX_FINDINGS_PER_CATEGORY) {
        hidden.push({
          offset,
          codePoint: `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`,
          name: hiddenCharacters.get(codePoint),
          line,
          column
        });
      }
    }
    offset += character.length;
    if (character === '\n') {
      line += 1;
      column = 1;
    } else column += character.length;
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
  return {
    characters: text.length,
    bytes: new TextEncoder().encode(text).length,
    lines: text ? text.split(/\r\n?|\n/u).length : 0,
    hidden,
    secretWarnings,
    terminalControls,
    formulaLines,
    omittedFindings: {
      hidden: Math.max(0, hiddenTotal - hidden.length),
      likelySecrets: Math.max(0, secretWarningTotal - secretWarnings.length),
      terminalControls: Math.max(0, terminalControlTotal - terminalControls.length),
      formulaLines: Math.max(0, formulaLineTotal - formulaLines.length)
    },
    multilineCommand,
    limitation: 'Pattern checks can produce false positives and can miss secrets or harmful instructions.'
  };
}

function decodeBasicEntities(value) {
  return value
    .replace(/&nbsp;/giu, '\u00A0')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'");
}

function stripHtml(value) {
  let output = '';
  let insideTag = false;
  let tag = '';
  for (const character of value) {
    if (!insideTag && character === '<') {
      insideTag = true;
      tag = '';
    } else if (insideTag && character === '>') {
      insideTag = false;
      if (/^\/?(?:p|div|br|li|h[1-6]|tr)\b/iu.test(tag.trim())) output += '\n';
    } else if (insideTag) tag += character;
    else output += character;
  }
  if (insideTag) output += `<${tag}`;
  return decodeBasicEntities(output).replace(/\n{3,}/gu, '\n\n').trim();
}

function removeTracking(value) {
  const urlPattern = /\bhttps?:\/\/[^\s<>"'`]+/giu;
  return value.replace(urlPattern, (raw) => {
    const punctuation = /[),.;!?]$/u.test(raw) ? raw.at(-1) : '';
    const candidate = punctuation ? raw.slice(0, -1) : raw;
    try {
      const url = new URL(candidate);
      for (const key of [...url.searchParams.keys()]) {
        if (/^(?:utm_.+|fbclid|gclid|dclid|mc_cid|mc_eid|_hsenc|_hsmi)$/iu.test(key)) url.searchParams.delete(key);
      }
      return `${url.href}${punctuation}`;
    } catch {
      return raw;
    }
  });
}

const ruleDefinitions = {
  'strip-html': { label: 'Remove HTML markup', transform: stripHtml },
  'remove-tracking': { label: 'Remove common tracking parameters', transform: removeTracking },
  'remove-zero-width': { label: 'Remove zero-width characters', transform: (value) => value.replace(/[\u200B-\u200D\uFEFF]/gu, '') },
  'remove-directional': { label: 'Remove directional formatting characters', transform: (value) => value.replace(/[\u202A-\u202E\u2066-\u2069]/gu, '') },
  'strip-terminal-controls': { label: 'Remove terminal control sequences', transform: (value) => value.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~])?/gu, '').replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '') },
  'normalise-line-endings': { label: 'Normalise line endings', transform: (value) => value.replace(/\r\n?/gu, '\n') },
  'replace-non-breaking-spaces': { label: 'Replace non-breaking spaces', transform: (value) => value.replace(/\u00A0/gu, ' ') },
  'normalise-smart-quotes': { label: 'Normalise smart quotes', transform: (value) => value.replace(/[\u2018\u2019]/gu, "'").replace(/[\u201C\u201D]/gu, '"') },
  'trim-trailing-space': { label: 'Trim trailing whitespace', transform: (value) => value.replace(/[ \t]+$/gmu, '') }
};

export const RULES = Object.freeze(Object.entries(ruleDefinitions).map(([id, definition]) => ({ id, label: definition.label })));

export const BUILT_IN_RECIPES = Object.freeze([
  { id: 'plain-text', name: 'Plain text', rules: ['strip-html', 'normalise-line-endings'] },
  { id: 'clean-markdown', name: 'Clean Markdown for an issue', rules: ['strip-html', 'remove-tracking', 'remove-zero-width', 'normalise-line-endings', 'trim-trailing-space'] },
  { id: 'safe-terminal', name: 'Review for terminal', rules: ['strip-terminal-controls', 'remove-directional', 'normalise-line-endings', 'trim-trailing-space'] },
  { id: 'clean-links', name: 'Remove tracking from links', rules: ['remove-tracking'] },
  { id: 'normalise-typography', name: 'Normalise typography', rules: ['replace-non-breaking-spaces', 'normalise-smart-quotes', 'normalise-line-endings'] }
]);

export function validateRecipe(value) {
  if (!value || typeof value !== 'object') throw new TypeError('A recipe must be an object.');
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 80) : '';
  if (!name) throw new RangeError('A recipe needs a name.');
  if (!Array.isArray(value.rules) || value.rules.length === 0) throw new RangeError('Select at least one recipe rule.');
  const rules = [...new Set(value.rules)];
  for (const id of rules) if (!ruleDefinitions[id]) throw new RangeError(`Unknown transformation rule: ${id}`);
  return { id: typeof value.id === 'string' && value.id.trim() ? value.id.trim().slice(0, 100) : `custom-${Date.now()}`, name, rules };
}

export function applyRecipe(value, recipeValue) {
  const original = validateText(value);
  const recipe = validateRecipe(recipeValue);
  let output = original;
  const edits = [];
  for (const ruleId of recipe.rules) {
    const before = output;
    output = ruleDefinitions[ruleId].transform(output);
    edits.push({
      ruleId,
      label: ruleDefinitions[ruleId].label,
      changed: before !== output,
      before,
      after: output,
      characterDelta: output.length - before.length
    });
  }
  return { input: original, output, recipe, edits, inspection: inspectText(original), outputInspection: inspectText(output) };
}

export function visibleText(value) {
  const text = validateText(value);
  let output = '';
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (hiddenCharacters.has(codePoint)) output += `⟦${hiddenCharacters.get(codePoint)} ${`U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`}⟧`;
    else if (character === '\t') output += '⟦tab U+0009⟧';
    else if (character === '\r') output += '⟦carriage return U+000D⟧';
    else output += character;
    if (output.length >= MAX_VISIBLE_PREVIEW_CHARACTERS) {
      output = `${output.slice(0, MAX_VISIBLE_PREVIEW_CHARACTERS)}\n⟦preview truncated at ${MAX_VISIBLE_PREVIEW_CHARACTERS.toLocaleString('en-AU')} characters⟧`;
      break;
    }
  }
  return output;
}
