import { useState } from 'react';
import { ArrowRight, Check, ChevronDown, Code2, Eye, EyeOff, Search, X } from 'lucide-react';
import { demoModels, demoTraces } from './demoData';
import { demoSeries, demoSummary, filteredDemoTraces } from './demoState';
import { DemoChart, DemoMetric, DemoPanel, demoMoney, demoNumber, type DemoViewProps } from './demoUi';

function GatewayPreview({state,dispatch,go}:DemoViewProps){
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

function AnalyticsPreview({state}:DemoViewProps){
  const [metric,setMetric]=useState<'cost'|'tokens'|'requests'>('cost');
  const summary=demoSummary({...state,query:'',model:'',status:''}),series=demoSeries(state.days);
  const labels={cost:'Priced cost',tokens:'Tokens',requests:'Requests'};
  return <div className="demo-view-stack">
    <div className="demo-view-heading"><div><h2>Analytics</h2><p>Explore the sample traffic by model and workload.</p></div><span className="demo-badge">Fictional traffic</span></div>
    <div className="demo-stats-grid"><DemoMetric label="Priced cost" value={demoMoney(summary.cost)}/><DemoMetric label="Requests" value={demoNumber(summary.requests)}/><DemoMetric label="Input tokens" value={demoNumber(summary.inputTokens)}/><DemoMetric label="Cache read" value={summary.cachePercent===null?'—':`${summary.cachePercent.toFixed(1)}%`}/></div>
    <DemoPanel title={`${labels[metric]} over time`} action={<div className="demo-tabs" aria-label="Analytics metric">{(['cost','tokens','requests'] as const).map(value=><button key={value} className={metric===value?'active':''} aria-pressed={metric===value} onClick={()=>setMetric(value)}>{labels[value]}</button>)}</div>}>
      <DemoChart values={series.map(point=>point[metric])} label={`Fictional ${labels[metric].toLowerCase()} over the last ${state.days} days`}/>
    </DemoPanel>
    <DemoPanel title="Model breakdown"><div className="demo-table-wrap"><table className="demo-table"><thead><tr><th>Model</th><th>Requests</th><th>Tokens</th><th>Priced cost</th></tr></thead><tbody>{summary.models.map(row=><tr key={row.model}><td><strong>{row.model}</strong></td><td>{demoNumber(row.requests)}</td><td>{demoNumber(row.tokens)}</td><td>{demoMoney(row.cost)}</td></tr>)}</tbody></table></div></DemoPanel>
  </div>;
}

function TracesPreview({state,dispatch}:DemoViewProps){
  const items=filteredDemoTraces(state),selected=demoTraces.find(trace=>trace.id===state.selectedTrace);
  return <div className="demo-view-stack">
    <div className="demo-toolbar"><label className="demo-search"><Search size={15}/><input aria-label="Search demo traces" placeholder="Search ID, workflow, repository…" value={state.query} onChange={event=>dispatch({type:'set',key:'query',value:event.target.value})}/></label><select className="demo-select" aria-label="Filter demo model" value={state.model} onChange={event=>dispatch({type:'set',key:'model',value:event.target.value})}><option value="">All models</option>{demoModels.map(model=><option key={model}>{model}</option>)}</select><select className="demo-select" aria-label="Filter demo status" value={state.status} onChange={event=>dispatch({type:'set',key:'status',value:event.target.value as ''|'success'|'error'})}><option value="">All statuses</option><option value="success">Success</option><option value="error">Errors</option></select><select className="demo-select" aria-label="Sort demo traces" value={state.traceSort} onChange={event=>dispatch({type:'set',key:'traceSort',value:event.target.value as 'newest'|'cost'|'tokens'})}><option value="newest">Newest first</option><option value="cost">Highest cost</option><option value="tokens">Most tokens</option></select></div>
    <DemoPanel title="Traces" action={<span className="demo-subtle">{items.length} sample requests</span>}><div className="demo-table-wrap"><table className="demo-table"><thead><tr><th>Request / workflow</th><th>Model</th><th>Status</th><th>Tokens</th><th>Latency</th><th>Cost</th></tr></thead><tbody>{items.map(trace=><tr key={trace.id} className={trace.id===state.selectedTrace?'selected':''}><td><button className="demo-row-action" onClick={()=>dispatch({type:'set',key:'selectedTrace',value:trace.id})}>{trace.id}</button><small>{trace.workflow}</small></td><td>{trace.model}</td><td><span className={`demo-badge ${trace.status==='success'?'green':'red'}`}>{trace.status}</span></td><td>{demoNumber(trace.inputTokens+trace.outputTokens)}</td><td>{demoNumber(trace.latencyMs)} ms</td><td>{demoMoney(trace.cost)}</td></tr>)}</tbody></table>{items.length===0&&<div className="demo-empty"><Search size={25}/><strong>No matching sample traces</strong><p>Try another model, status, or search.</p><button className="demo-button" onClick={()=>{dispatch({type:'set',key:'query',value:''});dispatch({type:'set',key:'model',value:''});dispatch({type:'set',key:'status',value:''});}}>Clear filters</button></div>}</div></DemoPanel>
    {selected&&<section className="demo-detail" aria-label="Sample trace details"><header className="demo-detail-heading"><div><span className="demo-subtle">Trace details</span><h3>{selected.id}</h3></div><button className="demo-icon-button" aria-label="Close sample trace details" onClick={()=>dispatch({type:'set',key:'selectedTrace',value:null})}><X size={17}/></button></header><div className="demo-detail-facts"><span>{selected.model}</span><span>{selected.repository}</span><span>{demoNumber(selected.cachedTokens)} cached tokens</span></div><div className="demo-tabs" aria-label="Sample trace payload"><button className={state.traceTab==='request'?'active':''} aria-pressed={state.traceTab==='request'} onClick={()=>dispatch({type:'set',key:'traceTab',value:'request'})}>Request</button><button className={state.traceTab==='response'?'active':''} aria-pressed={state.traceTab==='response'} onClick={()=>dispatch({type:'set',key:'traceTab',value:'response'})}>Response</button></div><pre className="demo-code">{JSON.stringify(state.traceTab==='request'?selected.request:selected.response,null,2)}</pre></section>}
  </div>;
}

function DashboardsPreview({state,go}:DemoViewProps){
  const [dashboard,setDashboard]=useState<'traffic'|'models'|'quality'>('traffic');
  const summary=demoSummary({...state,query:'',model:'',status:''}),series=demoSeries(state.days),results=state.evaluationResults;
  const score=results?.length?Math.round(results.filter(result=>result.pass).length/results.length*100):null;
  return <div className="demo-view-stack"><div className="demo-view-heading"><div><h2>Dashboards</h2><p>Switch between three views of the same sample project.</p></div><span className="demo-badge">Preview</span></div><div className="demo-tabs" aria-label="Sample dashboards">{(['traffic','models','quality'] as const).map(value=><button key={value} className={dashboard===value?'active':''} aria-pressed={dashboard===value} onClick={()=>setDashboard(value)}>{value[0].toUpperCase()+value.slice(1)}<ChevronDown size={12}/></button>)}</div>{dashboard==='traffic'?<><div className="demo-stats-grid"><DemoMetric label="Requests" value={demoNumber(summary.requests)}/><DemoMetric label="Success rate" value={summary.successPercent===null?'—':`${summary.successPercent.toFixed(1)}%`}/><DemoMetric label="Input cached" value={summary.cachePercent===null?'—':`${summary.cachePercent.toFixed(1)}%`}/><DemoMetric label="Priced cost" value={demoMoney(summary.cost)}/></div><DemoPanel title="Request volume"><DemoChart values={series.map(point=>point.requests)} label="Fictional request volume"/></DemoPanel></>:dashboard==='models'?<DemoPanel title="Tokens by model"><div className="demo-model-bars">{summary.models.map(row=><div key={row.model}><span>{row.model}</span><strong>{demoNumber(row.tokens)}</strong><progress aria-label={`${row.model} share of sample tokens`} max={Math.max(...summary.models.map(model=>model.tokens),1)} value={row.tokens}/></div>)}</div></DemoPanel>:<><div className="demo-stats-grid"><DemoMetric label="Sample cases" value={String(state.evaluationCases.length)}/><DemoMetric label="Latest match rate" value={score===null?'Not run':`${score}%`}/><DemoMetric label="Reviewed traces" value={String(state.reviewedTraces.length)}/><DemoMetric label="Scorer" value="Exact match"/></div><DemoPanel title="Quality checks"><div className="demo-connection-row"><Code2 size={24}/><div><strong>Test the sample answers yourself.</strong><p className="demo-subtle">Results are computed in this browser from the supplied cases.</p></div><button className="demo-button" onClick={()=>go('experiments')}>Open experiments<ArrowRight size={14}/></button></div></DemoPanel></>}</div>;
}

export function DemoTraffic(props:DemoViewProps){
  if(props.state.view==='gateway')return <GatewayPreview {...props}/>;
  if(props.state.view==='traces')return <TracesPreview {...props}/>;
  if(props.state.view==='dashboards')return <DashboardsPreview {...props}/>;
  return <AnalyticsPreview {...props}/>;
}
