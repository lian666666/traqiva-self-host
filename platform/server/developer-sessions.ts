import type { Context, Hono } from 'hono';
import { ApiError, now } from './security';
import type { Env, Principal, Row } from './types';

type AppEnv = { Bindings: Env; Variables: { user: Row } };
type Auth = { userProject(c: Context<AppEnv>, projectId: unknown): Promise<Principal> };
export type DeveloperSession = {
  id: string; repository: string | null; models: string[]; started_at: string; last_at: string;
  requests: number; input_tokens: number | null; output_tokens: number | null; cached_tokens: number | null;
  priced_cost_usd: number | null; priced_requests: number; trace_ids: string[];
};
type Group = { item: DeveloperSession; repositories: Set<string>; models: Set<string> };
const LIMIT = 200;
// SDK ingestion, the provider gateway and native-proxy traces are request sources.
// Manual trace imports, browser assistant calls and compression events are not sessions.
const filter = "project_id=? AND source IN ('sdk','gateway','native_proxy') AND created_at>=? AND created_at<=?";
// Extract only the allowlisted metadata inside SQLite. Large prompts and secret
// fields never leave D1 for this endpoint; malformed stored JSON safely yields NULL.
const metadataColumns = [
  ['$.session_id', 'session_id'], ['$.metadata.traqiva_session_id', 'traqiva_session_id'],
  ['$.metadata.session_id', 'metadata_session_id'], ['$.repository', 'repository'], ['$.metadata.repository', 'metadata_repository'],
].map(([path, name]) => `CASE WHEN json_valid(request_json) THEN json_extract(request_json,'${path}') END AS ${name}`).join(',');
const credentialLike = /^(?:sk[-_]|tq_|trq_|gh[pousr]_|github_pat_|AIza|Bearer)/i;
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) && !credentialLike.test(value);
const safeModel = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value) && !credentialLike.test(value);
const safeRepository = (value: unknown): value is string => typeof value === 'string' && value.length <= 200 && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?$/.test(value) && !credentialLike.test(value);
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1e12 ? value : null;
const cost = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12 ? value : null;
const add = (sum: number | null, value: unknown) => sum === null || count(value) === null ? null : sum + (value as number);

export function registerDeveloperSessions(app: Hono<AppEnv>, auth: Auth) {
  app.get('/api/developer-sessions', async c => {
    const { project } = await auth.userProject(c, c.req.query('project'));
    const dayValue = c.req.query('days') ?? '30';
    if (!['7', '30', '90'].includes(dayValue)) throw new ApiError(400, 'Choose 7, 30 or 90 days.');
    const to = now(), from = new Date(Date.parse(to) - (Number(dayValue) - 1) * 86400_000).toISOString().slice(0, 10) + 'T00:00:00.000Z';
    const bindings = [project.id, from, to];
    const rows = (await c.env.DB.prepare(`SELECT id,model,created_at,token_basis,input_tokens,output_tokens,cached_tokens,cost_usd,${metadataColumns} FROM traces WHERE ${filter} ORDER BY created_at DESC,id DESC LIMIT ${LIMIT}`).bind(...bindings).all<Row>()).results;
    let truncated = false;
    if (rows.length === LIMIT) {
      const last = rows[rows.length - 1];
      // Look behind only for existence; a 201st request body is never read or parsed.
      const more = await c.env.DB.prepare(`SELECT EXISTS(SELECT 1 FROM traces WHERE ${filter} AND (created_at<? OR (created_at=? AND id<?)) LIMIT 1) AS more`).bind(...bindings, last.created_at, last.created_at, last.id).first<Row>();
      truncated = Boolean(more?.more);
    }
    const groups = new Map<string, Group>();
    for (const row of rows) {
      const timestamp = Date.parse(row.created_at);
      if (!Number.isFinite(timestamp) || timestamp < Date.parse(from) || timestamp > Date.parse(to)) continue;
      const sessionId = [row.session_id, row.traqiva_session_id, row.metadata_session_id].find(safeId);
      if (!sessionId) continue;
      const repository = [row.repository, row.metadata_repository].find(safeRepository);
      const createdAt = new Date(timestamp).toISOString();
      let group = groups.get(sessionId);
      if (!group) {
        group = { item: { id: sessionId, repository: null, models: [], started_at: createdAt, last_at: createdAt, requests: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0, priced_cost_usd: null, priced_requests: 0, trace_ids: [] }, repositories: new Set(), models: new Set() };
        groups.set(sessionId, group);
      }
      const item = group.item;
      item.requests++; item.trace_ids.push(row.id);
      if (createdAt < item.started_at) item.started_at = createdAt;
      if (createdAt > item.last_at) item.last_at = createdAt;
      if (repository) group.repositories.add(repository);
      if (safeModel(row.model)) group.models.add(row.model);
      // Session metrics describe provider measurements. A single estimated or
      // unavailable request leaves the complete session total unknown.
      const available = row.token_basis === 'provider';
      item.input_tokens = add(item.input_tokens, available ? row.input_tokens : null);
      item.output_tokens = add(item.output_tokens, available ? row.output_tokens : null);
      item.cached_tokens = add(item.cached_tokens, available ? row.cached_tokens : null);
      const priced = cost(row.cost_usd);
      if (priced !== null) { item.priced_cost_usd = (item.priced_cost_usd ?? 0) + priced; item.priced_requests++; }
    }
    const items = [...groups.values()].map(({ item, repositories, models }) => ({ ...item, repository: repositories.size === 1 ? [...repositories][0] : null, models: [...models].sort() }))
      .sort((a, b) => b.last_at.localeCompare(a.last_at) || a.id.localeCompare(b.id));
    return c.json({ items, range: { from, to }, truncated });
  });
}
