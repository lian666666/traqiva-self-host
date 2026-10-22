import { useRef,useState } from 'react';
import { KeyRound } from 'lucide-react';
import { buildUniversalSetupPrompt } from '../setupPrompt';
import type { Project } from '../types';
import { CopyButton,Modal } from '../ui';
import SetupProjectKey from './SetupProjectKey';

export default function AgentSetupPrompt({origin,project}:{origin:string;project:Project}){
  const [keyOpen,setKeyOpen]=useState(false);
  const keyBusy=useRef(false);
  const prompt=buildUniversalSetupPrompt(origin,project);
  return <section className="setup-agent-prompt" aria-label="AI setup prompt">
    <p className="setup-prompt-intro">Copy this prompt into Codex or Claude Code to connect <strong>{project.name}</strong>.</p>
    <pre tabIndex={0} aria-label="Setup prompt">{prompt}</pre>
    <div className="setup-prompt-actions"><CopyButton value={prompt} label="Copy setup prompt"/><button className="text-button" aria-haspopup="dialog" onClick={()=>setKeyOpen(true)}><KeyRound size={14}/>Project key</button></div>
    <p className="setup-prompt-note">Works in desktop apps with local tool access. Enter your project key privately during setup.</p>
    {keyOpen&&<Modal title="Project key" onClose={()=>{if(!keyBusy.current)setKeyOpen(false);}}><SetupProjectKey projectId={project.id} onBusyChange={busy=>{keyBusy.current=busy;}}/></Modal>}
  </section>;
}
