#!/usr/bin/env node
import { BUILT_IN_RECIPES, MAX_TEXT_CHARACTERS, RULES, applyRecipe, inspectText, validateRecipe } from './core.js';

const defaultRecipeId = 'clean-markdown';
const usage = `Usage: clipclean [--recipe <id> | --rules <id,id,...> | --inspect] < input

Reads text from standard input and writes the result to standard output.
No clipboard is accessed.

Options:
  --recipe <id>   Apply a built-in recipe (default: ${defaultRecipeId})
  --rules <ids>   Apply a comma-separated list of rules, in order
  --inspect       Print the inspection report for the input as JSON
  --list          List the built-in recipes and rules
  -h, --help      Show this help
`;

class UsageError extends Error {
  constructor(message, { showHelp = true } = {}) {
    super(message);
    this.showHelp = showHelp;
  }
}

function parseArguments(argumentsList) {
  const options = { recipe: null, rules: null, inspect: false, list: false, help: false };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    const separator = argument.startsWith('--') ? argument.indexOf('=') : -1;
    const flag = separator >= 0 ? argument.slice(0, separator) : argument;
    const inlineValue = separator >= 0 ? argument.slice(separator + 1) : undefined;
    const takeValue = () => {
      if (inlineValue !== undefined) {
        if (!inlineValue) throw new UsageError(`${flag} needs a value.`);
        return inlineValue;
      }
      const next = argumentsList[index + 1];
      if (next === undefined || next.startsWith('-')) throw new UsageError(`${flag} needs a value.`);
      index += 1;
      return next;
    };
    const noValue = () => {
      if (inlineValue !== undefined) throw new UsageError(`${flag} does not take a value.`);
      return true;
    };
    switch (flag) {
      case '--recipe': options.recipe = takeValue(); break;
      case '--rules': options.rules = takeValue().split(',').map((id) => id.trim()).filter(Boolean); break;
      case '--inspect': options.inspect = noValue(); break;
      case '--list': options.list = noValue(); break;
      case '-h':
      case '--help': options.help = noValue(); break;
      default: throw new UsageError(`Unknown option “${argument}”.`);
    }
  }
  if (options.recipe !== null && options.rules !== null) throw new UsageError('Use either --recipe or --rules, not both.');
  if (options.inspect && (options.recipe !== null || options.rules !== null)) {
    throw new UsageError('--inspect reports on the supplied input, so it cannot be combined with --recipe or --rules.');
  }
  return options;
}

function resolveRecipe(options) {
  if (options.rules !== null) {
    try {
      return validateRecipe({ id: 'command-line', name: 'Command-line rules', rules: options.rules });
    } catch (error) {
      throw new UsageError(`${error.message.replace(/\.$/u, '')}. Run with --list to see the available rules.`);
    }
  }
  const recipeId = options.recipe ?? defaultRecipeId;
  const recipe = BUILT_IN_RECIPES.find(({ id }) => id === recipeId);
  if (!recipe) throw new UsageError(`Unknown recipe “${recipeId}”. Available: ${BUILT_IN_RECIPES.map(({ id }) => id).join(', ')}`);
  return recipe;
}

function listRecipesAndRules() {
  const width = Math.max(...[...BUILT_IN_RECIPES, ...RULES].map(({ id }) => id.length));
  const lines = ['Recipes:'];
  for (const recipe of BUILT_IN_RECIPES) lines.push(`  ${recipe.id.padEnd(width)}  ${recipe.name} (${recipe.rules.join(', ')})`);
  lines.push('', 'Rules:');
  for (const rule of RULES) lines.push(`  ${rule.id.padEnd(width)}  ${rule.label}`);
  return `${lines.join('\n')}\n`;
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count.toLocaleString('en-AU')} ${count === 1 ? singular : pluralForm}`;
}

function remainingFindings(inspection) {
  const { omittedFindings } = inspection;
  const counts = [
    [inspection.secretWarnings.length + omittedFindings.likelySecrets, 'likely secret'],
    [inspection.terminalControls.length + omittedFindings.terminalControls, 'terminal control sequence'],
    [inspection.hidden.length + omittedFindings.hidden, 'hidden character'],
    [inspection.formulaLines.length + omittedFindings.formulaLines, 'formula-like line']
  ];
  return counts.filter(([count]) => count > 0).map(([count, label]) => plural(count, label));
}

async function readStandardInput() {
  process.stdin.setEncoding('utf8');
  process.stderr.write(process.stdin.isTTY
    ? 'Reading standard input; press Ctrl-D when finished. No clipboard is accessed.\n'
    : 'Loading: reading supplied standard input. No clipboard is accessed.\n');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > MAX_TEXT_CHARACTERS) {
      throw new UsageError(`Input exceeds the ${MAX_TEXT_CHARACTERS.toLocaleString('en-AU')} character limit.`, { showHelp: false });
    }
  }
  return input;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
    return;
  }
  if (options.list) {
    process.stdout.write(listRecipesAndRules());
    return;
  }
  const recipe = options.inspect ? null : resolveRecipe(options);
  const input = await readStandardInput();
  if (options.inspect) {
    process.stdout.write(`${JSON.stringify(inspectText(input), null, 2)}\n`);
    return;
  }
  const result = applyRecipe(input, recipe);
  process.stdout.write(result.output);
  const changed = result.edits.filter((edit) => edit.changed).length;
  process.stderr.write(`Applied ${plural(result.edits.length, 'named rule')}; ${changed.toLocaleString('en-AU')} changed the supplied text.\n`);
  const remaining = remainingFindings(result.outputInspection);
  if (remaining.length) process.stderr.write(`Warning: the output still contains ${remaining.join(', ')}. Review them with --inspect.\n`);
}

process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

try {
  await main();
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n${error.showHelp ? 'Run with --help for usage.\n' : ''}`);
    process.exitCode = 2;
  } else {
    process.stderr.write(`Clipclean failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
