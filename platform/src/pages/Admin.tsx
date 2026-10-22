import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Check, Copy, CreditCard, Info, Save, ShieldCheck } from 'lucide-react';
import { api, json, useApp } from '../api';
import { ErrorNotice, PageIntro, Spinner } from '../ui';
import GoogleAccountConnection from '../components/GoogleAccountConnection';
import GitHubMark from '../components/GitHubMark';
import { AGENT_BUILDER_ENABLED } from '../features/agentBuilder';
import FreePlanTerms from '../components/FreePlanTerms';
import { FREE_PLAN_AVAILABILITY, FREE_PLAN_TEAM_TRIAL } from '../pricing';
import type { Workspace } from '../types';
import { deploymentMode, organizationSlug, updateOrganizationName } from './adminSettings';
import './admin-settings.css';

type AdminTab = 'general' | 'security' | 'projects' | 'team';
const availableTabs: { id: AdminTab; label: string }[] = [
  { id: 'general', label: 'General' }, { id: 'security', label: 'Security' },
  { id: 'projects', label: 'Projects' }, { id: 'team', label: 'Team' },
];

function AdminNavigation({ tab, billing = false }: { tab: AdminTab; billing?: boolean }) {
  return <nav className="admin-settings-tabs" aria-label="Admin settings">
    {availableTabs.map(item => <Link key={item.id} to={`/app/admin${item.id === 'general' ? '' : `?tab=${item.id}`}`} aria-current={!billing && tab === item.id ? 'page' : undefined}>{item.label}</Link>)}
    <button type="button" disabled title="Single sign-on is not enabled in this release.">Single sign-on</button>
    <Link to="/app/billing" aria-current={billing ? 'page' : undefined}>Billing</Link>
    <button type="button" disabled title="Data sources are not enabled in this release.">Data sources</button>
    <button type="button" disabled title="Judges are not enabled in this release.">Judges</button>
  </nav>;
}

function IdentityValue({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const { notify } = useApp();
  const [copied, setCopied] = useState(false);
  const copyLabel = `Copy ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); notify(`${label} copied.`); }
    catch { notify('Clipboard access was blocked. Select and copy the text instead.'); }
  }
  return <div className="admin-organization-row">
    <div className="admin-row-label">{label}</div>
    <div className="admin-row-value"><div className="admin-copy-value"><code>{value}</code><button type="button" className="icon-button" onClick={() => void copy()} aria-label={copyLabel} title={copyLabel}>{copied ? <Check size={15} /> : <Copy size={15} />}</button></div>{hint && <small>{hint}</small>}</div>
  </div>;
}

function OrganizationSettings({ workspace }: { workspace: Workspace }) {
  const { reload, notify } = useApp();
  const [name, setName] = useState(workspace.name), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const deployment = deploymentMode(typeof window === 'undefined' ? '' : window.location.hostname);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await updateOrganizationName(name.trim()); await reload(); notify('Organization name saved.'); }
    catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="admin-settings-stack">
    <section className="admin-settings-card" aria-labelledby="organization-settings-title">
      <header><h2 id="organization-settings-title">Organization</h2><p>Manage your organization's general settings.</p></header>
      <div className="admin-organization-row admin-name-row"><label className="admin-row-label" htmlFor="organization-name">Name</label><form className="admin-name-form" onSubmit={save}><input id="organization-name" aria-label="Organization name" required maxLength={80} value={name} disabled={busy} onChange={event => setName(event.target.value)} /><button className="button secondary" type="submit" disabled={busy || !name.trim() || name.trim() === workspace.name}>{busy && <Spinner />}Save</button><ErrorNotice message={error} /></form></div>
      <IdentityValue label="Organization ID" value={workspace.id} />
      <IdentityValue label="Organization slug" value={organizationSlug(workspace.name)} hint="Display only — derived from the name, not a workspace URL." />
      <div className="admin-organization-row"><div className="admin-row-label">Mode <Info size={13} aria-label="Deployment mode" /></div><div className="admin-row-value"><span className="admin-mode-badge">{deployment}</span><small>{deployment === 'Hosted' ? 'This workspace is on the Traqiva hosted service.' : deployment === 'Local preview' ? 'Running on this computer. Production hosting is not inferred.' : 'This installation does not report verified hosting ownership.'}</small></div></div>
    </section>
    <section className="admin-settings-card admin-github-card" aria-labelledby="github-settings-title">
      <header><div><h2 id="github-settings-title"><GitHubMark size={20} />GitHub</h2><p>Manage your organization's repository connection.</p></div><Link className="button secondary" to="/app/admin?tab=security">Manage sign-in<ArrowUpRight size={13} /></Link></header>
      <div className="admin-github-status"><span className="admin-mode-badge">Not connected</span><p>Repository integration is not enabled in this release. GitHub sign-in does not grant repository access.</p></div>
    </section>
  </div>;
}

function SystemSettings({ workspace }: { workspace: Workspace }) {
  const { reload, notify } = useApp();
  const [retention, setRetention] = useState(String(workspace.retention_days));
  const [mode, setMode] = useState(workspace.mode), [autopilot, setAutopilot] = useState(workspace.autopilot);
  const [budget, setBudget] = useState(String(workspace.monthly_budget)), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api('/api/workspace', json({ retention_days: Number(retention), mode, autopilot, monthly_budget: Number(budget) }, 'PATCH'));
      await reload(); notify('Workspace settings saved.');
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="admin-settings-card admin-system-card">
    <header><h2>System</h2><p>Control recorded data and gateway preferences.</p></header>
    <section className="settings-section"><h3>Budget reference</h3><label className="field">Monthly budget reference (USD)<input type="number" min="0" step="1" value={budget} disabled={busy} onChange={event => setBudget(event.target.value)} /><small>Used for visibility. This is not an enforced provider spending limit.</small></label></section>
    <section className="settings-section"><h3>Data &amp; retention</h3><label className="field">Retention window<select value={retention} disabled={busy} onChange={event => setRetention(event.target.value)}>{[7, 14, 30, 90].map(days => <option value={days} key={days}>{days} days</option>)}</select><small>Applies to stored traces. Retention cleanup runs on the service schedule.</small></label></section>
    <section className="settings-section"><h3>Gateway behavior</h3><p>Start with observation. Enable supported transforms deliberately.</p><div className="radio-options">{[
      { value: 'observe', title: 'Observe', text: 'Record requests and provider usage. Forward input without supported optimization transforms.' },
      { value: 'optimize', title: 'Optimize', text: 'Save an optimization preference. This release keeps gateway input unchanged; use the explicit local or server compression tool.' },
    ].map(item => <label className={`radio-option ${mode === item.value ? 'selected' : ''}`} key={item.value}><input type="radio" name="mode" value={item.value} checked={mode === item.value} disabled={busy} onChange={() => setMode(item.value as Workspace['mode'])} /><div><strong>{item.title}</strong><span>{item.text}</span></div></label>)}</div><label className="field">Autopilot<select value={autopilot} disabled={busy} onChange={event => setAutopilot(event.target.value as Workspace['autopilot'])}><option value="off">Off — manual analysis</option><option value="suggest">Suggest — review insights</option></select><small>Suggestions do not change your models or automatically approve an improvement.</small></label></section>
    <ErrorNotice message={error} /><div className="settings-save"><button className="button primary" type="submit" disabled={busy}>{busy ? <Spinner /> : <Save size={15} />}Save changes</button></div>
  </form>;
}

function SecuritySettings() {
  const { session } = useApp();
  return <div className="admin-settings-stack admin-security-content"><section className="admin-settings-card"><header><h2>Account security</h2><p>Manage the accounts you use to sign in to Traqiva.</p></header><div className="admin-account-identity"><span className="avatar">{session?.user?.name.slice(0, 1).toUpperCase()}</span><div><strong>{session?.user?.name}</strong><span>{session?.user?.email}</span></div><span className="admin-mode-badge">Workspace owner</span></div></section><GoogleAccountConnection /><div className="notice subtle"><ShieldCheck size={18} /><span>Traqiva does not use your prompts to train models. Check your upstream provider's data policy separately.</span></div></div>;
}

function ProjectSettings() {
  const { session, project, setProject, notify } = useApp();
  return <section className="admin-settings-card admin-projects-card"><header><h2>Projects</h2><p>Projects in your organization. Select a project to use it across your workspace.</p></header>{session?.projects.length ? <div className="admin-project-list">{session.projects.map(item => <div className="admin-project-row" key={item.id}><div><strong>{item.name}</strong><code>{item.id}</code></div>{project?.id === item.id ? <span className="admin-mode-badge">Current project</span> : <button type="button" className="button secondary" onClick={() => { setProject(item); notify(`Switched to ${item.name}.`); }}>Use project</button>}</div>)}</div> : <p className="admin-card-empty">No projects are available in this session.</p>}<footer><Link className="text-button" to="/app/connect">Open connection guide<ArrowUpRight size={13} /></Link></footer></section>;
}

function TeamSettings() {
  const { session } = useApp();
  return <section className="admin-settings-card admin-team-card" id="team"><header><div><h2>Team</h2><p>This release supports the workspace owner.</p></div><button type="button" className="button secondary" disabled>Invite a teammate</button></header><div className="admin-account-identity"><span className="avatar">{session?.user?.name.slice(0, 1).toUpperCase()}</span><div><strong>{session?.user?.name}</strong><span>{session?.user?.email}</span></div><span className="admin-mode-badge">Owner</span></div><footer>Team invitations and role management are not enabled.</footer></section>;
}

function BillingSettings() {
  return <><PageIntro title="Simple, transparent access." description="Your Free workspace and the planned monthly policy." /><section className="billing-summary"><span className="billing-icon"><CreditCard size={30} /></span><span className="section-label">Current access</span><h2>Free workspace</h2><p>{AGENT_BUILDER_ENABLED ? 'Gateway, traces, evaluations, and supported traffic analysis.' : 'Coding sessions, recorded requests, token usage and supported traffic analysis.'}<br />Bring your own provider account and API key.</p><div className="billing-price">$0<span>/ month</span></div><div className="notice"><ShieldCheck size={19} /><span>No payment method is collected. No trial will turn into a paid subscription.</span></div></section><section className="panel billing-plan-preview" aria-labelledby="billing-free-policy"><h2 id="billing-free-policy">Free plan policy</h2><FreePlanTerms /><p className="plan-policy-status">{FREE_PLAN_AVAILABILITY}</p><div className="free-plan-team"><button className="text-button" type="button" disabled>{FREE_PLAN_TEAM_TRIAL}</button><span className="badge neutral">Coming soon</span></div></section><section className="panel billing-notes"><h2>What you pay for today</h2><dl><div><dt>Traqiva subscription</dt><dd>No charge in this release</dd></div><div><dt>Model usage</dt><dd>Billed by your upstream provider</dd></div><div><dt>Workspace cost estimates</dt><dd>For visibility; not an invoice</dd></div></dl><p className="muted">Use your own provider key. Your provider’s terms, limits, and pricing still apply. Planned AI credits do not cover these charges. Usage metering, credit balances, paid upgrades and Team trials are not enabled.</p></section></>;
}

export default function Admin({ billing = false }: { billing?: boolean }) {
  const { session } = useApp();
  const [params] = useSearchParams();
  const requested = params.get('tab');
  const callback = params.has('oauth_error') || params.get('google') === 'linked' || params.get('github') === 'linked';
  const tab: AdminTab = availableTabs.some(item => item.id === requested) ? requested as AdminTab : callback ? 'security' : 'general';
  const system = params.get('section') === 'system', workspace = session?.workspace;
  return <div className="admin-settings-page"><h1 className="admin-settings-title">Admin Settings</h1><AdminNavigation tab={tab} billing={billing} />{billing ? <div className="admin-billing-content"><BillingSettings /></div> : tab === 'general' ? <div className="admin-general-layout"><nav className="admin-settings-subnav" aria-label="General settings"><Link to="/app/admin" aria-current={!system ? 'page' : undefined}>Organization</Link><button type="button" disabled title="Webhooks are not enabled in this release.">Webhooks</button><Link to="/app/admin?section=system" aria-current={system ? 'page' : undefined}>System</Link></nav>{workspace ? system ? <SystemSettings key={`${workspace.id}:${workspace.retention_days}:${workspace.mode}:${workspace.autopilot}:${workspace.monthly_budget}`} workspace={workspace} /> : <OrganizationSettings key={`${workspace.id}:${workspace.name}`} workspace={workspace} /> : <div className="admin-settings-stack"><div className="notice">Workspace settings are unavailable. Refresh your session to try again.</div><SecuritySettings /></div>}</div> : tab === 'security' ? <SecuritySettings /> : tab === 'projects' ? <ProjectSettings /> : <TeamSettings />}</div>;
}
