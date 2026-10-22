import { useEffect,useReducer,useRef,useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight,ArrowRight,BarChart3,Check,ChevronDown,Database,Expand,FlaskConical,FolderGit2,Home,Inbox,LayoutDashboard,ListTree,Menu,MessageCircle,Moon,MoreHorizontal,RotateCcw,Settings2,ShieldCheck,SlidersHorizontal,Sun,Terminal,X } from 'lucide-react';
import { Logo } from '../ui';
import { AGENT_BUILDER_ENABLED } from '../features/agentBuilder';
import { availableDemoView } from './demoFeatures';
import { createDemoState,demoReducer } from './demoState';
import type { DemoView } from './demoData';
import { DemoTraffic } from './DemoTraffic';
import { DemoEvaluate } from './DemoEvaluate';
import { DemoWorkspace } from './DemoWorkspace';
import './demo.css';
import './demo-overview.css';

export const demoTitles:Record<DemoView,string>={home:'Home',gateway:'Gateway',analytics:'Analytics',traces:'Traces',dashboards:'Dashboards',improvements:'Improvements',experiments:'Experiments',datasets:'Datasets',scorers:'Scorers',monitors:'Monitors',reviews:'Reviews',scenarios:'Scenarios','quality-gates':'Quality gates',governance:'Governance',settings:'Settings',sessions:'Developer sessions',ask:'Ask Traqiva',inbox:'Inbox'};
type NavigationItem={view:DemoView;icon:typeof Home};
const traffic:NavigationItem[]=[{view:'gateway',icon:ArrowLeftRight},{view:'analytics',icon:BarChart3},{view:'traces',icon:ListTree},{view:'dashboards',icon:LayoutDashboard}];
const evaluations:NavigationItem[]=[{view:'experiments',icon:FlaskConical},{view:'datasets',icon:Database},{view:'scorers',icon:SlidersHorizontal}];
const advanced:NavigationItem[]=[{view:'monitors',icon:BarChart3},{view:'reviews',icon:Check},{view:'scenarios',icon:FolderGit2},{view:'quality-gates',icon:ShieldCheck}];
const evalViews=new Set<DemoView>([...evaluations,...advanced].map(item=>item.view));
const trafficViews=new Set<DemoView>(traffic.map(item=>item.view));

export default function InteractiveDemo({standalone=false,initialView='home'}:{standalone?:boolean;initialView?:DemoView}){
  const [state,dispatch]=useReducer(demoReducer,initialView,view=>({...createDemoState(),view:availableDemoView(view)}));
  const [navigation,setNavigation]=useState(false),[more,setMore]=useState(false),[workspace,setWorkspace]=useState(false),[groups,setGroups]=useState({Traffic:true,Improve:true,Evaluate:true,Admin:true});
  const main=useRef<HTMLDivElement>(null),frame=useRef<HTMLDivElement>(null),navOpener=useRef<HTMLButtonElement>(null),navClose=useRef<HTMLButtonElement>(null),projectOpener=useRef<HTMLButtonElement>(null);
  function go(view:DemoView){dispatch({type:'navigate',view:availableDemoView(view)});setNavigation(false);setWorkspace(false);if(navigation)requestAnimationFrame(()=>main.current?.focus({preventScroll:true}));}
  function closeNavigation(){setNavigation(false);requestAnimationFrame(()=>navOpener.current?.focus());}
  function reset(){dispatch({type:'reset'});setMore(false);setWorkspace(false);setNavigation(false);setGroups({Traffic:true,Improve:true,Evaluate:true,Admin:true});main.current?.scrollTo({top:0});}
  useEffect(()=>{if(!state.selectedTrace)main.current?.scrollTo({top:0});},[state.view,state.selectedTrace]);
  useEffect(()=>{
    if(!navigation&&!workspace)return;
    if(navigation)navClose.current?.focus();
    function key(event:KeyboardEvent){
      if(event.key==='Escape'){event.preventDefault();setWorkspace(false);setNavigation(false);requestAnimationFrame(()=>{if(navigation)navOpener.current?.focus();else projectOpener.current?.focus();});}
      if(event.key==='Tab'&&navigation){const items=Array.from(frame.current?.querySelectorAll<HTMLElement>('.demo-sidebar a[href],.demo-sidebar button:not(:disabled)')||[]).filter(item=>item.getClientRects().length>0);const first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    }
    function outside(event:PointerEvent){if(workspace&&!frame.current?.querySelector('.demo-project')?.contains(event.target as Node))setWorkspace(false);}
    document.addEventListener('keydown',key);document.addEventListener('pointerdown',outside);return()=>{document.removeEventListener('keydown',key);document.removeEventListener('pointerdown',outside);};
  },[navigation,workspace]);
  const item=({view,icon:Icon}:NavigationItem)=><button type="button" key={view} className={`demo-nav-item ${state.view===view?'active':''}`} aria-current={state.view===view?'page':undefined} onClick={()=>go(view)}><Icon size={14}/><span>{demoTitles[view]}</span></button>;
  function group(label:keyof typeof groups,items:NavigationItem[]){return <section className="demo-nav-group"><button type="button" className="demo-group-label" aria-expanded={groups[label]} onClick={()=>setGroups(previous=>({...previous,[label]:!previous[label]}))}>{label}<ChevronDown size={10}/></button>{groups[label]&&<div>{items.map(item)}{label==='Evaluate'&&<>{more&&advanced.map(item)}<button type="button" className="demo-more" aria-expanded={more} onClick={()=>setMore(!more)}><MoreHorizontal size={14}/>{more?'Less':'More'}</button></>}</div>}</section>;}
  const props={state,dispatch,go};
  return <div ref={frame} className={`demo-window ${standalone?'standalone':''} ${navigation?'demo-nav-open':''}`} data-demo-theme={state.theme} aria-label="Traqiva interactive demo">
    {navigation&&<button className="demo-nav-scrim" aria-label="Close demo navigation" onClick={closeNavigation}/>}
    <aside className="demo-sidebar" aria-label="Demo navigation" role={navigation?'dialog':undefined} aria-modal={navigation?true:undefined}>
      <div className="demo-project"><Logo compact/><button ref={projectOpener} type="button" className="demo-project-toggle" onClick={()=>setWorkspace(!workspace)} aria-expanded={workspace}><span><strong>{state.projectName}</strong><small>sample-prod</small></span><ChevronDown size={11}/></button><button ref={navClose} type="button" className="demo-mobile-close demo-icon" aria-label="Close demo navigation" onClick={closeNavigation}><X size={16}/></button>{workspace&&<div className="demo-project-menu"><span>Fictional workspace</span><button type="button" onClick={()=>go('settings')}><Settings2 size={13}/>Project settings</button><button type="button" onClick={reset}><RotateCcw size={13}/>Reset sample project</button></div>}</div>
      <div className="demo-shortcuts" aria-label="Demo spaces">{([{view:'home',icon:Home},{view:'sessions',icon:Terminal},{view:'ask',icon:MessageCircle},{view:'inbox',icon:Inbox}] as NavigationItem[]).map(({view,icon:Icon})=><button key={view} type="button" title={demoTitles[view]} aria-label={`Demo ${demoTitles[view]}`} aria-pressed={state.view===view} onClick={()=>go(view)}><Icon size={15}/>{view==='inbox'&&<small>{state.notifications.length}</small>}</button>)}</div>
      <nav className="demo-navigation" aria-label="Demo modules">{item({view:'home',icon:Home})}{group('Traffic',traffic)}{group('Improve',[{view:'improvements',icon:SlidersHorizontal},{view:'sessions',icon:Terminal}])}{AGENT_BUILDER_ENABLED&&group('Evaluate',evaluations)}{group('Admin',[{view:'governance',icon:ShieldCheck},{view:'settings',icon:Settings2}])}</nav>
      <Link className="demo-setup-link" to="/signup">Set up your own project<ArrowRight size={14}/></Link>
    </aside>
    <div className="demo-main" inert={navigation?true:undefined}><header className="demo-header"><button ref={navOpener} type="button" className="demo-mobile-open demo-icon" onClick={()=>setNavigation(true)} aria-label="Open demo navigation" aria-expanded={navigation}><Menu size={17}/></button><strong aria-live="polite">{demoTitles[state.view]}</strong><span className="demo-sample-label"><i/>Sample project</span><div><button type="button" className="demo-icon" title="Reset demo" aria-label="Reset demo" onClick={reset}><RotateCcw size={14}/></button><button type="button" className="demo-icon" title={`Use ${state.theme==='light'?'dark':'light'} demo theme`} aria-label={`Use ${state.theme==='light'?'dark':'light'} demo theme`} onClick={()=>dispatch({type:'set',key:'theme',value:state.theme==='light'?'dark':'light'})}>{state.theme==='light'?<Moon size={14}/>:<Sun size={14}/>}</button>{!standalone&&<Link className="demo-icon" to={`/demo?view=${state.view}`} title="Open demo full screen" aria-label="Open demo full screen"><Expand size={14}/></Link>}</div></header>
      <div ref={main} className="demo-content" role="region" tabIndex={-1} aria-label={`${demoTitles[state.view]} demo content`}>
        {trafficViews.has(state.view)?<DemoTraffic {...props}/>:AGENT_BUILDER_ENABLED&&evalViews.has(state.view)?<DemoEvaluate {...props}/>:<DemoWorkspace {...props}/>}
      </div>
      <footer className="demo-footer"><span><i/>Interactive demo · fictional data</span><span>Changes reset on reload</span></footer>
    </div>
  </div>;
}
