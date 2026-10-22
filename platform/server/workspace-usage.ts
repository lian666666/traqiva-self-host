import type { Context, Hono } from 'hono';
import { getAiAllowance } from './ai-allowance';
import { hostedAvailable, publicAiAllowance } from './hosted-ask';
import { now } from './security';
import type { Env, Principal, Row } from './types';

type AppEnv = { Bindings: Env; Variables: { user: Row } };
type Auth = { userProject(c: Context<AppEnv>, projectId: unknown): Promise<Principal> };

// First-party assistant audits belong to AI accounting, never to connected
// project traffic. Preserve all currently supported external record sources.
export const EXTERNAL_TRACE_FILTER = "source IN ('sdk','gateway','native_proxy','import')";

// Only the server gateway can persist this decision contract. Invalid JSON or
// arbitrary objects are not routing evidence, and raw request bodies are unread.
const routingDecision = `CASE WHEN t.source='gateway' AND json_valid(t.routing_json) THEN CASE WHEN
  json_type(t.routing_json)='object'
  AND json_extract(t.routing_json,'$.method')='rules_v1'
  AND json_extract(t.routing_json,'$.requested_model')='traqiva-auto'
  AND json_type(t.routing_json,'$.selected_model')='text'
  AND length(trim(json_extract(t.routing_json,'$.selected_model'))) BETWEEN 1 AND 200
  AND json_extract(t.routing_json,'$.tier') IN ('small','balanced','reasoning')
  AND json_extract(t.routing_json,'$.reason') IN ('tools_present','conversation_context_unavailable','complexity_keyword','large_request','medium_request','short_request')
  AND json_type(t.routing_json,'$.quality_verified')='false'
  AND (json_type(t.routing_json,'$.reasoning_effort')='null' OR json_extract(t.routing_json,'$.reasoning_effort') IN ('low','medium','high'))
  THEN 1 ELSE 0 END ELSE 0 END`;

export function registerWorkspaceUsage(app: Hono<AppEnv>, auth: Auth) {
  app.get('/api/workspace/usage', async c => {
    const principal = await auth.userProject(c, c.req.query('project'));
    const to = now(), from = to.slice(0, 7) + '-01T00:00:00.000Z';
    const traffic = await c.env.DB.prepare(`SELECT COUNT(*) AS events,COALESCE(SUM(${routingDecision}),0) AS decisions
      FROM projects p JOIN traces t ON t.project_id=p.id
      WHERE p.workspace_id=? AND t.${EXTERNAL_TRACE_FILTER} AND t.created_at>=? AND t.created_at<=? AND julianday(t.created_at) IS NOT NULL`)
      .bind(principal.workspace.id, from, to).first<{ events: number; decisions: number }>();
    const allowance = await getAiAllowance(c.env.DB, principal.userId!);
    return c.json({
      ai: { available: hostedAvailable(c.env), allowance: publicAiAllowance(allowance) },
      observability: { events: traffic?.events ?? 0, limit: 100000, enforced: false },
      // Request latency is not agent runtime. No reliable session-duration
      // accounting exists yet, so the preview must not invent consumed minutes.
      agent_runs: { minutes: null, limit: 600, enforced: false },
      routing: { decisions: traffic?.decisions ?? 0, limit: 25000, enforced: false },
      range: { from, to }, plan_enforced: false,
    });
  });
}
