import { BUILT_IN_RECIPES, MAX_TEXT_CHARACTERS, RULES, applyRecipe, describeChanges, validateRecipe, visibleText } from './core.js';
import { SAMPLE_TEXT } from './sample.js';

const recipeStorageKey = 'clipclean:recipes:v0.1';
const recipeBackupKey = `${recipeStorageKey}:unreadable`;
const maxLocalRecipes = 20;
const defaultRecipeId = 'clean-markdown';

const elements = {
  recipe: document.querySelector('#recipe-select'),
  recipeRules: document.querySelector('#recipe-rules'),
  deleteRecipe: document.querySelector('#delete-recipe'),
  customName: document.querySelector('#custom-name'),
  customRules: document.querySelector('#custom-rules'),
  input: document.querySelector('#input-text'),
  output: document.querySelector('#output-text'),
  inputSize: document.querySelector('#input-size'),
  openFile: document.querySelector('#open-file'),
  fileInput: document.querySelector('#file-input'),
  inspection: document.querySelector('#inspection-content'),
  outputInspection: document.querySelector('#output-inspection-content'),
  diff: document.querySelector('#diff-list'),
  copy: document.querySelector('#copy-button'),
  status: document.querySelector('#job-status'),
  cancel: document.querySelector('#cancel-job')
};

let customRecipes = [];
// Stored entries that could not be validated are kept as they are, so saving never discards them.
let unreadableRecipes = [];
let activeController = null;
let lastResult = null;
// Text areas turn CR and CRLF into LF. When text arrives whole from a paste or a file, the exact original is kept
// here so carriage returns can still be inspected; any edit in the text area falls back to its value.
let exactText = null;
let pendingPaste = null;

function setStatus(message, loading = false, cancellable = loading) {
  elements.status.textContent = message;
  elements.status.classList.toggle('loading', loading);
  elements.cancel.hidden = !loading || !cancellable;
}

async function runJob(label, work, options = {}) {
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  setStatus(`Loading: ${label}`, true);
  try {
    await new Promise((resolve, reject) => {
      const timer = window.setTimeout(resolve, 45);
      controller.signal.addEventListener('abort', () => {
        window.clearTimeout(timer);
        reject(new DOMException('Cancelled', 'AbortError'));
      }, { once: true });
    });
    if (options.nonInterruptibleBoundary) {
      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      setStatus(`Loading: ${label}. ${options.nonInterruptibleBoundary}`, true, false);
    }
    const value = await work(controller.signal);
    setStatus(`${label} complete.`);
    return value;
  } catch (error) {
    // A job replaced by a newer one leaves the status to its successor.
    if (activeController === controller) {
      setStatus(error.name === 'AbortError' ? `${label} cancelled. Supplied text was not changed.` : `${label} failed: ${error.message}`);
    }
    return null;
  } finally {
    if (activeController === controller) activeController = null;
  }
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count.toLocaleString('en-AU')} ${count === 1 ? singular : pluralForm}`;
}

function suppliedText() {
  return exactText ?? elements.input.value;
}

function suppliedTextChanged(message = 'Supplied text changed. Inspect again before copying.') {
  const text = suppliedText();
  const carriageReturns = exactText?.includes('\r') ? ' Carriage returns are kept for inspection; the text box shows them as line breaks.' : '';
  elements.inputSize.textContent = plural(text.length, 'character');
  elements.copy.disabled = true;
  setStatus(`${message}${carriageReturns}`);
}

function loadExactText(text, message) {
  exactText = text;
  elements.input.value = text;
  suppliedTextChanged(message);
}

function allRecipes() {
  return [...BUILT_IN_RECIPES, ...customRecipes];
}

function currentRecipe() {
  return allRecipes().find(({ id }) => id === elements.recipe.value) ?? BUILT_IN_RECIPES.find(({ id }) => id === defaultRecipeId);
}

function renderRecipeOptions(selectedId) {
  elements.recipe.replaceChildren();
  for (const recipe of allRecipes()) {
    const option = document.createElement('option');
    option.value = recipe.id;
    option.textContent = `${customRecipes.includes(recipe) ? 'Local: ' : ''}${recipe.name}`;
    elements.recipe.append(option);
  }
  elements.recipe.value = selectedId && allRecipes().some(({ id }) => id === selectedId) ? selectedId : defaultRecipeId;
  renderSelectedRules();
}

function renderSelectedRules() {
  elements.recipeRules.replaceChildren();
  elements.deleteRecipe.hidden = !customRecipes.some(({ id }) => id === elements.recipe.value);
  const byId = new Map(RULES.map((rule) => [rule.id, rule.label]));
  for (const id of currentRecipe().rules) {
    const text = document.createElement('p');
    text.textContent = byId.get(id) ?? id;
    elements.recipeRules.append(text);
  }
}

function initialiseCustomRules() {
  for (const rule of RULES) {
    const label = document.createElement('label');
    label.className = 'rule-check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = rule.id;
    const text = document.createElement('span');
    text.textContent = rule.label;
    label.append(input, text);
    elements.customRules.append(label);
  }
}

function storeRecipes(recipes) {
  localStorage.setItem(recipeStorageKey, JSON.stringify([...recipes, ...unreadableRecipes]));
}

function loadRecipes() {
  customRecipes = [];
  unreadableRecipes = [];
  let raw = null;
  try {
    raw = localStorage.getItem(recipeStorageKey);
    const values = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(values)) throw new TypeError('the stored value is not a list');
    const takenIds = new Set(BUILT_IN_RECIPES.map(({ id }) => id));
    for (const value of values) {
      try {
        const recipe = validateRecipe(value);
        if (takenIds.has(recipe.id)) recipe.id = `local-${crypto.randomUUID()}`;
        takenIds.add(recipe.id);
        customRecipes.push(recipe);
      } catch {
        unreadableRecipes.push(value);
      }
    }
    customRecipes = customRecipes.slice(-maxLocalRecipes);
    if (unreadableRecipes.length) {
      setStatus(`${plural(unreadableRecipes.length, 'saved recipe definition')} could not be read and ${unreadableRecipes.length === 1 ? 'was' : 'were'} left untouched.`);
    }
  } catch (error) {
    customRecipes = [];
    unreadableRecipes = [];
    try {
      if (raw !== null && localStorage.getItem(recipeBackupKey) === null) localStorage.setItem(recipeBackupKey, raw);
    } catch {
      // Storage is unavailable; there is nothing further to preserve.
    }
    setStatus(`Local recipe definitions could not be loaded: ${error.message}.${raw !== null ? ' The stored value was kept as a backup.' : ''}`);
  }
  renderRecipeOptions();
}

function findingItem(className, text) {
  const item = document.createElement('li');
  if (className) item.className = className;
  item.textContent = text;
  return item;
}

// Consecutive identical invisible characters, such as a run of zero-width spaces, are listed once with a count.
function groupHidden(findings) {
  const groups = [];
  for (const finding of findings) {
    const previous = groups.at(-1);
    const codePoint = Number.parseInt(finding.codePoint.slice(2), 16);
    if (previous && previous.name === finding.name && previous.nextOffset === finding.offset) {
      previous.count += 1;
      previous.lastCodePoint = finding.codePoint;
    } else groups.push({ ...finding, count: 1, lastCodePoint: finding.codePoint });
    groups.at(-1).nextOffset = finding.offset + (codePoint > 0xffff ? 2 : 1);
  }
  return groups;
}

function remainingFindings(inspection) {
  const { omittedFindings } = inspection;
  return [
    [inspection.secretWarnings.length + omittedFindings.likelySecrets, 'likely secret'],
    [inspection.hiddenText.length + omittedFindings.hiddenText, 'hidden text run'],
    [inspection.terminalControls.length + omittedFindings.terminalControls, 'terminal control sequence'],
    [inspection.hidden.length + omittedFindings.hidden, 'hidden character'],
    [inspection.formulaLines.length + omittedFindings.formulaLines, 'formula-like line']
  ].filter(([count]) => count > 0).map(([count, label]) => plural(count, label));
}

function renderInspection(container, inspection, text, { previewHeading = 'Hidden-character view' } = {}) {
  container.replaceChildren();
  const grid = document.createElement('div');
  grid.className = 'inspection-grid';
  for (const [label, value] of [
    ['Characters', inspection.characters],
    ['UTF-8 bytes', inspection.bytes],
    ['Lines', inspection.lines]
  ]) {
    const metric = document.createElement('div');
    metric.className = 'metric';
    const strong = document.createElement('strong');
    strong.textContent = value.toLocaleString('en-AU');
    const caption = document.createElement('span');
    caption.textContent = label;
    metric.append(strong, caption);
    grid.append(metric);
  }
  const list = document.createElement('ul');
  list.className = 'finding-list';
  for (const finding of inspection.secretWarnings) {
    list.append(findingItem('secret', `${finding.label} at line ${finding.line}, column ${finding.column}. ${finding.disclosure}`));
  }
  for (const finding of inspection.hiddenText) {
    const where = `${plural(finding.characters, finding.kind.replace(/s$/u, ''), finding.kind)} at line ${finding.line}, column ${finding.column}`;
    list.append(findingItem('secret', finding.decoded ? `Hidden text in ${where}: “${finding.decoded}”` : `${where} carry hidden data that is not readable text.`));
  }
  for (const finding of inspection.terminalControls) {
    list.append(findingItem('secret', `${finding.label}${finding.detail ? `: “${finding.detail}”` : ''} at line ${finding.line}, column ${finding.column}. Never execute supplied commands from this tool.`));
  }
  for (const group of groupHidden(inspection.hidden)) {
    const codePoints = group.codePoint === group.lastCodePoint ? group.codePoint : `${group.codePoint}–${group.lastCodePoint}`;
    const count = group.count > 1 ? `${group.count.toLocaleString('en-AU')} × ` : '';
    list.append(findingItem('information', `${count}${group.name} (${codePoints}) at line ${group.line}, column ${group.column}.`));
  }
  for (const finding of inspection.formulaLines) {
    list.append(findingItem('information', `Line ${finding.line}: ${finding.label}`));
  }
  const omitted = Object.values(inspection.omittedFindings).reduce((sum, count) => sum + count, 0);
  if (omitted > 0) {
    list.append(findingItem('information', `${plural(omitted, 'additional finding')} ${omitted === 1 ? 'was' : 'were'} counted but not listed. Each finding category is capped at 1,000 records.`));
  }
  if (inspection.multilineCommand) {
    list.append(findingItem('information', 'The text has multiple non-empty lines. Review line boundaries before using it in a terminal.'));
  }
  list.append(findingItem('', list.children.length ? inspection.limitation : `No catalogue warnings were detected. ${inspection.limitation}`));
  const heading = document.createElement('h4');
  heading.textContent = previewHeading;
  const visible = document.createElement('div');
  visible.className = 'visible-preview';
  visible.textContent = visibleText(text) || 'Empty text.';
  container.append(grid, list, heading, visible);
}

function renderDiff(result) {
  elements.diff.replaceChildren();
  for (const edit of result.edits) {
    const item = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = edit.label;
    const summary = document.createElement('span');
    item.append(name, summary);
    if (!edit.changed) {
      summary.textContent = 'No matching content; no change.';
      elements.diff.append(item);
      continue;
    }
    const { hunks, omitted } = describeChanges(edit.before, edit.after);
    const delta = edit.characterDelta;
    summary.textContent = `Changed ${plural(hunks.length + omitted, 'place')}; ${delta > 0 ? `${plural(delta, 'character')} added` : delta < 0 ? `${plural(-delta, 'character')} removed` : 'same length'}.`;
    const details = document.createElement('details');
    const title = document.createElement('summary');
    title.textContent = 'Show what this rule changed';
    details.append(title);
    for (const hunk of hunks) {
      const where = document.createElement('p');
      where.className = 'hunk-location';
      where.textContent = hunk.lines === 0 ? `Added at line ${hunk.line}` : hunk.lines > 1 ? `Lines ${hunk.line}–${hunk.line + hunk.lines - 1}` : `Line ${hunk.line}`;
      const comparison = document.createElement('div');
      comparison.className = 'before-after';
      for (const [label, value, count, none] of [['Before', hunk.before, hunk.lines, '(nothing here before)'], ['After', hunk.after, hunk.addedLines, '(removed)']]) {
        const pre = document.createElement('pre');
        pre.setAttribute('aria-label', label);
        pre.textContent = count === 0 ? none : visibleText(value) || '(empty line)';
        comparison.append(pre);
      }
      details.append(where, comparison);
    }
    if (omitted) {
      const more = document.createElement('p');
      more.className = 'hunk-location';
      more.textContent = `${plural(omitted, 'more changed line')} not shown.`;
      details.append(more);
    }
    item.append(details);
    elements.diff.append(item);
  }
}

async function transform() {
  const recipe = currentRecipe();
  const text = suppliedText();
  const result = await runJob(`inspecting and applying “${recipe.name}”`, async () => applyRecipe(text, recipe), {
    nonInterruptibleBoundary: 'The bounded synchronous inspection has started and cannot be cancelled until it returns.'
  });
  if (!result) return;
  lastResult = result;
  elements.output.value = result.output;
  elements.copy.disabled = false;
  renderInspection(elements.inspection, result.inspection, result.input);
  renderInspection(elements.outputInspection, result.outputInspection, result.output, { previewHeading: 'Hidden-character view of the output' });
  renderDiff(result);
  const changed = result.edits.filter((edit) => edit.changed).length;
  const remaining = remainingFindings(result.outputInspection);
  setStatus(`Inspection complete. ${changed} of ${plural(result.edits.length, 'named rule')} changed the text. ${remaining.length
    ? `The output still contains ${remaining.join(', ')}. Review the output check before copying.`
    : 'The output check found no catalogue warnings.'}`);
}

async function openFile(file) {
  if (!file) return;
  if (file.size > MAX_TEXT_CHARACTERS * 4) {
    setStatus(`“${file.name}” is too large. Text is limited to ${MAX_TEXT_CHARACTERS.toLocaleString('en-AU')} characters.`);
    return;
  }
  try {
    const bytes = await file.arrayBuffer();
    let text;
    let note = '';
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
      note = ' It is not valid UTF-8, so unreadable bytes were shown as replacement characters.';
    }
    if (text.length > MAX_TEXT_CHARACTERS) {
      setStatus(`“${file.name}” is too large. Text is limited to ${MAX_TEXT_CHARACTERS.toLocaleString('en-AU')} characters.`);
      return;
    }
    loadExactText(text, `Opened “${file.name}”.${note} Inspect it before copying anything.`);
  } catch (error) {
    setStatus(`“${file.name}” could not be read: ${error.message}`);
  }
}

elements.input.addEventListener('paste', (event) => {
  pendingPaste = event.clipboardData?.getData('text/plain') ?? null;
});
elements.input.addEventListener('input', (event) => {
  // Keep the exact pasted text only when the paste replaced everything, so the text area holds nothing else.
  const pasted = pendingPaste;
  pendingPaste = null;
  exactText = event.inputType === 'insertFromPaste' && pasted !== null && elements.input.value === pasted.replace(/\r\n?/gu, '\n') ? pasted : null;
  suppliedTextChanged();
});
elements.recipe.addEventListener('change', () => {
  renderSelectedRules();
  elements.copy.disabled = true;
  setStatus('Recipe changed. Inspect again before copying.');
});
document.querySelector('#transform-button').addEventListener('click', transform);
document.querySelector('#sample-button').addEventListener('click', () => {
  loadExactText(SAMPLE_TEXT, 'Synthetic release note loaded. Inspect it to see what it hides.');
  elements.input.focus();
});
elements.openFile.addEventListener('click', () => elements.fileInput.click());
elements.fileInput.addEventListener('change', async () => {
  await openFile(elements.fileInput.files?.[0]);
  elements.fileInput.value = '';
});
document.addEventListener('dragover', (event) => {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
});
document.addEventListener('drop', (event) => {
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault();
  openFile(event.dataTransfer.files[0]);
});
document.querySelector('#save-recipe').addEventListener('click', () => {
  try {
    const recipe = validateRecipe({
      id: `local-${crypto.randomUUID()}`,
      name: elements.customName.value,
      rules: [...elements.customRules.querySelectorAll('input:checked')].map(({ value }) => value)
    });
    const recipes = [...customRecipes, recipe].slice(-maxLocalRecipes);
    storeRecipes(recipes);
    customRecipes = recipes;
    renderRecipeOptions(recipe.id);
    elements.copy.disabled = true;
    elements.customName.value = '';
    elements.customRules.querySelectorAll('input').forEach((input) => { input.checked = false; });
    setStatus(`Recipe “${recipe.name}” saved locally. No supplied text was stored.`);
  } catch (error) {
    setStatus(`Recipe could not be saved: ${error.message}`);
  }
});
elements.deleteRecipe.addEventListener('click', () => {
  const recipe = customRecipes.find(({ id }) => id === elements.recipe.value);
  if (!recipe || !window.confirm(`Delete the local recipe “${recipe.name}”?`)) return;
  try {
    const recipes = customRecipes.filter((item) => item !== recipe);
    storeRecipes(recipes);
    customRecipes = recipes;
    renderRecipeOptions();
    elements.copy.disabled = true;
    setStatus(`Local recipe “${recipe.name}” deleted. Inspect again before copying.`);
  } catch (error) {
    setStatus(`Recipe could not be deleted: ${error.message}`);
  }
});
elements.copy.addEventListener('click', async () => {
  const recipe = currentRecipe();
  if (!lastResult || lastResult.input !== suppliedText() || lastResult.recipe.rules.join() !== recipe.rules.join()) {
    setStatus('The text or recipe changed. Inspect again before copying.');
    return;
  }
  const output = lastResult.output;
  const copied = await runJob('requesting an explicit browser clipboard write', async (signal) => {
    if (!navigator.clipboard?.writeText) throw new Error('This browser does not provide clipboard writing in the current context. Select the output manually.');
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    await navigator.clipboard.writeText(output);
    return true;
  }, { nonInterruptibleBoundary: 'The browser clipboard request cannot be cancelled after it has been issued.' });
  if (copied) setStatus('Cleaned plain text written through the browser clipboard API after your action. No expiry or native change-count check is available in this web build.');
});
elements.cancel.addEventListener('click', () => activeController?.abort());

initialiseCustomRules();
loadRecipes();
