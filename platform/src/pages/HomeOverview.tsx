import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, CircleHelp, Plug, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { number, money, useApp, useResource } from '../api';
import { emptyOverview, type Improvement, type Overview } from '../types';
import { ErrorNotice, Select, Spinner } from '../ui';
import './home-overview.css';

type Point = { date: string; value: number | null };
const emptyFindings: { items: Improvement[] } = { items: [] };
const questions = [
  'How much have my requests cost?',
  'Which models use the most tokens?',
  'What should I investigate next?',
];

function Trend({ points, kind, label, empty }: {
  points: Point[]; kind: 'cost' | 'requests'; label: string; empty?: string;
}) {
  const gradient = useId().replaceAll(':', '');
  const available = points.filter(point => point.value !== null);
  const maximum = Math.max(...available.map(point => point.value || 0), 0) || 1;
  const x = (index: number) => 4 + index / Math.max(1, points.length - 1) * 392;
  const y = (value: number) => 100 - value / maximum * 88;
  // Unknown costs remain gaps, including days containing only unpriced requests.
  const segments: { index: number; value: number; date: string }[][] = [];
  points.forEach((point, index) => {
    if (point.value === null) return;
    if (!index || points[index - 1].value === null) segments.push([]);
    segments[segments.length - 1]?.push({ index, value: point.value, date: point.date });
  });
  const format = kind === 'cost' ? money : number;
  return <div className={`home-trend ${empty ? 'is-empty' : ''}`}>
    <div className="home-trend-plot" role="img" aria-label={empty || label} aria-describedby={empty ? undefined : `${gradient}-values`}>
      <svg viewBox="0 0 400 106" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".16"/><stop offset="100%" stopColor="currentColor" stopOpacity=".015"/></linearGradient></defs>
        {[12, 56, 100].map(value => <line key={value} x1="0" x2="400" y1={value} y2={value} className="home-chart-grid"/>)}
        {!empty && segments.map((segment, index) => {
          const coordinates = segment.map(point => `${x(point.index)},${y(point.value)}`).join(' ');
          return <g key={index}>
            {segment.length > 1 && <polygon points={`${x(segment[0].index)},100 ${coordinates} ${x(segment[segment.length - 1].index)},100`} fill={`url(#${gradient})`}/>}
            <polyline points={coordinates} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke"/>
            {segment.map(point => <circle key={point.date} cx={x(point.index)} cy={y(point.value)} r={segment.length === 1 ? 2.5 : 1.4} fill="currentColor"><title>{point.date}: {format(point.value)}</title></circle>)}
          </g>;
        })}
      </svg>
      {empty && <span className="home-chart-message">{empty}</span>}
    </div>
    {!empty && <span className="sr-only" id={`${gradient}-values`}>Daily values in UTC. {points.map(point => `${point.date}: ${point.value === null ? 'unpriced' : format(point.value)}`).join('; ')}.</span>}
    {!empty && <div className="home-chart-axis" aria-hidden="true"><span>{format(maximum)}</span><span>{format(maximum / 2)}</span><span>{kind === 'cost' ? '$0' : '0'}</span></div>}
  </div>;
}

function CacheShare({ cached, input, available, loading }: { cached: number; input: number; available: boolean; loading: boolean }) {
  const percent = input > 0 ? Math.min(100, Math.max(0, cached / input * 100)) : null;
  return <div className={`home-cache-chart ${!available || percent === null ? 'is-empty' : ''}`} role="img" aria-label={loading ? 'Loading cache usage' : available && percent !== null ? `${percent.toFixed(1)} percent of recorded input tokens were cached in this period` : 'Cached input share is not available'}>
    <div className="home-cache-plot"><div className="home-cache-grid"/>{available && percent !== null && !loading ? <div className="home-cache-fill" style={{ height: `${percent}%` }}/> : <span className="home-chart-message">{loading ? 'Loading usage…' : 'Awaiting token measurements'}</span>}</div>
    {available && percent !== null && !loading && <div className="home-chart-axis" aria-hidden="true"><span>100%</span><span>50%</span><span>0</span></div>}
  </div>;
}

export default function HomeOverview() {
  const { project, session } = useApp();
  const [days, setDays] = useState('30');
  const overview = useResource<Overview>(project ? `/api/overview?project=${project.id}&days=${days}` : null, emptyOverview);
  const findings = useResource<{ items: Improvement[] }>(project ? `/api/improvements?project=${project.id}` : null, emptyFindings);
  const { stats, series } = overview.data;
  const open = findings.data.items.filter(item => item.status !== 'accepted' && item.status !== 'dismissed');
  const loading = overview.loading;
  const hasUsage = (stats.usage_available_requests || 0) > 0;
  const hasPrices = (stats.priced_requests || 0) > 0;
  const hasCache = (stats.cache_available_requests || 0) > 0;
  const cacheInput = stats.cache_covered_input_tokens || 0;
  const cachedPercent = hasCache && cacheInput > 0 ? stats.cached_tokens / cacheInput * 100 : null;
  const firstName = session?.user?.name?.trim().split(/\s+/)[0] || 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const refresh = () => { overview.refresh(); findings.refresh(); };
  const requestPoints = series.map(point => ({ date: point.date, value: point.requests }));
  const costPoints = series.map(point => ({ date: point.date, value: point.cost }));
  const success = stats.requests ? (stats.requests - stats.errors) / stats.requests * 100 : null;

  if (overview.error) return <div className="home-overview"><div className="home-welcome"><div><h1>Overview unavailable</h1><p>This period’s statistics could not be loaded.</p></div></div><ErrorNotice message={overview.error} retry={refresh}/></div>;

  return <div className="home-overview" aria-busy={loading}>
    <div className="home-welcome"><div><h1>{greeting}, {firstName}</h1><p>Your project’s recorded activity, with estimates kept in view.</p></div><div className="home-period"><Select value={days} onChange={setDays} label="Overview time range"><option value="7">Last 7 days</option><option value="14">Last 14 days</option><option value="30">Last 30 days</option></Select><button className="icon-button" onClick={refresh} aria-label="Refresh overview" disabled={loading}>{loading ? <Spinner/> : <RefreshCw size={15}/>}</button></div></div>
    <ErrorNotice message={overview.error || findings.error} retry={refresh}/>

    <div className="home-metric-grid">
      <section className="home-metric-card home-spend">
        <Link className="home-metric-title" to="/app/analytics">Spend<ArrowUpRight size={13}/></Link>
        <div className="home-metric-value">{loading ? '…' : money(stats.estimated_cost_usd)}<span className="home-value-note">estimated</span></div>
        <Trend kind="cost" label={`Priced request cost by UTC day, last ${days} days`} points={costPoints} empty={loading ? 'Loading activity…' : !hasPrices ? stats.requests ? 'No request pricing supplied' : 'Your priced requests will appear here' : undefined}/>
        <div className="home-metric-foot"><span>{hasPrices ? `Recorded prices · ${number(stats.priced_requests)} of ${number(stats.requests)} requests` : 'Estimated subtotal · pricing not available'}</span><span>Unknown prices stay unpriced.</span></div>
      </section>

      <section className="home-metric-card home-saved">
        <div className="home-metric-title">Saved<CircleHelp size={13}><title>Verified monetary savings require a comparable usage baseline.</title></CircleHelp></div>
        <div className="home-metric-value home-positive">—</div>
        <div className="home-unmeasured-chart"><div className="home-unmeasured-rule"/><span><ShieldCheck size={13}/>Not verified yet</span></div>
        <div className="home-metric-foot"><span>No comparable monetary baseline.</span>{stats.saved_tokens !== null ? <Link to="/app/improvements">{number(stats.saved_tokens)} tokens · client estimate<ArrowRight size={12}/></Link> : <Link to="/app/improvements">Review measurement notes<ArrowRight size={12}/></Link>}</div>
      </section>

      <section className="home-metric-card home-available">
        <Link className="home-metric-title" to="/app/improvements">Available briefs<ArrowUpRight size={13}/></Link>
        <div className="home-metric-value">{findings.loading ? '…' : findings.error ? '—' : number(open.length)}<span className="home-value-unit">open</span></div>
        <div className="home-unmeasured-chart"><div className="home-unmeasured-rule"/><Link to="/app/improvements">{findings.error ? 'Briefs are temporarily unavailable' : open.length ? 'Review the supporting evidence' : 'Findings appear after traffic analysis'}<ArrowRight size={12}/></Link></div>
        <div className="home-metric-foot"><span>Opportunities to investigate.</span><span>No monetary projection.</span></div>
      </section>

      <section className="home-metric-card home-requests">
        <Link className="home-metric-title" to="/app/traces">Requests<ArrowUpRight size={13}/></Link>
        <div className="home-metric-value">{loading ? '…' : number(stats.requests)}</div>
        <Trend kind="requests" label={`Recorded requests by UTC day, last ${days} days`} points={requestPoints} empty={loading ? 'Loading activity…' : !stats.requests ? 'Connect an agent to see activity' : undefined}/>
        <div className="home-metric-foot"><span>{success === null ? 'No recorded requests yet.' : `${success.toFixed(1)}% success · ${number(stats.errors)} failed`}</span><span>Local compression events are separate.</span></div>
      </section>

      <section className="home-metric-card home-cached">
        <Link className="home-metric-title" to="/app/analytics">Input cached<ArrowUpRight size={13}/></Link>
        <div className="home-metric-value">{loading ? '…' : cachedPercent === null ? '—' : `${cachedPercent.toFixed(1)}%`}</div>
        <CacheShare cached={stats.cached_tokens} input={cacheInput} available={hasCache} loading={loading}/>
        <div className="home-metric-foot"><span>{hasCache ? `${number(stats.cached_tokens)} of ${number(cacheInput)} measured input tokens` : hasUsage ? 'Cache usage has not been reported.' : 'Input usage has not been reported.'}</span><span>{hasCache ? `Period total · cache reported in ${number(stats.cache_available_requests)} of ${number(stats.requests)} requests` : 'Period total · no cache estimate'}</span></div>
      </section>
    </div>

    <div className="home-question-links" aria-label="Explore project statistics">{questions.map(question => <Link key={question} to={`/app/ask?question=${encodeURIComponent(question)}`}><Sparkles size={12}/>{question}</Link>)}</div>

    <section className="home-next" aria-labelledby="home-next-title"><header><h2 id="home-next-title">Next</h2><span>{findings.loading ? 'Loading briefs…' : findings.error ? 'Briefs unavailable' : `${open.length} open`}</span><Link to="/app/improvements">All briefs<ArrowRight size={13}/></Link></header>
      {findings.error ? <p className="home-measurement-note">Retry loading the briefs to see your next steps.</p> : open.length ? <div className="home-next-list">{open.slice(0, 3).map(item => <Link to="/app/improvements" key={item.id}><span className="home-next-icon"><Sparkles size={15}/></span><div><strong>{item.title}</strong><p>{item.description || 'Review the evidence and suggested next step.'}</p></div><ArrowUpRight size={15}/></Link>)}</div> : <div className="home-next-empty"><span className="home-next-icon">{stats.requests ? <ShieldCheck size={18}/> : <Plug size={18}/>}</span><div><strong>{stats.requests ? 'Review your recorded traffic' : 'Connect your first agent'}</strong><p>{stats.requests ? 'Analyze your project for supported findings, then review the evidence.' : 'Send a model request to start building your project’s activity record.'}</p></div><Link to={stats.requests ? '/app/improvements' : '/app/connect'}>{stats.requests ? 'Review traffic' : 'Set up this project'}<ArrowRight size={14}/></Link></div>}
    </section>
    <p className="home-measurement-note">Charts use UTC days. Cost is a subtotal of supplied request prices; reported token counts may include client estimates.</p>
  </div>;
}
