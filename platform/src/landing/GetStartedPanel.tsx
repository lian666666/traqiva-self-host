import { useEffect,useRef,useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight,ArrowUpRight,Check,Copy,X } from 'lucide-react';
import { useApp } from '../api';
import { AGENT_BUILDER_ENABLED } from '../features/agentBuilder';
import { installCommand,LANDING_CLI_DOCS } from './content';

export default function GetStartedPanel({origin,onClose}:{origin:string;onClose:(restoreFocus?:boolean)=>void}){
  const {session,notify}=useApp();const panel=useRef<HTMLDivElement>(null);const [copied,setCopied]=useState(false),[copyError,setCopyError]=useState(false);const command=installCommand(origin);
  useEffect(()=>{
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside=(event:PointerEvent)=>{const target=event.target as Element;if(!panel.current?.contains(target)&&!target.closest('[data-landing-start]'))onClose(false);};
    const keyboard=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();onClose(true);return;}
    };
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',keyboard);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',keyboard);};
  },[onClose]);
  useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(false),3500);return()=>clearTimeout(timer);},[copied]);
  async function copy(){try{await navigator.clipboard.writeText(command);setCopied(true);setCopyError(false);notify('Quickstart command copied.');}catch{setCopied(false);setCopyError(true);notify('Clipboard unavailable. Select and copy the command.');}}
  return <div ref={panel} className="landing-start-panel" role="dialog" aria-labelledby="landing-start-title" aria-describedby="landing-start-description"><div className="landing-start-top"><div><strong id="landing-start-title">Get started</strong><p id="landing-start-description">Free. Pick where to start.</p></div><button className="landing-icon-button" onClick={()=>onClose(true)} aria-label="Close get started"><X size={18}/></button></div><div className="landing-start-columns"><section><div className="landing-product-name">TRAQIVA CLI</div><h2>Agents you run.</h2><p>Codex and Claude Code. One command guides you through local setup.</p><button className="landing-install-command" onClick={()=>void copy()} aria-label="Copy CLI quickstart command" title={copied?'Copied':'Copy command'}><code>{command}</code><span aria-hidden="true">{copied?<Check size={16}/>:<Copy size={16}/>}</span></button><div className="landing-copy-state" role="status">{copied?'Copied. Paste it in your terminal.':copyError?'Select the command above and copy it manually.':'Copy. Paste it in your terminal.'}</div><p className="landing-start-note">Node.js 22.13+. No global install.</p><footer><span>Runs locally · no account.</span><a className="landing-text-link" href={LANDING_CLI_DOCS} target="_blank" rel="noreferrer">Setup guide<ArrowUpRight size={13}/></a></footer></section><section><div className="landing-product-name">{AGENT_BUILDER_ENABLED?'TRAQIVA CLOUD':'TRAQIVA WORKSPACE'}</div><h2>{AGENT_BUILDER_ENABLED?'Agents you build.':'Coding workspace.'}</h2><p>{AGENT_BUILDER_ENABLED?'Understand your requests, usage, and costs in one clear workspace.':'Keep your coding sessions, recorded requests and token usage together.'}</p><Link className="landing-button landing-button-dark landing-cloud-signup" to={session?.user?'/app/home':'/signup'}>{session?.user?'Open your workspace':'Create your account'}<ArrowRight size={16}/></Link><p className="landing-start-note">Your provider. Your model.<br/>Provider usage is billed separately.</p><footer><Link className="landing-text-link" to="/deploy">Self-host<ArrowUpRight size={13}/></Link><a className="landing-text-link" href="#pricing" onClick={()=>onClose(false)}>Pricing<ArrowRight size={13}/></a></footer></section></div></div>;
}
