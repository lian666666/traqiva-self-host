import { useEffect,useState,type FormEvent,type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight,ArrowUpRight,Check,ChevronRight,FileText,Inbox,MessageCircle,Send,Shield,Terminal,X } from 'lucide-react';
import { LANDING_CLI_DOCS } from '../landing/content';
import { demoBriefs,demoNotifications,demoQuestions,demoTraces,type DemoTrace } from './demoData';
import { demoAnswer,demoSeries,demoSummary } from './demoState';
import { DemoChart,DemoMetric,DemoPanel,demoMoney,demoNumber,type DemoViewProps } from './demoUi';

const percent=(value:number|null)=>value===null?'—':`${value.toFixed(1)}%`;
const sampleTime=(value:string)=>new Date(value).toLocaleString('en',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'});

function ViewHeading({title,detail,children}:{title:string;detail:string;children?:ReactNode}){
  return <header className="demo-view-heading"><div><h1>{title}</h1><p>{detail}</p></div>{children}</header>;
}

function DemoHome({state,dispatch,go}:DemoViewProps){
  // Home presents the entire project, independently of the Traces table's search filters.
  const summary=demoSummary({...state,query:'',model:'',status:''}),series=demoSeries(state.days);
  const next=demoBriefs.filter(brief=>state.briefStatus[brief.id]==='open');
  function ask(question:string){dispatch({type:'set',key:'question',value:question});dispatch({type:'set',key:'answer',value:demoAnswer(question)});go('ask');}
  function openBrief(id:string){dispatch({type:'set',key:'selectedBrief',value:id});go('improvements');}
  return <div className="demo-home">
    <ViewHeading title="Good morning, Demo" detail={`${state.projectName} · Fictional project activity. Explore the same sample records across every view.`}><label className="demo-select-label"><select aria-label="Sample time range" value={state.days} onChange={event=>dispatch({type:'set',key:'days',value:event.target.value==='7'?7:30})}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select></label></ViewHeading>
    <div className="demo-home-grid">
      <button className="demo-home-card wide" onClick={()=>go('analytics')} aria-label={`Sample spend ${demoMoney(summary.cost)}. Open Analytics.`}><DemoMetric label="Spend" value={demoMoney(summary.cost)}/><DemoChart values={series.map(day=>day.cost)} label="Fictional request cost over the selected period"/><span className="demo-card-caption">Illustrative cost · {demoNumber(summary.requests)} sample requests</span></button>
      <button className="demo-home-card green" onClick={()=>go('analytics')} aria-label={`Sample cache coverage ${percent(summary.cachePercent)}. Open Analytics.`}><DemoMetric label="Cache coverage" value={percent(summary.cachePercent)} green/><DemoChart values={series.map(day=>day.cachedPercent??0)} tone="green" label="Fictional cached-input coverage over the selected period"/><span className="demo-card-caption">Reported in the fixtures · no savings claim</span></button>
      <button className="demo-home-card" onClick={()=>go('improvements')} aria-label={`${summary.openBriefs} available sample briefs. Open Improvements.`}><DemoMetric label="Available briefs" value={demoNumber(summary.openBriefs)}/><div className="demo-card-placeholder"><FileText size={20}/><span>Potential per day <strong>—</strong></span></div><span className="demo-card-caption">Sample findings · no comparable savings baseline</span></button>
      <button className="demo-home-card" onClick={()=>go('traces')} aria-label={`${summary.requests} sample requests. Open Traces.`}><DemoMetric label="Requests" value={demoNumber(summary.requests)}/><DemoChart values={series.map(day=>day.requests)} label="Fictional request count over the selected period"/><span className="demo-card-caption">{percent(summary.successPercent)} sample success</span></button>
      <button className="demo-home-card" onClick={()=>go('traces')} aria-label={`${percent(summary.cachePercent)} sample input cached. Open Traces.`}><DemoMetric label="Input cached" value={percent(summary.cachePercent)}/><DemoChart values={series.map(day=>day.cachedPercent??0)} label="Fictional cached input as a share of total input"/><span className="demo-card-caption">{demoNumber(summary.cachedTokens)} of {demoNumber(summary.inputTokens)} input tokens</span></button>
    </div>
    <div className="demo-home-questions" aria-label="Sample questions">{demoQuestions.map(question=><button key={question} onClick={()=>ask(question)}><MessageCircle size={12}/>{question}</button>)}</div>
    <section className="demo-next"><header><h2>Next</h2><button onClick={()=>go('improvements')}>{next.length} open · All briefs<ArrowRight size={13}/></button></header>{next.length?<div className="demo-next-list">{next.slice(0,2).map(brief=><button key={brief.id} onClick={()=>openBrief(brief.id)}><span className="demo-brief-kind">{brief.kind}</span><strong>{brief.title}</strong><ChevronRight size={14}/></button>)}</div>:<p className="demo-empty">You reviewed the sample briefs. Reset the demo to start again.</p>}</section>
  </div>;
}

function DemoImprovements({state,dispatch}:DemoViewProps){
  const [filter,setFilter]=useState<'open'|'reviewed'|'all'>('open');
  const selected=demoBriefs.find(brief=>brief.id===state.selectedBrief)||demoBriefs[0];
  const items=demoBriefs.filter(brief=>filter==='all'||state.briefStatus[brief.id]===filter);
  const status=state.briefStatus[selected.id]||'open';
  return <div className="demo-improvements">
    <ViewHeading title="Improvements" detail="Sample findings with evidence. Review decisions stay in this demonstration."/>
    <div className="demo-tabs" role="group" aria-label="Filter sample briefs">{(['open','reviewed','all'] as const).map(value=><button key={value} aria-pressed={filter===value} className={filter===value?'active':''} onClick={()=>setFilter(value)}>{value==='all'?'All briefs':value[0].toUpperCase()+value.slice(1)}</button>)}</div>
    <div className="demo-brief-layout"><aside className="demo-brief-list" aria-label="Sample briefs">{items.length?items.map(brief=><button key={brief.id} className={selected.id===brief.id?'active':''} aria-pressed={selected.id===brief.id} onClick={()=>dispatch({type:'set',key:'selectedBrief',value:brief.id})}><span className="demo-brief-kind">{brief.kind}</span><strong>{brief.title}</strong><small>{state.briefStatus[brief.id]} · potential/day {brief.potentialDaily===null?'—':demoMoney(brief.potentialDaily)}</small></button>):<p className="demo-empty">No sample briefs in this view.</p>}</aside>
      <article className="demo-brief-detail"><div className="demo-detail-meta"><span>{selected.kind}</span><span className="demo-badge">{status}</span></div><h2>{selected.title}</h2><p>{selected.summary}</p><DemoPanel title="Evidence"><p>{selected.evidence}</p></DemoPanel><DemoPanel title="Suggested investigation"><p>{selected.nextStep}</p></DemoPanel><div className="demo-brief-potential"><span>Potential per day</span><strong>{selected.potentialDaily===null?'—':demoMoney(selected.potentialDaily)}</strong><small>No verified counterfactual savings in this sample.</small></div><div className="demo-actions">{status!=='reviewed'&&<button className="demo-button primary" onClick={()=>dispatch({type:'review-brief',id:selected.id,status:'reviewed'})}><Check size={14}/>Mark reviewed</button>}{status!=='dismissed'&&<button className="demo-button" onClick={()=>dispatch({type:'review-brief',id:selected.id,status:'dismissed'})}>Dismiss</button>}{status!=='open'&&<button className="demo-button" onClick={()=>dispatch({type:'review-brief',id:selected.id,status:'open'})}>Reopen sample</button>}</div><p className="demo-preview-note">Local simulation · no prompt, model, or production policy is changed.</p></article>
    </div>
  </div>;
}

function DemoSessions({dispatch,go}:DemoViewProps){
  const groups=Array.from(demoTraces.reduce((sessions,trace)=>{const items=sessions.get(trace.sessionId)||[];items.push(trace);sessions.set(trace.sessionId,items);return sessions;},new Map<string,DemoTrace[]>()));
  function openTrace(id:string){go('traces');dispatch({type:'set',key:'selectedTrace',value:id});dispatch({type:'set',key:'traceTab',value:'request'});}
  return <div className="demo-sessions"><ViewHeading title="Sessions" detail="All fictional sessions, grouped by their explicit sample session IDs."/><div className="demo-session-list">{groups.map(([id,traces])=><DemoPanel key={id} title={id} action={<span className="demo-muted">{traces.length} requests · {demoMoney(traces.reduce((total,trace)=>total+trace.cost,0))}</span>}><div className="demo-session-meta"><Terminal size={13}/>{traces[0].repository}<span>{demoNumber(traces.reduce((total,trace)=>total+trace.inputTokens+trace.outputTokens,0))} tokens</span></div><div className="demo-table-wrap"><table><thead><tr><th>Request</th><th>Workflow</th><th>Sample time · UTC</th><th>Status</th><th/></tr></thead><tbody>{traces.map(trace=><tr key={trace.id}><td><code>{trace.id}</code></td><td>{trace.workflow}</td><td>{sampleTime(trace.startedAt)}</td><td><span className={`demo-status ${trace.status}`}>{trace.status}</span></td><td><button className="demo-text-button" onClick={()=>openTrace(trace.id)} aria-label={`Open ${trace.id}`}>Open<ArrowUpRight size={12}/></button></td></tr>)}</tbody></table></div></DemoPanel>)}</div></div>;
}

function DemoAsk({state,dispatch}:DemoViewProps){
  const [draft,setDraft]=useState(state.question);
  useEffect(()=>{setDraft(state.question);},[state.question]);
  function answer(question:string){const value=question.trim();if(!value)return;setDraft(value);dispatch({type:'set',key:'question',value});dispatch({type:'set',key:'answer',value:demoAnswer(value)});}
  function submit(event:FormEvent){event.preventDefault();answer(draft);}
  return <div className="demo-ask"><ViewHeading title="Ask Traqiva" detail="Explore a prewritten answer about this fictional project. No model is called."/><div className="demo-ask-presets">{demoQuestions.map(question=><button className="demo-button" key={question} onClick={()=>answer(question)}>{question}<ArrowRight size={13}/></button>)}</div>{state.answer?<DemoPanel title="Prewritten sample answer" action={<span className="demo-badge">No model call</span>}><div className="demo-sample-question"><MessageCircle size={14}/><strong>{state.question}</strong></div><p className="demo-sample-answer">{state.answer}</p><p className="demo-preview-note">Source: the bundled fictional dataset · this is not a live analysis.</p></DemoPanel>:<div className="demo-ask-empty"><MessageCircle size={28}/><h2>Get to know the sample project.</h2><p>Choose a question, or ask about sample spend, models, or improvement briefs.</p></div>}<form className="demo-ask-form" onSubmit={submit}><label htmlFor="demo-question">Your sample question</label><div><input id="demo-question" value={draft} onChange={event=>setDraft(event.target.value)} maxLength={600} placeholder="Which models use the most tokens?" autoComplete="off"/><button className="demo-button primary" disabled={!draft.trim()}><Send size={14}/><span>Show sample answer</span></button></div><small>Questions remain in this page's memory. Other topics return a preset-demo explanation.</small></form></div>;
}

function DemoInbox({state,dispatch,go}:DemoViewProps){
  const items=demoNotifications.filter(item=>state.notifications.includes(item.id));
  return <div className="demo-inbox"><ViewHeading title="Inbox" detail="Fictional project notifications. Dismissing one only changes this preview."/><DemoPanel title={`${items.length} sample notification${items.length===1?'':'s'}`}>{items.length?items.map(item=><article className="demo-inbox-item" key={item.id}><span className="demo-inbox-icon"><Inbox size={17}/></span><div><h2>{item.title}</h2><p>{item.body}</p><button className="demo-text-button" onClick={()=>go(item.view)}>Open sample<ArrowRight size={13}/></button></div><button className="demo-icon-button" onClick={()=>dispatch({type:'dismiss-notification',id:item.id})} aria-label={`Dismiss ${item.title}`}><X size={15}/></button></article>):<div className="demo-empty"><Check size={23}/><h2>You're caught up in this preview.</h2><p>Use Reset demo to restore the sample notifications.</p></div>}</DemoPanel></div>;
}

function DemoGovernance({state,dispatch}:DemoViewProps){
  const [budget,setBudget]=useState(String(state.budget)),[retention,setRetention]=useState(state.retention),[maskEmails,setMaskEmails]=useState(state.maskEmails),[blockSecrets,setBlockSecrets]=useState(state.blockSecrets),[saved,setSaved]=useState(false);
  function save(event:FormEvent){event.preventDefault();const parsed=Number(budget);if(!Number.isFinite(parsed)||parsed<0)return;dispatch({type:'set',key:'budget',value:parsed});dispatch({type:'set',key:'retention',value:retention});dispatch({type:'set',key:'maskEmails',value:maskEmails});dispatch({type:'set',key:'blockSecrets',value:blockSecrets});setSaved(true);}
  return <div className="demo-governance"><ViewHeading title="Governance" detail="Preview policy controls. No live policy is applied."/><p className="demo-preview-note"><Shield size={14}/>Preview only · no enforcement, billing, or alerts.</p><form className="demo-settings-form" onSubmit={save} onChange={()=>setSaved(false)}><DemoPanel title="Budget & retention"><label className="demo-field">Monthly budget preview · USD<input required min={0} max={1000000} step="0.01" type="number" value={budget} onChange={event=>setBudget(event.target.value)}/><small>A sample reference value. No payment method or charge.</small></label><label className="demo-field">Retention preview<select value={retention} onChange={event=>setRetention(Number(event.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select><small>Fictional fixtures are not deleted by this preview.</small></label></DemoPanel><DemoPanel title="Guardrail preview"><label className="demo-checkbox"><input type="checkbox" checked={maskEmails} onChange={event=>setMaskEmails(event.target.checked)}/><span><strong>Mask email addresses</strong><small>Preview a masking preference for recorded requests.</small></span></label><label className="demo-checkbox"><input type="checkbox" checked={blockSecrets} onChange={event=>setBlockSecrets(event.target.checked)}/><span><strong>Flag likely secrets</strong><small>A configuration preview, not a live security scanner.</small></span></label></DemoPanel><div className="demo-actions"><button className="demo-button primary"><Check size={14}/>Apply to demo</button>{saved&&<span className="demo-form-feedback" role="status">Preview updated. No live policy applied.</span>}</div></form></div>;
}

function DemoSettings({state,dispatch}:DemoViewProps){
  const [name,setName]=useState(state.projectName),[theme,setTheme]=useState(state.theme),[saved,setSaved]=useState(false);
  useEffect(()=>{setTheme(state.theme);},[state.theme]);
  function save(event:FormEvent){event.preventDefault();const value=name.trim();if(!value)return;dispatch({type:'set',key:'projectName',value});dispatch({type:'set',key:'theme',value:theme});setSaved(true);}
  return <div className="demo-settings"><ViewHeading title="Project settings" detail="Personalize this demo. Your changes are kept only in page memory."/><form className="demo-settings-form" onSubmit={save} onChange={()=>setSaved(false)}><DemoPanel title="Demo project"><label className="demo-field">Project name<input required maxLength={80} value={name} onChange={event=>setName(event.target.value)}/></label><label className="demo-field">Theme<select value={theme} onChange={event=>setTheme(event.target.value==='dark'?'dark':'light')}><option value="light">Light · default</option><option value="dark">Dark</option></select></label></DemoPanel><div className="demo-actions"><button className="demo-button primary">Save demo settings</button>{saved&&<span className="demo-form-feedback" role="status">Updated for this preview. Reloading resets it.</span>}</div></form><DemoPanel title="Use your own workspace"><p>This preview is separate from real accounts and project traffic.</p><div className="demo-actions"><Link className="demo-button primary" to="/signup">Create a workspace<ArrowRight size={13}/></Link><Link className="demo-button" to="/deploy">Deploy your own<ArrowUpRight size={13}/></Link><a className="demo-text-button" href={LANDING_CLI_DOCS} target="_blank" rel="noreferrer">Read the connection guide<ArrowUpRight size={13}/></a></div></DemoPanel></div>;
}

export function DemoWorkspace(props:DemoViewProps){
  switch(props.state.view){
    case 'home':return <DemoHome {...props}/>;
    case 'improvements':return <DemoImprovements {...props}/>;
    case 'sessions':return <DemoSessions {...props}/>;
    case 'ask':return <DemoAsk {...props}/>;
    case 'inbox':return <DemoInbox {...props}/>;
    case 'governance':return <DemoGovernance {...props}/>;
    case 'settings':return <DemoSettings {...props}/>;
    default:return null;
  }
}
