import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, CalendarDays, Code2, RefreshCw, Terminal } from 'lucide-react';
import { money, number, useApp, useResource } from '../api';
import { ErrorNotice, Select, Spinner } from '../ui';
import { agentMetric, agentUsageDays, agentUsageResource, emptyAgentUsage, orderedAgents, type AgentUsageResponse, type UsageMetric } from './agentUsageData';
import './agent-usage.css';

const percentage = (value: number | null) => value === null ? '—' : `${new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value)}%`;
const utcDate = (value: string) => new Date(value).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function UsageIllustration() {
  return <svg className="agent-usage-illustration" viewBox="0 0 150 95" fill="none" aria-hidden="true">
    <path d="m22 57 48-25 58 27-48 25-58-27Z" stroke="currentColor" strokeOpacity=".25" strokeDasharray="3 4"/>
    <path d="m44 52 26-14 36 17-26 14-36-17Z" fill="var(--subtle)" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
    <path d="M44 52v7l36 17 26-14v-7M80 69v7" stroke="currentColor" strokeWidth="1.1"/>
    <path d="M53 17c0-2 1-2 3-1l39 19c2 1 3 2 3 4v16L53 34V17Z" fill="var(--surface)" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
    <path d="m62 25 5 7-5 2m10 6 16 8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="m33 21 3-7 7-3m66 14 5 2 2 5M25 43l-4 2m94 30 5 2" stroke="currentColor" strokeOpacity=".45" strokeLinecap="round"/>
  </svg>;
}

function AgentRows({ data, metric }: { data: AgentUsageResponse; metric: UsageMetric }) {
  const items = orderedAgents(data.agents, metric), maximum = Math.max(0, ...items.map(item => agentMetric(item, metric) ?? 0));
  return <div className="agent-usage-table-scroll"><table className="agent-usage-table"><thead><tr><th>Coding agent</th><th className={`numeric ${metric === 'requests' ? 'is-selected' : ''}`}>Requests</th><th className={`numeric ${metric === 'tokens' ? 'is-selected' : ''}`}>Provider tokens</th><th className={`numeric ${metric === 'cost' ? 'is-selected' : ''}`}>Supplied cost</th></tr></thead><tbody>{items.map(item => {
    const value = agentMetric(item, metric), total = agentMetric(item, 'tokens');
    return <tr key={item.agent ?? 'unattributed'}><td><div className="agent-usage-agent"><span className={`agent-usage-agent-icon ${item.agent === null ? 'unattributed' : ''}`}><Code2 size={14}/></span><div><strong>{item.agent ?? 'Unattributed'}</strong><div className="agent-usage-row-track" aria-hidden="true"><span style={{ width: `${maximum && value !== null ? 100 * value / maximum : 0}%` }}/></div></div></div></td>
      <td className="numeric">{number(item.requests)}</td>
      <td className="numeric">{number(total)}{item.provider_requests > 0 && item.provider_requests < item.requests ? <small>{number(item.provider_requests)} of {number(item.requests)} reported</small> : null}</td>
      <td className="numeric">{item.priced_cost_usd === null ? <span className="muted">Not priced</span> : money(item.priced_cost_usd)}{item.priced_requests > 0 && item.priced_requests < item.requests ? <small>{number(item.priced_requests)} of {number(item.requests)} priced</small> : null}</td></tr>;
  })}</tbody></table></div>;
}

export default function AgentUsage() {
  const { project, session, setProject } = useApp(), [params, setParams] = useSearchParams();
  const days = agentUsageDays(params.get('days')), selectedMetric = params.get('metric');
  const metric: UsageMetric = selectedMetric === 'tokens' || selectedMetric === 'cost' ? selectedMetric : 'requests';
  const { data, loading, error, refresh } = useResource<AgentUsageResponse>(agentUsageResource(project?.id, days), emptyAgentUsage);
  const projects = session?.projects?.length ? session.projects : project ? [project] : [], measured = !!project && !loading && !error;
  const summary = data.summary, totalTokens = summary.input_tokens === null || summary.output_tokens === null ? null : summary.input_tokens + summary.output_tokens;
  const rangeLabel = data.range ? `${utcDate(data.range.from)} – ${utcDate(data.range.to)} · UTC` : 'Selected date window';
  function updateQuery(key: string, value: string) { setParams(previous => { const next = new URLSearchParams(previous); next.set(key, value); return next; }); }

  return <div className="agent-usage">
    <div className="agent-usage-controls" role="region" aria-label="Agent usage controls">
      <Select label="Project" value={project?.id ?? ''} onChange={value => { const selected = projects.find(item => item.id === value); if (selected) setProject(selected); }}>{!project ? <option value="">Select a project</option> : null}{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
      <div className="agent-usage-period" title={rangeLabel}><CalendarDays size={13}/><Select label="Agent usage date range" value={days} onChange={value => updateQuery('days', value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></Select></div>
      <button className="icon-button agent-usage-refresh" aria-label="Refresh agent usage" onClick={refresh} disabled={!project || loading}>{loading ? <Spinner/> : <RefreshCw size={14}/>}</button>
    </div>

    <div className="agent-usage-metrics" aria-label="Agent usage metrics">
      <article className="agent-usage-metric"><span title="Distinct agents explicitly reported by connected requests">Coding agents</span><strong>{measured ? number(summary.coding_agents) : '—'}</strong><small>{measured && summary.unattributed_requests ? `${number(summary.unattributed_requests)} ${summary.unattributed_requests === 1 ? 'request' : 'requests'} unattributed` : 'Explicitly reported agents'}</small></article>
      <article className="agent-usage-metric"><span>Requests</span><strong>{measured ? number(summary.requests) : '—'}</strong><small>Connected request traffic</small></article>
      <article className="agent-usage-metric"><span title="Subtotal of client-reported costs and supplied-price estimates; not an invoice">Supplied cost</span><strong>{measured ? money(summary.priced_cost_usd) : '—'}</strong><small>{measured && summary.priced_requests ? `${number(summary.priced_requests)} of ${number(summary.requests)} requests priced` : 'No supplied request prices'}</small></article>
      <article className="agent-usage-metric"><span title="Available only when every included request has a supplied price">Cost per request</span><strong>{measured ? money(summary.cost_per_request_usd) : '—'}</strong><small>{measured && summary.requests && summary.priced_requests === summary.requests ? 'From supplied prices' : 'Complete pricing required'}</small></article>
    </div>

    {measured && data.truncated ? <p className="agent-usage-bound" role="status">Only the latest {number(data.limit)} connected requests are included. This window is incomplete.</p> : null}
    <div className="agent-usage-body">
    <section className="agent-usage-panel agent-usage-primary" aria-label="Usage by coding agent">
      <header className="agent-usage-panel-header"><h2>Usage by coding agent</h2><Select label="Usage metric" value={metric} onChange={value => updateQuery('metric', value)}><option value="requests">Requests</option><option value="tokens">Provider tokens</option><option value="cost">Supplied cost</option></Select></header>
      {loading ? <div className="agent-usage-empty"><Spinner/><p>Loading agent usage…</p></div> : error ? <div className="agent-usage-empty"><ErrorNotice message={error} retry={refresh}/></div> : measured && summary.requests ? <><AgentRows data={data} metric={metric}/><p className="agent-usage-panel-note">{number(summary.attributed_requests)} of {number(summary.requests)} requests attributed. Requests without an explicit agent label appear as Unattributed.</p></> : <div className="agent-usage-empty"><UsageIllustration/><h3>{project ? 'No connected requests in this window.' : 'Choose a project to view agent usage.'}</h3><p>Usage appears as connected agents send requests through Traqiva.</p><Link className="button secondary" to="/app/connect?tab=cli"><Terminal size={14}/>Connect a coding agent<ArrowRight size={13}/></Link></div>}
    </section>

    <div className="agent-usage-details">
      <section className="agent-usage-panel agent-usage-tokens" aria-label="Tokens"><header className="agent-usage-panel-header"><h2>Tokens</h2><span>Provider-reported</span></header>
        {measured && summary.provider_requests ? <div className="agent-usage-token-content"><strong>{number(totalTokens)}</strong><p>{number(summary.provider_requests)} of {number(summary.requests)} requests provider-reported</p><div className="agent-usage-token-bar" aria-hidden="true"><span style={{ width: `${totalTokens ? 100 * (summary.input_tokens ?? 0) / totalTokens : 0}%` }}/><span style={{ width: `${totalTokens ? 100 * (summary.output_tokens ?? 0) / totalTokens : 0}%` }}/></div><dl><div><dt><i/>Input</dt><dd>{number(summary.input_tokens)}</dd></div><div><dt><i/>Output</dt><dd>{number(summary.output_tokens)}</dd></div><div><dt>Cache read <span>included in input</span></dt><dd>{number(summary.cached_tokens)}<small>{number(summary.cache_requests)}/{number(summary.requests)} reported</small></dd></div></dl><p className="agent-usage-coverage">{number(summary.estimated_requests)} estimated · {number(summary.unavailable_requests)} unavailable. Excluded from provider totals.</p></div> : <div className="agent-usage-secondary-empty"><span className="agent-usage-empty-value">—</span><p>{loading ? 'Loading token usage…' : error ? 'Token usage unavailable.' : 'Provider token usage not reported.'}</p>{measured && summary.estimated_requests ? <small>{number(summary.estimated_requests)} estimated requests excluded from provider totals.</small> : null}</div>}
      </section>
      <section className="agent-usage-panel agent-usage-cache" aria-label="Cache read by work type"><header className="agent-usage-panel-header"><h2>Cache read by work type</h2></header>
        {measured && data.work_types.length ? <div className="agent-usage-cache-content">{data.work_types.map(item => <div className="agent-usage-cache-row" key={item.work_type ?? 'unreported'}><div><strong>{item.work_type ?? 'Not reported'}</strong><span>{percentage(item.cache_read_percent)}</span></div><div className="agent-usage-cache-track" aria-hidden="true"><span style={{ width: `${item.cache_read_percent ?? 0}%` }}/></div><small>{number(item.cache_requests)} of {number(item.requests)} requests with cache usage{item.cache_read_percent === null ? ' · Rate unavailable' : ''}</small></div>)}<p className="agent-usage-coverage">Cached input ÷ input tokens for requests with provider-reported cache usage.</p></div> : <div className="agent-usage-secondary-empty"><span className="agent-usage-empty-value">—</span><p>{loading ? 'Loading cache usage…' : error ? 'Cache usage unavailable.' : 'No reported cache usage in this window.'}</p></div>}
      </section>
    </div>
    </div>
    <p className="agent-usage-method">Agent and work type labels are client-reported. Token totals show provider measurements with request coverage. Supplied costs are reported amounts or estimates, not billed charges.{measured && summary.estimated_price_requests ? ` ${number(summary.estimated_price_requests)} requests use supplied-price estimates.` : ''} {rangeLabel} · Up to {number(data.limit)} recent connected requests.</p>
  </div>;
}
