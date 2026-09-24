import { BUILT_IN_RECIPES, RULES, applyRecipe, inspectText, validateRecipe, visibleText } from './core.js';

const recipeStorageKey = 'clipclean:recipes:v0.1';
const recipeBackupKey = `${recipeStorageKey}:unreadable`;
const maxLocalRecipes = 20;
const sample = `<p>Release note\u200B — build “184”</p>
Read <a href="https://docs.example.test/release?utm_source=newsletter&section=changes">the changes</a>.
Token for pattern testing only: ghp_1234567890abcdefghijklmnop
\u001b[31mThis line contains a terminal colour escape.\u001b[0m
=HYPERLINK("https://example.test","Spreadsheet-like line")`;

const elements = {
  recipe: document.querySelector('#recipe-select'),
  recipeRules: document.querySelector('#recipe-rules'),
  deleteRecipe: document.querySelector('#delete-recipe'),
  customName: document.querySelector('#custom-name'),
  customRules: document.querySelector('#custom-rules'),
  input: document.querySelector('#input-text'),
  output: document.querySelector('#output-text'),
  inputSize: document.querySelector('#input-size'),
  inspection: document.querySelector('#inspection-content'),
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
    setStatus(error.name === 'AbortError' ? `${label} cancelled. Supplied text was not changed.` : `${label} failed: ${error.message}`);
    return null;
  } finally {
    if (activeController === controller) activeController = null;
  }
}

function allRecipes() {
  return [...BUILT_IN_RECIPES, ...customRecipes];
}

function currentRecipe() {
  return allRecipes().find(({ id }) => id === elements.recipe.value) ?? BUILT_IN_RECIPES[1];
}

function renderRecipeOptions(selectedId) {
  elements.recipe.replaceChildren();
  for (const recipe of allRecipes()) {
    const option = document.createElement('option');
    option.value = recipe.id;
    option.textContent = `${customRecipes.includes(recipe) ? 'Local: ' : ''}${recipe.name}`;
    elements.recipe.append(option);
  }
  elements.recipe.value = selectedId && allRecipes().some(({ id }) => id === selectedId) ? selectedId : BUILT_IN_RECIPES[1].id;
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
      setStatus(`${unreadableRecipes.length.toLocaleString('en-AU')} saved recipe definition${unreadableRecipes.length === 1 ? '' : 's'} could not be read and ${unreadableRecipes.length === 1 ? 'was' : 'were'} left untouched.`);
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

function renderInspection(inspection, input) {
  elements.inspection.replaceChildren();
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
    const item = document.createElement('li');
    item.className = 'secret';
    item.textContent = `${finding.label} at character ${finding.offset + 1}. ${finding.disclosure}`;
    list.append(item);
  }
  for (const finding of inspection.hiddenText) {
    const item = document.createElement('li');
    item.className = 'secret';
    const where = `${finding.characters.toLocaleString('en-AU')} ${finding.kind} at line ${finding.line}, column ${finding.column}`;
    item.textContent = finding.decoded ? `Hidden text in ${where}: “${finding.decoded}”` : `${where} carry hidden data that is not readable text.`;
    list.append(item);
  }
  for (const finding of inspection.hidden) {
    const item = document.createElement('li');
    item.className = 'information';
    item.textContent = `${finding.name} (${finding.codePoint}) at line ${finding.line}, column ${finding.column}.`;
    list.append(item);
  }
  for (const finding of inspection.terminalControls) {
    const item = document.createElement('li');
    item.className = 'secret';
    item.textContent = `${finding.label} ${finding.codePoint} at character ${finding.offset + 1}. Never execute supplied commands from this tool.`;
    list.append(item);
  }
  for (const finding of inspection.formulaLines) {
    const item = document.createElement('li');
    item.className = 'information';
    item.textContent = `Line ${finding.line}: ${finding.label}`;
    list.append(item);
  }
  const omitted = Object.values(inspection.omittedFindings).reduce((sum, count) => sum + count, 0);
  if (omitted > 0) {
    const item = document.createElement('li');
    item.className = 'information';
    item.textContent = `${omitted.toLocaleString('en-AU')} additional findings were counted but not rendered. Each finding category is capped at 1,000 records.`;
    list.append(item);
  }
  if (inspection.multilineCommand) {
    const item = document.createElement('li');
    item.className = 'information';
    item.textContent = 'The supplied text has multiple non-empty lines. Review line boundaries before using it in a terminal.';
    list.append(item);
  }
  if (!list.children.length) {
    const item = document.createElement('li');
    item.textContent = `No catalogue warnings were detected. ${inspection.limitation}`;
    list.append(item);
  } else {
    const item = document.createElement('li');
    item.textContent = inspection.limitation;
    list.append(item);
  }
  const heading = document.createElement('h4');
  heading.textContent = 'Hidden-character view';
  const visible = document.createElement('div');
  visible.className = 'visible-preview';
  visible.textContent = visibleText(input) || 'Empty text.';
  elements.inspection.append(grid, list, heading, visible);
}

function renderDiff(result) {
  elements.diff.replaceChildren();
  for (const edit of result.edits) {
    const item = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = edit.label;
    const summary = document.createElement('span');
    summary.textContent = edit.changed ? `Changed text; character delta ${edit.characterDelta}.` : 'No matching content; no change.';
    item.append(name, summary);
    if (edit.changed) {
      const details = document.createElement('details');
      const title = document.createElement('summary');
      title.textContent = 'Show this rule’s before and after';
      const comparison = document.createElement('div');
      comparison.className = 'before-after';
      const before = document.createElement('pre');
      before.textContent = edit.before;
      const after = document.createElement('pre');
      after.textContent = edit.after;
      comparison.append(before, after);
      details.append(title, comparison);
      item.append(details);
    }
    elements.diff.append(item);
  }
}

async function transform() {
  const result = await runJob(`inspecting and applying “${currentRecipe().name}”`, async (signal) => {
    const recipe = currentRecipe();
    const inspection = inspectText(elements.input.value);
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const transformed = applyRecipe(elements.input.value, recipe);
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    return { ...transformed, inspection };
  }, { nonInterruptibleBoundary: 'The bounded synchronous inspection has started and cannot be cancelled until it returns.' });
  if (!result) return;
  lastResult = result;
  elements.output.value = result.output;
  elements.copy.disabled = false;
  renderInspection(result.inspection, result.input);
  renderDiff(result);
  const changed = result.edits.filter(({ changed }) => changed).length;
  setStatus(`Inspection complete. ${changed} of ${result.edits.length} named rules changed the preview. Review ${result.inspection.secretWarnings.length} likely-secret warnings before copying.`);
}

elements.input.addEventListener('input', () => {
  elements.inputSize.textContent = `${elements.input.value.length.toLocaleString('en-AU')} characters`;
  elements.copy.disabled = true;
  setStatus('Supplied text changed. Inspect again before copying.');
});
elements.recipe.addEventListener('change', () => {
  renderSelectedRules();
  elements.copy.disabled = true;
  setStatus('Recipe changed. Inspect again before copying.');
});
document.querySelector('#transform-button').addEventListener('click', transform);
document.querySelector('#sample-button').addEventListener('click', () => {
  elements.input.value = sample;
  elements.input.dispatchEvent(new Event('input'));
  elements.input.focus();
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
  if (!lastResult || elements.output.value !== lastResult.output) {
    setStatus('The preview changed. Inspect again before copying.');
    return;
  }
  const copied = await runJob('requesting an explicit browser clipboard write', async (signal) => {
    if (!navigator.clipboard?.writeText) throw new Error('This browser does not provide clipboard writing in the current context. Select the output manually.');
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    await navigator.clipboard.writeText(lastResult.output);
    return true;
  }, { nonInterruptibleBoundary: 'The browser clipboard request cannot be cancelled after it has been issued.' });
  if (copied) setStatus('Cleaned plain text written through the browser clipboard API after your action. No expiry or native change-count check is available in this web build.');
});
elements.cancel.addEventListener('click', () => activeController?.abort());

initialiseCustomRules();
loadRecipes();
