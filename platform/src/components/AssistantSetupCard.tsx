import { useEffect,useRef,useState } from 'react';
import { Check,ChevronDown,Copy,MessageCircle,ShieldCheck } from 'lucide-react';
import { useApp } from '../api';
import { buildSetupPrompt,type SetupAssistant } from '../setupPrompt';
import type { Project } from '../types';

export default function AssistantSetupCard({origin,project:providedProject,assistant:providedAssistant,onAssistantChange,showAssistantSelector=true,compact=false}:{origin:string;project?:Project;assistant?:SetupAssistant;onAssistantChange?:(assistant:SetupAssistant)=>void;showAssistantSelector?:boolean;compact?:boolean}){
  const {project:activeProject,notify}=useApp();const project=providedProject||activeProject;
  const [localAssistant,setLocalAssistant]=useState<SetupAssistant>('codex'),[feedback,setFeedback]=useState<'copied'|'failed'|''>('');const assistant=providedAssistant||localAssistant;
  function chooseAssistant(value:SetupAssistant){setLocalAssistant(value);onAssistantChange?.(value);setFeedback('');}
  const preview=useRef<HTMLDetailsElement>(null);
  const prompt=project?buildSetupPrompt(assistant,origin,project):'';
  useEffect(()=>{setFeedback('');},[assistant,project?.id,project?.name]);
  useEffect(()=>{if(!feedback)return;const timer=setTimeout(()=>setFeedback(''),5000);return()=>clearTimeout(timer);},[feedback]);
  async function copy(){try{await navigator.clipboard.writeText(prompt);setFeedback('copied');notify('Setup prompt copied. Paste it into your AI assistant.');}catch{setFeedback('failed');if(preview.current)preview.current.open=true;notify('Clipboard unavailable. Select and copy the prompt from the preview.');}}
  return <section className={`assistant-setup-card ${compact?'compact-setup-card':''}`} aria-labelledby="assistant-setup-title"><div className="assistant-setup-heading"><span className="assistant-setup-icon"><MessageCircle size={21}/></span><div><h2 id="assistant-setup-title">Let your AI handle setup</h2><p>Choose your assistant, copy the prompt, and paste it into a new chat. It will guide the local installation for this project.</p></div></div><div className="assistant-setup-actions">{showAssistantSelector&&<label className="assistant-choice">Your assistant<span className="select-wrap"><select value={assistant} onChange={e=>{chooseAssistant(e.target.value as SetupAssistant);}} aria-label="Setup assistant"><option value="codex">Codex</option><option value="claude">Claude Code</option></select><ChevronDown size={14}/></span></label>}<button className="button primary" onClick={()=>void copy()} disabled={!project}>{feedback==='copied'?<Check size={15}/>:<Copy size={15}/>}Copy setup prompt</button><span className={`assistant-copy-feedback ${feedback==='failed'?'failed':''}`} role="status">{feedback==='copied'?'Copied. Ready to paste.':feedback==='failed'?'Select and copy the preview below.':''}</span></div><details className="assistant-prompt-preview" ref={preview}><summary>Preview setup prompt<ChevronDown size={14}/></summary><pre tabIndex={0}>{prompt||'Create or select a project to generate its setup prompt.'}</pre></details><p className="assistant-setup-note"><ShieldCheck size={13}/><span>Includes this project’s address and ID. No API key is copied. Enter your key privately during setup.</span></p></section>;
}
