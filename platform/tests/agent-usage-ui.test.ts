import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentUsage from '../src/pages/AgentUsage';
import { agentMetric, agentUsageDays, agentUsageResource, orderedAgents, type AgentUsageResponse } from '../src/pages/agentUsageData';

const state = vi.hoisted(() => ({ data: null as unknown, loading: false, error: '', paths: [] as string[] }));
vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
  const project = { id: 'project-real', name: 'Real project' };
  return { ...actual, useApp: () => ({ project, session: { projects: [project, { id: 'project-other', name: 'Other project' }] }, setProject: () => {} }), useResource: (path: string | null, initial: unknown) => {
    if (path) state.paths.push(path);
    return { data: state.data ?? initial, loading: state.loading, error: state.error, refresh: () => {} };
  } };
});
const metrics = { requests: 0, provider_requests: 0, estimated_requests: 0, unavailable_requests: 0, input_tokens: null, output_tokens: null, cached_tokens: null, cache_requests: 0, cache_input_tokens: null, cache_read_percent: null, priced_cost_usd: null, priced_requests: 0, reported_price_requests: 0, estimated_price_requests: 0, cost_per_request_usd: null };
const response = (extra = {}) => ({ agents: [], work_types: [], summary: { ...metrics, coding_agents: 0, attributed_requests: 0, unattributed_requests: 0 }, range: { from: '2026-10-16T00:00:00.000Z', to: '2026-10-22T12:34:56.000Z' }, truncated: false, limit: 200, ...extra });
const group = (agent: string | null, extra = {}) => ({ ...metrics, agent, requests: 1, ...extra });
function renderUsage(path = '/app/developers/usage') { return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(AgentUsage))); }
beforeEach(() => { state.data = response(); state.loading = false; state.error = ''; state.paths = []; });

describe('Agent usage presentation helpers', () => {
  it('bounds date filters and encodes project selection into the real endpoint', () => {
    expect(agentUsageDays('7')).toBe('7'); expect(agentUsageDays('30')).toBe('30'); expect(agentUsageDays('90')).toBe('90'); expect(agentUsageDays('wrong')).toBe('30');
    expect(agentUsageResource('project&foreign', '7')).toBe('/api/developers/usage?project=project%26foreign&days=7');
    expect(agentUsageResource(undefined, '7')).toBeNull();
  });
  it('sorts measured groups for the selected metric without turning unknown tokens or prices into zeros', () => {
    const agents = [group('Unpriced', { requests: 4 }), group('Reported', { requests: 2, provider_requests: 2, input_tokens: 100, output_tokens: 10, priced_cost_usd: .5, priced_requests: 2 }), group(null, { requests: 1, provider_requests: 1, input_tokens: 20, output_tokens: 2, priced_cost_usd: 1, priced_requests: 1 })] as AgentUsageResponse['agents'];
    expect(orderedAgents(agents, 'requests').map(item => item.agent)).toEqual(['Unpriced', 'Reported', null]);
    expect(orderedAgents(agents, 'tokens').map(item => item.agent)).toEqual(['Reported', null, 'Unpriced']);
    expect(orderedAgents(agents, 'cost').map(item => item.agent)).toEqual([null, 'Reported', 'Unpriced']);
    expect(agentMetric(agents[0], 'tokens')).toBeNull(); expect(agentMetric(agents[0], 'cost')).toBeNull();
  });
});
describe('Agent usage screen', () => {
  it('renders the reference layout with project/date controls, four metrics, real empty states and a connection link', () => {
    const html = renderUsage();
    expect(state.paths).toContain('/api/developers/usage?project=project-real&days=30');
    expect(html).toContain('Other project'); expect(html).toContain('Agent usage date range'); expect(html).toContain('Refresh agent usage');
    expect(html.match(/class="agent-usage-metric"/g)).toHaveLength(4);
    for (const label of ['Coding agents', 'Requests', 'Supplied cost', 'Cost per request', 'Usage by coding agent', 'Tokens', 'Cache read by work type', 'No connected requests in this window.']) expect(html).toContain(label);
    expect(html).toContain('href="/app/connect?tab=cli"');
    expect(html).not.toContain('$0.00'); expect(html).not.toContain('0%');
  });
  it('requests the selected period and reflects metric selection in grouped data', () => {
    state.data = response({ agents: [group('Codex')], summary: { ...metrics, requests: 1, coding_agents: 1, attributed_requests: 1, unattributed_requests: 0 } });
    const html = renderUsage('/app/developers/usage?days=90&metric=cost');
    expect(state.paths).toContain('/api/developers/usage?project=project-real&days=90');
    expect(html).toContain('<option value="cost" selected="">Supplied cost</option>');
    expect(html).toContain('Codex'); expect(html).toContain('Not priced');
  });
  it('preserves unattributed requests and reports token/cache/price coverage with real zero prices intact', () => {
    const summary = { ...metrics, requests: 3, coding_agents: 1, attributed_requests: 1, unattributed_requests: 2, provider_requests: 1, estimated_requests: 1, unavailable_requests: 1, input_tokens: 100, output_tokens: 20, cached_tokens: 0, cache_requests: 1, cache_input_tokens: 100, cache_read_percent: 0, priced_cost_usd: 0, priced_requests: 1, reported_price_requests: 1 };
    state.data = response({ summary, agents: [group('Codex'), group(null, { requests: 2 })], work_types: [{ ...metrics, work_type: null, requests: 3, cache_requests: 1, cache_read_percent: 0, cached_tokens: 0, cache_input_tokens: 100 }] });
    const html = renderUsage();
    expect(html).toContain('Unattributed'); expect(html).toContain('Not reported');
    expect(html).toContain('1 of 3 requests priced'); expect(html).toContain('Complete pricing required');
    expect(html).toContain('1 of 3 requests provider-reported'); expect(html).toContain('1 estimated'); expect(html).toContain('1 unavailable');
    expect(html).toContain('$0.00'); expect(html).toContain('0%');
    expect(html).toContain('1 of 3 requests with cache usage');
  });
  it('shows loading and failure distinctly from empty activity without stale measured metrics', () => {
    state.loading = true;
    const loading = renderUsage(); expect(loading).toContain('Loading agent usage'); expect(loading).not.toContain('No connected requests in this window.');
    state.loading = false; state.error = 'Usage unavailable';
    const failure = renderUsage(); expect(failure).toContain('Usage unavailable'); expect(failure).toContain('Try again'); expect(failure).not.toContain('No connected requests in this window.');
  });
  it('clearly marks a bounded incomplete window', () => {
    state.data = response({ truncated: true });
    expect(renderUsage()).toContain('Only the latest 200 connected requests are included. This window is incomplete.');
  });
});
