import type { Context, Hono } from 'hono';
import { ApiError, now } from './security';
import type { Env, Principal, Row } from './types';

type AppEnv = { Bindings: Env; Variables: { user: Row } };
type Auth = { userProject(c: Context<AppEnv>, projectId: unknown): Promise<Principal> };
const LIMIT = 200;
const filter = "project_id=? AND source IN ('sdk','gateway','native_proxy') AND created_at>=? AND created_at<=?";
// Existing SDK ingestion and the gateway preserve these explicitly reported
// request fields. Provider/model/source names are never agent attribution.
// Extract this allowlist inside D1; no prompt, response or full request is read.
const metadataColumns = [
  ['$.metadata.traqiva_agent', 'traqiva_agent'], ['$.metadata.coding_agent', 'metadata_agent'], ['$.coding_agent', 'coding_agent'],
  ['$.metadata.traqiva_work_type', 'traqiva_work_type'], ['$.metadata.work_type', 'metadata_work_type'], ['$.work_type', 'work_type'],
].map(([path, name]) => `CASE WHEN json_valid(request_json) THEN json_extract(request_json,'${path}') END AS ${name}`).join(',');
const credentialLike = /^(?:sk[-_]|tq_|trq_|gh[pousr]_|github_pat_|AIza|Bearer)/i;
const aliases: Record<string, string> = { codex: 'Codex', 'claude code': 'Claude Code', 'claude-code': 'Claude Code', claude_code: 'Claude Code', cursor: 'Cursor', windsurf: 'Windsurf', 'github copilot': 'GitHub Copilot', 'github-copilot': 'GitHub Copilot', aider: 'Aider', cline: 'Cline', 'roo code': 'Roo Code' };
const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1e12 ? value : null;
const cost = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12 ? value : null;

function reportedLabel(values: unknown[], agent = false): string | null {
  const labels: string[] = [];
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(value) || credentialLike.test(value)) return null;
    const label = value.trim().replace(/ +/g, ' '), lower = label.toLowerCase();
    if (['unknown', 'unattributed', 'unreported', 'not reported'].includes(lower)) return null;
    labels.push(agent && Object.hasOwn(aliases, lower) ? aliases[lower] : label);
  }
  // Conflicting reports cannot establish which agent or work type was used.
  return labels.length && new Set(labels.map(label => label.toLowerCase())).size === 1 ? labels[0] : null;
}

export type AgentUsageMetrics = {
  requests: number; provider_requests: number; estimated_requests: number; unavailable_requests: number;
  input_tokens: number | null; output_tokens: number | null; cached_tokens: number | null;
  cache_requests: number; cache_input_tokens: number | null; cache_read_percent: number | null;
  priced_cost_usd: number | null; priced_requests: number; reported_price_requests: number; estimated_price_requests: number;
  cost_per_request_usd: number | null;
};
function emptyMetrics(): AgentUsageMetrics {
  return { requests: 0, provider_requests: 0, estimated_requests: 0, unavailable_requests: 0, input_tokens: null, output_tokens: null, cached_tokens: null, cache_requests: 0, cache_input_tokens: null, cache_read_percent: null, priced_cost_usd: null, priced_requests: 0, reported_price_requests: 0, estimated_price_requests: 0, cost_per_request_usd: null };
}
function addRequest(metrics: AgentUsageMetrics, row: Row) {
  metrics.requests++;
  const input = count(row.input_tokens), output = count(row.output_tokens), cached = count(row.cached_tokens);
  if (row.token_basis === 'provider' && input !== null && output !== null) {
    metrics.provider_requests++;
    metrics.input_tokens = (metrics.input_tokens ?? 0) + input;
    metrics.output_tokens = (metrics.output_tokens ?? 0) + output;
    if (cached !== null && cached <= input) {
      metrics.cache_requests++;
      metrics.cached_tokens = (metrics.cached_tokens ?? 0) + cached;
      metrics.cache_input_tokens = (metrics.cache_input_tokens ?? 0) + input;
    }
  } else if (row.token_basis === 'estimated' && input !== null && output !== null) metrics.estimated_requests++;
  else metrics.unavailable_requests++;
  const priced = cost(row.cost_usd);
  if (priced !== null && ['client_reported', 'user_price_estimate'].includes(row.cost_basis)) {
    metrics.priced_cost_usd = (metrics.priced_cost_usd ?? 0) + priced;
    metrics.priced_requests++;
    if (row.cost_basis === 'user_price_estimate') metrics.estimated_price_requests++;
    else metrics.reported_price_requests++;
  }
  metrics.cache_read_percent = metrics.cache_input_tokens ? 100 * (metrics.cached_tokens ?? 0) / metrics.cache_input_tokens : null;
  metrics.cost_per_request_usd = metrics.requests && metrics.priced_requests === metrics.requests ? (metrics.priced_cost_usd ?? 0) / metrics.requests : null;
}

export function registerAgentUsage(app: Hono<AppEnv>, auth: Auth) {
  app.get('/api/developers/usage', async c => {
    const { project } = await auth.userProject(c, c.req.query('project'));
    const days = c.req.query('days') ?? '30';
    if (!['7', '30', '90'].includes(days)) throw new ApiError(400, 'Choose 7, 30 or 90 days.');
    const to = now(), from = new Date(Date.parse(to) - (Number(days) - 1) * 86400_000).toISOString().slice(0, 10) + 'T00:00:00.000Z';
    const bindings = [project.id, from, to];
    const rows = (await c.env.DB.prepare(`SELECT id,created_at,token_basis,input_tokens,output_tokens,cached_tokens,cost_usd,cost_basis,${metadataColumns} FROM traces WHERE ${filter} ORDER BY created_at DESC,id DESC LIMIT ${LIMIT}`).bind(...bindings).all<Row>()).results;
    let truncated = false;
    if (rows.length === LIMIT) {
      const last = rows[rows.length - 1];
      const more = await c.env.DB.prepare(`SELECT EXISTS(SELECT 1 FROM traces WHERE ${filter} AND (created_at<? OR (created_at=? AND id<?)) LIMIT 1) AS more`).bind(...bindings, last.created_at, last.created_at, last.id).first<Row>();
      truncated = Boolean(more?.more);
    }
    const summary = emptyMetrics(), agents = new Map<string | null, AgentUsageMetrics>(), workTypes = new Map<string | null, AgentUsageMetrics>();
    let attributed = 0;
    for (const row of rows) {
      const timestamp = Date.parse(row.created_at);
      if (!Number.isFinite(timestamp) || timestamp < Date.parse(from) || timestamp > Date.parse(to)) continue;
      const agent = reportedLabel([row.traqiva_agent, row.metadata_agent, row.coding_agent], true);
      const workType = reportedLabel([row.traqiva_work_type, row.metadata_work_type, row.work_type]);
      if (agent !== null) attributed++;
      addRequest(summary, row);
      if (!agents.has(agent)) agents.set(agent, emptyMetrics());
      if (!workTypes.has(workType)) workTypes.set(workType, emptyMetrics());
      addRequest(agents.get(agent)!, row);
      addRequest(workTypes.get(workType)!, row);
    }
    return c.json({
      summary: { ...summary, coding_agents: [...agents.keys()].filter(agent => agent !== null).length, attributed_requests: attributed, unattributed_requests: summary.requests - attributed },
      agents: [...agents].map(([agent, metrics]) => ({ agent, ...metrics })).sort((a, b) => b.requests - a.requests || (a.agent ?? '').localeCompare(b.agent ?? '')),
      work_types: [...workTypes].map(([work_type, metrics]) => ({ work_type, ...metrics })).sort((a, b) => b.requests - a.requests || (a.work_type ?? '').localeCompare(b.work_type ?? '')),
      range: { from, to }, truncated, limit: LIMIT,
    });
  });
}
