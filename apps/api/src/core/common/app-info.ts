import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VersionDto } from '@lims/shared';

/**
 * Version de l'application : dist/build-info.json (écrit à la construction), sinon la version
 * du package.json racine (exécution depuis les sources).
 */
function load(): VersionDto {
  const candidates = [join(__dirname, '..', '..', 'build-info.json'), join(process.cwd(), 'dist', 'build-info.json')];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<VersionDto>;
      if (typeof raw.version === 'string') return { version: raw.version, commit: raw.commit ?? null, builtAt: raw.builtAt ?? null };
    } catch {
      // fichier illisible : on retombe sur package.json
    }
  }
  for (const file of [join(process.cwd(), '..', '..', 'package.json'), join(__dirname, '..', '..', '..', '..', '..', 'package.json')]) {
    try {
      const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version?: string };
      if (pkg.name === 'lims' && pkg.version) return { version: pkg.version, commit: null, builtAt: null };
    } catch {
      // essai suivant
    }
  }
  return { version: '0.0.0', commit: null, builtAt: null };
}

export const APP_INFO: VersionDto = load();
