// Explicit operator-run benchmark. Uses existing Codex auth and real model quota.
// Not part of npm test. Raw output stays in an isolated directory outside Git.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installEngine } from '../lib/native.mjs';
import { installNativeProxy } from '../lib/proxy-native.mjs';
import { compressArtifact, recoverArtifact } from '../lib/operations.mjs';
import { agentEnvironment } from '../lib/agent.mjs';

const binary = process.env.TRAQIVA_BENCHMARK_CODEX_BIN;
const model = process.env.TRAQIVA_BENCHMARK_MODEL;
const effort = process.env.TRAQIVA_BENCHMARK_EFFORT;
if (!binary || !model || !effort) throw new Error('Set TRAQIVA_BENCHMARK_CODEX_BIN, TRAQIVA_BENCHMARK_MODEL and TRAQIVA_BENCHMARK_EFFORT explicitly. This makes real model calls.');
const origin = process.env.TRAQIVA_BENCHMARK_ORIGIN;
if (!origin) throw new Error('Set TRAQIVA_BENCHMARK_ORIGIN to the trusted Traqiva release origin.');
const mode = process.env.TRAQIVA_BENCHMARK_MODE || 'input';
const automaticSandbox = process.env.TRAQIVA_BENCHMARK_AUTOMATIC_SANDBOX || 'read-only';
if (!['input', 'automatic', 'all'].includes(mode) || !['read-only', 'workspace-write'].includes(automaticSandbox)) throw new Error('Use input/automatic/all mode and read-only/workspace-write automatic sandbox.');
const directory = await mkdtemp(join(tmpdir(), 'TraqivaTokenAB-'));
const home = join(directory, 'traqiva'), work = join(directory, 'fixture');
await mkdir(home); await mkdir(work);
process.env.TRAQIVA_HOME = home;
const cli = fileURLToPath(new URL('../bin/traqiva.mjs', import.meta.url));
const configPath = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml');
const hash = value => createHash('sha256').update(value).digest('hex');
const configHash = async () => { try { return hash(await readFile(configPath)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const before = await configHash();
const expected = { code: 'DB_TIMEOUT', service: 'billing', retry: 'backoff', release_id: 'R20261021_BENCH', incident_id: 'INC_AB_731' };
const original = '2026-10-21 INFO release_id=R20261021_BENCH environment=synthetic\n'
  + '2026-10-21 INFO service=billing worker=receipts operation=validate status=success elapsed_ms=4 retries=0 region=eu cache=hit\n'.repeat(180)
  + '2026-10-21 ERROR code=DB_TIMEOUT service=billing retry=backoff incident_id=INC_AB_731\n'
  + '2026-10-21 INFO final_status=aborted\n';
const schema = { type: 'object', properties: Object.fromEntries(Object.keys(expected).map(key => [key, { type: 'string' }])), required: Object.keys(expected), additionalProperties: false };
const schemaPath = join(directory, 'answer-schema.json');
await writeFile(schemaPath, JSON.stringify(schema));
await writeFile(join(work, 'fixture.log'), original);
console.log(JSON.stringify({ event: 'benchmark_started', directory, model, effort, mode, automatic_sandbox: automaticSandbox, planned_model_tasks: mode === 'input' ? 4 : mode === 'automatic' ? 2 : 6 }));
await installEngine(origin);
const compressed = await compressArtifact(null, original, 'text');
assert.equal((await recoverArtifact(null, compressed.recovery_handle)).original, original, 'Exact original recovery must succeed before making model calls');
await writeFile(join(directory, 'original.log'), original);
await writeFile(join(directory, 'compressed.log'), compressed.compressedText);

const common = ['--no-daemon', '-a', 'never', 'exec', '--ignore-user-config', '--disable', 'plugins', '--disable', 'hooks', '--json', '--ephemeral', '--skip-git-repo-check', '-m', model, '-c', `model_reasoning_effort=${JSON.stringify(effort)}`, '--sandbox', 'read-only', '--output-schema', schemaPath, '-'];
const env = agentEnvironment(process.env, home);
const prompt = 'This is an isolated synthetic log-extraction experiment. Extract code, service, retry, release_id and incident_id from the supplied log. Return only the required JSON. Use "unknown" for a fact not present. Do not invent missing facts.';
const manualPrompt = text => `${prompt}\nAll data is inline below. Do not use any tools, commands, files, web access, or retrieval.\n<log>\n${text}</log>\n`;
const filePrompt = `${prompt}\nRead ./fixture.log exactly once using Get-Content -Raw -LiteralPath ./fixture.log. Set the command tool output budget to at least 12000 tokens so the complete synthetic log is visible without truncation. Do not modify files. Do not run any other command or use other tools.\n`;
const automaticArgs = common.map(value => value === 'read-only' ? automaticSandbox : value);
const rows = [];
async function run(label, executable, args, input) {
  console.log(JSON.stringify({ event: 'run_started', label }));
  const child = spawn(executable, args, { cwd: work, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = '', timedOut = false;
  const start = Date.now();
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 240_000);
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end(input);
  let exit;
  try { exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); }
  finally { clearTimeout(timer); }
  await writeFile(join(directory, label + '.jsonl'), stdout, { mode: 0o600 });
  await writeFile(join(directory, label + '.stderr.log'), stderr, { mode: 0o600 });
  const parse = text => text.split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const events = parse(stdout), diagnostics = parse(stderr);
  const completed = events.filter(event => event.type === 'turn.completed');
  const usage = completed.at(-1)?.usage ?? null;
  const final = events.filter(event => event.type === 'item.completed' && event.item?.type === 'agent_message').at(-1)?.item?.text || '';
  let answer = null; try { answer = JSON.parse(final.replace(/^```json\s*|\s*```$/g, '')); } catch { /* Failure is reported, not filled in. */ }
  const correct = !!answer && Object.entries(expected).every(([key, value]) => answer[key] === value) && Object.keys(answer).length === Object.keys(expected).length;
  const commands = events.filter(event => event.type === 'item.completed' && event.item?.type === 'command_execution');
  const toolCalls = events.filter(event => event.type === 'item.completed' && ['command_execution', 'mcp_tool_call', 'web_search', 'file_change'].includes(event.item?.type));
  const measured = completed.length === 1 && usage && Number.isSafeInteger(usage.input_tokens) && Number.isSafeInteger(usage.output_tokens);
  const row = { label, exit_code: exit, timed_out: timedOut, elapsed_ms: Date.now() - start, answer_correct: correct, answer, usage, total_tokens: measured ? usage.input_tokens + usage.output_tokens : null, uncached_input_tokens: measured && Number.isSafeInteger(usage.cached_input_tokens) ? usage.input_tokens - usage.cached_input_tokens : null, completed_commands: commands.length, other_tool_calls: toolCalls.length - commands.length, output_truncation_seen: commands.some(event => /truncated|truncation|exceeds.*limit/i.test(event.item?.aggregated_output || '')), launcher: diagnostics.find(event => event.event === 'traqiva_agent_finished') || null };
  rows.push(row);
  await save();
  console.log(JSON.stringify({ event: 'run_finished', ...row, answer: undefined }));
  if (exit !== 0 || timedOut || !measured) throw new Error(`Run ${label} did not produce a completed measured turn. Inspect the private run output; no model substitution or retry was attempted.`);
  return row;
}
async function save() {
  const result = { schema: 1, test: 'synthetic_real_Codex_token_AB', created_at: new Date().toISOString(), model, effort, mode, automatic_sandbox: automaticSandbox, auth_mode: 'existing_Codex_auth_not_inspected', usage_basis: 'Codex_turn_completed_usage', expected, artifact: { original_bytes: Buffer.byteLength(original), compressed_bytes: Buffer.byteLength(compressed.compressedText), original_sha256: hash(original), compressed_sha256: hash(compressed.compressedText), exact_recovery: true, local_estimates_are_provider_usage: false }, global_configuration_unchanged: before === await configHash(), authentication_copied: false, rows, limitations: ['Small synthetic extraction task, not a general coding-quality benchmark.', 'Input includes cached input; total = input + output. Reasoning is not added twice.', 'Explicit precompression and automatic proxy routing are separate experiments.', 'Token reductions are not verified invoice or subscription-quota savings.'] };
  await writeFile(join(directory, 'summary.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
}

try {
  if (mode !== 'automatic') {
    for (const [label, text] of [['manual-raw-1', original], ['manual-compressed-1', compressed.compressedText], ['manual-compressed-2', compressed.compressedText], ['manual-raw-2', original]]) {
      const row = await run(label, binary, common, manualPrompt(text));
      if (row.completed_commands || row.other_tool_calls) throw new Error('The no-tool protocol was violated; the input-only comparison is not valid.');
    }
    if (rows.some(row => !row.answer_correct)) throw new Error('The input experiment failed an exact-fact quality check. Its token counts do not establish equivalent task quality.');
  }
  if (mode !== 'input') {
    const control = await run('automatic-control', binary, automaticArgs, filePrompt);
    if (control.completed_commands !== 1 || control.other_tool_calls || control.output_truncation_seen) throw new Error('The automatic control did not follow the full-log, single-command protocol.');
    await installNativeProxy(origin);
    const proxyArgs = [cli, 'agent', 'codex', '--auth', 'chatgpt', '--', ...automaticArgs.slice(1)];
    // The launcher supplies --no-daemon itself, using this exact selected binary.
    const previous = env.TRAQIVA_CODEX_BIN;
    env.TRAQIVA_CODEX_BIN = binary;
    try { await run('automatic-traqiva', process.execPath, proxyArgs, filePrompt); }
    finally { if (previous === undefined) delete env.TRAQIVA_CODEX_BIN; else env.TRAQIVA_CODEX_BIN = previous; }
    if (rows.some(row => !row.answer_correct)) throw new Error('The automatic experiment failed an exact-fact quality check. Do not claim equivalent task quality.');
  }
} finally {
  await save();
  console.log(JSON.stringify({ event: 'benchmark_saved', directory, global_configuration_unchanged: before === await configHash(), completed_runs: rows.length }));
}
