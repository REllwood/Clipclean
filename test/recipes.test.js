import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILT_IN_RECIPES, RULES, applyRecipe, validateRecipe } from '../src/core.js';

test('inherited object keys are not accepted as rule identifiers', () => {
  for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    assert.throws(() => validateRecipe({ name: 'Sneaky', rules: [id] }), /Unknown transformation rule/, id);
    assert.throws(() => applyRecipe('text', { name: 'Sneaky', rules: [id] }), /Unknown transformation rule/, id);
  }
});

test('rule identifiers must be text', () => {
  for (const id of [1, null, {}, ['strip-html']]) {
    assert.throws(() => validateRecipe({ name: 'Odd', rules: [id] }), /identified by text/);
  }
});

test('built-in recipes and rules cannot be modified', () => {
  assert.equal(Object.isFrozen(BUILT_IN_RECIPES), true);
  for (const recipe of BUILT_IN_RECIPES) {
    assert.equal(Object.isFrozen(recipe), true);
    assert.throws(() => recipe.rules.push('strip-html'), TypeError);
  }
  assert.equal(RULES.every(Object.isFrozen), true);
});

test('every built-in recipe validates against the rule catalogue', () => {
  const known = new Set(RULES.map(({ id }) => id));
  for (const recipe of BUILT_IN_RECIPES) {
    assert.deepEqual(validateRecipe(recipe).rules, [...recipe.rules]);
    assert.equal(recipe.rules.every((id) => known.has(id)), true, recipe.id);
  }
  assert.equal(new Set(BUILT_IN_RECIPES.map(({ id }) => id)).size, BUILT_IN_RECIPES.length);
});

test('names and identifiers are truncated without splitting characters', () => {
  const recipe = validateRecipe({ id: `x${'😀'.repeat(120)}`, name: `a${'😀'.repeat(100)}`, rules: ['strip-html'] });
  assert.equal(Array.from(recipe.name).length, 80);
  assert.equal(Array.from(recipe.id).length, 100);
  assert.doesNotMatch(recipe.name + recipe.id, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
});

test('recipes without an identifier get a unique one', () => {
  const first = validateRecipe({ name: 'One', rules: ['strip-html'] });
  const second = validateRecipe({ name: 'Two', rules: ['strip-html'] });
  assert.match(first.id, /^custom-/);
  assert.notEqual(first.id, second.id);
});
