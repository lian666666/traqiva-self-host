import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Maximize2, Minimize2, Minus, X } from 'lucide-react';
import { Logo, Spinner } from '../ui';
import './traqiva-ai-dock.css';

const EmbeddedAsk = lazy(() => import('../pages/Ask').then(module => ({ default: module.AskWorkspace })));
export default function TraqivaAiDock() {
  const [open, setOpen] = useState(false), [mounted, setMounted] = useState(false), [expanded, setExpanded] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null), panel = useRef<HTMLElement>(null);
  function hide() { setOpen(false); setExpanded(false); launcher.current?.focus(); }
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    window.dispatchEvent(new Event('traqiva-ask-opened'));
    function keyboard(event: KeyboardEvent) { if (event.key === 'Escape' && panel.current?.contains(event.target as Node)) { setOpen(false); setExpanded(false); launcher.current?.focus(); } }
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, [open]);
  return <>
    <button ref={launcher} className="traqiva-ai-launcher" aria-expanded={open} aria-controls="traqiva-ai-panel" onClick={() => { if (open) hide(); else { setMounted(true); setOpen(true); } }}><Logo compact/>Traqiva AI</button>
    {mounted && <section ref={panel} id="traqiva-ai-panel" className={`traqiva-ai-dock ${expanded ? 'expanded' : ''}`} hidden={!open} role="dialog" aria-label="Traqiva AI" tabIndex={-1}><header><strong>Traqiva AI</strong><div><Link to="/app/ask" aria-label="Open full Ask workspace" onClick={hide}><ArrowUpRight size={15}/></Link><button aria-label="Minimize Traqiva AI" onClick={hide}><Minus size={15}/></button><button aria-label={expanded ? 'Restore Traqiva AI size' : 'Expand Traqiva AI'} onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 size={15}/> : <Maximize2 size={15}/>}</button><button aria-label="Close Traqiva AI" onClick={hide}><X size={16}/></button></div></header><div className="traqiva-ai-dock-body"><Suspense fallback={<div className="traqiva-ai-dock-loading"><Spinner/>Opening Traqiva AI…</div>}><EmbeddedAsk compact/></Suspense></div></section>}
  </>;
}
