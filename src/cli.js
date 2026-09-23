#!/usr/bin/env node
import { BUILT_IN_RECIPES, applyRecipe, inspectText } from './core.js';

const argumentsList = process.argv.slice(2);
const recipeIndex = argumentsList.indexOf('--recipe');
const recipeId = recipeIndex >= 0 ? argumentsList[recipeIndex + 1] : 'clean-markdown';
const inspectOnly = argumentsList.includes('--inspect');
const recipe = BUILT_IN_RECIPES.find((item) => item.id === recipeId);

if (!inspectOnly && !recipe) {
  process.stderr.write(`Unknown recipe “${recipeId}”. Available: ${BUILT_IN_RECIPES.map(({ id }) => id).join(', ')}\n`);
  process.exitCode = 2;
} else {
  process.stderr.write('Loading: reading supplied standard input. No clipboard is accessed.\n');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 500_000) {
      process.stderr.write('Input exceeds the 500,000 character limit.\n');
      process.exitCode = 2;
      break;
    }
  }
  if (!process.exitCode) {
    try {
      if (inspectOnly) {
        const inspection = inspectText(input);
        process.stdout.write(`${JSON.stringify(inspection, null, 2)}\n`);
      } else {
        const result = applyRecipe(input, recipe);
        process.stdout.write(result.output);
        process.stderr.write(`Applied ${result.edits.length} named rules; ${result.edits.filter(({ changed }) => changed).length} changed the supplied text. Review warnings separately with --inspect.\n`);
      }
    } catch (error) {
      process.stderr.write(`Clipclean failed: ${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
