import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const sections = ['Traqiva frontend/server runtime dependency notices\nGenerated from the installed lockfile. Native-engine/proxy notices are distributed separately with those artifacts.'];
for (const [path, metadata] of Object.entries(lock.packages)) {
  if (!path.startsWith('node_modules/') || metadata.dev || metadata.devOptional) continue;
  const directory = join(root, path);
  const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const files = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile() && /^(license|licence|copying|notice)([.-]|$)/i.test(entry.name));
  if (!files.length) throw new Error(`No runtime license text found for ${pkg.name}; review before distribution.`);
  const texts = await Promise.all(files.map(async entry => `${entry.name}\n${await readFile(join(directory, entry.name), 'utf8')}`));
  sections.push(`${pkg.name}@${pkg.version}\nDeclared license: ${pkg.license || metadata.license || 'See license text'}\n${texts.join('\n\n')}`);
}
const content = sections.join('\n\n' + '='.repeat(72) + '\n\n') + '\n';
await mkdir(join(root, 'public/licenses'), { recursive: true });
await writeFile(join(root, 'public/licenses/BUNDLED_DEPENDENCIES.txt'), content);
console.log(`Generated runtime dependency notices for ${sections.length - 1} packages.`);
