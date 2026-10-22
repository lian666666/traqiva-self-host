import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';

const packages = {
  codex: { name: '@openai/codex', entry: ['bin', 'codex.js'] },
  claude: { name: '@anthropic-ai/claude-code', entry: ['cli.js'] },
};
const isFile = async (path) => { try { return (await stat(path)).isFile(); } catch { return false; } };

async function npmEntry(shim, assistant) {
  const specification = packages[assistant];
  const parent = dirname(shim);
  const roots = [join(parent, 'node_modules', specification.name)];
  if (basename(parent).toLowerCase() === '.bin') roots.push(join(parent, '..', specification.name));
  for (const root of roots) {
    try {
      if (JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).name !== specification.name) continue;
      const entry = join(root, ...specification.entry);
      if (await isFile(entry)) return { file: process.execPath, prefix: [entry] };
    } catch {}
  }
  throw new Error('Unsupported assistant npm shim: its official entry point was not found.');
}

/** Resolve Windows npm wrappers without executing a .cmd/.ps1 file or a shell. */
export async function resolveAssistantCommand(assistant, { env = process.env, platform = process.platform } = {}) {
  if (!Object.hasOwn(packages, assistant)) throw new Error('Unsupported coding assistant.');
  const override = env[assistant === 'codex' ? 'TRAQIVA_CODEX_BIN' : 'TRAQIVA_CLAUDE_BIN'];
  const pathValue = Object.entries(env).find(([name]) => name.toLowerCase() === 'path')?.[1] || '';
  const directories = pathValue.split(platform === 'win32' ? ';' : ':').map((path) => path.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
  if (override) {
    const extension = extname(override).toLowerCase();
    const direct = isAbsolute(override) || /[\\/]/.test(override);
    const candidates = direct ? [resolve(override)] : directories.map((directory) => join(directory, override));
    for (const candidate of candidates) {
      if (!await isFile(candidate)) continue;
      if (['.js', '.mjs'].includes(extension)) return { file: process.execPath, prefix: [candidate] };
      if (platform !== 'win32' || extension === '.exe') return { file: candidate, prefix: [] };
      if (extension === '.cmd') return await npmEntry(candidate, assistant);
      throw new Error('Unsupported Windows assistant executable. Use a native .exe or a .js/.mjs entry.');
    }
    throw new Error('The configured assistant executable was not found.');
  }
  if (platform !== 'win32') return { file: assistant, prefix: [] };
  // Prefer a real executable even when an earlier PATH entry has an npm shim.
  for (const directory of directories) {
    const file = join(directory, `${assistant}.exe`);
    if (await isFile(file)) return { file, prefix: [] };
  }
  for (const directory of directories) {
    const shim = join(directory, `${assistant}.cmd`);
    if (!await isFile(shim)) continue;
    try { return await npmEntry(shim, assistant); } catch {}
  }
  throw new Error('A supported coding assistant executable was not found.');
}
