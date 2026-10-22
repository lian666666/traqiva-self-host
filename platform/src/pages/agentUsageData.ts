import type { AgentUsageMetrics } from '../../server/agent-usage';

export type AgentUsageResponse = {
  summary: AgentUsageMetrics & { coding_agents: number; attributed_requests: number; unattributed_requests: number };
  agents: (AgentUsageMetrics & { agent: string | null })[];
  work_types: (AgentUsageMetrics & { work_type: string | null })[];
  range: { from: string; to: string } | null;
  truncated: boolean;
  limit: number;
};
export type UsageMetric = 'requests' | 'tokens' | 'cost';
export const emptyAgentUsage: AgentUsageResponse = {
  summary: { requests: 0, coding_agents: 0, attributed_requests: 0, unattributed_requests: 0, provider_requests: 0, estimated_requests: 0, unavailable_requests: 0, input_tokens: null, output_tokens: null, cached_tokens: null, cache_requests: 0, cache_input_tokens: null, cache_read_percent: null, priced_cost_usd: null, priced_requests: 0, reported_price_requests: 0, estimated_price_requests: 0, cost_per_request_usd: null },
  agents: [], work_types: [], range: null, truncated: false, limit: 200,
};
export const agentUsageDays = (value: string | null): '7' | '30' | '90' => value === '7' || value === '90' ? value : '30';
export const agentUsageResource = (project: string | undefined, days: string) => project ? `/api/developers/usage?project=${encodeURIComponent(project)}&days=${days}` : null;
export function agentMetric(item: AgentUsageResponse['agents'][number], metric: UsageMetric): number | null {
  if (metric === 'cost') return item.priced_cost_usd;
  if (metric === 'tokens') return item.input_tokens === null || item.output_tokens === null ? null : item.input_tokens + item.output_tokens;
  return item.requests;
}
export function orderedAgents(items: AgentUsageResponse['agents'], metric: UsageMetric) {
  return [...items].sort((a, b) => {
    const left = agentMetric(a, metric), right = agentMetric(b, metric);
    return left === right ? (a.agent ?? 'Unattributed').localeCompare(b.agent ?? 'Unattributed') : left === null ? 1 : right === null ? -1 : right - left;
  });
}
