import { useId,useRef,useState,type KeyboardEvent } from 'react';
import { KeyRound,Sparkles,Terminal } from 'lucide-react';
import { buildUniversalSetupPrompt,type TerminalShell } from '../setupPrompt';
import type { Project } from '../types';
import { CopyButton,Modal } from '../ui';
import SetupProjectKey from './SetupProjectKey';
import CompactAgentSetup from './CompactAgentSetup';

const methods=[{id:'ai',label:'Ask AI',icon:Sparkles},{id:'terminal',label:'Terminal',icon:Terminal}] as const;

export default function AgentSetupPrompt({origin,project}:{origin:string;project:Project}){
  const [keyOpen,setKeyOpen]=useState(false);
  const [method,setMethod]=useState<'ai'|'terminal'>('ai');
  const [shell,setShell]=useState<TerminalShell>(()=>typeof navigator!=='undefined'&&/Win/i.test(navigator.platform)?'windows':'posix');
  const keyBusy=useRef(false);
  const tabs=useRef<(HTMLButtonElement|null)[]>([]),id=useId();
  const prompt=buildUniversalSetupPrompt(origin,project);
  function moveTab(event:KeyboardEvent<HTMLButtonElement>,index:number){
    const next=event.key==='Home'?0:event.key==='End'?methods.length-1:event.key==='ArrowRight'?(index+1)%methods.length:event.key==='ArrowLeft'?(index+methods.length-1)%methods.length:null;
    if(next===null)return;event.preventDefault();setMethod(methods[next].id);tabs.current[next]?.focus();
  }
  return <section className="setup-agent-prompt" aria-label="Agent setup methods">
    <div className="setup-method-tabs" role="tablist" aria-label="Setup method">{methods.map((item,index)=><button key={item.id} id={`${id}-${item.id}`} role="tab" aria-selected={method===item.id} aria-controls={`${id}-panel`} tabIndex={method===item.id?0:-1} ref={node=>{tabs.current[index]=node;}} onKeyDown={event=>moveTab(event,index)} onClick={()=>setMethod(item.id)}><item.icon size={15}/>{item.label}</button>)}</div>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${method}`}>
      {method==='ai'?<><p className="setup-prompt-intro">Copy this prompt into Codex or Claude Code to connect <strong>{project.name}</strong>.</p><pre className="setup-prompt-code" tabIndex={0} aria-label="Setup prompt">{prompt}</pre></>:<CompactAgentSetup origin={origin} projectId={project.id} shell={shell} onShellChange={setShell}/>}
    </div>
    <div className="setup-prompt-actions">{method==='ai'?<CopyButton value={prompt} label="Copy setup prompt"/>:<a className="text-button" href={`${origin}/agent-setup.md`} target="_blank" rel="noreferrer">Setup guide ↗</a>}<button className="text-button" aria-haspopup="dialog" onClick={()=>setKeyOpen(true)}><KeyRound size={14}/>Project key</button></div>
    <p className="setup-prompt-note">{method==='ai'?'Works in desktop apps with local tool access. Enter your project key privately during setup.':'Requires Node.js 22.13+. Restart or reconnect your agent after MCP setup.'}</p>
    {keyOpen&&<Modal title="Project key" onClose={()=>{if(!keyBusy.current)setKeyOpen(false);}}><SetupProjectKey projectId={project.id} onBusyChange={busy=>{keyBusy.current=busy;}}/></Modal>}
  </section>;
}
