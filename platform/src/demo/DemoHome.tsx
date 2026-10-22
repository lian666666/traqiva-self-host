import { useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, ChevronRight, MessageCircle, ScanLine } from 'lucide-react';
import { demoBriefs, demoQuestions } from './demoData';
import { AGENT_BUILDER_ENABLED } from '../features/agentBuilder';
import { demoAnswer, demoBriefEvidence, demoSeries, demoSummary, demoWorkflows } from './demoState';
import { DemoMetricDialog } from './DemoMetricDialog';
import { DemoChart, DemoMetric, demoCompactNumber, demoHeadlineMoney, demoMoney, demoNumber, type DemoViewProps } from './demoUi';

type Metric = 'spend' | 'cache' | 'requests' | 'input';
const percent = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}%`;

export function DemoHome({ state, dispatch, go }: DemoViewProps) {
  const [metric, setMetric] = useState<Metric | null>(null);
  const summary = demoSummary({ ...state, query: '', model: '', status: '' });
  const series = demoSeries(state.days), dates = series.map(day => day.date);
  const workflows = demoWorkflows(state);
  const next = demoBriefs.filter(brief => state.briefStatus[brief.id] === 'open');

  function ask(question: string) {
    dispatch({ type: 'set', key: 'question', value: question });
    dispatch({ type: 'set', key: 'answer', value: demoAnswer(question, state) });
    go('ask');
  }
  function openBrief(id: string) {
    dispatch({ type: 'set', key: 'selectedBrief', value: id });
    go('improvements');
  }
  function inspectMetric() {
    dispatch({ type: 'inspect-traces' });
    if (metric === 'spend' || metric === 'input') {
      dispatch({ type: 'set', key: 'traceSort', value: metric === 'spend' ? 'cost' : 'tokens' });
    }
    setMetric(null);
  }

  return <div className="demo-home">
    <header className="demo-view-heading">
      <div><h1>Good morning, Demo</h1><p>See what your coding agents spend. Find what to improve.</p></div>
      <label className="demo-select-label"><select aria-label="Sample time range" value={state.days} onChange={event => dispatch({ type: 'set', key: 'days', value: event.target.value === '7' ? 7 : 30 })}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select></label>
    </header>

    <div className="demo-home-grid">
      <button className="demo-home-card wide" onClick={() => setMetric('spend')} aria-label="Spend: details">
        <div className="demo-card-top"><DemoMetric label="Spend" value={demoHeadlineMoney(summary.cost)}/><ArrowUpRight size={15}/></div>
        <DemoChart values={series.map(day => day.cost)} dates={dates} formatValue={value => `$${value.toFixed(2)}`} label="Daily sample spend in USD"/>
        <span className="demo-card-caption">Sample cost · {demoNumber(summary.requests)} requests</span>
      </button>
      <button className="demo-home-card green" onClick={() => setMetric('cache')} aria-label="Input cached: details">
        <div className="demo-card-top"><DemoMetric label="Input cached" value={percent(summary.cachePercent)} green/><ArrowUpRight size={15}/></div>
        <DemoChart values={series.map(day => day.cachedPercent ?? 0)} dates={dates} formatValue={value => `${Math.round(value)}%`} tone="green" label="Daily sample cached input percentage"/>
        <span className="demo-card-caption">{demoCompactNumber(summary.cachedTokens)} of {demoCompactNumber(summary.inputTokens)} input tokens</span>
      </button>
      <button className="demo-home-card demo-findings-card" onClick={() => go('improvements')} aria-label={`${next.length} open findings. Review evidence.`}>
        <div className="demo-card-top"><DemoMetric label="Open findings" value={demoNumber(next.length)}/><ScanLine size={16}/></div>
        <div className="demo-findings-tags">{next.length ? next.map(brief => <span key={brief.id}>{brief.kind}</span>) : <span><Check size={13}/>All findings reviewed</span>}</div>
        <span className="demo-card-caption">Find what to inspect in your coding workflow <span>Review the evidence <ArrowRight size={11}/></span></span>
      </button>
      <button className="demo-home-card" onClick={() => setMetric('requests')} aria-label="Requests: details">
        <div className="demo-card-top"><DemoMetric label="Requests" value={demoNumber(summary.requests)}/><ArrowUpRight size={15}/></div>
        <DemoChart values={series.map(day => day.requests)} dates={dates} formatValue={demoNumber} label="Daily sample request count"/>
        <span className="demo-card-caption"><span><b className={summary.errors ? '' : 'positive'}>{percent(summary.successPercent)} success</b> · {summary.errors} failed</span></span>
      </button>
      <button className="demo-home-card" onClick={() => setMetric('input')} aria-label="Input tokens: details">
        <div className="demo-card-top"><DemoMetric label="Input tokens" value={demoCompactNumber(summary.inputTokens)}/><ArrowUpRight size={15}/></div>
        <DemoChart values={series.map(day => day.inputTokens)} dates={dates} formatValue={demoCompactNumber} label="Daily sample input token volume"/>
        <span className="demo-card-caption">{demoNumber(summary.inputTokens)} tokens read</span>
      </button>
    </div>

    <div className="demo-home-questions" aria-label="Sample questions">{demoQuestions.map(question => <button key={question} onClick={() => ask(question)}><MessageCircle size={12}/>{question}</button>)}</div>

    <section className="demo-next">
      <header><div><h2>Where to look next</h2><p>{AGENT_BUILDER_ENABLED?'Read the finding. Inspect a request. Test the change.':'Read the finding. Inspect its coding-agent requests.'}</p></div><button onClick={() => go('improvements')}>{next.length} open · All findings<ArrowRight size={13}/></button></header>
      {next.length ? <div className="demo-next-list">{next.map(brief => {
        const evidenceCount = demoBriefEvidence(brief.id, state.days).length;
        return <button key={brief.id} onClick={() => openBrief(brief.id)}><span className="demo-finding-dot"/><div><span className="demo-brief-kind">{brief.kind}</span><strong>{brief.title}</strong></div><span className="demo-evidence-count">{evidenceCount} request{evidenceCount === 1 ? '' : 's'}</span><ChevronRight size={15}/></button>;
      })}</div> : <p className="demo-empty">All sample findings reviewed. Reset the demo to try again.</p>}
    </section>

    <section className="demo-workflows" aria-labelledby="demo-workflows-title">
      <header><div><h2 id="demo-workflows-title">Workflows</h2><p>Which work uses the most? Follow any row to its requests.</p></div><span>{workflows.length} workflows · {summary.requests} requests</span></header>
      <div className="demo-workflow-labels" aria-hidden="true"><span>Workflow / share of spend</span><span>Requests</span><span>Cache read</span><span>Sample cost</span></div>
      {workflows.map(workflow => <button className="demo-workflow-row" key={workflow.workflow} onClick={() => dispatch({ type: 'inspect-traces', query: workflow.workflow })} aria-label={`Inspect ${workflow.workflow} requests`}>
        <span className="demo-workflow-name"><strong>{workflow.workflow}</strong><span className="demo-workflow-bar"><i style={{ width: `${summary.cost ? workflow.cost / summary.cost * 100 : 0}%` }}/></span></span>
        <span><small>Requests</small>{workflow.requests}</span><span><small>Cache read</small>{percent(workflow.cachePercent)}</span><span><small>Sample cost</small>{demoMoney(workflow.cost)}<ChevronRight size={13}/></span>
      </button>)}
    </section>

    {AGENT_BUILDER_ENABLED&&<section className="demo-quality-callout"><span className="demo-quality-icon"><Check size={18}/></span><div><h2>A cheaper answer still needs to be a good answer.</h2><p>Run the sample cases. Edit an answer and see the check change.</p></div><button className="demo-button" onClick={() => go('experiments')}>Try a quality check<ArrowRight size={13}/></button></section>}
    {metric && <DemoMetricDialog metric={metric} state={state} onClose={() => setMetric(null)} onInspect={inspectMetric} onAnalytics={() => { setMetric(null); go('analytics'); }}/>}
  </div>;
}
