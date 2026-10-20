import { useEffect,useRef,useState,type FormEvent,type MouseEvent } from 'react';
import { NavLink,Outlet,useLocation,useNavigate } from 'react-router-dom';
import { ArrowLeftRight,ArrowRight,ArrowUpRight,BarChart3,Box,Check,ChevronDown,CircleHelp,FlaskConical,Home,Inbox,LayoutDashboard,ListTree,LogOut,Menu,MessageCircle,Moon,Plus,Settings2,Shield,SlidersHorizontal,Sun,Terminal,Users,Wallet,X } from 'lucide-react';
import { api,json,useApp } from './api';
import { ErrorNotice,Logo,Modal,Spinner } from './ui';
import type { Project } from './types';
import { useConnectionStatus } from './useConnectionStatus';
import './shell-reference.css';

const products=[{name:'Observability',detail:'Agents you build',icon:Box,path:'/app/home'},{name:'Evals',detail:'Answer quality',icon:FlaskConical,path:'/app/evals'},{name:'Developer insights',detail:'Coding agents you use',icon:Terminal,path:'/app/developers'},{name:'Admin',detail:'Keys, access, billing',icon:Shield,path:'/app/admin'}];
const pageNames:Record<string,[string,string]>={home:['Overview','Home'],gateway:['Traffic','Gateway'],analytics:['Traffic','Analytics'],traces:['Traffic','Traces'],dashboards:['Traffic','Dashboards'],improvements:['Improve','Improvements'],evals:['Evaluate','Evals'],developers:['Improve','Developer insights'],admin:['Admin','Workspace settings'],ask:['Assistant','Ask Traqiva'],inbox:['Workspace','Inbox'],billing:['Admin','Billing'],connect:['Setup','Connect an agent']};
const navGroups=[{id:'traffic',label:'Traffic',items:[{path:'gateway',label:'Gateway',icon:ArrowLeftRight},{path:'analytics',label:'Analytics',icon:BarChart3},{path:'traces',label:'Traces',icon:ListTree},{path:'dashboards',label:'Dashboards',icon:LayoutDashboard}]},{id:'improve',label:'Improve',items:[{path:'improvements',label:'Improvements',icon:SlidersHorizontal},{path:'developers',label:'Developer insights',icon:Terminal}]},{id:'evaluate',label:'Evaluate',items:[{path:'evals',label:'Evaluations',icon:FlaskConical}]},{id:'admin',label:'Admin',items:[{path:'admin',label:'Workspace settings',icon:Shield},{path:'billing',label:'Billing',icon:Wallet}]}];

export default function Shell(){
  const {session,project,setProject,reload,notify}=useApp();const location=useLocation(),navigate=useNavigate();
  const [menu,setMenu]=useState<''|'workspace'|'products'>(''),[mobile,setMobile]=useState(false),[newProject,setNewProject]=useState(false),[projectName,setProjectName]=useState(''),[busy,setBusy]=useState(false),[signingOut,setSigningOut]=useState(false),[error,setError]=useState(''),[groups,setGroups]=useState<Record<string,boolean>>({traffic:true,improve:true,evaluate:true,admin:true});
  const [dark,setDark]=useState(()=>{try{return localStorage.getItem('traqiva-theme')==='dark';}catch{return false;}});
  const menuRegion=useRef<HTMLDivElement>(null),sidebar=useRef<HTMLElement>(null),menuOpener=useRef<HTMLButtonElement|null>(null),mobileOpener=useRef<HTMLButtonElement>(null),mobileClose=useRef<HTMLButtonElement>(null);
  const route=location.pathname.split('/')[2]||'home';const [category,title]=pageNames[route]||['Workspace','Home'];
  const product=route==='evals'?products[1]:route==='developers'?products[2]:/admin|billing/.test(route)?products[3]:products[0];
  // The status endpoint is scoped to the server-selected setup project, not an arbitrary active project.
  const statusProject=project&&project.id===session?.setup?.project_id?project.id:null;
  const {status,checking,error:connectionError,online}=useConnectionStatus('connect',statusProject,session?.terms?.accepted===true);
  const connected=Boolean(statusProject&&status?.connected);
  const connectionLabel=!online?'Offline':connectionError?'Status unavailable':!statusProject?'Connection unconfirmed':checking&&!status?'Checking connection':connected?'Connection recorded':'Not connected';
  const connectionDetail=connected?`Server evidence: ${status?.method?.replace('_',' ')}${status?.last_activity_at?` · ${new Date(status.last_activity_at).toLocaleString()}`:''}. This is recorded activity, not a live-session indicator.`:!statusProject?'Connection status is available for the project selected during setup. Open the connection guide for this project.':connectionError||'Connect an agent or application to record real project activity.';

  useEffect(()=>{document.documentElement.dataset.theme=dark?'dark':'light';try{localStorage.setItem('traqiva-theme',dark?'dark':'light');}catch{/* The selected theme still works when browser storage is unavailable. */}},[dark]);
  useEffect(()=>{setMobile(false);setMenu('');},[location.pathname,location.hash]);
  useEffect(()=>{const query=window.matchMedia('(max-width: 760px)');function layoutChanged(event:MediaQueryListEvent){const focusWasInSidebar=sidebar.current?.contains(document.activeElement);setMobile(false);setMenu('');if(focusWasInSidebar)requestAnimationFrame(()=>{if(event.matches)mobileOpener.current?.focus();else menuRegion.current?.querySelector<HTMLButtonElement>('.reference-workspace-switch')?.focus();});}query.addEventListener('change',layoutChanged);return()=>query.removeEventListener('change',layoutChanged);},[]);
  useEffect(()=>{document.title=`${title} — Traqiva`;},[title]);
  useEffect(()=>{if(!mobile)return;mobileClose.current?.focus();const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous;};},[mobile]);
  useEffect(()=>{
    if(!menu&&!mobile)return;
    const timer=menu?requestAnimationFrame(()=>menuRegion.current?.querySelector<HTMLButtonElement>(`[data-shell-popover="${menu}"] button:not(:disabled)`)?.focus()):null;
    function outside(event:PointerEvent){if(menu&&!menuRegion.current?.contains(event.target as Node))setMenu('');}
    function keyboard(event:KeyboardEvent){
      if(newProject)return;
      if(event.key==='Escape'){
        event.preventDefault();
        if(menu){setMenu('');requestAnimationFrame(()=>menuOpener.current?.focus());}
        else if(mobile){setMobile(false);requestAnimationFrame(()=>mobileOpener.current?.focus());}
        return;
      }
      if(event.key==='Tab'&&mobile&&sidebar.current&&!newProject){const focusable=Array.from(sidebar.current.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input')).filter(element=>element.getClientRects().length>0);const first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    }
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',keyboard);
    return()=>{if(timer!==null)cancelAnimationFrame(timer);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',keyboard);};
  },[menu,mobile,newProject]);

  function toggleMenu(name:'workspace'|'products',event:MouseEvent<HTMLButtonElement>){menuOpener.current=event.currentTarget;setMenu(value=>value===name?'':name);}
  function closeMobile(){setMenu('');setMobile(false);requestAnimationFrame(()=>mobileOpener.current?.focus());}
  function go(path:string){setMenu('');navigate(path);}
  async function signOut(){setSigningOut(true);try{await api('/api/auth/logout',json({}));await reload();navigate('/login');}catch(e){notify((e as Error).message);}finally{setSigningOut(false);}}
  async function createProject(event:FormEvent){event.preventDefault();setBusy(true);setError('');try{const result=await api<{project:Project}>('/api/projects',json({name:projectName}));await reload();setProject(result.project);setNewProject(false);setProjectName('');notify('Project created.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const link=(path:string,label:string,Icon:typeof Home)=><NavLink key={path} className={({isActive})=>`nav-item ${isActive?'active':''}`} to={`/app/${path}`}><Icon size={15} strokeWidth={1.65}/><span>{label}</span></NavLink>;

  return <div className={`app-shell reference-shell ${mobile?'sidebar-open':''}`}>
    {mobile&&<button aria-label="Close navigation" className="sidebar-scrim" onClick={closeMobile}/>}
    <aside className="sidebar" ref={sidebar} aria-label="Workspace navigation" role={mobile?'dialog':undefined} aria-modal={mobile?true:undefined}>
      <div className="reference-workspace-region" ref={menuRegion}>
        <div className="reference-workspace-row">
          <NavLink className="reference-brand" to="/" aria-label="Traqiva homepage"><Logo compact/></NavLink>
          <button className="workspace-switch reference-workspace-switch" aria-expanded={menu==='workspace'} aria-controls="reference-workspace-menu" onClick={event=>toggleMenu('workspace',event)}><span><strong>{session?.workspace?.name||'Personal workspace'}</strong><small>{project?.name||'Select a project'}</small></span><ChevronDown size={12}/></button>
          <button className="reference-product-trigger" aria-label={`Switch product. Current product: ${product.name}`} aria-expanded={menu==='products'} aria-controls="reference-product-menu" onClick={event=>toggleMenu('products',event)} title={product.name}><product.icon size={17} strokeWidth={1.65}/></button>
          <button ref={mobileClose} className="icon-button reference-mobile-close" onClick={closeMobile} aria-label="Close navigation"><X size={17}/></button>
        </div>
        {menu==='workspace'&&<div id="reference-workspace-menu" className="dropdown-menu workspace-menu" data-shell-popover="workspace"><div className="dropdown-label">Projects</div>{session?.projects.map(item=><button key={item.id} aria-current={item.id===project?.id?'true':undefined} onClick={()=>{setProject(item);setMenu('');}}><Box size={15}/><span>{item.name}</span>{item.id===project?.id&&<Check size={14}/>}</button>)}<button onClick={()=>{setMenu('');setNewProject(true);}}><Plus size={15}/>New project</button><button onClick={()=>go('/app/connect')}><Terminal size={15}/>Connect coding agent</button><div className="menu-divider"/><div className="dropdown-label">Organization</div><button onClick={()=>go('/app/admin')}><Settings2 size={15}/>Organization settings</button><button onClick={()=>go('/app/admin#team')}><Users size={15}/>Team</button><button onClick={()=>go('/app/billing')}><Wallet size={15}/>Billing</button><div className="menu-divider"/><div className="account-summary"><span className="avatar">{session?.user?.name?.slice(0,1).toUpperCase()||'T'}</span><span><strong>{session?.user?.name}</strong><small>{session?.user?.email}</small></span></div><button onClick={()=>setDark(!dark)}>{dark?<Sun size={15}/>:<Moon size={15}/>}Switch to {dark?'light':'dark'} theme</button><button className="danger-text" disabled={signingOut} onClick={()=>void signOut()}><LogOut size={15}/>{signingOut?'Signing out…':'Sign out'}</button></div>}
        {menu==='products'&&<div id="reference-product-menu" className="dropdown-menu products-menu" data-shell-popover="products"><div className="dropdown-label">Products</div>{products.map(item=><button key={item.name} onClick={()=>go(item.path)}><span className="product-icon"><item.icon size={17}/></span><span><strong>{item.name}</strong><small>{item.detail}</small></span>{product.name===item.name&&<Check size={14}/>}</button>)}</div>}
      </div>
      <div className="reference-quick-actions" role="group" aria-label="Quick actions">{[{path:'home',label:'Home',icon:Home},{path:'connect',label:'Connect an agent',icon:Terminal},{path:'ask',label:'Ask Traqiva',icon:MessageCircle},{path:'inbox',label:'Inbox',icon:Inbox}].map(item=><NavLink key={item.path} to={`/app/${item.path}`} className={({isActive})=>isActive?'active':''} aria-label={item.label} title={item.label}><item.icon size={15} strokeWidth={1.65}/></NavLink>)}</div>
      <nav className="sidebar-nav" aria-label="Main navigation">
        {link('home','Home',Home)}
        {navGroups.map(group=><div className="reference-nav-group" key={group.id}><button className="reference-group-toggle" aria-expanded={groups[group.id]} aria-controls={`reference-group-${group.id}`} onClick={()=>setGroups(previous=>({...previous,[group.id]:!previous[group.id]}))}>{group.label}<ChevronDown size={10}/></button><div id={`reference-group-${group.id}`} hidden={!groups[group.id]}>{group.items.map(item=>link(item.path,item.label,item.icon))}</div></div>)}
      </nav>
      <div className="sidebar-bottom"><NavLink className="reference-setup-strip" to="/app/connect"><span>{connected?<Check size={13}/>:<Terminal size={13}/>}<strong>{connected?'Manage connection':'Set up this project'}</strong></span><ArrowRight size={13}/></NavLink><div className="sidebar-footer"><NavLink title="Documentation and setup" aria-label="Documentation and setup" to="/app/connect"><CircleHelp size={15}/></NavLink><button onClick={()=>setDark(!dark)} title={`Switch to ${dark?'light':'dark'} theme`} aria-label={`Switch to ${dark?'light':'dark'} theme`}>{dark?<Moon size={15}/>:<Sun size={15}/>}<span>{dark?'Dark':'Light'}</span></button></div></div>
    </aside>
    <main className="app-main" inert={mobile?true:undefined}><header className="app-header"><div className="breadcrumb"><button ref={mobileOpener} className="icon-button reference-mobile-open" onClick={()=>setMobile(true)} aria-label="Open navigation" aria-expanded={mobile}><Menu size={18}/></button>{route!=='home'&&<><span>{category}</span><span className="breadcrumb-slash">/</span></>}<strong>{title}</strong></div><div className="header-actions"><span className={`reference-connection-state ${connected?'has-evidence':''}`} title={connectionDetail}><i/>{connectionLabel}</span><button className="button secondary compact reference-connect-button" onClick={()=>navigate('/app/connect')}><Terminal size={13}/><span>Connect</span></button></div></header><div className="app-content" key={project?.id}><Outlet/></div><footer className="app-bottom-bar"><span><span className="tiny-logo">T</span> Your data. Your models. Your workspace.</span><button onClick={()=>navigate('/app/ask')}><MessageCircle size={12}/>Ask Traqiva<ArrowUpRight size={11}/></button></footer></main>
    {newProject&&<Modal title="Create a project" onClose={()=>setNewProject(false)}><form onSubmit={createProject}><p className="muted">Keep each agent or application’s traffic in its own project.</p><label className="field">Project name<input required maxLength={80} value={projectName} onChange={event=>setProjectName(event.target.value)} placeholder="e.g. Customer support agent"/></label><ErrorNotice message={error}/><div className="form-actions"><button className="button secondary" type="button" onClick={()=>setNewProject(false)}>Cancel</button><button className="button primary" disabled={busy}>{busy?<Spinner/>:<Plus size={15}/>}Create project</button></div></form></Modal>}
  </div>;
}
