import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, Project } from './types';

export class ApiError extends Error { status:number; constructor(message:string,status:number){super(message);this.status=status;} }
export async function api<T=Record<string,unknown>>(path:string,options:RequestInit={}):Promise<T>{
  const response=await fetch(path,{credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
  const body:unknown=await response.json().catch(()=>({error:'The server returned an unreadable response.'}));
  if(!response.ok){const problem=body&&typeof body==='object'?body as {error?:unknown;message?:unknown}:{};const message=typeof problem.error==='string'?problem.error:typeof problem.message==='string'?problem.message:`Request failed (${response.status}).`;throw new ApiError(message,response.status);}
  return body as T;
}
export const json=(body:unknown,method='POST'):RequestInit=>({method,body:JSON.stringify(body)});
type AppContextValue={session:Session|null;loading:boolean;error:string;reload:()=>Promise<void>;project:Project|null;setProject:(p:Project)=>void;notify:(message:string)=>void};
const AppContext=createContext<AppContextValue|null>(null);
export function AppProvider({children}:{children:ReactNode}){
  const [session,setSession]=useState<Session|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[selected,setSelected]=useState(()=>localStorage.getItem('traqiva-project')||''),[toast,setToast]=useState('');
  const reload=useCallback(async()=>{try{const data=await api<Session>('/api/session');setSession(data);setError('');}catch(e){setError((e as Error).message);}finally{setLoading(false);}},[]);
  useEffect(()=>{void reload();},[reload]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),4200);return()=>clearTimeout(timer);},[toast]);
  const project=session?.projects?.find(p=>p.id===selected)||session?.activeProject||session?.projects?.[0]||null;
  const setProject=(p:Project)=>{setSelected(p.id);localStorage.setItem('traqiva-project',p.id);};
  return <AppContext.Provider value={{session,loading,error,reload,project,setProject,notify:setToast}}>{children}{toast&&<div className="toast" role="status">{toast}</div>}</AppContext.Provider>;
}
export function useApp(){const value=useContext(AppContext);if(!value)throw new Error('App provider missing');return value;}
export function useResource<T>(path:string|null,initial:T){
  const [data,setData]=useState<T>(initial),[loading,setLoading]=useState(!!path),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{let active=true;if(!path){setData(initial);setLoading(false);return;}setLoading(true);setError('');api<T>(path).then(value=>{if(active)setData(value);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[path,revision]);
  return {data,loading,error,refresh:()=>setRevision(v=>v+1)};
}
export const number=(value:number|null|undefined)=>value==null?'—':new Intl.NumberFormat('en',{notation:value>=100000?'compact':'standard',maximumFractionDigits:1}).format(value);
export const money=(value:number|null|undefined)=>value==null?'—':new Intl.NumberFormat('en',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:value>0&&value<0.01?5:2}).format(value);
export const date=(value:string)=>{const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleString('en',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});};
export function download(name:string,value:string,type='text/plain'){const url=URL.createObjectURL(new Blob([value],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
