import { readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), 'upstream');
const marker = '// Traqiva modification (2026-10-20): Traqiva recovery names / local-only integration; see runtime/MODIFICATIONS.md.\n';
const changed = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.endsWith('.go')) {
      const before = await readFile(path, 'utf8');
      let after = before.replaceAll('caveman_retrieve', 'traqiva_retrieve').replaceAll('mcp__caveman', 'mcp__traqiva').replaceAll('caveman_traqiva_retrieve', 'traqiva_traqiva_retrieve');
      if (path.endsWith(join('cloudlink', 'link.go')) && !after.includes('Traqiva never reads Caveman Cloud settings')) {
        after = after.replace('func (l *Link) settings() settings {', 'func (l *Link) settings() settings {\n\t// Traqiva never reads Caveman Cloud settings or credentials and never routes to it.\n\tif true { return settings{offline: true, noTelemetry: true} }');
      }
      if (path.endsWith(join('caveman-proxy', 'main.go'))) after = after.replaceAll('".caveman"', '".traqiva"');
      if (before !== after) {
        if (!after.includes(marker.trim())) after = after.replace(/\npackage /, '\n' + marker + 'package ');
        await writeFile(path, after);
        changed.push(relative(root, path).replaceAll('\\', '/'));
      }
    }
  }
}
await walk(join(root, 'proxy'));
const invariantPath = join(root, 'engine/compressors/invariants.go');
let invariant = await readFile(invariantPath, 'utf8');
if (invariant.includes('caveman_retrieve')) {
  invariant = invariant.replaceAll('caveman_retrieve', 'traqiva_retrieve');
  invariant = invariant.replace(/\npackage /, '\n' + marker + 'package ');
  await writeFile(invariantPath, invariant);
  changed.push('engine/compressors/invariants.go');
}
process.stdout.write(JSON.stringify({ changed }, null, 2) + '\n');
