// Écrit apps/api/dist/build-info.json : version (package.json racine), commit et date de construction.
// Le commit vient de LIMS_COMMIT, sinon de git, sinon il reste vide (archive sans historique).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
let commit = process.env.LIMS_COMMIT?.trim() || null;
if (!commit) {
  try {
    commit = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    commit = null;
  }
}
const info = { version, commit, builtAt: new Date().toISOString() };
const out = join(root, 'apps/api/dist/build-info.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(info, null, 2) + '\n');
console.log(`build-info : v${version}${commit ? ` (${commit})` : ''}`);
