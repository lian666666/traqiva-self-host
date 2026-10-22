import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUp, ArrowUpRight, Check, ChevronDown, Copy, FileText, Folder, KeyRound, MessageCircle, Plus, RefreshCw, ShieldCheck, SlidersHorizontal, SquareSlash, X } from 'lucide-react';
import { api, date, json, useApp, useResource } from '../api';
import { ErrorNotice, Logo, Spinner } from '../ui';
import { askCanSend, askEvidence, askMoney, askProjectPath, askQuestions, emptyAskConversation, emptyAskConversations, emptyAskStatus, type AskAllowance, type AskConversationDetail, type AskMessage, type AskMode, type AskResponse, type AskStatus } from './askWorkspaceData';
import './ask-workspace.css';

function AnswerEvidence({ message, projectId }: { message: AskMessage; projectId: string }) {
  const [copied, setCopied] = useState(false), [copyError, setCopyError] = useState(false);
  const sources = askEvidence(message.sources, projectId);
  async function copy() {
    try { await navigator.clipboard.writeText(message.content); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  }
  return <div className="ask-answer-evidence">
    <details><summary>How this was answered <ChevronDown size={12}/></summary><div><p>{message.method === 'llm' ? `Answered with ${message.model || 'the selected model'} using recorded project summaries and recent trace metadata.` : 'Computed from recorded project statistics. No model call.'}</p><p>Review the linked evidence before relying on an answer. Missing traces do not prove that you have never used Traqiva.</p>{sources.length ? <ul>{sources.map((source, index) => <li key={`${source.label}-${index}`}><Link to={source.href}>{source.label}<ArrowUpRight size={12}/></Link>{!!source.traceIds.length && <span>Trace IDs: {source.traceIds.join(', ')}</span>}</li>)}</ul> : <p>No supporting records were attached to this answer.</p>}</div></details>
    <div className="ask-answer-actions"><button type="button" onClick={() => void copy()} aria-label="Copy answer">{copied ? <Check size={13}/> : <Copy size={13}/>} {copied ? 'Copied' : 'Copy'}</button>{sources.map((source, index) => <Link key={`${source.label}-${index}`} to={source.href}><FileText size={13}/>{source.label}<ArrowUpRight size={12}/></Link>)}</div>
    {copyError && <small role="status">Clipboard unavailable. Select the answer to copy it.</small>}
  </div>;
}

function AskProject({ compact }: { compact: boolean }) {
  const { project, session, setProject } = useApp();
  const [params, setParams] = useSearchParams();
  const [embeddedChatId, setEmbeddedChatId] = useState<string | null>(null);
  const selectedId = compact ? embeddedChatId : params.get('chat') || null;
  const status = useResource<AskStatus>(askProjectPath('/api/ask/status', project?.id), emptyAskStatus);
  const conversations = useResource(compact ? null : askProjectPath('/api/ask/conversations', project?.id), emptyAskConversations);
  const detail = useResource<AskConversationDetail>(selectedId && project ? askProjectPath(`/api/ask/conversations/${encodeURIComponent(selectedId)}`, project.id) : null, emptyAskConversation);
  const [draft, setDraft] = useState<{ id: string | null; messages: AskMessage[] } | null>(null);
  const [question, setQuestion] = useState(() => compact ? '' : params.get('question')?.slice(0, 2000) || '');
  const [mode, setMode] = useState<AskMode>('hosted'), [provider, setProvider] = useState<'openai' | 'anthropic'>('openai');
  const [model, setModel] = useState(''), [apiKey, setApiKey] = useState(''), [settingsOpen, setSettingsOpen] = useState(false), [commandsOpen, setCommandsOpen] = useState(false);
  const [days, setDays] = useState('30');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [latestAllowance, setLatestAllowance] = useState<AskAllowance | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null), bottom = useRef<HTMLDivElement>(null), thread = useRef<HTMLDivElement>(null), requestInFlight = useRef(false);
  const draftMatches = !!draft && draft.id === selectedId;
  const messages = project ? draftMatches ? draft.messages : selectedId ? detail.data.messages || [] : [] : [];
  const threadLoading = !!selectedId && detail.loading && !draftMatches;
  const threadError = selectedId && !draftMatches ? detail.error : '';
  const hostedAvailable = !!project && !status.loading && !status.error && status.data.hosted.available;
  const effectiveMode = mode === 'hosted' && !status.loading && !hostedAvailable ? 'statistics' : mode;
  const allowance = latestAllowance || (!status.loading && !status.error && project ? status.data.hosted.allowance : undefined);
  const exhausted = !!allowance && allowance.remaining_usd <= 0;
  const canSend = !threadLoading && !threadError && askCanSend({ question, busy, projectId: project?.id, mode: effectiveMode, statusLoading: status.loading, hostedAvailable, allowance, key: apiKey, model });
  const contextMessages = effectiveMode === 'byok' ? 'Your provider bills these calls. Your key stays in this page’s memory.' : effectiveMode === 'statistics' ? 'Computed project statistics · no model call' : '$1 lifetime AI allowance per user · no automatic renewal';

  useEffect(() => {
    if (!messages.length || !thread.current?.getClientRects().length) return;
    if (compact) thread.current.scrollTop = thread.current.scrollHeight;
    else bottom.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [messages.length, busy, compact]);
  useEffect(() => {
    if (!compact) return;
    const opened = () => { setLatestAllowance(null); status.refresh(); };
    window.addEventListener('traqiva-ask-opened', opened);
    return () => window.removeEventListener('traqiva-ask-opened', opened);
  }, [compact, status.refresh]);

  function updateConversation(id: string | null, replace = false) {
    if (compact) { setEmbeddedChatId(id); return; }
    setParams(previous => { const next = new URLSearchParams(previous); if (id) next.set('chat', id); else next.delete('chat'); next.delete('question'); return next; }, { replace });
  }
  function focusComposer() { if (composer.current?.getClientRects().length) composer.current.focus(); }

  function selectChat(id: string | null) {
    if (requestInFlight.current) return;
    updateConversation(id);
    setDraft(null); setQuestion(''); setError(''); setCommandsOpen(false);
    requestAnimationFrame(focusComposer);
  }
  function chooseQuestion(value: string) { setQuestion(value); setCommandsOpen(false); focusComposer(); }
  async function send() {
    if (!canSend || !project || requestInFlight.current) return;
    requestInFlight.current = true;
    const value = question.trim(), previousMessages = messages, requestedMode = effectiveMode;
    const pendingMessages: AskMessage[] = [...previousMessages, { role: 'user', content: value }];
    setDraft({ id: selectedId, messages: pendingMessages }); setQuestion(''); setError(''); setBusy(true); setCommandsOpen(false);
    try {
      const options = json({ project_id: project.id, question: value, days: Number(days), mode: requestedMode, ...(selectedId ? { conversation_id: selectedId } : {}), ...(requestedMode === 'byok' ? { provider, model: model.trim() } : {}) });
      if (requestedMode === 'byok') options.headers = { Authorization: `Bearer ${apiKey.trim()}` };
      const result = await api<AskResponse>('/api/ask', options);
      const conversationId = result.conversation_id || selectedId;
      setDraft({ id: conversationId, messages: [...pendingMessages, { id: result.message_id, role: 'assistant', content: result.answer, sources: result.sources, method: result.method, model: result.provider_called ? result.model : undefined }] });
      if (conversationId) updateConversation(conversationId, !selectedId);
      if (result.allowance) setLatestAllowance(result.allowance);
      conversations.refresh(); status.refresh();
    } catch (problem) {
      setDraft({ id: selectedId, messages: previousMessages }); setQuestion(value); setError((problem as Error).message); status.refresh();
    } finally { requestInFlight.current = false; setBusy(false); window.dispatchEvent(new Event('traqiva-usage-updated')); }
  }

  return <section className={`ask-workspace ${compact ? 'ask-workspace-compact' : ''} ${messages.length ? 'has-conversation' : ''}`} aria-label="Ask Traqiva">
    {!compact && <aside className="ask-history" aria-label="Your conversations">
      <header><span>Your chats</span><button className="icon-button" aria-label="Refresh conversations" onClick={conversations.refresh} disabled={conversations.loading || !project}><RefreshCw size={14} className={conversations.loading ? 'spin' : ''}/></button></header>
      <button className="ask-new-chat" onClick={() => selectChat(null)} disabled={busy || !project}><Plus size={15}/>New chat</button>
      {conversations.loading ? <p role="status">Loading chats…</p> : conversations.error ? <ErrorNotice message="Chat history could not be loaded." retry={conversations.refresh}/> : !project ? <p>Choose a project to view chats.</p> : conversations.data.items.length ? <ul>{conversations.data.items.map(item => <li key={item.id}><button onClick={() => selectChat(item.id)} disabled={busy} aria-pressed={selectedId === item.id} title={item.title}><span>{item.title}</span>{item.updated_at && <time dateTime={item.updated_at}>{date(item.updated_at)}</time>}</button></li>)}</ul> : <p>No conversations yet.</p>}
      {project && !conversations.loading && !conversations.error && conversations.data.has_more && <p>Showing the latest {conversations.data.limit || conversations.data.items.length} chats.</p>}
      <div className="ask-credit-summary" aria-label="AI allowance"><span>Traqiva AI</span><strong>{status.loading && project ? 'Checking allowance…' : allowance && hostedAvailable ? `${askMoney(allowance.remaining_usd)} left` : allowance ? 'Unavailable until enabled' : 'Allowance unavailable'}</strong>{allowance && <>
        <progress value={Math.max(0, allowance.used_usd + allowance.reserved_usd)} max={allowance.limit_usd || 1} aria-label="AI allowance used"/>
        <small>{askMoney(allowance.used_usd)} used of {askMoney(allowance.limit_usd)}{allowance.reserved_usd > 0 ? ` · ${askMoney(allowance.reserved_usd)} reserved` : ''}<br/>Lifetime allowance · does not reset{Number(allowance.conservative_usd) > 0 && <><br/>{askMoney(allowance.conservative_usd!)} conservatively charged for unconfirmed usage.</>}</small>
        <button className="text-button" onClick={() => { setLatestAllowance(null); status.refresh(); }} disabled={status.loading || busy} aria-label="Refresh AI allowance">Refresh allowance</button>
      </>}</div>
    </aside>}
    <div className="ask-conversation-area">{!compact && <header className="ask-workspace-header"><span><MessageCircle size={16}/>Ask Traqiva</span><button className="button secondary compact" onClick={() => selectChat(null)} disabled={busy || !project}><Plus size={14}/>New chat</button></header>}
      <div ref={thread} className="ask-thread" aria-live="polite" aria-busy={busy || threadLoading}>
        {!!selectedId && !threadLoading && !threadError && detail.data.has_more && <p className="ask-state-note">Showing the latest {detail.data.limit || 50} messages. Earlier messages are outside this view.</p>}
        {!project ? <div className="ask-welcome"><Logo compact/><h1>Choose a project to start</h1><p>Your answers use evidence from the selected project.</p></div> : threadLoading ? <div className="ask-thread-loading"><Spinner/>Loading conversation…</div> : threadError ? <ErrorNotice message={threadError} retry={detail.refresh}/> : messages.length ? <div className="ask-message-list">{messages.map((message, index) => <article key={message.id || `${message.role}-${index}`} className={`ask-workspace-message ${message.role}`} aria-label={message.role === 'user' ? 'Your message' : 'Traqiva answer'}><p>{message.content}</p>{message.role === 'assistant' && <AnswerEvidence message={message} projectId={project.id}/>}</article>)}{busy && <div className="ask-working" role="status"><Spinner/><span>{effectiveMode === 'statistics' ? 'Reading recorded statistics…' : 'Requesting an evidence-based answer…'}</span></div>}<div ref={bottom}/></div> : <div className="ask-welcome"><Logo compact/><h1>{compact ? 'Ask Traqiva' : 'What should we look into?'}</h1><p>{compact ? `Ask about ${project.name}’s activity, tokens and costs.` : 'Ask about your project’s recorded activity, tokens, and costs.'}</p>{compact && <div className="ask-compact-suggestions">{askQuestions.map(item => <button key={item.command} onClick={() => chooseQuestion(item.question)} disabled={busy}>{item.label}</button>)}</div>}</div>}
      </div>
      <div className="ask-workspace-compose"><ErrorNotice message={error}/>{status.error && <ErrorNotice message="Built-in AI status could not be loaded. Project statistics remain available." retry={status.refresh}/>} {!status.loading && !status.error && project && !hostedAvailable && <p className="ask-state-note" role="status">Built-in AI is unavailable. You can use project statistics.</p>}{hostedAvailable && exhausted && <p className="ask-state-note" role="status">Your $1 lifetime AI allowance has been used or reserved. <button type="button" onClick={() => setMode('statistics')} disabled={busy}>Use project statistics</button></p>}{hostedAvailable && allowance && allowance.remaining_usd > 0 && allowance.remaining_usd < .02 && <p className="ask-state-note">Less than {askMoney(.02)} remains. A request may require more than the remaining allowance.</p>}
        {commandsOpen && <div className="ask-command-menu" aria-label="Analysis questions"><header>Explore your evidence<button className="icon-button" aria-label="Close analysis questions" onClick={() => setCommandsOpen(false)}><X size={13}/></button></header>{askQuestions.map(item => <button key={item.command} onClick={() => chooseQuestion(item.question)} disabled={busy}><span>{item.label}</span><code>{item.command}</code></button>)}</div>}
        <form className="ask-workspace-composer" onSubmit={(event: FormEvent) => { event.preventDefault(); void send(); }}><textarea ref={composer} aria-label="Your project question" placeholder={messages.length ? 'Reply…' : `Ask about ${project?.name || 'your project'}…`} maxLength={2000} rows={3} value={question} disabled={busy || !project || threadLoading || !!threadError} onChange={event => { setQuestion(event.target.value); if (event.target.value === '/') setCommandsOpen(true); }} onKeyDown={event => { if (event.key === 'Escape') setCommandsOpen(false); if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}/><div className="ask-compose-tools"><div><button className="icon-button" type="button" aria-label="Analysis questions" aria-expanded={commandsOpen} onClick={() => setCommandsOpen(open => !open)} disabled={busy || !project}><SquareSlash size={17}/></button><button className="icon-button" type="button" aria-label="Connection settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(open => !open)} disabled={busy}><SlidersHorizontal size={16}/></button></div><div><label className="ask-answer-mode"><span className="sr-only">Answer mode</span><select aria-label="Answer mode" value={effectiveMode} onChange={event => { const next = event.target.value as AskMode; setMode(next); if (next === 'byok') setSettingsOpen(true); else setApiKey(''); setError(''); }} disabled={busy}><option value="hosted" disabled={!hostedAvailable}>GPT-6 Luna{!hostedAvailable && !status.loading ? ' · unavailable' : ''}</option><option value="statistics">Project statistics</option>{settingsOpen && <option value="byok">My provider connection</option>}</select><ChevronDown size={13}/></label><button type="submit" className="ask-workspace-send" disabled={!canSend} aria-label="Send question">{busy ? <Spinner/> : <ArrowUp size={18}/>}</button></div></div></form>
        <div className="ask-compose-context"><label><Folder size={14}/><select aria-label="Ask project" value={project?.id || ''} disabled={busy || !project} onChange={event => { const next = session?.projects.find(item => item.id === event.target.value); if (next) { if (!compact) setParams(previous => { const value = new URLSearchParams(previous); value.delete('chat'); value.delete('question'); return value; }); setProject(next); } }}>{!project && <option value="">Choose project</option>}{session?.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="ask-period"><select aria-label="Ask evidence period" value={days} disabled={busy} onChange={event => setDays(event.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label></div>
        {settingsOpen && <section className="ask-advanced-settings" aria-label="Advanced connection settings"><header><strong>Connection settings</strong><button className="icon-button" aria-label="Close connection settings" onClick={() => { setSettingsOpen(false); if (mode === 'byok') { setMode('hosted'); setApiKey(''); } }} disabled={busy}><X size={15}/></button></header><label className="ask-own-provider-toggle"><input type="checkbox" checked={mode === 'byok'} disabled={busy} onChange={event => { setMode(event.target.checked ? 'byok' : 'hosted'); setApiKey(''); }}/><KeyRound size={14}/>Use my own provider account</label>{mode === 'byok' && <><div className="ask-advanced-fields"><label className="field">Provider<select value={provider} onChange={event => { setProvider(event.target.value as 'openai' | 'anthropic'); setApiKey(''); setModel(''); }} disabled={busy}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></select></label><label className="field">Model ID<input autoComplete="off" spellCheck={false} value={model} onChange={event => setModel(event.target.value)} placeholder="Your model ID" maxLength={200} disabled={busy}/></label><label className="field">Provider API key<input type="password" autoComplete="off" data-1p-ignore data-lpignore="true" spellCheck={false} value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="Your API key" maxLength={512} disabled={busy}/></label></div><p><ShieldCheck size={13}/>Your key is held in this page’s memory and sent only with your request. Your provider bills these calls separately.</p>{apiKey && <button className="text-button" onClick={() => setApiKey('')} disabled={busy}>Clear key</button>}</>}</section>}
        {effectiveMode === 'hosted' && <p className="ask-privacy-note">{compact ? 'OpenAI uses your question, recent chat and project metadata. No raw trace bodies.' : 'Uses OpenAI with your question, recent chat and selected project metadata. Raw trace bodies are not sent.'}</p>}
        {compact ? <div className="ask-compact-footer"><button type="button" onClick={() => selectChat(null)} disabled={busy || !project}><Plus size={12}/>New chat</button><Link to={selectedId ? `/app/ask?chat=${encodeURIComponent(selectedId)}` : '/app/ask'} title="Open chats and AI allowance">{status.loading ? 'Checking credit…' : hostedAvailable && allowance ? `${askMoney(allowance.remaining_usd)} left · lifetime` : 'Open full chat'}<ArrowUpRight size={11}/></Link></div> : <><p className="ask-allowance-note">{contextMessages}</p>{effectiveMode === 'hosted' && <p className="ask-accounting-note">Costs use provider-reported tokens. Interrupted or unconfirmed calls may retain a conservative reservation.</p>}</>}
        {!compact && !messages.length && project && <div className="ask-starter-questions">{askQuestions.slice(0, 2).map(item => <button key={item.command} onClick={() => chooseQuestion(item.question)} disabled={busy}>{item.question}</button>)}</div>}
      </div>
    </div>
  </section>;
}

export function AskWorkspace({ compact = false }: { compact?: boolean }) {
  const { project } = useApp();
  return <AskProject key={`${compact ? 'embedded' : 'page'}-${project?.id || 'no-project'}`} compact={compact}/>;
}

export default function Ask() { return <AskWorkspace/>; }
