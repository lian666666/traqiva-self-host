import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { ApiError, compactJson, hashPassword, hashSecret, id, now, randomSecret, readBodyText, readJson, redactCredential, sameOriginWrite, scrubSecrets, stringField, verifyPassword } from './security';
import { computeCost, estimateTokens, UsageCollector, type Prices, type Usage } from './usage';
import type { Env, Execution, Principal, Row } from './types';
import { askProvider, groundedProjectContext, ProviderError, type AssistantProvider, type AssistantSource } from './assistant';
import { googleAvailable, registerGoogleAuth } from './google';
import { githubAvailable, registerGithubAuth } from './github';
import { onboardingFor, registerOnboarding, requireTerms, termsFor } from './onboarding';
import { registerDeveloperSessions } from './developer-sessions';

export const app = new Hono<{ Bindings: Env; Variables: { user: Row } }>();
const COOKIE = 'traqiva_session';
const encoder = new TextEncoder();
const jsonValue = (value: unknown) => value === undefined ? null : JSON.stringify(scrubSecrets(value));
const dbOne = <T = Row>(env: Env, sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).first<T>();
const dbAll = async <T = Row>(env: Env, sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;
const numeric = (value: unknown, fallback: number | null = null) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12 ? value : fallback;
const integer = (value: unknown) => Number.isSafeInteger(value) && numeric(value) !== null ? value as number : null;
const traceFields = 'id,project_id,model,provider,status,http_status,input_tokens,output_tokens,cached_tokens,latency_ms,cost_usd,cost_basis,input_bytes,output_bytes,original_tokens,optimized_tokens,token_basis,saved_tokens,created_at,source,compressed,algorithm';
const publicTrace = (row: Row): Row => ({ ...row, compressed: Boolean(row.compressed) });
const publicUser = (row: Row) => ({ id: row.id, name: row.name, email: row.email, google_linked: Boolean(row.google_linked), github_linked: Boolean(row.github_linked) });
const publicWorkspace = (row: Row) => ({ id: row.id, name: row.name, retention_days: row.retention_days, mode: row.mode, autopilot: row.autopilot, monthly_budget: row.monthly_budget ?? 0 });

app.onError((error, c) => error instanceof ApiError ? c.json({ error: error.message }, error.status as any) : c.json({ error: 'The request could not be completed.' }, 500));
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const keyRoute = ['/api/ingest', '/api/compress', '/api/compression-events'].includes(c.req.path) && Boolean(c.req.header('x-traqiva-key'));
    if (!keyRoute && !sameOriginWrite(c.req.raw)) throw new ApiError(403, 'A same-origin request is required.');
    if (keyRoute && c.req.header('origin') && !sameOriginWrite(c.req.raw)) throw new ApiError(403, 'Cross-origin writes are not allowed.');
  }
  await next();
});
async function currentUser(c: any): Promise<Row | null> {
  const token = getCookie(c, COOKIE);
  if (!token || token.length > 256) return null;
  return dbOne(c.env, 'SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?', await hashSecret(token), now());
}
async function userRequired(c: any) {
  const user = await currentUser(c);
  if (!user) throw new ApiError(401, 'Sign in to continue.');
  return user;
}
async function workspaceFor(env: Env, userId: string) {
  const workspace = await dbOne(env, 'SELECT w.* FROM workspaces w JOIN members m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY w.created_at LIMIT 1', userId);
  if (!workspace) throw new ApiError(403, 'Workspace access is required.');
  return workspace;
}
async function userProject(c: any, projectId: unknown): Promise<Principal> {
  const user = await userRequired(c);
  const project = await dbOne(c.env, 'SELECT p.* FROM projects p JOIN members m ON m.workspace_id=p.workspace_id WHERE p.id=? AND m.user_id=?', stringField(projectId, 'project', 64), user.id);
  if (!project) throw new ApiError(404, 'Project not found.');
  const workspace = (await dbOne(c.env, 'SELECT * FROM workspaces WHERE id=?', project.workspace_id))!;
  await requireTerms(c.env, workspace.id);
  return { project, workspace, userId: user.id };
}
async function keyPrincipal(c: any): Promise<Principal> {
  const key = c.req.header('x-traqiva-key');
  if (!key || key.length > 256) throw new ApiError(401, 'A project API key is required.');
  const record = await dbOne(c.env, 'SELECT k.id AS key_id,k.project_id FROM project_keys k WHERE k.key_hash=? AND k.revoked_at IS NULL', await hashSecret(key));
  if (!record) throw new ApiError(401, 'Invalid project API key.');
  const project = (await dbOne(c.env, 'SELECT * FROM projects WHERE id=?', record.project_id))!;
  const workspace = (await dbOne(c.env, 'SELECT * FROM workspaces WHERE id=?', project.workspace_id))!;
  await requireTerms(c.env, workspace.id);
  await c.env.DB.prepare('UPDATE project_keys SET last_used_at=? WHERE id=?').bind(now(), record.key_id).run();
  return { project, workspace, keyId: record.key_id };
}
async function projectPrincipal(c: any, projectId: unknown): Promise<Principal> {
  if (!c.req.header('x-traqiva-key')) return userProject(c, projectId);
  const principal = await keyPrincipal(c);
  if (projectId && projectId !== principal.project.id) throw new ApiError(404, 'Project not found.');
  return principal;
}
async function audit(env: Env, principal: Principal, action: string, details: unknown) {
  await env.DB.prepare('INSERT INTO audit_log(id,workspace_id,project_id,user_id,action,details_json,created_at) VALUES(?,?,?,?,?,?,?)').bind(id(), principal.workspace.id, principal.project.id, principal.userId ?? null, action, jsonValue(details), now()).run();
}
async function sessionPayload(c: any, user: Row | null) {
  if (!user) return { user: null, workspace: null, projects: [], activeProject: null, setup: null, terms: null };
  const linked = await dbAll(c.env, "SELECT provider FROM oauth_identities WHERE user_id=?", user.id);
  const workspace = await workspaceFor(c.env, user.id);
  const projects = await dbAll(c.env, 'SELECT id,name,workspace_id,created_at FROM projects WHERE workspace_id=? ORDER BY created_at', workspace.id);
  const setup = await onboardingFor(c.env, user.id), terms = await termsFor(c.env, workspace.id);
  return { user: publicUser({ ...user, google_linked: linked.some(row => row.provider === 'google'), github_linked: linked.some(row => row.provider === 'github') }), workspace: publicWorkspace(workspace), projects, activeProject: projects.find(project => project.id === setup.project_id) ?? projects[0] ?? null, setup, terms };
}
async function createSession(c: any, userId: string) {
  const token = randomSecret();
  await c.env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(await hashSecret(token), userId, new Date(Date.now() + 7 * 86400_000).toISOString(), now()).run();
  setCookie(c, COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 7 * 86400 });
}
async function authLimit(c: any, email: string) {
  const key = await hashSecret(`${c.req.header('cf-connecting-ip') ?? 'local'}:${email}`);
  const window = Math.floor(Date.now() / 900_000);
  await c.env.DB.prepare('INSERT INTO auth_attempts(id,attempts,window_start) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN window_start=excluded.window_start THEN attempts+1 ELSE 1 END,window_start=excluded.window_start').bind(key, window).run();
  const row = await dbOne(c.env, 'SELECT attempts FROM auth_attempts WHERE id=?', key);
  if (row && row.attempts > 10) throw new ApiError(429, 'Too many sign-in attempts. Try again later.');
}
const emailField = (value: unknown) => {
  const email = stringField(value, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'A valid email is required.');
  return email;
};

registerGoogleAuth(app, { currentUser, createSession, authLimit });
registerGithubAuth(app, { currentUser, createSession, authLimit });
app.get('/api/auth/providers', c => c.json({ google: googleAvailable(c.env, c.req.url), github: githubAvailable(c.env, c.req.url) }));
registerOnboarding(app, { userRequired, workspaceFor });
registerDeveloperSessions(app, { userProject });
app.get('/api/session', async c => c.json(await sessionPayload(c, await currentUser(c))));
app.post('/api/auth/register', async c => {
  const body = await readJson(c.req.raw);
  const name = stringField(body.name, 'name', 80), email = emailField(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 12 || password.length > 256) throw new ApiError(400, 'Use a password between 12 and 256 characters.');
  await authLimit(c, email);
  if (await dbOne(c.env, 'SELECT id FROM users WHERE email=?', email)) throw new ApiError(409, 'This email is already registered.');
  const hash = await hashPassword(password), userId = id(), workspaceId = id(), projectId = id(), at = now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO users(id,name,email,password_hash,password_salt,password_iterations,created_at) VALUES(?,?,?,?,?,?,?)').bind(userId, name, email, hash.hash, hash.salt, hash.iterations, at),
      c.env.DB.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').bind(workspaceId, `${name}'s workspace`, at),
      c.env.DB.prepare('INSERT INTO members(workspace_id,user_id,role) VALUES(?,?,?)').bind(workspaceId, userId, 'owner'),
      c.env.DB.prepare('INSERT INTO projects(id,workspace_id,name,created_at) VALUES(?,?,?,?)').bind(projectId, workspaceId, 'My project', at),
    ]);
  } catch { throw new ApiError(409, 'Registration could not be completed. This email may already be registered.'); }
  await createSession(c, userId);
  return c.json(await sessionPayload(c, { id: userId, name, email }), 201);
});
app.post('/api/auth/login', async c => {
  const body = await readJson(c.req.raw), email = emailField(body.email);
  const password = typeof body.password === 'string' && body.password.length <= 256 ? body.password : '';
  await authLimit(c, email);
  const user = await dbOne(c.env, 'SELECT * FROM users WHERE email=?', email);
  const ok = await verifyPassword(password, user ? { hash: user.password_hash, salt: user.password_salt, iterations: user.password_iterations } : { hash: '0'.repeat(64), salt: 'no-user-constant-salt', iterations: 100_000 });
  if (!user || !ok || !user.password_enabled) throw new ApiError(401, 'Email or password is incorrect.');
  await createSession(c, user.id);
  return c.json(await sessionPayload(c, user));
});
app.post('/api/auth/logout', async c => {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hashSecret(token)).run();
  setCookie(c, COOKIE, '', { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 0 });
  return c.json({ ok: true });
});
app.get('/api/projects', async c => {
  const user = await userRequired(c), workspace = await workspaceFor(c.env, user.id);
  await requireTerms(c.env, workspace.id);
  return c.json({ items: await dbAll(c.env, 'SELECT id,name,workspace_id,created_at FROM projects WHERE workspace_id=? ORDER BY created_at', workspace.id) });
});
app.post('/api/projects', async c => {
  const user = await userRequired(c), workspace = await workspaceFor(c.env, user.id), body = await readJson(c.req.raw);
  await requireTerms(c.env, workspace.id);
  const project = { id: id(), name: stringField(body.name, 'name', 100), workspace_id: workspace.id, created_at: now() };
  await c.env.DB.prepare('INSERT INTO projects(id,workspace_id,name,created_at) VALUES(?,?,?,?)').bind(project.id, workspace.id, project.name, project.created_at).run();
  await audit(c.env, { project, workspace, userId: user.id }, 'project.created', { name: project.name });
  return c.json({ project }, 201);
});
app.patch('/api/projects/:id', async c => {
  const principal = await userProject(c, c.req.param('id')), body = await readJson(c.req.raw);
  const member = await dbOne(c.env, 'SELECT role FROM members WHERE workspace_id=? AND user_id=?', principal.workspace.id, principal.userId);
  if (member?.role !== 'owner') throw new ApiError(403, 'Workspace owner access is required to rename a project.');
  const name = stringField(body.name, 'name', 100);
  await c.env.DB.prepare('UPDATE projects SET name=? WHERE id=? AND workspace_id=?').bind(name, principal.project.id, principal.workspace.id).run();
  await audit(c.env, principal, 'project.renamed', { previous_name: principal.project.name, name });
  return c.json({ project: { ...principal.project, name } });
});
async function overview(env: Env, projectId: string, days: number) {
  const to = now(), from = new Date(Date.parse(to) - (days - 1) * 86400_000).toISOString().slice(0, 10);
  const stats = (await dbOne(env, `SELECT COUNT(*) AS requests,COALESCE(SUM(input_tokens),0) AS input_tokens,COALESCE(SUM(output_tokens),0) AS output_tokens,COALESCE(SUM(cached_tokens),0) AS cached_tokens,COUNT(CASE WHEN input_tokens IS NOT NULL AND cached_tokens IS NOT NULL THEN 1 END) AS cache_available_requests,COALESCE(SUM(CASE WHEN input_tokens IS NOT NULL AND cached_tokens IS NOT NULL THEN input_tokens END),0) AS cache_covered_input_tokens,SUM(cost_usd) AS estimated_cost_usd,SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors,AVG(latency_ms) AS avg_latency_ms,SUM(saved_tokens) AS saved_tokens,SUM(CASE WHEN token_basis='unavailable' THEN 0 ELSE 1 END) AS usage_available_requests,COUNT(cost_usd) AS priced_requests FROM traces WHERE project_id=? AND created_at>=? AND created_at<=?`, projectId, from, to))!;
  stats.errors ??= 0; stats.avg_latency_ms ??= 0; stats.usage_available_requests ??= 0;
  stats.saved_tokens_basis = stats.saved_tokens === null ? 'unavailable' : 'client_estimate';
  const compression = (await dbOne(env, 'SELECT COUNT(*) AS events,SUM(estimated_saved_tokens) AS estimated_saved_tokens FROM compression_events WHERE project_id=? AND created_at>=? AND created_at<=?', projectId, from, to))!;
  stats.compression_events = compression.events;
  stats.compression_estimated_saved_tokens = compression.estimated_saved_tokens;
  const rows = await dbAll(env, 'SELECT substr(created_at,1,10) AS date,COUNT(*) AS requests,COALESCE(SUM(input_tokens+output_tokens),0) AS tokens,SUM(cost_usd) AS cost FROM traces WHERE project_id=? AND created_at>=? AND created_at<=? GROUP BY substr(created_at,1,10) ORDER BY date', projectId, from, to);
  const series = Array.from({ length: days }, (_, index) => { const date = new Date(Date.parse(`${from}T00:00:00Z`) + index * 86400_000).toISOString().slice(0, 10); return rows.find(row => row.date === date) ?? { date, requests: 0, tokens: 0, cost: null }; });
  const models = await dbAll(env, 'SELECT model,COUNT(*) AS requests,COALESCE(SUM(input_tokens+output_tokens),0) AS tokens,SUM(cost_usd) AS cost FROM traces WHERE project_id=? AND created_at>=? AND created_at<=? GROUP BY model ORDER BY requests DESC LIMIT 30', projectId, from, to);
  const traces = (await dbAll(env, `SELECT ${traceFields} FROM traces WHERE project_id=? AND created_at>=? AND created_at<=? ORDER BY created_at DESC LIMIT 10`, projectId, from, to)).map(publicTrace);
  return { stats, series, models, traces };
}
app.get('/api/overview', async c => {
  const { project } = await userProject(c, c.req.query('project'));
  const days = Math.min(90, Math.max(1, Math.floor(Number(c.req.query('days')) || 7)));
  return c.json(await overview(c.env, project.id, days));
});
app.get('/api/traces', async c => {
  const { project } = await userProject(c, c.req.query('project'));
  const args: unknown[] = [project.id]; let where = 'project_id=?';
  for (const field of ['status', 'model'] as const) { const value = c.req.query(field); if (value && value !== 'all') { where += ` AND ${field}=?`; args.push(value.slice(0, 200)); } }
  const search = c.req.query('search');
  if (search) { where += ' AND (model LIKE ? ESCAPE \'\\\' OR provider LIKE ? ESCAPE \'\\\' OR id LIKE ? ESCAPE \'\\\')'; const term = `%${search.slice(0, 120).replace(/[\\%_]/g, '\\$&')}%`; args.push(term, term, term); }
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 100));
  return c.json({ items: (await dbAll(c.env, `SELECT ${traceFields} FROM traces WHERE ${where} ORDER BY created_at DESC LIMIT ?`, ...args, limit)).map(publicTrace) });
});
app.get('/api/traces/:id', async c => {
  const user = await userRequired(c);
  const row = await dbOne(c.env, 'SELECT t.* FROM traces t JOIN projects p ON p.id=t.project_id JOIN members m ON m.workspace_id=p.workspace_id WHERE t.id=? AND m.user_id=?', c.req.param('id'), user.id);
  if (!row) throw new ApiError(404, 'Trace not found.');
  await userProject(c, row.project_id);
  const { request_json, response_json, ...trace } = row;
  return c.json({ trace: publicTrace(trace), request: request_json ? JSON.parse(request_json) : null, response: response_json ? JSON.parse(response_json) : null });
});
app.get('/api/keys', async c => {
  const { project } = await userProject(c, c.req.query('project'));
  return c.json({ items: await dbAll(c.env, 'SELECT id,project_id,name,prefix,created_at,last_used_at,revoked_at FROM project_keys WHERE project_id=? ORDER BY created_at DESC', project.id) });
});
app.post('/api/keys', async c => {
  const body = await readJson(c.req.raw), principal = await userProject(c, body.project_id);
  const key = `tq_${randomSecret()}`, record = { id: id(), project_id: principal.project.id, name: stringField(body.name, 'name', 100), prefix: key.slice(0, 11), created_at: now(), last_used_at: null, revoked_at: null };
  await c.env.DB.prepare('INSERT INTO project_keys(id,project_id,name,key_hash,prefix,created_at) VALUES(?,?,?,?,?,?)').bind(record.id, record.project_id, record.name, await hashSecret(key), record.prefix, record.created_at).run();
  await audit(c.env, principal, 'key.created', { key_id: record.id, prefix: record.prefix });
  return c.json({ key, record }, 201);
});
app.delete('/api/keys/:id', async c => {
  const user = await userRequired(c), row = await dbOne(c.env, 'SELECT k.* FROM project_keys k JOIN projects p ON p.id=k.project_id JOIN members m ON m.workspace_id=p.workspace_id WHERE k.id=? AND m.user_id=?', c.req.param('id'), user.id);
  if (!row) throw new ApiError(404, 'API key not found.');
  const principal = await userProject(c, row.project_id);
  await c.env.DB.prepare('UPDATE project_keys SET revoked_at=? WHERE id=? AND project_id=?').bind(now(), row.id, row.project_id).run();
  await audit(c.env, principal, 'key.revoked', { key_id: row.id });
  return c.json({ ok: true });
});

function traceStatement(env: Env, principal: Principal, record: any, source: string, traceId = id()) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new ApiError(400, 'Every trace record must be an object.');
  const model = typeof record.model === 'string' ? record.model.slice(0, 200) : 'unknown';
  const provider = typeof record.provider === 'string' ? record.provider.slice(0, 80) : 'unknown';
  let basis = ['provider', 'estimated', 'unavailable'].includes(record.token_basis) ? record.token_basis : 'estimated';
  const input = integer(record.input_tokens), output = integer(record.output_tokens), cached = integer(record.cached_tokens);
  if (input === null || output === null) basis = 'unavailable';
  if (cached !== null && input !== null && cached > input) throw new ApiError(400, 'Cached input cannot exceed total input.');
  const original = integer(record.original_tokens), optimized = integer(record.optimized_tokens);
  const saved = original !== null && optimized !== null && basis === 'estimated' && record.compressed === true ? original - optimized : null;
  const at = typeof record.created_at === 'string' && Number.isFinite(Date.parse(record.created_at)) ? new Date(record.created_at).toISOString() : now();
  const requestJson = jsonValue(record.request), responseJson = jsonValue(record.response);
  const limited = (value: string | null) => value && encoder.encode(value).byteLength > 262144 ? JSON.stringify({ body_stored: false, reason: 'telemetry_size_limit' }) : value;
  const cost = numeric(record.cost_usd);
  const httpStatus = integer(record.http_status) ?? (typeof record.status === 'number' ? integer(record.status) : null);
  const statement = env.DB.prepare('INSERT INTO traces(id,project_id,model,provider,status,http_status,input_tokens,output_tokens,cached_tokens,latency_ms,cost_usd,cost_basis,input_bytes,output_bytes,original_tokens,optimized_tokens,token_basis,saved_tokens,created_at,source,compressed,algorithm,request_json,response_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(traceId, principal.project.id, model, provider, record.status === 'error' || (httpStatus ?? 200) >= 400 ? 'error' : 'success', httpStatus, basis === 'unavailable' ? null : input, basis === 'unavailable' ? null : output, basis === 'unavailable' ? null : cached, numeric(record.latency_ms, 0), cost, cost === null ? 'unavailable' : record.cost_basis === 'user_price_estimate' ? 'user_price_estimate' : 'client_reported', integer(record.input_bytes) ?? 0, integer(record.output_bytes) ?? 0, original, optimized, basis, saved, at, source.slice(0, 64), record.compressed === true ? 1 : 0, typeof record.algorithm === 'string' ? record.algorithm.slice(0, 100) : null, limited(requestJson), limited(responseJson));
  return { traceId, statement };
}
async function insertTrace(env: Env, principal: Principal, record: any, source: string, traceId = id()) {
  const prepared = traceStatement(env, principal, record, source, traceId);
  await prepared.statement.run();
  return prepared.traceId;
}
async function importRecords(c: any, principal: Principal, body: any, source: string) {
  if (!Array.isArray(body.records) || body.records.length < 1 || body.records.length > 100) throw new ApiError(400, 'Provide between 1 and 100 trace records.');
  const prepared = body.records.map((record: unknown) => traceStatement(c.env, principal, record, source));
  await c.env.DB.batch(prepared.map((item: ReturnType<typeof traceStatement>) => item.statement));
  const ids = prepared.map((item: ReturnType<typeof traceStatement>) => item.traceId);
  await audit(c.env, principal, 'traces.imported', { count: ids.length, source });
  return c.json({ accepted: ids.length, ids }, 201);
}
app.post('/api/traces/import', async c => { const body = await readJson(c.req.raw); return importRecords(c, await userProject(c, body.project_id), body, 'import'); });
app.post('/api/ingest', async c => { const body = await readJson(c.req.raw); return importRecords(c, await projectPrincipal(c, body.project_id), body, 'sdk'); });
app.get('/api/connection', async c => { const { project, workspace } = await keyPrincipal(c); return c.json({ connected: true, project: { id: project.id, name: project.name }, workspace: { id: workspace.id, name: workspace.name, mode: workspace.mode } }); });

async function compressionEvent(env: Env, principal: Principal, body: any, location: 'server' | 'client') {
  const fields = ['input_bytes', 'output_bytes', 'original_tokens_estimate', 'optimized_tokens_estimate'];
  if (fields.some(field => integer(body[field]) === null)) throw new ApiError(400, 'Compression event counts must be non-negative integers.');
  const event = { id: id(), project_id: principal.project.id, algorithm: stringField(body.algorithm, 'algorithm', 100), source: typeof body.source === 'string' ? body.source.slice(0, 64) : 'sdk', input_bytes: body.input_bytes, output_bytes: body.output_bytes, original_tokens_estimate: body.original_tokens_estimate, optimized_tokens_estimate: body.optimized_tokens_estimate, estimated_saved_tokens: body.original_tokens_estimate - body.optimized_tokens_estimate, token_basis: 'estimated', recovery_handle: typeof body.recovery_handle === 'string' ? body.recovery_handle.slice(0, 256) : null, recovery_location: location, created_at: now() };
  await env.DB.prepare('INSERT INTO compression_events(id,project_id,algorithm,source,input_bytes,output_bytes,original_tokens_estimate,optimized_tokens_estimate,estimated_saved_tokens,token_basis,recovery_handle,recovery_location,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(event.id, event.project_id, event.algorithm, event.source, event.input_bytes, event.output_bytes, event.original_tokens_estimate, event.optimized_tokens_estimate, event.estimated_saved_tokens, event.token_basis, event.recovery_handle, event.recovery_location, event.created_at).run();
  return event;
}
app.post('/api/compression-events', async c => {
  const body = await readJson(c.req.raw), principal = await projectPrincipal(c, body.project_id);
  const event = await compressionEvent(c.env, principal, body, 'client');
  await audit(c.env, principal, 'compression.event-recorded', { event_id: event.id, algorithm: event.algorithm, source: event.source, provider_called: false });
  return c.json({ event }, 201);
});
app.get('/api/compression-events', async c => {
  const principal = await projectPrincipal(c, c.req.query('project'));
  return c.json({ items: await dbAll(c.env, 'SELECT * FROM compression_events WHERE project_id=? ORDER BY created_at DESC LIMIT 100', principal.project.id) });
});

app.post('/api/compress', async c => {
  const body = await readJson(c.req.raw), principal = await projectPrincipal(c, body.project_id);
  if (typeof body.text !== 'string' || encoder.encode(body.text).byteLength > 900_000) throw new ApiError(400, 'text must contain at most 900,000 UTF-8 bytes.');
  const compressedText = compactJson(body.text), recovery_handle = `tr_${randomSecret(24)}`, at = now();
  await c.env.DB.prepare('INSERT INTO recoveries(handle,project_id,original,content_type,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(recovery_handle, principal.project.id, body.text, compressedText !== body.text || ['{', '['].includes(body.text.trimStart().charAt(0)) ? 'json' : 'text', at, new Date(Date.now() + principal.workspace.retention_days * 86400_000).toISOString()).run();
  await audit(c.env, principal, 'compression.created', { algorithm: compressedText === body.text ? 'none' : 'json_minify', input_bytes: encoder.encode(body.text).byteLength, output_bytes: encoder.encode(compressedText).byteLength, recovery_handle });
  await compressionEvent(c.env, principal, { algorithm: compressedText === body.text ? 'none' : 'json_minify', source: 'server', input_bytes: encoder.encode(body.text).byteLength, output_bytes: encoder.encode(compressedText).byteLength, original_tokens_estimate: estimateTokens(body.text), optimized_tokens_estimate: estimateTokens(compressedText), recovery_handle }, 'server');
  return c.json({ compressedText, algorithm: compressedText === body.text ? 'none' : 'json_minify', original_tokens_estimate: estimateTokens(body.text), optimized_tokens_estimate: estimateTokens(compressedText), token_basis: 'estimated', estimate_method: 'utf8_bytes_divided_by_4', recovery_handle, changed: compressedText !== body.text });
});
app.get('/api/recover/:handle', async c => {
  const row = await dbOne(c.env, 'SELECT * FROM recoveries WHERE handle=? AND expires_at>?', c.req.param('handle'), now());
  if (!row) throw new ApiError(404, 'Recovery content not found or expired.');
  const principal = await projectPrincipal(c, row.project_id);
  if (principal.project.id !== row.project_id) throw new ApiError(404, 'Recovery content not found.');
  return c.json({ original: row.original, content_type: row.content_type, project_id: row.project_id, created_at: row.created_at });
});

export function gradeCases(cases: Array<{ input: string; expected: string; actual: string; expected_digest?: string; actual_digest?: string }>) {
  const results = cases.map((item, index) => ({ index, passed: item.expected_digest && item.actual_digest ? item.expected_digest === item.actual_digest : item.expected === item.actual, input: item.input, expected: item.expected, actual: item.actual }));
  return { results, passed: results.filter(item => item.passed).length, total: results.length };
}
app.get('/api/evals', async c => {
  const { project } = await userProject(c, c.req.query('project'));
  const suites = (await dbAll(c.env, 'SELECT * FROM eval_suites WHERE project_id=? ORDER BY created_at DESC', project.id)).map(({ cases_json, ...row }) => ({ ...row, cases: JSON.parse(cases_json), case_count: JSON.parse(cases_json).length }));
  const runs = (await dbAll(c.env, 'SELECT * FROM eval_runs WHERE project_id=? ORDER BY created_at DESC LIMIT 100', project.id)).map(({ results_json, ...row }) => ({ ...row, results: JSON.parse(results_json) }));
  return c.json({ suites, runs });
});
app.post('/api/evals', async c => {
  const body = await readJson(c.req.raw), principal = await userProject(c, body.project_id), name = stringField(body.name, 'name', 100);
  if (!Array.isArray(body.cases) || body.cases.length < 1 || body.cases.length > 100 || body.cases.some((item: any) => !item || ['input', 'expected', 'actual'].some(key => typeof item[key] !== 'string' || item[key].length > 10000))) throw new ApiError(400, 'Provide 1–100 cases with input, expected and actual strings.');
  // Persist digests of the original comparison strings before telemetry redaction.
  // Otherwise two different credential-like strings would both become [redacted]
  // and could incorrectly pass an exact-match evaluation.
  const cases = await Promise.all(body.cases.map(async (item: any) => ({ input: item.input, expected: item.expected, actual: item.actual, expected_digest: await hashSecret(item.expected), actual_digest: await hashSecret(item.actual) })));
  const suite = { id: id(), project_id: principal.project.id, name, cases, created_at: now() };
  await c.env.DB.prepare('INSERT INTO eval_suites(id,project_id,name,cases_json,created_at) VALUES(?,?,?,?,?)').bind(suite.id, suite.project_id, name, jsonValue(suite.cases), suite.created_at).run();
  await audit(c.env, principal, 'eval.created', { suite_id: suite.id, cases: suite.cases.length });
  return c.json({ suite }, 201);
});
app.post('/api/evals/:id/run', async c => {
  const user = await userRequired(c), suite = await dbOne(c.env, 'SELECT e.* FROM eval_suites e JOIN projects p ON p.id=e.project_id JOIN members m ON m.workspace_id=p.workspace_id WHERE e.id=? AND m.user_id=?', c.req.param('id'), user.id);
  if (!suite) throw new ApiError(404, 'Evaluation suite not found.');
  const principal = await userProject(c, suite.project_id), grade = gradeCases(JSON.parse(suite.cases_json));
  const run = { id: id(), suite_id: suite.id, project_id: suite.project_id, status: 'completed', grader: 'exact_match', provider_called: false, ...grade, created_at: now() };
  await c.env.DB.prepare('INSERT INTO eval_runs(id,suite_id,project_id,status,passed,total,results_json,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(run.id, suite.id, suite.project_id, run.status, grade.passed, grade.total, jsonValue(grade.results), run.created_at).run();
  await c.env.DB.prepare('INSERT INTO inbox(id,project_id,type,title,message,created_at) VALUES(?,?,?,?,?,?)').bind(id(), suite.project_id, 'eval', `Evaluation completed: ${suite.name}`, `${grade.passed}/${grade.total} exact-match cases passed. No model provider was called.`, run.created_at).run();
  await audit(c.env, principal, 'eval.executed', { run_id: run.id, grader: 'exact_match', provider_called: false, passed: grade.passed, total: grade.total });
  return c.json({ run });
});
export async function analyzeProject(env: Env, projectId: string) {
  const stats = (await dbOne(env, "SELECT COUNT(*) AS requests,SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors,SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced,MAX(input_tokens) AS largest_input FROM traces WHERE project_id=?", projectId))!;
  if (!stats.requests) return [];
  const rules: Array<{ kind: string; title: string; description: string }> = [];
  if (stats.errors > 0) rules.push({ kind: 'errors', title: 'Review failed requests', description: `${stats.errors} of ${stats.requests} recorded requests failed. Review the trace errors before changing retry behavior.` });
  if (stats.unpriced > 0) rules.push({ kind: 'pricing', title: 'Add explicit model prices', description: `${stats.unpriced} recorded requests have no known price. Cost and savings remain unavailable for those requests.` });
  if (stats.largest_input > 8000) rules.push({ kind: 'large-context', title: 'Inspect large tool outputs', description: `The largest recorded input is ${stats.largest_input} tokens. Review eligible structured tool output; any compression must preserve recoverability. No saving has been verified.` });
  const at = now();
  for (const rule of rules) {
    const existing = await dbOne(env, 'SELECT id FROM improvements WHERE project_id=? AND kind=?', projectId, rule.kind);
    await env.DB.prepare("INSERT INTO improvements(id,project_id,kind,title,description,status,evidence_json,created_at,updated_at) VALUES(?,?,?,?,?,'pending',?,?,?) ON CONFLICT(project_id,kind) DO UPDATE SET description=excluded.description,evidence_json=excluded.evidence_json,updated_at=excluded.updated_at").bind(id(), projectId, rule.kind, rule.title, rule.description, jsonValue(stats), at, at).run();
    if (!existing) await env.DB.prepare('INSERT INTO inbox(id,project_id,type,title,message,created_at) VALUES(?,?,?,?,?,?)').bind(id(), projectId, 'improvement', rule.title, rule.description, at).run();
  }
  return dbAll(env, 'SELECT * FROM improvements WHERE project_id=? ORDER BY created_at DESC', projectId);
}
app.get('/api/improvements', async c => { const { project } = await userProject(c, c.req.query('project')); return c.json({ items: (await dbAll(c.env, 'SELECT * FROM improvements WHERE project_id=? ORDER BY created_at DESC', project.id)).map(({ evidence_json, ...row }) => ({ ...row, evidence: JSON.parse(evidence_json) })) }); });
app.post('/api/improvements/analyze', async c => { const body = await readJson(c.req.raw), principal = await userProject(c, body.project_id); const items = await analyzeProject(c.env, principal.project.id); await audit(c.env, principal, 'improvements.analyzed', { count: items.length, method: 'rules', provider_called: false }); return c.json({ items }); });
app.patch('/api/improvements/:id', async c => {
  const body = await readJson(c.req.raw); if (!['accepted', 'dismissed'].includes(body.status)) throw new ApiError(400, 'status must be accepted or dismissed.');
  const user = await userRequired(c), row = await dbOne(c.env, 'SELECT i.* FROM improvements i JOIN projects p ON p.id=i.project_id JOIN members m ON m.workspace_id=p.workspace_id WHERE i.id=? AND m.user_id=?', c.req.param('id'), user.id);
  if (!row) throw new ApiError(404, 'Improvement not found.');
  const principal = await userProject(c, row.project_id);
  await c.env.DB.prepare('UPDATE improvements SET status=?,updated_at=? WHERE id=? AND project_id=?').bind(body.status, now(), row.id, row.project_id).run();
  await audit(c.env, principal, `improvement.${body.status}`, { improvement_id: row.id, configuration_applied: false });
  return c.json({ item: { ...row, status: body.status }, applied: false });
});
app.patch('/api/workspace', async c => {
  const user = await userRequired(c), workspace = await workspaceFor(c.env, user.id), body = await readJson(c.req.raw);
  await requireTerms(c.env, workspace.id);
  const name = body.name === undefined ? workspace.name : stringField(body.name, 'name', 100);
  const retention = body.retention_days ?? workspace.retention_days, mode = body.mode ?? workspace.mode, autopilot = body.autopilot ?? workspace.autopilot;
  const budget = body.monthly_budget === undefined ? workspace.monthly_budget : body.monthly_budget;
  if (!Number.isInteger(retention) || retention < 1 || retention > 365 || !['observe', 'optimize'].includes(mode) || !['off', 'suggest'].includes(autopilot) || (budget !== null && numeric(budget) === null)) throw new ApiError(400, 'Workspace settings are invalid.');
  await c.env.DB.prepare('UPDATE workspaces SET name=?,retention_days=?,mode=?,autopilot=?,monthly_budget=? WHERE id=?').bind(name, retention, mode, autopilot, budget, workspace.id).run();
  const project = await dbOne(c.env, 'SELECT * FROM projects WHERE workspace_id=? ORDER BY created_at LIMIT 1', workspace.id);
  if (project) await audit(c.env, { project, workspace, userId: user.id }, 'workspace.updated', { retention_days: retention, mode, autopilot, monthly_budget: budget });
  return c.json({ workspace: publicWorkspace({ ...workspace, name, retention_days: retention, mode, autopilot, monthly_budget: budget }) });
});
app.get('/api/inbox', async c => { const { project } = await userProject(c, c.req.query('project')); return c.json({ items: await dbAll(c.env, 'SELECT * FROM inbox WHERE project_id=? ORDER BY created_at DESC LIMIT 100', project.id) }); });
app.post('/api/ask', async c => {
  const body = await readJson(c.req.raw), principal = await userProject(c, body.project_id), { project } = principal, question = stringField(body.question, 'question', 2000);
  const data = await overview(c.env, project.id, 7), s = data.stats;
  const authorization = c.req.header('authorization');
  if (authorization) {
    const key = /^Bearer\s+([^\s]+)$/i.exec(authorization)?.[1];
    if (!key || key.length > 1024) throw new ApiError(401, 'Provide a valid Bearer provider API key for AI mode.');
    if (!['openai', 'anthropic'].includes(body.provider)) throw new ApiError(400, 'Choose openai or anthropic for AI mode.');
    const provider = body.provider as AssistantProvider, model = stringField(body.model, 'model', 200);
    if (!/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/.test(model) || model.includes(key)) throw new ApiError(400, 'Enter an explicit provider model name.');
    const context = groundedProjectContext(project.id, data), started = Date.now();
    const sources: AssistantSource[] = [{ type: 'project_statistics', project_id: project.id, days: 7 }, { type: 'model_breakdown', project_id: project.id, days: 7 }];
    if (data.traces.length) sources.push({ type: 'trace_metadata', project_id: project.id, trace_ids: data.traces.map(trace => trace.id) });
    try {
      const result = await askProvider({ provider, model, key, question, context });
      const traceId = await insertTrace(c.env, principal, { provider, model, status: 'success', http_status: 200, ...result.usage, token_basis: result.usage ? 'provider' : 'unavailable', latency_ms: Date.now() - started, input_bytes: result.requestBytes, output_bytes: result.responseBytes, request: { kind: 'project_assistant', question: redactCredential(question, key), sources }, response: { answer: result.answer }, compressed: false }, 'assistant');
      return c.json({ answer: result.answer, sources, method: 'llm', provider_called: true, provider, model, trace_id: traceId });
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      await insertTrace(c.env, principal, { provider, model, status: 'error', http_status: error.upstreamStatus ?? error.status, token_basis: 'unavailable', latency_ms: Date.now() - started, request: { kind: 'project_assistant', sources }, response: { error: error.message }, compressed: false }, 'assistant');
      return c.json({ error: error.message, upstream_status: error.upstreamStatus, method: 'llm', provider_called: true, provider, model }, error.status);
    }
  }
  const requestWord = s.requests === 1 ? 'request' : 'requests';
  const answer = !s.requests ? 'This project has no recorded requests in the last 7 days. Connect a client or import trace records to analyze actual usage.' : /error|fail|错误|失败/i.test(question) ? `${s.errors} of ${s.requests} recorded ${requestWord} failed in the last 7 days. Open the failed traces to inspect their recorded responses.` : /cost|price|spend|费用|成本/i.test(question) ? `Supplied pricing covers ${s.priced_requests} of ${s.requests} recorded ${requestWord}. Their estimated cost subtotal is ${s.estimated_cost_usd === null ? 'unavailable' : `$${Number(s.estimated_cost_usd).toFixed(6)}`}. Unknown model prices are not filled in.` : `In the last 7 days this project recorded ${s.requests} ${requestWord}, ${s.input_tokens} input ${s.input_tokens === 1 ? 'token' : 'tokens'}, ${s.output_tokens} output ${s.output_tokens === 1 ? 'token' : 'tokens'} and ${s.errors} ${s.errors === 1 ? 'error' : 'errors'}. ${s.usage_available_requests} ${s.usage_available_requests === 1 ? 'request includes' : 'requests include'} token measurements. This answer is computed from project statistics; no language-model provider was called.`;
  return c.json({ answer, sources: s.requests ? [{ type: 'project_statistics', project_id: project.id, days: 7 }] : [], method: 'rules', provider_called: false });
});

function headerPrices(request: Request): Prices | undefined {
  const input = request.headers.get('x-traqiva-price-input'), output = request.headers.get('x-traqiva-price-output');
  if (input === null || output === null) return undefined;
  const cached = request.headers.get('x-traqiva-price-cached');
  const prices = { input_per_million: Number(input), output_per_million: Number(output), ...(cached !== null ? { cached_input_per_million: Number(cached) } : {}) };
  return Object.values(prices).every(value => Number.isFinite(value) && value >= 0) ? prices : undefined;
}
async function streamEvidence(stream: ReadableStream<Uint8Array>, provider: 'openai' | 'anthropic', isSse: boolean) {
  const reader = stream.getReader(), decoder = new TextDecoder(), collector = new UsageCollector(provider);
  let bytes = 0, capture = '', carry = '', captureComplete = true;
  const acceptBlock = (block: string) => { const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'); if (data && data !== '[DONE]') { try { collector.accept(JSON.parse(data)); } catch { /* Partial content does not create usage. */ } } };
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    bytes += value.byteLength; const text = decoder.decode(value, { stream: true });
    if (captureComplete && encoder.encode(capture).byteLength + value.byteLength <= 262144) capture += text; else captureComplete = false;
    if (isSse) {
      carry = (carry + text).replace(/\r\n/g, '\n'); let end: number;
      while ((end = carry.indexOf('\n\n')) !== -1) { acceptBlock(carry.slice(0, end)); carry = carry.slice(end + 2); }
      if (carry.length > 1_048_576) carry = '';
    }
  }
  let response: unknown = { body_stored: false, stream: isSse };
  if (isSse) { if (carry) acceptBlock(carry); response = { stream: true, usage: collector.usage, body_stored: false }; }
  else if (captureComplete) { try { response = JSON.parse(capture); collector.accept(response); } catch { response = { body_stored: false, reason: 'non_json_response' }; } }
  return { usage: collector.usage, bytes, response };
}
app.post('/v1/responses', async c => gateway(c));
app.post('/v1/messages', async c => gateway(c));
app.post('/v1/chat/completions', async c => gateway(c));
async function gateway(c: any) {
  const principal = await keyPrincipal(c), started = Date.now(), path = c.req.path;
  const provider = path === '/v1/messages' ? 'anthropic' : 'openai';
  if (!['/v1/chat/completions', '/v1/responses', '/v1/messages'].includes(path)) throw new ApiError(404, 'Unknown gateway endpoint.');
  const authorization = c.req.header('authorization') ?? '', bearer = /^Bearer\s+([^\s]+)$/i.exec(authorization)?.[1];
  const providerKey = bearer ?? (provider === 'anthropic' ? c.req.header('x-api-key') : undefined);
  if (!providerKey || providerKey.length > 1024) throw new ApiError(401, 'Provide your upstream provider API key for this request. It is not stored.');
  const body = await readBodyText(c.req.raw, 2_097_152);
  let payload: any;
  try { payload = JSON.parse(body); } catch { throw new ApiError(400, 'Invalid JSON.'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ApiError(400, 'A provider request object is required.');
  const model = stringField(payload.model, 'model', 200);
  if (model.includes(providerKey)) throw new ApiError(400, 'The model name must not contain a provider credential.');
  const prices = headerPrices(c.req.raw), safeRequest = redactCredential(payload, providerKey);
  const headers = new Headers({ 'content-type': 'application/json', 'accept-encoding': 'identity' });
  if (provider === 'openai') headers.set('authorization', `Bearer ${providerKey}`);
  else { headers.set('x-api-key', providerKey); headers.set('anthropic-version', c.req.header('anthropic-version') ?? '2023-06-01'); const beta = c.req.header('anthropic-beta'); if (beta && beta.length < 1000) headers.set('anthropic-beta', beta); }
  let upstream: Response;
  try { upstream = await fetch(`${provider === 'openai' ? 'https://api.openai.com' : 'https://api.anthropic.com'}${path}`, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(120000) }); }
  catch { await insertTrace(c.env, principal, { model, provider, status: 'error', http_status: 502, latency_ms: Date.now() - started, token_basis: 'unavailable', input_bytes: encoder.encode(body).byteLength, request: safeRequest, response: { error: 'Upstream connection failed.' } }, 'gateway'); return c.json({ error: 'Upstream connection failed.' }, 502); }
  if (upstream.status >= 300 && upstream.status < 400) {
    try { await upstream.body?.cancel(); } catch { /* Redirects remain rejected even if the response stream fails. */ }
    await insertTrace(c.env, principal, { model, provider, status: 'error', http_status: upstream.status, latency_ms: Date.now() - started, token_basis: 'unavailable', input_bytes: encoder.encode(body).byteLength, request: safeRequest, response: { error: 'Upstream redirects are not allowed.' } }, 'gateway');
    return c.json({ error: 'Upstream redirects are not allowed.' }, 502);
  }
  const responseHeaders = new Headers();
  for (const name of ['content-type', 'cache-control', 'retry-after', 'x-request-id', 'request-id']) { const value = upstream.headers.get(name); if (value) responseHeaders.set(name, value); }
  responseHeaders.set('Cache-Control', 'no-store'); responseHeaders.set('X-Traqiva-Mode', principal.workspace.mode); responseHeaders.set('X-Traqiva-Optimization', 'not-applied');
  const traceId = id(); responseHeaders.set('X-Traqiva-Request-Id', traceId);
  if (!upstream.body) { await insertTrace(c.env, principal, { model, provider, http_status: upstream.status, latency_ms: Date.now() - started, token_basis: 'unavailable', input_bytes: encoder.encode(body).byteLength }, 'gateway', traceId); return new Response(null, { status: upstream.status, headers: responseHeaders }); }
  const [client, metering] = upstream.body.tee();
  const record = (async () => {
    let evidence: { usage: Usage | null; bytes: number; response: unknown }, streamFailed = false;
    try { evidence = await streamEvidence(metering, provider, (upstream.headers.get('content-type') ?? '').includes('text/event-stream')); }
    catch { streamFailed = true; evidence = { usage: null, bytes: 0, response: { error: 'The upstream response ended before usage could be measured.' } }; }
    const cost = computeCost(model, evidence.usage, prices);
    await insertTrace(c.env, principal, { model, provider, http_status: upstream.status, status: upstream.status >= 400 || streamFailed ? 'error' : 'success', ...evidence.usage, token_basis: evidence.usage ? 'provider' : 'unavailable', latency_ms: Date.now() - started, cost_usd: cost, cost_basis: cost === null ? 'unavailable' : 'user_price_estimate', input_bytes: encoder.encode(body).byteLength, output_bytes: evidence.bytes, request: safeRequest, response: redactCredential(evidence.response, providerKey), compressed: false }, 'gateway', traceId);
  })();
  const execution = (() => { try { return c.executionCtx as Execution; } catch { return undefined; } })();
  if (execution) execution.waitUntil(record); else await record;
  return new Response(client, { status: upstream.status, headers: responseHeaders });
}
app.all('/api/*', c => c.json({ error: 'API route not found.' }, 404));
app.all('/v1/*', c => c.json({ error: 'Gateway endpoint not found.' }, 404));
app.get('/health', c => c.json({ ok: true, service: 'traqiva' }));
app.all('*', c => c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.json({ error: 'Not found.' }, 404));

export async function scheduled(_event: unknown, env: Env, execution: Execution) {
  execution.waitUntil((async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM traces WHERE id IN (SELECT t.id FROM traces t JOIN projects p ON p.id=t.project_id JOIN workspaces w ON w.id=p.workspace_id WHERE julianday(t.created_at)<julianday('now')-w.retention_days)"),
      env.DB.prepare("DELETE FROM compression_events WHERE id IN (SELECT t.id FROM compression_events t JOIN projects p ON p.id=t.project_id JOIN workspaces w ON w.id=p.workspace_id WHERE julianday(t.created_at)<julianday('now')-w.retention_days)"),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now()),
      env.DB.prepare('DELETE FROM oauth_states WHERE expires_at<?').bind(now()),
      env.DB.prepare('DELETE FROM recoveries WHERE expires_at<?').bind(now()),
      env.DB.prepare('DELETE FROM auth_attempts WHERE window_start<?').bind(Math.floor(Date.now() / 900_000) - 96),
    ]);
    const projects = await dbAll(env, "SELECT p.id FROM projects p JOIN workspaces w ON w.id=p.workspace_id WHERE w.autopilot='suggest' LIMIT 500");
    for (const project of projects) await analyzeProject(env, project.id);
  })());
}
export default { fetch: app.fetch, scheduled };
