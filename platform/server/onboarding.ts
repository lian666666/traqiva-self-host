import type { Context, Hono } from 'hono';
import { ApiError, id, now, readJson, stringField } from './security';
import type { Env, Row } from './types';

export const TERMS_VERSION = '2026-10-20.1';
type Setup = { stage: 'goals' | 'project' | 'connect' | 'complete'; goals: Array<'coding' | 'observe'>; project_id: string | null };
type AppEnv = { Bindings: Env; Variables: { user: Row } };
type Ctx = Context<AppEnv>;
type Auth = { userRequired(c: Ctx): Promise<Row>; workspaceFor(env: Env, userId: string): Promise<Row> };
const one = (env: Env, sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).first<Row>();

export async function onboardingFor(env: Env, userId: string): Promise<Setup> {
  const at = now();
  await env.DB.prepare('INSERT OR IGNORE INTO user_onboarding(user_id,created_at,updated_at) VALUES(?,?,?)').bind(userId, at, at).run();
  const row = (await one(env, 'SELECT stage,goals_json,project_id FROM user_onboarding WHERE user_id=?', userId))!;
  return { stage: row.stage, goals: JSON.parse(row.goals_json), project_id: row.project_id };
}
export async function termsFor(env: Env, workspaceId: string) {
  const accepted = await one(env, 'SELECT accepted_at FROM workspace_terms_acceptances WHERE workspace_id=? AND version=?', workspaceId, TERMS_VERSION);
  return { version: TERMS_VERSION, accepted: Boolean(accepted), accepted_at: accepted?.accepted_at ?? null };
}
export async function requireTerms(env: Env, workspaceId: string) {
  if (!(await termsFor(env, workspaceId)).accepted) throw new ApiError(428, 'Accept the current workspace terms before continuing.');
}
export async function connectionStatus(env: Env, setup: Setup, workspaceId: string) {
  const empty = { connected: false, method: null, last_activity_at: null };
  if (!setup.project_id || !await one(env, 'SELECT id FROM projects WHERE id=? AND workspace_id=?', setup.project_id, workspaceId)) return empty;
  const projectId = setup.project_id, at = now();
  const evidence: Array<{ method: 'project_key' | 'traffic' | 'compression'; at: string | null }> = [
    { method: 'project_key', at: (await one(env, 'SELECT MAX(last_used_at) AS at FROM project_keys WHERE project_id=? AND revoked_at IS NULL', projectId))?.at ?? null },
    // Manual imports and browser assistant requests do not establish that a coding agent or SDK connected.
    { method: 'traffic', at: (await one(env, "SELECT MAX(created_at) AS at FROM traces WHERE project_id=? AND source IN ('gateway','sdk') AND created_at<=?", projectId, at))?.at ?? null },
    { method: 'compression', at: (await one(env, 'SELECT MAX(created_at) AS at FROM compression_events WHERE project_id=? AND created_at<=?', projectId, at))?.at ?? null },
  ];
  const latest = evidence.filter((item): item is { method: 'project_key' | 'traffic' | 'compression'; at: string } => Boolean(item.at)).sort((a, b) => b.at.localeCompare(a.at))[0];
  return latest ? { connected: true, method: latest.method, last_activity_at: latest.at } : empty;
}
async function setupAudit(env: Env, userId: string, workspaceId: string, projectId: string | null, action: string, details: unknown) {
  await env.DB.prepare('INSERT INTO audit_log(id,workspace_id,project_id,user_id,action,details_json,created_at) VALUES(?,?,?,?,?,?,?)').bind(id(), workspaceId, projectId, userId, action, JSON.stringify(details), now()).run();
}
export function registerOnboarding(app: Hono<AppEnv>, auth: Auth) {
  const context = async (c: Ctx) => {
    const user = await auth.userRequired(c), workspace = await auth.workspaceFor(c.env, user.id), setup = await onboardingFor(c.env, user.id);
    return { user, workspace, setup };
  };
  app.post('/api/consent', async c => {
    const { user, workspace } = await context(c), body = await readJson(c.req.raw);
    if (body.version !== TERMS_VERSION || body.accepted !== true) throw new ApiError(400, 'Explicitly accept the current terms version.');
    const member = await one(c.env, 'SELECT role FROM members WHERE workspace_id=? AND user_id=?', workspace.id, user.id);
    if (member?.role !== 'owner') throw new ApiError(403, 'A workspace owner must accept the terms.');
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO audit_log(id,workspace_id,project_id,user_id,action,details_json,created_at) SELECT ?,?,NULL,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM workspace_terms_acceptances WHERE workspace_id=? AND version=?)").bind(id(), workspace.id, user.id, 'terms.accepted', JSON.stringify({ version: TERMS_VERSION }), now(), workspace.id, TERMS_VERSION),
      c.env.DB.prepare('INSERT INTO workspace_terms_acceptances(workspace_id,version,accepted_by,accepted_at) VALUES(?,?,?,?) ON CONFLICT(workspace_id,version) DO NOTHING').bind(workspace.id, TERMS_VERSION, user.id, now()),
    ]);
    return c.json({ terms: await termsFor(c.env, workspace.id) });
  });
  app.post('/api/onboarding/goals', async c => {
    const { user, workspace } = await context(c), body = await readJson(c.req.raw), goals = body.goals;
    if (!Array.isArray(goals) || goals.length < 1 || goals.length > 2 || new Set(goals).size !== goals.length || goals.some(goal => !['coding', 'observe'].includes(goal))) throw new ApiError(400, 'Select one or both goals: coding, observe.');
    await c.env.DB.prepare("UPDATE user_onboarding SET goals_json=?,stage=CASE WHEN stage='goals' THEN 'project' ELSE stage END,updated_at=? WHERE user_id=?").bind(JSON.stringify(goals), now(), user.id).run();
    await setupAudit(c.env, user.id, workspace.id, null, 'onboarding.goals', { goals });
    return c.json({ setup: await onboardingFor(c.env, user.id) });
  });
  app.post('/api/onboarding/project', async c => {
    const { user, workspace, setup } = await context(c), body = await readJson(c.req.raw), name = stringField(body.name, 'name', 100);
    if (!setup.goals.length) throw new ApiError(409, 'Select your goals before choosing a project.');
    let project = setup.project_id ? await one(c.env, 'SELECT * FROM projects WHERE id=? AND workspace_id=?', setup.project_id, workspace.id) : null;
    project ??= await one(c.env, 'SELECT * FROM projects WHERE workspace_id=? ORDER BY created_at,id LIMIT 1', workspace.id);
    const member = await one(c.env, 'SELECT role FROM members WHERE workspace_id=? AND user_id=?', workspace.id, user.id);
    if (member?.role !== 'owner' && (!project || project.name !== name)) throw new ApiError(403, 'Workspace owner access is required to create or rename a project.');
    if (!project) {
      // One atomic conditional insert also handles concurrent retries when a workspace has no project.
      await c.env.DB.prepare('INSERT INTO projects(id,workspace_id,name,created_at) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM projects WHERE workspace_id=?)').bind(id(), workspace.id, name, now(), workspace.id).run();
      project = (await one(c.env, 'SELECT * FROM projects WHERE workspace_id=? ORDER BY created_at,id LIMIT 1', workspace.id))!;
    }
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE projects SET name=? WHERE id=? AND workspace_id=?').bind(name, project.id, workspace.id),
      c.env.DB.prepare("UPDATE user_onboarding SET project_id=?,stage=CASE WHEN stage='complete' THEN 'complete' ELSE 'connect' END,updated_at=? WHERE user_id=?").bind(project.id, now(), user.id),
    ]);
    await setupAudit(c.env, user.id, workspace.id, project.id, 'onboarding.project', { name });
    return c.json({ setup: await onboardingFor(c.env, user.id), project: { ...project, name } });
  });
  app.get('/api/onboarding/status', async c => {
    const { workspace, setup } = await context(c);
    return c.json(await connectionStatus(c.env, setup, workspace.id));
  });
  app.post('/api/onboarding/complete', async c => {
    const { user, workspace, setup } = await context(c), body = await readJson(c.req.raw);
    await requireTerms(c.env, workspace.id);
    if (typeof body.skip_connection !== 'boolean') throw new ApiError(400, 'skip_connection must be an explicit boolean.');
    if (!setup.goals.length || !setup.project_id || !['connect', 'complete'].includes(setup.stage) || !await one(c.env, 'SELECT id FROM projects WHERE id=? AND workspace_id=?', setup.project_id, workspace.id)) throw new ApiError(409, 'Choose your goals and project before completing setup.');
    if (setup.stage !== 'complete') {
      const connection = await connectionStatus(c.env, setup, workspace.id);
      if (!connection.connected && body.skip_connection !== true) throw new ApiError(409, 'Connect your project or explicitly skip this step.');
      await c.env.DB.prepare("UPDATE user_onboarding SET stage='complete',updated_at=? WHERE user_id=?").bind(now(), user.id).run();
      await setupAudit(c.env, user.id, workspace.id, setup.project_id, 'onboarding.completed', { connection_method: connection.method, skipped_connection: body.skip_connection });
    }
    return c.json({ setup: await onboardingFor(c.env, user.id) });
  });
  app.post('/api/onboarding/restart', async c => {
    const { user, workspace, setup } = await context(c);
    if (c.req.raw.body) await readJson(c.req.raw);
    await c.env.DB.prepare("UPDATE user_onboarding SET stage='goals',updated_at=? WHERE user_id=?").bind(now(), user.id).run();
    await setupAudit(c.env, user.id, workspace.id, setup.project_id, 'onboarding.restarted', {});
    return c.json({ setup: await onboardingFor(c.env, user.id) });
  });
}
