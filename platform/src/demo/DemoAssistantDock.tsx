import { useEffect, useId, useRef } from 'react';
import { Expand, MessageCircle, Minus, X } from 'lucide-react';
import { demoTraces } from './demoData';
import { DemoAsk } from './DemoWorkspace';
import type { DemoViewProps } from './demoUi';

export function DemoUsageMeters() {
  return <section className="demo-usage-meters" aria-label="Sample plan usage">
    <small>Sample usage · no charges</small>
    <dl>
      <div><dt><i/>AI credits</dt><dd>$1.00 <span>sample</span></dd></div>
      <div><dt><i/>Observability</dt><dd>{demoTraces.length} / 100K</dd></div>
      <div title="No run duration recorded in this sample"><dt><i/>Agent runs</dt><dd>— / 600 <span>min</span></dd></div>
      <div title="No routing decisions recorded in this sample"><dt><i/>Routing</dt><dd>— / 25K</dd></div>
    </dl>
    <p>Plan preview. AI credits are separate from agent traffic.</p>
  </section>;
}

export function DemoAssistantDock({ open, onOpenChange, ...props }: DemoViewProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const panelId = useId();
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }, [open]);
  function close() {
    onOpenChange(false);
    requestAnimationFrame(() => opener.current?.focus());
  }
  return <div className="demo-ai-dock">
    {open && <section ref={panel} id={panelId} className="demo-ai-panel" role="dialog" aria-label="Traqiva AI sample chat" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
      <header><strong>Traqiva AI</strong><div>
        <button type="button" className="demo-icon" aria-label="Minimize Traqiva AI sample chat" onClick={close}><Minus size={15}/></button>
        <button type="button" className="demo-icon" aria-label="Expand Traqiva AI sample chat" onClick={() => { props.go('ask'); onOpenChange(false); }}><Expand size={15}/></button>
        <button type="button" className="demo-icon" aria-label="Close Traqiva AI sample chat" onClick={close}><X size={15}/></button>
      </div></header>
      <div className="demo-ai-content"><DemoAsk {...props} compact/></div>
    </section>}
    <button ref={opener} type="button" className="demo-ai-launcher" aria-label="Open Traqiva AI sample chat" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => onOpenChange(!open)}><MessageCircle size={16}/><span>Traqiva AI</span></button>
  </div>;
}
