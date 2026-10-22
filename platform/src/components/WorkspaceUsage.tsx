import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, RefreshCw, X } from 'lucide-react';
import { useApp, useResource } from '../api';
import { workspaceUsageRows, type WorkspaceUsageData } from './workspaceUsageData';
import './workspace-usage.css';

export default function WorkspaceUsage() {
  const { project } = useApp();
  const { data, loading, error, refresh } = useResource<WorkspaceUsageData | null>(project ? `/api/workspace/usage?project=${encodeURIComponent(project.id)}` : null, null);
  const [open, setOpen] = useState(false), region = useRef<HTMLElement>(null), close = useRef<HTMLButtonElement>(null), opener = useRef<HTMLButtonElement | null>(null), refreshLatest = useRef(refresh);
  const id = useId(), rows = workspaceUsageRows(error ? null : data);
  useEffect(() => { refreshLatest.current = refresh; }, [refresh]);
  useEffect(() => {
    function update() { if (document.visibilityState !== 'hidden') refreshLatest.current(); }
    window.addEventListener('traqiva-usage-updated', update); window.addEventListener('focus', update); document.addEventListener('visibilitychange', update);
    return () => { window.removeEventListener('traqiva-usage-updated', update); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  useEffect(() => {
    if (!open) return;
    close.current?.focus();
    function outside(event: PointerEvent) { if (!region.current?.contains(event.target as Node)) setOpen(false); }
    function keyboard(event: KeyboardEvent) { if (event.key === 'Escape') { setOpen(false); opener.current?.focus(); } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keyboard); };
  }, [open]);
  return <section className="workspace-usage" aria-label="Traqiva plan usage" ref={region}>
    {rows.map(row => <button key={row.label} className="workspace-usage-row" title={row.detail} aria-expanded={open} aria-controls={id} onClick={event => { opener.current = event.currentTarget; setOpen(value => !value); }}><span className="workspace-usage-ring" aria-hidden="true" style={{ '--usage-progress': `${(row.fraction || 0) * 100}%` } as CSSProperties}/><span>{row.label}</span><strong>{loading ? 'Loading…' : row.value}</strong></button>)}
    {open && <div id={id} className="workspace-usage-popover" role="dialog" aria-label="Plan usage details"><header><strong>Traqiva usage</strong><button ref={close} className="icon-button" aria-label="Close usage details" onClick={() => { setOpen(false); opener.current?.focus(); }}><X size={14}/></button></header>{error ? <p role="status">Usage could not be loaded.</p> : rows.map(row => <div key={row.label}><strong>{row.label}<span>{loading ? 'Loading…' : row.value}</span></strong><p>{row.detail}</p></div>)}<footer><button className="text-button" disabled={loading || !project} onClick={refresh}><RefreshCw size={12}/>Refresh</button><Link to="/app/billing" onClick={() => setOpen(false)}>Plan details<ArrowUpRight size={12}/></Link></footer></div>}
  </section>;
}
