// Test runner: executes every test/*.test.mjs in its own Node process (so the
// app's one-time bootstrap runs fresh per file) and reports a summary.
import { readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const only = process.argv[2];               // optional: `npm test rename` runs matching files
const files = readdirSync(here)
  .filter(f => f.endsWith('.test.mjs'))
  .filter(f => !only || f.includes(only))
  .sort();

if (!files.length) { console.error('No test files found.'); process.exit(1); }

let pass = 0, fail = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [resolve(here, f)], { encoding: 'utf8' });
  const okRun = r.status === 0;
  okRun ? pass++ : fail++;
  console.log(`${okRun ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${f}`);
  if (!okRun) process.stdout.write((r.stdout || '') + (r.stderr || '') + '\n');
}
console.log(`\n${pass}/${pass + fail} test files passed`);
process.exit(fail ? 1 : 0);
