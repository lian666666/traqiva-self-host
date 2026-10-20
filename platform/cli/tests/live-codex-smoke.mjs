// Explicit operator-run integration check. Never included in npm test; makes one
// real Codex task using the existing user's normal auth store without copying it.
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = fileURLToPath(new URL('../bin/traqiva.mjs', import.meta.url));
const task = await mkdtemp(join(tmpdir(), 'TraqivaAgentSmoke-'));
const home = join(task, 'traqiva'); const work = join(task, 'fixture');
await mkdir(join(home, 'bin'), { recursive: true, mode: 0o700 }); await mkdir(work);
const sha = (value) => createHash('sha256').update(value).digest('hex');
for (const [source, name, metadata, version] of [['runtime/build/traqiva-proxy-windows-amd64.exe', 'traqiva-proxy.exe', 'proxy-install.json', '0.1.0-traqiva'], ['runtime/build/traqiva-engine-0.1.0-windows-amd64.exe', 'traqiva-engine.exe', 'engine.json', '0.1.0']]) {
  const bytes = await readFile(join(root, source));
  await copyFile(join(root, source), join(home, 'bin', name));
  await writeFile(join(home, metadata), JSON.stringify({ sha256: sha(bytes), version }), { mode: 0o600 });
}
const synthetic = '2026-10-20 INFO service=billing starting\n' + '2026-10-20 INFO service=billing worker=receipts operation=validate status=success elapsed_ms=4 retries=0 region=eu cache=hit\n'.repeat(500) + '2026-10-20 ERROR code=DB_TIMEOUT service=billing retry=backoff\n2026-10-20 INFO service=billing ending\n';
await writeFile(join(work, 'fixture.log'), synthetic);
const configPath = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml');
let before;
try { before = sha(await readFile(configPath)); } catch { before = null; }
const prompt = 'Read ./fixture.log exactly once using Get-Content -Raw -LiteralPath ./fixture.log. Return only a JSON object with code, service and retry from its ERROR record. Do not modify files. Do not run other shell commands.';
const args = [cli, 'agent', 'codex', '--auth', 'chatgpt', '--', '-a', 'never', '--disable', 'plugins', '--disable', 'hooks', 'exec', '--json', '--skip-git-repo-check', '-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="low"', '--sandbox', 'danger-full-access', prompt];
const child = spawn(process.execPath, args, { cwd: work, env: { ...process.env, TRAQIVA_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let stdout = ''; let stderr = '';
child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
const exit = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', done); });
await writeFile(join(task, 'codex-output.jsonl'), stdout, { mode: 0o600 });
await writeFile(join(task, 'launcher-diagnostics.log'), stderr, { mode: 0o600 });
const events = stdout.split(/\r?\n/).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
const diagnostics = stderr.split(/\r?\n/).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
const final = events.filter((event) => event.type === 'item.completed' && event.item?.type === 'agent_message').at(-1)?.item?.text || '';
let answer;
try { answer = JSON.parse(final.replace(/^```json\s*|\s*```$/g, '')); } catch { answer = null; }
const summary = { date: '2026-10-20', test: 'single_synthetic_Codex_ChatGPT_task', model: 'gpt-6.1-sol', effort: 'low', exit_code: exit, answer_correct: answer?.code === 'DB_TIMEOUT' && answer?.service === 'billing' && answer?.retry === 'backoff', completed_shell_commands: events.filter((event) => event.type === 'item.completed' && event.item?.type === 'command_execution').length, usage: events.filter((event) => event.type === 'turn.completed').map((event) => event.usage), launcher: diagnostics.find((event) => event.event === 'traqiva_agent_finished') || null, global_config_unchanged: before === sha(await readFile(configPath)), auth_copied: false, private_test_directory: task };
await writeFile(join(task, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 });
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
if (exit !== 0 || !summary.answer_correct || !summary.global_config_unchanged) process.exitCode = 1;
