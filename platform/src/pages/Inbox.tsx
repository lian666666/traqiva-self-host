import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ChevronDown, ChevronLeft, ChevronRight, Filter, Inbox, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import { date, useApp, useResource } from '../api';
import { ErrorNotice, Spinner } from '../ui';
import { AGENT_BUILDER_ENABLED } from '../features/agentBuilder';
import { isReportTypingTarget, moveReportSelection, reportBody, reportHref, reportType, reportTypeLabel, visibleInboxReports, type InboxReport } from './inboxReports';
import './inbox.css';

function InboxIllustration() {
  return <svg className="inbox-illustration" width="166" height="106" viewBox="0 0 166 106" fill="none" aria-hidden="true">
    <ellipse cx="83" cy="55" rx="75" ry="43" stroke="currentColor" strokeDasharray="2.5 3" opacity=".2"/>
    <ellipse cx="83" cy="55" rx="63" ry="35" stroke="currentColor" strokeDasharray="2.5 3" opacity=".3"/>
    <path d="m46 47 34-20 43 24v9L89 80 46 56z" fill="var(--surface)" stroke="currentColor" opacity=".65"/>
    <path d="m46 47 43 24 34-20M89 71v9M50 49v6l39 22 30-18v-6M50 52l39 22 30-18" stroke="currentColor" opacity=".5"/>
    <path d="m53 46 27-16 35 20-27 16z" stroke="currentColor" opacity=".65"/>
    <path d="m63 44 18-10 25 14-18 11z" fill="var(--subtle)" stroke="currentColor" strokeWidth="1.5" opacity=".8"/>
    <path d="m63 44 25 15 18-11M81 34v-7M89 66v5" stroke="currentColor" opacity=".4"/>
  </svg>;
}

function InboxProject({ projectId }: { projectId: string | undefined }) {
  const { data, loading, error, refresh } = useResource<{ items: InboxReport[] }>(projectId ? `/api/inbox?project=${encodeURIComponent(projectId)}` : null, { items: [] });
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const reports = useMemo(() => visibleInboxReports(projectId ? data.items || [] : [], AGENT_BUILDER_ENABLED), [data.items, projectId]);
  const items = useMemo(() => visibleInboxReports(reports, AGENT_BUILDER_ENABLED, search, type), [reports, search, type]);
  const types = Array.from(new Set(reports.map(reportType)));
  const selectedIndex = items.findIndex(item => item.id === selectedId);
  const selected = items[selectedIndex];
  const href = selected ? reportHref(selected, AGENT_BUILDER_ENABLED) : null;
  const move = (direction: -1 | 1) => setSelectedId(id => moveReportSelection(items, id, direction));

  useEffect(() => {
    if (!selectedId) return;
    if (window.matchMedia('(max-width: 760px)').matches) headingRef.current?.focus();
    else listRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isReportTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key !== 'j' && key !== 'k') return;
      if (!items.length || loading || error) return;
      event.preventDefault();
      setSelectedId(id => moveReportSelection(items, id, key === 'j' ? 1 : -1));
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [items, loading, error]);

  const filtered = !!search.trim() || !!type;
  return <section className={`inbox-workspace ${selected ? 'has-selected-report' : ''}`} aria-label="Inbox reports">
    <div className="inbox-report-column">
      <div className="inbox-toolbar">
        <label className="inbox-search"><Search size={16}/><input ref={searchRef} type="search" aria-label="Search reports" placeholder="Search reports…" value={search} onChange={event => { setSearch(event.target.value); setSelectedId(null); }}/></label>
        <label className={`inbox-filter ${type ? 'is-active' : ''}`} title={type ? `Filter: ${reportTypeLabel(type)}` : 'Filter reports'}><Filter size={16}/><span>Filter{type ? ' · 1' : ''}</span><ChevronDown size={14}/><select aria-label="Filter report type" value={type} onChange={event => { setType(event.target.value); setSelectedId(null); }}><option value="">All report types</option>{types.map(value => <option key={value} value={value}>{reportTypeLabel(value)}</option>)}</select></label>
        <button type="button" className="icon-button inbox-refresh" aria-label="Refresh reports" title="Refresh reports" disabled={loading || !projectId} onClick={refresh}><RefreshCw size={17} className={loading ? 'spin' : ''}/></button>
      </div>
      <div className="inbox-list-summary" aria-live="polite"><span>{loading ? 'Loading reports…' : error ? 'Reports unavailable' : `${items.length} ${items.length === 1 ? 'report' : 'reports'}`}</span><span>Newest first</span></div>
      <div className="inbox-report-list" ref={listRef} aria-busy={!!loading}>
        {!projectId ? <div className="inbox-empty-state"><InboxIllustration/><h2>Choose a project</h2><p>Select a project in your workspace to view its reports.</p></div> : loading ? <div className="inbox-loading" role="status"><Spinner/><span>Loading reports…</span></div> : error ? <div className="inbox-empty-state inbox-load-error"><h2>Reports unavailable</h2><ErrorNotice message={error} retry={refresh}/></div> : items.length ? <ul aria-label="Reports">{items.map(item => <li key={item.id}><button type="button" className={`inbox-report-row ${item.id === selectedId ? 'is-selected' : ''}`} aria-pressed={item.id === selectedId} onClick={() => setSelectedId(item.id)}><span className="inbox-report-kind"><SlidersHorizontal size={15}/>{reportTypeLabel(reportType(item))}</span><strong>{item.title}</strong><span className="inbox-report-preview">{reportBody(item) || 'Open this report to review its details.'}</span><time dateTime={item.created_at}>{date(item.created_at)}</time></button></li>)}</ul> : <div className="inbox-empty-state"><InboxIllustration/><h2>{filtered ? 'No matching reports' : 'Nothing needs you'}</h2><p>{filtered ? 'Try a different search or report type.' : 'Project updates and findings ready for your review appear here, with the evidence behind them.'}</p>{filtered ? <button type="button" className="text-button" onClick={() => { setSearch(''); setType(''); setSelectedId(null); }}><X size={13}/>Clear filters</button> : <div className="inbox-evidence-path" aria-label="Report flow"><span>Activity</span><ChevronRight size={12}/><span>Findings</span><ChevronRight size={12}/><span>Inbox</span></div>}</div>}
      </div>
      <footer className="inbox-list-footer"><span><kbd>J</kbd><kbd>K</kbd><span>Move</span></span><span aria-label="Report position">{selectedIndex < 0 ? 0 : selectedIndex + 1} / {items.length}</span></footer>
    </div>
    <section className="inbox-detail-column" aria-label="Report details">
      <header className="inbox-detail-toolbar"><span>Report</span><button type="button" className="inbox-back-button text-button" onClick={() => { setSelectedId(null); requestAnimationFrame(() => searchRef.current?.focus()); }}><ArrowLeft size={14}/>Back to reports</button><div><button type="button" className="icon-button" aria-label="Previous report" disabled={!items.length || selectedIndex === 0 || !!loading || !!error} onClick={() => move(-1)} title="Previous report (K)"><ChevronLeft size={17}/></button><button type="button" className="icon-button" aria-label="Next report" disabled={!items.length || selectedIndex === items.length - 1 || !!loading || !!error} onClick={() => move(1)} title="Next report (J)"><ChevronRight size={17}/></button></div></header>
      {selected && !loading && !error ? <article className="inbox-report-detail" key={selected.id}><div className="inbox-detail-meta"><span><SlidersHorizontal size={14}/>{reportTypeLabel(reportType(selected))}</span><time dateTime={selected.created_at}>{date(selected.created_at)}</time></div><h1 ref={headingRef} tabIndex={-1}>{selected.title}</h1><p>{reportBody(selected) || 'No additional details were included in this report.'}</p>{href && <Link className="button secondary compact" to={href}>{reportType(selected) === 'improvement' ? 'Review finding' : 'Open related activity'}<ArrowRight size={14}/></Link>}</article> : <div className="inbox-detail-placeholder"><Inbox size={23} strokeWidth={1.7}/><p>Select a report</p></div>}
    </section>
  </section>;
}

export default function InboxPage() {
  const { project } = useApp();
  return <InboxProject key={project?.id || 'no-project'} projectId={project?.id}/>;
}
