import { useEffect,useState,type FormEvent } from 'react';
import { Link,Navigate,useNavigate,useSearchParams } from 'react-router-dom';
import { ArrowLeft,ArrowRight,Box,Check,Code2,LogOut,RefreshCw,ShieldCheck,Terminal } from 'lucide-react';
import { api,date,json,useApp } from './api';
import { Code,ErrorNotice,Logo,Select,Spinner } from './ui';
import { oauthAuthError } from './googleAuth';
import { canFinishSetup,setupProjectFor,setupStageFor,TERMS_VERSION } from './setupState';
import { useConnectionStatus } from './useConnectionStatus';
import type { Project,SetupGoal } from './types';
import type { SetupAssistant } from './setupPrompt';
import AssistantSetupCard from './components/AssistantSetupCard';
import SetupConsent from './components/SetupConsent';
import SetupProjectKey from './components/SetupProjectKey';

export default function Onboarding(){
  const {session,loading,error:sessionError,reload,setProject}=useApp(),navigate=useNavigate();const [params]=useSearchParams();
  const stage=setupStageFor(session),setupProject=session?setupProjectFor(session):null,termsAccepted=session?.terms?.accepted===true;
  const [goals,setGoals]=useState<SetupGoal[]>(['coding']),[name,setName]=useState(''),[busy,setBusy]=useState(''),[error,setError]=useState(''),[editingGoals,setEditingGoals]=useState(false),[consentOpen,setConsentOpen]=useState(false),[assistant,setAssistant]=useState<SetupAssistant>('codex'),[tab,setTab]=useState('cli');
  const connection=useConnectionStatus(stage,setupProject?.id||null,termsAccepted);
  const shownStage=editingGoals?'goals':stage;
  const projectId=setupProject?.id||'<PROJECT_ID>',origin=location.origin;
  useEffect(()=>{document.title='Set up your workspace — Traqiva';},[]);
  useEffect(()=>{if(session?.setup?.goals.length)setGoals(session.setup.goals);},[session?.setup?.stage]);
  useEffect(()=>{setName(setupProject?.name||'My project');},[setupProject?.id,stage]);
  useEffect(()=>{if(setupProject)setProject(setupProject);},[setupProject?.id]);
  useEffect(()=>{if(stage==='connect'){setTab(session?.setup?.goals.includes('coding')?'cli':'api');if(!termsAccepted)setConsentOpen(true);}},[stage,termsAccepted]);

  async function saveGoals(){setBusy('goals');setError('');try{await api('/api/onboarding/goals',json({goals}));await reload();setEditingGoals(false);}catch(e){setError((e as Error).message);}finally{setBusy('');}}
  async function saveProject(event:FormEvent){event.preventDefault();setBusy('project');setError('');try{const result=await api<{project:Project}>('/api/onboarding/project',json({name:name.trim()}));await reload();setProject(result.project);}catch(e){setError((e as Error).message);}finally{setBusy('');}}
  async function finish(skip:boolean){if(!termsAccepted||(!skip&&!canFinishSetup(connection.status,termsAccepted)))return;setBusy(skip?'skip':'complete');setError('');try{await api('/api/onboarding/complete',json({skip_connection:skip}));await reload();navigate('/app/home',{replace:true});}catch(e){setError((e as Error).message);}finally{setBusy('');}}
  async function logout(){setBusy('logout');try{await api('/api/auth/logout',json({}));await reload();navigate('/login',{replace:true});}catch(e){setError((e as Error).message);setBusy('');}}
  if(loading)return <div className="loading-screen"><Spinner/><span>Opening setup…</span></div>;
  if(sessionError)return <div className="loading-screen"><ErrorNotice message={sessionError} retry={()=>void reload()}/></div>;
  if(!session?.user)return <Navigate to="/login" replace/>;
  if(stage==='complete')return <Navigate to="/app/home" replace/>;

  const sdk=`import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "${origin}/v1",
  defaultHeaders: { "x-traqiva-key": process.env.TRAQIVA_KEY }
});

// Use a model available in your own provider account.
const result = await client.chat.completions.create({
  model: "YOUR_PROVIDER_MODEL",
  messages: [{ role: "user", content: "Hello, Traqiva." }]
});`;
  return <div className="onboarding-page setup-wizard"><header><Link to="/"><Logo/></Link><div className="setup-user"><span>Signed in as <strong>{session.user.email}</strong></span><button className="text-button" onClick={()=>void logout()} disabled={!!busy}>{busy==='logout'?<Spinner/>:<LogOut size={13}/>}Sign out</button></div></header>
    <main className={`onboarding-main ${shownStage==='connect'?'setup-connect-main':''}`}>
      <div className="onboarding-step">Step {shownStage==='goals'?1:shownStage==='project'?2:3} of 3</div>
      <h1>{shownStage==='goals'?'What do you want to do?':shownStage==='project'?'Give your project a home.':session.setup?.goals.includes('coding')?'Set up your coding agent.':'Connect your application.'}</h1>
      <p>{shownStage==='goals'?'Choose one or both. Setup only asks for what you need.':shownStage==='project'?'Keep your requests, evaluations, and insights together.':'Connect this project and add tools you can verify.'}</p>
      <ErrorNotice message={error||oauthAuthError(params.get('oauth_error'),params.get('oauth_provider'))}/>

      {shownStage==='goals'&&<><div className="goal-grid">{[{id:'coding' as SetupGoal,icon:Terminal,title:'Spend less on coding agents',description:'Connect the coding agents you use. Inspect token usage and test recoverable context compression.'},{id:'observe' as SetupGoal,icon:Box,title:'Build more efficient agents',description:'Trace agents in your own code. Understand their quality, costs, and opportunities to improve.'}].map(goal=><button key={goal.id} aria-pressed={goals.includes(goal.id)} className={`goal-option ${goals.includes(goal.id)?'selected':''}`} onClick={()=>setGoals(values=>values.includes(goal.id)?values.filter(value=>value!==goal.id):[...values,goal.id])} disabled={!!busy}><span className="goal-check">{goals.includes(goal.id)&&<Check size={13}/>}</span><goal.icon size={42} strokeWidth={1.2}/><h3>{goal.title}</h3><p>{goal.description}</p></button>)}</div><button className="button primary onboarding-next" disabled={!goals.length||!!busy} onClick={()=>void saveGoals()}>{busy==='goals'?<Spinner/>:<>Continue<ArrowRight size={16}/></>}</button></>}

      {shownStage==='project'&&<form className="onboarding-form" onSubmit={saveProject}><label className="field">Project name<input required maxLength={100} value={name} onChange={event=>setName(event.target.value)} autoFocus disabled={!!busy}/></label><div className="notice"><Code2 size={18}/><span>{setupProject?'This uses your existing project. Its data and identity stay intact.':'Start with one project. You can add more later.'}</span></div><button className="button primary full-width" disabled={!name.trim()||!!busy}>{busy==='project'?<Spinner/>:<>Continue<ArrowRight size={16}/></>}</button><button type="button" className="text-button onboarding-back" onClick={()=>setEditingGoals(true)} disabled={!!busy}><ArrowLeft size={14}/>Back to your goals</button></form>}

      {shownStage==='connect'&&<div className="setup-connect-content">
        {!termsAccepted?<section className="setup-consent-required"><ShieldCheck size={28}/><h2>Review your workspace terms</h2><p>Accept the current terms before creating a key or connecting an agent.</p><button className="button primary" onClick={()=>setConsentOpen(true)}>Review terms<ArrowRight size={15}/></button></section>:<>
          <div className="setup-agent-picker"><span>I use</span><Select value={assistant} onChange={value=>setAssistant(value as SetupAssistant)} label="Coding assistant"><option value="codex">Codex</option><option value="claude">Claude Code</option></Select><span>for <strong>{setupProject?.name}</strong></span></div>
          <div className={`setup-connection-state ${connection.status?.connected?'connected':''}`} role="status"><span className="setup-connection-dot"/><div><strong>{connection.status?.connected?'Project connection verified':!connection.online?'You’re offline':connection.checking?'Checking your connection…':'Waiting for your connection'}</strong><small>{connection.status?.connected?connection.status.method==='traffic'?'Actual request traffic was received.':connection.status.method==='compression'?'A compression event was received.':'Your project key was used to connect.':!connection.online?'Checks resume when you’re online.':'Use the instructions below. This updates after a real connection.'}{connection.status?.last_activity_at&&` · ${date(connection.status.last_activity_at)}`}</small></div><button className="icon-button" aria-label="Check connection now" onClick={connection.refresh} disabled={connection.checking||!connection.online}>{connection.checking?<Spinner/>:<RefreshCw size={15}/>}</button></div>
          <ErrorNotice message={connection.error} retry={connection.refresh}/>
          {setupProject&&<SetupProjectKey key={setupProject.id} projectId={setupProject.id}/>}
          {setupProject&&<AssistantSetupCard origin={origin} project={setupProject} assistant={assistant} onAssistantChange={setAssistant} showAssistantSelector={false} compact/>}
          <div className="tabs setup-connection-tabs"><button className={tab==='cli'?'active':''} onClick={()=>setTab('cli')}><Terminal size={15}/>Coding agent</button><button className={tab==='api'?'active':''} onClick={()=>setTab('api')}><Code2 size={15}/>API / SDK</button></div>
          {tab==='cli'?<div className="setup-manual-guide"><h2>Or set up from your terminal</h2><p>Requires Node.js 22.13 or newer. These commands install the local client, not a new website.</p><Code>{`npm install --global ${origin}/downloads/traqiva-cli-0.1.0.tgz`}</Code><p>Enter your project key privately in a local terminal. The command below intentionally keeps a placeholder.</p><Code>{`traqiva connect --url ${origin} --project ${projectId} --key <PRIVATE_PROJECT_KEY>\ntraqiva status`}</Code><p>Install the optional native engine, then print the MCP configuration for your assistant.</p><Code>{`traqiva engine install --url ${origin}\ntraqiva engine status\ntraqiva setup --agent ${assistant} --print`}</Code><div className="notice subtle"><ShieldCheck size={17}/><span>The setup command prints configuration; merge only the Traqiva MCP entry and preserve existing settings. Restart your assistant if needed. Tools are available when invoked; this does not intercept an existing desktop chat or prove token savings.</span></div><Link className="text-button" to="/deploy" target="_blank">Want to host the website yourself? Open the separate deployment guide<ArrowRight size={13}/></Link></div>:<div className="setup-manual-guide"><h2>Point your API client to Traqiva</h2><p>Use your own provider account and model. Keep both API keys in your server environment, never browser code.</p><Code>{sdk}</Code><div className="notice subtle"><ShieldCheck size={17}/><span>Sending a provider request may incur that provider’s charges. Run it only when you choose to. A real Traces record and reported usage are needed before drawing conclusions about costs.</span></div></div>}
          <div className="setup-finish"><button className="button primary full-width" disabled={!canFinishSetup(connection.status,termsAccepted)||!!busy} onClick={()=>void finish(false)}>{busy==='complete'?<Spinner/>:<>Continue to workspace<ArrowRight size={16}/></>}</button><button className="text-button" disabled={!!busy} onClick={()=>void finish(true)}>{busy==='skip'?<Spinner/>:'Skip for now'}</button><p>Skipping opens an empty workspace. You can connect later.</p></div>
        </>}
      </div>}
      <div className="step-dots">{['goals','project','connect'].map(value=><span className={value===shownStage?'active':''} key={value}/>)}</div>
    </main>
    {stage==='connect'&&!termsAccepted&&consentOpen&&<SetupConsent version={session.terms?.version||TERMS_VERSION} onClose={()=>setConsentOpen(false)}/>}
  </div>;
}
