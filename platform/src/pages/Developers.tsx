import { useState } from 'react';
import { Link,useSearchParams } from 'react-router-dom';
import { ArrowRight,CalendarDays,ChevronDown,ChevronLeft,ChevronRight,Code2,Columns3,Download,FileCode2,Filter,KeyRound,RefreshCw,Search,ShieldCheck,Terminal,Users } from 'lucide-react';
import { api,date,download,json,money,number,useApp,useResource } from '../api';
import { Code,Empty,ErrorNotice,Select,Spinner } from '../ui';
import { filterSessions,sessionColumns,sessionDays,sessionMetrics,sessionPage,sessionsResource,type DeveloperSession,type DeveloperSessionsResponse,type SessionColumn } from './developerSessions';
import './developer-sessions.css';

function SessionIllustration(){
  return <svg className="developer-session-illustration" viewBox="0 0 170 120" fill="none" aria-hidden="true">
    <ellipse cx="84" cy="85" rx="73" ry="25" stroke="currentColor" strokeOpacity=".35" strokeDasharray="3 4"/>
    <ellipse cx="84" cy="85" rx="61" ry="19" stroke="currentColor" strokeOpacity=".18" strokeDasharray="2 4"/>
    <path d="m30 69 37-21 55 27-37 21-55-27Z" fill="var(--subtle)" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
    <path d="M30 69v5l55 27 37-21v-5M85 96v5" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
    <path d="M67 17c0-2 1-2 3-1l50 25c1 .5 2 2 2 4v30L67 48V17Z" fill="var(--surface)" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    <path d="m73 24 43 22v20L73 45V24Z" stroke="currentColor" strokeWidth=".9" strokeLinejoin="round"/>
    <path d="m80 35 5 6-5 1m10 6 13 6M55 60l43 21M61 56l43 21M49 64l43 21m-35-27 12-7m-4 11 12-7m-4 11 12-7m-4 11 12-7" stroke="currentColor" strokeWidth=".8" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="m51 73 13-7 15 8-13 7-15-8Z" stroke="currentColor" strokeWidth=".8" strokeLinejoin="round"/>
  </svg>;
}

function SessionRows({items,columns}:{items:DeveloperSession[];columns:SessionColumn[]}){
  const visible=(column:SessionColumn)=>columns.includes(column);
  return <div className="developer-session-table-scroll"><table className="developer-session-table"><thead><tr><th>Session</th>{sessionColumns.filter(column=>visible(column.id)).map(column=><th key={column.id} className={column.id==='requests'||column.id==='cost'?'numeric':''}>{column.label}</th>)}</tr></thead><tbody>{items.map(item=><tr key={item.id}>
    <td><code title={item.id}>{item.id}</code><small>Started {date(item.started_at)}</small></td>
    {visible('repository')&&<td>{item.repository||<span className="muted">Not reported</span>}</td>}
    {visible('models')&&<td>{item.models.length?item.models.join(', '):<span className="muted">Not reported</span>}</td>}
    {visible('requests')&&<td className="numeric">{number(item.requests)}</td>}
    {visible('cost')&&<td className="numeric">{money(item.priced_cost_usd)}{item.priced_requests>0&&item.priced_requests<item.requests&&<small>{number(item.priced_requests)}/{number(item.requests)} priced</small>}</td>}
    {visible('activity')&&<td className="nowrap">{date(item.last_at)}</td>}
  </tr>)}</tbody></table></div>;
}

export default function Developers(){
  const {project,session,setProject}=useApp(),[params,setParams]=useSearchParams();
  const [columns,setColumns]=useState<SessionColumn[]>(sessionColumns.map(column=>column.id)),[localOpened,setLocalOpened]=useState(false);
  const days=sessionDays(params.get('days')),search=params.get('search')||'',model=params.get('model')||'';
  const {data,loading,error,refresh}=useResource<DeveloperSessionsResponse>(sessionsResource(project?.id,days),{items:[],range:null,truncated:false});
  const items=data.items||[],filtered=filterSessions(items,search,model),metrics=sessionMetrics(filtered),page=sessionPage(filtered,params.get('page'));
  const models=Array.from(new Set(items.flatMap(item=>item.models))).sort();
  const projects=session?.projects?.length?session.projects:project?[project]:[];
  const measured=!!project&&!loading&&!error;
  function updateQuery(key:string,value:string){setParams(previous=>{const next=new URLSearchParams(previous);if(value)next.set(key,value);else next.delete(key);if(key!=='page')next.delete('page');return next;},{replace:key==='search'});}
  function toggleColumn(column:SessionColumn){setColumns(current=>current.includes(column)?current.filter(item=>item!==column):[...current,column]);}
  const rangeLabel=data.range?`${date(data.range.from)} – ${date(data.range.to)}`:'Selected date window';

  return <div className="developer-sessions">
    <div className="developer-session-controls" role="region" aria-label="Session controls">
      <Select label="Project" value={project?.id||''} onChange={value=>{const selected=projects.find(item=>item.id===value);if(selected){setProject(selected);updateQuery('page','');}}}>{!project&&<option value="">Select a project</option>}{projects.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</Select>
      <button className="developer-control-button" disabled title="This data does not include actor attribution."><Users size={13}/>Everyone<ChevronDown size={12}/></button>
      <div className="developer-date-search" title={rangeLabel}><CalendarDays size={13}/><Select label="Session date range" value={days} onChange={value=>updateQuery('days',value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></Select><span className="developer-control-divider"/><Search size={13}/><input aria-label="Search sessions" value={search} onChange={event=>updateQuery('search',event.target.value)} placeholder="Search sessions…"/></div>
      <button className="icon-button developer-session-refresh" aria-label="Refresh sessions" onClick={refresh} disabled={!project||loading}>{loading?<Spinner/>:<RefreshCw size={14}/>}</button>
      <details className="developer-session-menu"><summary><Filter size={13}/>Filter{model&&<span className="developer-filter-count">1</span>}<ChevronDown size={11}/></summary><div className="developer-session-popover"><label>Model<Select label="Session model" value={model} onChange={value=>updateQuery('model',value)}><option value="">All models</option>{models.map(value=><option key={value} value={value}>{value}</option>)}{model&&!models.includes(model)&&<option value={model}>{model}</option>}</Select></label>{(model||search)&&<button className="text-button" onClick={()=>{setParams(previous=>{const next=new URLSearchParams(previous);next.delete('model');next.delete('search');next.delete('page');return next;});}}>Clear filters</button>}</div></details>
      <details className="developer-session-menu"><summary><Columns3 size={13}/>Display<ChevronDown size={11}/></summary><div className="developer-session-popover developer-display-options"><strong>Visible columns</strong><label><input type="checkbox" checked disabled/>Session</label>{sessionColumns.map(column=><label key={column.id}><input type="checkbox" checked={columns.includes(column.id)} onChange={()=>toggleColumn(column.id)}/>{column.label}</label>)}</div></details>
    </div>

    <div className="developer-session-metrics" aria-label="Session metrics">
      <article className="developer-session-metric" title="Identified in this window"><span>Sessions</span><strong>{measured?number(metrics.sessions):'—'}</strong></article>
      <article className="developer-session-metric" title="Requests in identified sessions"><span>Requests</span><strong>{measured?number(metrics.requests):'—'}</strong></article>
      <article className="developer-session-metric" title={measured&&metrics.pricedRequests?'Subtotal of supplied request prices; not an invoice':'No priced requests'}><span>Priced cost</span><strong>{measured?money(metrics.cost):'—'}</strong>{measured&&metrics.pricedRequests>0&&metrics.pricedRequests<metrics.requests&&<small>{number(metrics.pricedRequests)} of {number(metrics.requests)} requests priced</small>}</article>
      <article className="developer-session-metric" title={measured&&metrics.cached!==null?`${number(metrics.cached)} provider-reported cached input tokens`:'Cache usage unavailable'}><span>Cache read</span><strong>{measured&&metrics.cacheRead!==null?`${new Intl.NumberFormat('en',{maximumFractionDigits:1}).format(metrics.cacheRead)}%`:'—'}</strong></article>
    </div>

    <section className="developer-session-panel" aria-label="Sessions">
      {loading?<div className="developer-session-empty"><Spinner/><h2>Sessions</h2><p>Loading sessions…</p></div>:error?<div className="developer-session-empty"><h2>Sessions</h2><ErrorNotice message={error} retry={refresh}/></div>:page.items.length?<SessionRows items={page.items} columns={columns}/>:<div className="developer-session-empty"><div className="developer-session-empty-content">
        <SessionIllustration/><h2>Sessions</h2>
        <p>{!project?'Choose a project to view its sessions.':items.length?'No sessions match these filters. Try a different search or model.':'No sessions in this window. Sessions appear when connected traffic includes a session ID.'}</p>
        <div className="developer-session-path" aria-label="Connection path"><span><KeyRound size={12}/>Personal key</span><ChevronRight size={12}/><span><Terminal size={12}/>Sessions</span><ChevronRight size={12}/><span>Delivery</span></div>
        <Link className="button secondary" to="/app/connect?tab=cli"><Terminal size={14}/>Connect a coding agent<ArrowRight size={13}/></Link>
      </div></div>}
      {data.truncated&&measured&&<p className="developer-session-truncated">Only recent candidate requests are included. Session totals may be incomplete.</p>}
      <footer className="developer-session-pagination"><span>{loading?'Loading…':error?'Results unavailable':`${page.start}–${page.end} of ${page.total} sessions`}</span><div><span>20 per page</span><button className="icon-button" aria-label="Previous page" disabled={!measured||!page.hasPrevious} onClick={()=>updateQuery('page',String(page.page-1))}><ChevronLeft size={15}/></button><span>{page.page} / {page.pages}</span><button className="icon-button" aria-label="Next page" disabled={!measured||!page.hasNext} onClick={()=>updateQuery('page',String(page.page+1))}><ChevronRight size={15}/></button></div></footer>
    </section>

    <details className="developer-local-compression" onToggle={event=>{if(event.currentTarget.open)setLocalOpened(true);}}><summary><Code2 size={14}/>Local compression<ChevronDown size={13}/></summary>{localOpened&&<div className="developer-local-content"><LocalCompression/></div>}</details>
  </div>;
}
type CompressionEvent={id:string;algorithm:string;source:string;input_bytes:number;output_bytes:number;original_tokens_estimate:number;optimized_tokens_estimate:number;estimated_saved_tokens:number;token_basis:string;recovery_handle:string|null;recovery_location:string;created_at:string};
type CompressionResult={compressedText:string;algorithm:string;original_tokens_estimate:number;optimized_tokens_estimate:number;token_basis:string;recovery_handle:string;changed:boolean};
function LocalCompression(){const {project,notify}=useApp();const {data,error:loadError,refresh}=useResource<{items:CompressionEvent[]}>(project?`/api/compression-events?project=${project.id}`:null,{items:[]});const [text,setText]=useState(''),[result,setResult]=useState<CompressionResult|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');const events=data.items||[];const original=events.reduce((sum,e)=>sum+e.input_bytes,0),optimized=events.reduce((sum,e)=>sum+e.output_bytes,0),estimate=events.reduce((sum,e)=>sum+e.estimated_saved_tokens,0);
  async function compress(){setError('');setBusy(true);try{const r=await api<CompressionResult>('/api/compress',json({project_id:project?.id,text}));setResult(r);refresh();notify(r.changed?'Structured input compacted. Original content is recoverable.':'Input preserved. No eligible JSON compaction was applied.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function recover(){if(!result)return;setBusy(true);setError('');try{const r=await api<{original:string}>(`/api/recover/${encodeURIComponent(result.recovery_handle)}?project=${project?.id}`);download('traqiva-recovered-input.txt',r.original);notify('Original content recovered.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <><div className="metrics-strip"><div><span>Compression events</span><strong>{number(events.length)}</strong><small>Latest 100 recorded events</small></div><div><span>Input bytes</span><strong>{number(original)}</strong><small>Reported by the client or server</small></div><div><span>Output bytes</span><strong>{number(optimized)}</strong><small>After the recorded transform</small></div><div><span>Estimated token reduction</span><strong>{events.length?number(estimate):'—'}</strong><small>Estimate · not provider usage</small></div></div><div className="notice subtle"><ShieldCheck size={19}/><span>These are compression operations, not LLM requests. Token counts are estimates. No provider call, invoice saving, or automatic desktop routing is implied.</span></div><ErrorNotice message={loadError} retry={refresh}/><section className="panel"><header className="panel-header"><h2>Compression activity</h2><button className="icon-button" aria-label="Refresh compression events" onClick={refresh}><RefreshCw size={15}/></button></header><div className="table-scroll"><table><thead><tr><th>Time</th><th>Algorithm</th><th>Source</th><th className="numeric">Before bytes</th><th className="numeric">After bytes</th><th className="numeric">Est. token reduction</th><th>Recovery</th></tr></thead><tbody>{events.map(e=><tr key={e.id}><td className="nowrap">{date(e.created_at)}</td><td><code>{e.algorithm}</code></td><td>{e.source}</td><td className="numeric">{number(e.input_bytes)}</td><td className="numeric">{number(e.output_bytes)}</td><td className="numeric">{number(e.estimated_saved_tokens)}</td><td><span className="badge neutral">{e.recovery_handle?`${e.recovery_location} handle`:'No handle'}</span></td></tr>)}</tbody></table>{!events.length&&<Empty icon={<FileCode2 size={29}/>} title="No compression events yet">Use the local CLI or try structured input compaction below.<br/>Real model traffic appears separately in Traces.</Empty>}</div></section><section className="compression-lab"><div className="compression-lab-intro"><span className="mode-icon"><Code2 size={24}/></span><h2>Try a recoverable transform.</h2><p>Compact structured JSON on the server. String values are preserved. The original content is stored for your workspace’s retention window and can be recovered by its handle.</p><p>This lab does not call a model. For local context reduction, use the downloadable CLI and native engine.</p><Link className="text-button" to="/app/connect?tab=cli">Open local setup guide<ArrowRight size={14}/></Link></div><div><label className="field">Your structured input<textarea rows={9} className="code-input" value={text} onChange={e=>setText(e.target.value)} placeholder={'Paste JSON you want to compact…'}/></label><ErrorNotice message={error}/><button className="button primary" onClick={()=>void compress()} disabled={busy||!text.trim()||!project}>{busy?<Spinner/>:<Code2 size={15}/>}Compact input</button>{result&&<div className="compression-result"><div><span className="badge neutral">{result.algorithm}</span><span>{number(result.original_tokens_estimate)} → {number(result.optimized_tokens_estimate)} estimated tokens</span></div><Code>{result.compressedText}</Code><button className="button secondary compact" disabled={busy} onClick={()=>void recover()}><Download size={14}/>Recover original</button><p className="muted small">Recovery handle: <code>{result.recovery_handle}</code></p></div>}</div></section></>;
}
