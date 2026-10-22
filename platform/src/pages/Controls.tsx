import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Boxes, ChevronDown, Globe2, MessageSquareText, RefreshCw, Save, SearchCheck, ShieldCheck, Terminal } from 'lucide-react';
import { api, json, useApp, useResource } from '../api';
import type { Improvement } from '../types';
import { Code, Empty, ErrorNotice, PageIntro, Spinner } from '../ui';
import './controls.css';

type Effort = 'low' | 'medium' | 'high' | null;
type Tier = 'small' | 'balanced' | 'reasoning';
type AutoSettings = {
  enabled: boolean;
  provider: 'openai';
  tiers: Record<Tier, { model: string; reasoning_effort: Effort }>;
  small_max_chars: number;
  balanced_max_chars: number;
  waste_checks_enabled: boolean;
  updated_at: string | null;
};
type AutoResponse = { settings: AutoSettings | null; sentinel: string; method: string };
const initialAuto: AutoResponse = { settings: null, sentinel: 'traqiva-auto', method: 'rules_v1' };
const initialFindings: { items: Improvement[] } = { items: [] };
const tiers: { id: Tier; name: string }[] = [{ id: 'small', name: 'Small tasks' }, { id: 'balanced', name: 'Balanced tasks' }, { id: 'reasoning', name: 'Reasoning tasks' }];
const localTools = [
  { id: 'say-less', number: '01', name: 'Say Less', icon: MessageSquareText, description: 'Adds concise-response guidance to supported client calls.', detail: 'Guidance can shorten replies; it does not enforce output length or take over an existing desktop chat.' },
  { id: 'read-less', number: '02', name: 'Read Less', icon: BookOpen, description: 'Compresses artifacts before an assistant reads them.', detail: 'Use the compression or MCP tool explicitly. Exact originals remain recoverable; restore omitted detail whenever the task needs it.' },
  { id: 'blocks', number: '04', name: 'Blocks', icon: Boxes, description: 'Saves reusable code locally for later retrieval.', detail: 'Store and retrieve a known script instead of generating it again. Traqiva does not execute stored code automatically.' },
  { id: 'browse', number: '06', name: 'Browse', icon: Globe2, description: 'Fetches public HTML and compacts the extracted text.', detail: 'This fetcher does not control your browser or log into private sites. The downloaded original remains recoverable.' },
] as const;

export default function Controls() {
  const { project } = useApp();
  return <div className="efficiency-controls"><PageIntro title="Efficiency controls" description="Choose what runs locally and how this project handles eligible requests." />
    <span className="section-label efficiency-eyebrow">Six controls</span>
    {project ? <ProjectControls key={project.id} projectId={project.id} projectName={project.name} /> : <section className="panel"><Empty icon={<ShieldCheck size={25} />} title="Select a project">Create or select a project to configure routing and recorded-traffic checks.</Empty></section>}
    <section className="panel efficiency-local" aria-labelledby="local-controls-heading"><header className="efficiency-section-header"><div><span className="section-label">Your machine</span><h2 id="local-controls-heading">Local tools</h2><p>Local status is not available in this browser.</p></div><Terminal size={19} /></header>
      {localTools.map(tool => <details className="efficiency-local-row" key={tool.id}><summary><span className="efficiency-tool-icon"><tool.icon size={18} /></span><span className="efficiency-tool-copy"><strong>{tool.name}</strong><span>{tool.description}</span></span><span className="efficiency-control-number">{tool.number}</span><ChevronDown size={15} /></summary><div className="efficiency-local-detail"><p>{tool.detail}</p><Code>{`traqiva controls set ${tool.id} on\ntraqiva controls set ${tool.id} off`}</Code></div></details>)}
      <div className="efficiency-local-footer"><p>Check the actual settings in your terminal. Tools run only when invoked; installed tools are not proof of token savings.</p><Code>{'traqiva controls status'}</Code><Link className="text-button" to="/app/connect?tab=cli">Set up local tools<ArrowRight size={14} /></Link></div>
    </section>
    <div className="notice subtle"><ShieldCheck size={17} /><span>Token estimates, provider usage, and invoice savings are different measurements. Review actual traces before attributing a reduction to a control.</span></div>
  </div>;
}

function ProjectControls({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { notify } = useApp();
  const { data, loading, error: loadError, refresh } = useResource<AutoResponse>(`/api/auto?project=${encodeURIComponent(projectId)}`, initialAuto);
  const findings = useResource<{ items: Improvement[] }>(`/api/improvements?project=${encodeURIComponent(projectId)}`, initialFindings);
  const [draft, setDraft] = useState<AutoSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const settings = draft ?? data.settings;
  const unavailable = loading || !!loadError || !settings;
  const needsModels = !!settings?.enabled && tiers.some(tier => !settings.tiers[tier.id].model.trim());
  const openFindings = findings.data.items.filter(item => item.status !== 'accepted' && item.status !== 'dismissed').length;

  function update(values: Partial<AutoSettings>) { if (settings) setDraft({ ...settings, ...values }); }
  function updateTier(tier: Tier, values: Partial<AutoSettings['tiers'][Tier]>) {
    if (settings) update({ tiers: { ...settings.tiers, [tier]: { ...settings.tiers[tier], ...values } } });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || unavailable || needsModels || saving) return;
    setSaving(true); setError('');
    try {
      await api<AutoResponse>('/api/auto', json({ project_id: projectId, enabled: draft.enabled, provider: draft.provider, tiers: draft.tiers, small_max_chars: draft.small_max_chars, balanced_max_chars: draft.balanced_max_chars, waste_checks_enabled: draft.waste_checks_enabled }, 'PATCH'));
      setDraft(null); refresh(); notify('Project efficiency controls saved.');
    } catch (problem) { setError((problem as Error).message); }
    finally { setSaving(false); }
  }
  async function analyze() {
    if (unavailable || saving || analyzing || draft || !data.settings?.waste_checks_enabled) return;
    setAnalyzing(true); setError('');
    try { await api('/api/improvements/analyze', json({ project_id: projectId })); findings.refresh(); notify('Waste checks completed using recorded traffic.'); }
    catch (problem) { setError((problem as Error).message); }
    finally { setAnalyzing(false); }
  }

  return <form className="efficiency-project" onSubmit={save}><div className="efficiency-project-heading"><div><span className="section-label">Project gateway</span><strong>{projectName}</strong></div><button type="button" className="button secondary compact" disabled={saving || analyzing || loading} onClick={() => { setDraft(null); setError(''); refresh(); findings.refresh(); }}><RefreshCw size={13} />Reload saved settings</button></div>
    <ErrorNotice message={loadError || error} retry={loadError ? refresh : undefined} />
    <fieldset disabled={unavailable || saving || analyzing} className="efficiency-project-fields"><section className="panel efficiency-routing" aria-labelledby="auto-control-heading"><header className="efficiency-section-header"><div><span className="section-label">03 · Auto</span><h2 id="auto-control-heading">Model & reasoning routing</h2><p>Use your chosen model tiers for eligible API requests.</p></div><label className="efficiency-switch"><input role="switch" aria-label="Enable Auto routing" type="checkbox" checked={!!settings?.enabled} onChange={event => update({ enabled: event.target.checked })} /><span aria-hidden="true" /></label></header>
      <div className="efficiency-routing-content"><p className="efficiency-saved-status" role="status">{loading ? 'Loading routing settings' : loadError || !data.settings ? 'Routing status unavailable' : data.settings.enabled ? 'Auto is on for requests using traqiva-auto' : 'Auto is off'}{draft && <span> · Unsaved changes</span>}</p><div className="efficiency-models">{tiers.map(tier => <div key={tier.id}><label className="field">{tier.name}<input aria-label={`${tier.name} model`} value={settings?.tiers[tier.id].model ?? ''} maxLength={120} placeholder="Provider model ID" required={!!settings?.enabled} onChange={event => updateTier(tier.id, { model: event.target.value })} /></label><label className="field">Reasoning effort<select aria-label={`${tier.name} reasoning effort`} value={settings?.tiers[tier.id].reasoning_effort ?? ''} onChange={event => updateTier(tier.id, { reasoning_effort: event.target.value ? event.target.value as Effort : null })}><option value="">Provider default</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label></div>)}</div>
      {needsModels && <p className="efficiency-validation">Choose all three model IDs before enabling Auto.</p>}
      <p className="efficiency-boundary">OpenAI-compatible routing policy · No quality or savings guarantee. Use models and efforts supported by your provider account.</p>
      <details className="efficiency-routing-example"><summary>Send an eligible request<ChevronDown size={13} /></summary><Code>{'model: "traqiva-auto"'}</Code><p>Use this model name with the project gateway. Explicit model names pass through unchanged.</p><p>The rule policy selects a tier using request size and task hints. It does not evaluate answer quality or choose among the whole model market.</p><Link className="text-button" to="/app/connect">Gateway connection guide<ArrowRight size={13} /></Link></details></div>
    </section>
    <section className="panel efficiency-waste" aria-labelledby="waste-control-heading"><header className="efficiency-section-header"><div><span className="section-label">05 · Waste Fixes</span><h2 id="waste-control-heading">Recorded-traffic checks</h2><p>Look for errors, large inputs, repeated prefixes, and cache gaps.</p></div><label className="efficiency-switch"><input role="switch" aria-label="Enable Waste checks" type="checkbox" checked={!!settings?.waste_checks_enabled} onChange={event => update({ waste_checks_enabled: event.target.checked })} /><span aria-hidden="true" /></label></header><div className="efficiency-waste-content"><p className="efficiency-saved-status">{loading ? 'Loading check settings' : loadError || !data.settings ? 'Check status unavailable' : data.settings.waste_checks_enabled ? 'Waste checks are on' : 'Waste checks are off'}</p><p>Cache findings are recommendations based on a bounded sample of actual traces. They do not enable a cache or verify lower bills.</p><div className="efficiency-waste-actions"><button type="button" className="button secondary compact" disabled={unavailable || saving || analyzing || !!draft || !data.settings?.waste_checks_enabled} onClick={() => void analyze()}>{analyzing ? <Spinner /> : <SearchCheck size={14} />}Analyze recorded traffic</button><Link className="text-button" to="/app/improvements">View findings<ArrowRight size={13} /></Link></div><ErrorNotice message={findings.error} retry={findings.refresh} /><p className="efficiency-findings-count">{findings.loading ? 'Loading findings' : findings.error ? 'Findings unavailable' : `${openFindings} open finding${openFindings === 1 ? '' : 's'}`}{draft ? ' · Save changes before running checks.' : ''}</p></div></section>
    </fieldset><div className="efficiency-save"><span>{draft ? 'Changes apply after saving.' : 'Project settings are separate from local device controls.'}</span><button className="button primary" disabled={unavailable || saving || analyzing || !draft || needsModels}>{saving ? <Spinner /> : <Save size={14} />}Save controls</button></div>
  </form>;
}
