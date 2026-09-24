import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('..', import.meta.url));
const checkedExtensions = new Set(['.js', '.mjs', '.json', '.html', '.css', '.md']);
// fixtures/ holds deliberately messy sample text.
const skippedDirectories = new Set(['.git', 'node_modules', 'fixtures']);
const invisible = /[\p{Default_Ignorable_Code_Point}\p{Zl}\p{Zp}\p{Mn}\p{Me}]|[^\P{Zs} ]|[^\P{Cc}\t\n\r]/gu;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || skippedDirectories.has(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return checkedExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

test('source files spell invisible characters as escape sequences', () => {
  const problems = [];
  for (const path of sourceFiles(repository)) {
    const lines = readFileSync(path, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const match of line.matchAll(invisible)) {
        const codePoint = match[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
        problems.push(`${relative(repository, path)}:${index + 1} contains U+${codePoint}`);
      }
    });
  }
  assert.deepEqual(problems, []);
});
