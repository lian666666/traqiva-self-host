import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ChevronDown, Code2, Eye, EyeOff, Search, Terminal, X } from 'lucide-react';
import { AGENT_BUILDER_ENABLED } from '../features/agentBuilder';
import { demoModels, demoTraces } from './demoData';
import { demoSeries, demoSummary, filteredDemoTraces } from './demoState';
import { DemoChart, DemoMetric, DemoPanel, demoMoney, demoNumber, type DemoViewProps } from './demoUi';

function CodingGatewayPreview({state,go}:DemoViewProps){
  const summary=demoSummary({...state,query:'',model:'',status:''});
  return <div className="demo-view-stack">
    <div className="demo-view-heading"><div><h2>Gateway</h2><p>See requests from the coding agents you connect.</p></div><span className="demo-badge">Preview</span></div>
    <div className="demo-stats-grid"><DemoMetric label="Example requests" value={demoNumber(summary.requests)}/><DemoMetric label="Workflows" value={String(new Set(demoTraces.map(trace=>trace.workflow)).size)}/><DemoMetric label="Project" value={state.projectName}/><DemoMetric label="Mode" value="Simulation"/></div>
    <DemoPanel title="Connect a coding agent">
      <div className="demo-connection-row"><Terminal size={26}/><div><strong>Your agent. Your coding workflow.</strong><p className="demo-subtle">Create a workspace, choose your coding agent, then follow its connection steps.</p></div><Link className="demo-button primary" to="/signup">Connect your agent<ArrowRight size={14}/></Link></div>
      <p className="demo-preview-note">Only connected requests appear in a real workspace. This demo uses fictional records and does not intercept your existing chats.</p>
    </DemoPanel>
    <DemoPanel title="Inspect a sample session"><p className="demo-subtle">Follow repository exploration, test failure triage, refactoring, and release notes from each session to its requests.</p><div className="demo-actions"><button className="demo-button" onClick={()=>go('sessions')}>Explore sessions<ArrowRight size={14}/></button><button className="demo-button" onClick={()=>go('traces')}>Explore requests<ArrowRight size={14}/></button></div></DemoPanel>
  </div>;
}

function GatewayPreview(props:DemoViewProps){
  return AGENT_BUILDER_ENABLED?<BuilderGatewayPreview {...props}/>:<CodingGatewayPreview {...props}/>;
}

function BuilderGatewayPreview({state,dispatch,go}:DemoViewProps){
  const [language,setLanguage]=useState<'javascript'|'python'>('javascript');
  const summary=demoSummary({...state,query:'',model:'',status:''});
  const example=language==='javascript'
    ? `// Example only — this endpoint does not make requests.\nconst client = new OpenAI({\n  baseURL: "https://demo.invalid/v1",\n  apiKey: "demo_only_not_a_credential"\n});`
    : `# Example only — this endpoint does not make requests.\nclient = OpenAI(\n    base_url="https://demo.invalid/v1",\n    api_key="demo_only_not_a_credential"\n)`;
  return <div className="demo-view-stack">
    <div className="demo-view-heading"><div><h2>Gateway</h2><p>One place to inspect your agents’ requests.</p></div><span className="demo-badge">Preview</span></div>
    <div className="demo-stats-grid"><DemoMetric label="Example requests" value={demoNumber(summary.requests)}/><DemoMetric label="Providers" value={String(new Set(demoTraces.map(trace=>trace.provider)).size)}/><DemoMetric label="Project" value={state.projectName}/><DemoMetric label="Mode" value="Simulation"/></div>
    <DemoPanel title="Project connection" action={<span className="demo-badge green"><Check size={12}/>Demo connected</span>}>
      <div className="demo-connection-row"><div><strong>{state.projectName}</strong><p className="demo-subtle">Fictional project · example key</p></div><div className="demo-key"><code>{state.keyVisible?'demo_only_not_a_credential':'demo_only_••••••••••••'}</code><button className="demo-icon-button" aria-label={state.keyVisible?'Hide example key':'Show example key'} onClick={()=>dispatch({type:'set',key:'keyVisible',value:!state.keyVisible})}>{state.keyVisible?<EyeOff size={16}/>:<Eye size={16}/>}</button></div></div>
      <p className="demo-subtle">This key is illustrative and cannot authenticate a request.</p>
    </DemoPanel>
    <DemoPanel title="Connect an SDK" action={<div className="demo-tabs" aria-label="Example language"><button className={language==='javascript'?'active':''} aria-pressed={language==='javascript'} onClick={()=>setLanguage('javascript')}>JavaScript</button><button className={language==='python'?'active':''} aria-pressed={language==='python'} onClick={()=>setLanguage('python')}>Python</button></div>}>
      <pre className="demo-code">{example}</pre><div className="demo-panel-footer"><span className="demo-subtle">Read the request and response in the sample traces.</span><button className="demo-button" onClick={()=>go('traces')}>Explore traces<ArrowRight size={14}/></button></div>
    </DemoPanel>
  </div>;
}

function AnalyticsPreview({state,dispatch}:DemoViewProps){
  const [metric,setMetric]=useState<'cost'|'tokens'|'requests'>('cost');
  const summary=demoSummary({...state,query:'',model:'',status:''}),series=demoSeries(state.days);
  const labels={cost:'Priced cost',tokens:'Tokens',requests:'Requests'};
  return <div className="demo-view-stack">
    <div className="demo-view-heading"><div><h2>Analytics</h2><p>See which models drive cost, then inspect their requests.</p></div><select className="demo-select" aria-label="Demo time range" value={state.days} onChange={event=>dispatch({type:'set',key:'days',value:Number(event.target.value) as 7|30})}><option value={7}>Last 7 sample days</option><option value={30}>Last 30 sample days</option></select></div>
    <div className="demo-stats-grid"><DemoMetric label="Priced cost" value={demoMoney(summary.cost)}/><DemoMetric label="Requests" value={demoNumber(summary.requests)}/><DemoMetric label="Input tokens" value={demoNumber(summary.inputTokens)}/><DemoMetric label="Cache read" value={summary.cachePercent===null?'—':`${summary.cachePercent.toFixed(1)}%`}/></div>
    <DemoPanel title={`${labels[metric]} over time`} action={<div className="demo-tabs" aria-label="Analytics metric">{(['cost','tokens','requests'] as const).map(value=><button key={value} className={metric===value?'active':''} aria-pressed={metric===value} onClick={()=>setMetric(value)}>{labels[value]}</button>)}</div>}>
      <DemoChart values={series.map(point=>point[metric])} dates={series.map(point=>point.date)} formatValue={metric==='cost'?demoMoney:demoNumber} label={`Fictional ${labels[metric].toLowerCase()} over the last ${state.days} days`}/>
    </DemoPanel>
    <DemoPanel title="Model breakdown" action={<span className="demo-subtle">Show matching requests</span>}><div className="demo-table-wrap"><table className="demo-table"><thead><tr><th>Model</th><th>Requests</th><th>Tokens</th><th>Priced cost</th></tr></thead><tbody>{summary.models.map(row=><tr key={row.model}><td><button className="demo-row-action" aria-label={`Inspect ${row.model} traces`} onClick={()=>dispatch({type:'inspect-traces',model:row.model})}>{row.model}<ArrowRight size={13}/></button></td><td>{demoNumber(row.requests)}</td><td>{demoNumber(row.tokens)}</td><td>{demoMoney(row.cost)}</td></tr>)}</tbody></table></div></DemoPanel>
  </div>;
}

function TracesPreview({state,dispatch}:DemoViewProps){
  const items=filteredDemoTraces(state),selected=demoTraces.find(trace=>trace.id===state.selectedTrace);
  const detailsRef=useRef<HTMLElement>(null);
  useEffect(()=>{
    if(!selected||!detailsRef.current)return;
    detailsRef.current.scrollIntoView({block:'nearest'});
    detailsRef.current.focus({preventScroll:true});
  },[selected]);
  return <div className="demo-view-stack">
    <div className="demo-view-heading"><div><h2>Traces</h2><p>Open a request to inspect its payload and token accounting.</p></div><select className="demo-select" aria-label="Demo time range" value={state.days} onChange={event=>{dispatch({type:'set',key:'days',value:Number(event.target.value) as 7|30});dispatch({type:'set',key:'selectedTrace',value:null});}}><option value={7}>Last 7 sample days</option><option value={30}>Last 30 sample days</option></select></div>
    <div className="demo-toolbar"><label className="demo-search"><Search size={15}/><input aria-label="Search demo traces" placeholder="Search ID, workflow, repository…" value={state.query} onChange={event=>{dispatch({type:'set',key:'query',value:event.target.value});dispatch({type:'set',key:'selectedTrace',value:null});}}/></label><select className="demo-select" aria-label="Filter demo model" value={state.model} onChange={event=>{dispatch({type:'set',key:'model',value:event.target.value});dispatch({type:'set',key:'selectedTrace',value:null});}}><option value="">All models</option>{demoModels.map(model=><option key={model}>{model}</option>)}</select><select className="demo-select" aria-label="Filter demo status" value={state.status} onChange={event=>{dispatch({type:'set',key:'status',value:event.target.value as ''|'success'|'error'});dispatch({type:'set',key:'selectedTrace',value:null});}}><option value="">All statuses</option><option value="success">Success</option><option value="error">Errors</option></select><select className="demo-select" aria-label="Sort demo traces" value={state.traceSort} onChange={event=>dispatch({type:'set',key:'traceSort',value:event.target.value as 'newest'|'cost'|'tokens'})}><option value="newest">Newest first</option><option value="cost">Highest cost</option><option value="tokens">Most tokens</option></select></div>
    <DemoPanel title="Traces" action={<span className="demo-subtle">{items.length} sample requests</span>}><div className="demo-table-wrap"><table className="demo-table"><thead><tr><th>Request / workflow</th><th>Model</th><th>Status</th><th>Tokens</th><th>Latency</th><th>Cost</th></tr></thead><tbody>{items.map(trace=><tr key={trace.id} className={trace.id===state.selectedTrace?'selected':''}><td><button className="demo-row-action" onClick={()=>dispatch({type:'set',key:'selectedTrace',value:trace.id})}>{trace.id}</button><small>{trace.workflow}</small></td><td>{trace.model}</td><td><span className={`demo-badge ${trace.status==='success'?'green':'red'}`}>{trace.status}</span></td><td>{demoNumber(trace.inputTokens+trace.outputTokens)}</td><td>{demoNumber(trace.latencyMs)} ms</td><td>{demoMoney(trace.cost)}</td></tr>)}</tbody></table>{items.length===0&&<div className="demo-empty"><Search size={25}/><strong>No matching sample traces</strong><p>Try another model, status, or search.</p><button className="demo-button" onClick={()=>{dispatch({type:'set',key:'query',value:''});dispatch({type:'set',key:'model',value:''});dispatch({type:'set',key:'status',value:''});}}>Clear filters</button></div>}</div></DemoPanel>
    {selected&&<section ref={detailsRef} tabIndex={-1} className="demo-detail" aria-label="Sample trace details"><header className="demo-detail-heading"><div><span className="demo-subtle">Trace details · {selected.workflow}</span><h3>{selected.id}</h3></div><button className="demo-icon-button" aria-label="Close sample trace details" onClick={()=>dispatch({type:'set',key:'selectedTrace',value:null})}><X size={17}/></button></header><div className="demo-detail-facts"><span>{selected.model}</span><span>{selected.repository}</span><span className={`demo-badge ${selected.status==='success'?'green':'red'}`}>{selected.status}</span></div><div className="demo-trace-accounting"><dl><div><dt>Sample time · UTC</dt><dd>{new Date(selected.startedAt).toLocaleString('en',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'})}</dd></div><div><dt>Input tokens</dt><dd>{demoNumber(selected.inputTokens)}</dd></div><div><dt>Output tokens</dt><dd>{demoNumber(selected.outputTokens)}</dd></div><div><dt>Cached input</dt><dd>{demoNumber(selected.cachedTokens)}</dd></div><div><dt>Priced cost</dt><dd>{demoMoney(selected.cost)}</dd></div><div><dt>Latency</dt><dd>{demoNumber(selected.latencyMs)} ms</dd></div></dl></div><div className="demo-tabs" aria-label="Sample trace payload"><button className={state.traceTab==='request'?'active':''} aria-pressed={state.traceTab==='request'} onClick={()=>dispatch({type:'set',key:'traceTab',value:'request'})}>Request</button><button className={state.traceTab==='response'?'active':''} aria-pressed={state.traceTab==='response'} onClick={()=>dispatch({type:'set',key:'traceTab',value:'response'})}>Response</button></div><pre className="demo-code">{JSON.stringify(state.traceTab==='request'?selected.request:selected.response,null,2)}</pre></section>}
  </div>;
}

function DashboardsPreview({state,go}:DemoViewProps){
  const [dashboard,setDashboard]=useState<'traffic'|'models'|'quality'>('traffic');
  const dashboards:('traffic'|'models'|'quality')[]=AGENT_BUILDER_ENABLED?['traffic','models','quality']:['traffic','models'];
  const summary=demoSummary({...state,query:'',model:'',status:''}),series=demoSeries(state.days),results=state.evaluationResults;
  const score=results?.length?Math.round(results.filter(result=>result.pass).length/results.length*100):null;
  return <div className="demo-view-stack"><div className="demo-view-heading"><div><h2>Dashboards</h2><p>Switch between {AGENT_BUILDER_ENABLED?'three':'two'} views of the same sample project.</p></div><span className="demo-badge">Preview</span></div><div className="demo-tabs" aria-label="Sample dashboards">{dashboards.map(value=><button key={value} className={dashboard===value?'active':''} aria-pressed={dashboard===value} onClick={()=>setDashboard(value)}>{value[0].toUpperCase()+value.slice(1)}<ChevronDown size={12}/></button>)}</div>{dashboard==='traffic'?<><div className="demo-stats-grid"><DemoMetric label="Requests" value={demoNumber(summary.requests)}/><DemoMetric label="Success rate" value={summary.successPercent===null?'—':`${summary.successPercent.toFixed(1)}%`}/><DemoMetric label="Input cached" value={summary.cachePercent===null?'—':`${summary.cachePercent.toFixed(1)}%`}/><DemoMetric label="Priced cost" value={demoMoney(summary.cost)}/></div><DemoPanel title="Request volume"><DemoChart values={series.map(point=>point.requests)} label="Fictional request volume"/></DemoPanel></>:dashboard==='models'?<DemoPanel title="Tokens by model"><div className="demo-model-bars">{summary.models.map(row=><div key={row.model}><span>{row.model}</span><strong>{demoNumber(row.tokens)}</strong><progress aria-label={`${row.model} share of sample tokens`} max={Math.max(...summary.models.map(model=>model.tokens),1)} value={row.tokens}/></div>)}</div></DemoPanel>:AGENT_BUILDER_ENABLED?<><div className="demo-stats-grid"><DemoMetric label="Sample cases" value={String(state.evaluationCases.length)}/><DemoMetric label="Latest match rate" value={score===null?'Not run':`${score}%`}/><DemoMetric label="Reviewed traces" value={String(state.reviewedTraces.length)}/><DemoMetric label="Scorer" value="Exact match"/></div><DemoPanel title="Quality checks"><div className="demo-connection-row"><Code2 size={24}/><div><strong>Test the sample answers yourself.</strong><p className="demo-subtle">Results are computed in this browser from the supplied cases.</p></div><button className="demo-button" onClick={()=>go('experiments')}>Open experiments<ArrowRight size={14}/></button></div></DemoPanel></>:null}</div>;
}

export function DemoTraffic(props:DemoViewProps){
  if(props.state.view==='gateway')return <GatewayPreview {...props}/>;
  if(props.state.view==='traces')return <TracesPreview {...props}/>;
  if(props.state.view==='dashboards')return <DashboardsPreview {...props}/>;
  return <AnalyticsPreview {...props}/>;
}
