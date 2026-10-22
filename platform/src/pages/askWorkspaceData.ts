export type AskMode = 'hosted' | 'statistics' | 'byok';
export type AskAllowance = { limit_usd: number; used_usd: number; reserved_usd: number; remaining_usd: number; conservative_usd?: number; reset: 'never'; accounting?: string };
export type AskStatus = { hosted: { available: boolean; model: string; label: string; allowance: AskAllowance } };
export type AskSource = { type: string; project_id: string; days?: number; trace_ids?: string[]; href?: string };
export type AskMessage = { id?: string; role: 'user' | 'assistant'; content: string; sources?: unknown[]; method?: string; model?: string; created_at?: string };
export type AskConversation = { id: string; title: string; created_at?: string; updated_at?: string };
export type AskConversationDetail = { conversation: AskConversation | null; messages: AskMessage[]; has_more?: boolean; limit?: number };
export type AskResponse = { answer: string; sources: unknown[]; method: string; provider_called: boolean; provider?: string; model?: string; conversation_id?: string; message_id?: string; allowance?: AskAllowance };
export const emptyAskStatus: AskStatus = { hosted: { available: false, model: 'gpt-6-luna', label: 'GPT-6 Luna', allowance: { limit_usd: 1, used_usd: 0, reserved_usd: 0, remaining_usd: 0, reset: 'never' } } };
export const emptyAskConversations: { items: AskConversation[]; has_more?: boolean; limit?: number } = { items: [] };
export const emptyAskConversation: AskConversationDetail = { conversation: null, messages: [] };
export const askProjectPath = (path: string, projectId?: string) => projectId ? `${path}?project=${encodeURIComponent(projectId)}` : null;
export const askQuestions = [
  { command: '/investigate', label: 'Investigate an issue', question: 'What should I investigate in my recorded project traffic?' },
  { command: '/cache', label: 'Review cache usage', question: 'What does my recorded cache usage show? Distinguish measured and missing data.' },
  { command: '/compare', label: 'Compare model usage', question: 'Compare the recorded models by token usage and supplied cost. State where prices or measurements are missing.' },
] as const;
export function askEvidence(sources: unknown[] | undefined, projectId: string) {
  return (sources || []).flatMap(value => {
    if (!value || typeof value !== 'object') return [];
    const source = value as Partial<AskSource>;
    if (source.project_id !== projectId || typeof source.type !== 'string') return [];
    const days = Number.isInteger(source.days) && Number(source.days) > 0 && Number(source.days) <= 90 ? Number(source.days) : null;
    const suffix = days ? ` · ${days} days` : '';
    // Derive routes from recognized evidence types. Never navigate a model-supplied URL.
    const type = source.type;
    const label = type === 'project_statistics' ? 'Project statistics' : type === 'model_breakdown' ? 'Model breakdown' : type === 'recent_traces' || type === 'trace_metadata' || type === 'traces' ? 'Recorded traces' : null;
    if (!label) return [];
    const href = type === 'project_statistics' || type === 'model_breakdown' ? '/app/analytics' : '/app/traces';
    return [{ label: `${label}${suffix}`, href: `${href}${days && href === '/app/analytics' ? `?days=${days}` : ''}`, traceIds: Array.isArray(source.trace_ids) ? source.trace_ids.filter((id): id is string => typeof id === 'string' && id.length <= 200).slice(0, 20) : [] }];
  });
}
export function askCanSend(options: { question: string; busy: boolean; projectId?: string; mode: AskMode; statusLoading: boolean; hostedAvailable: boolean; allowance?: AskAllowance; key: string; model: string }) {
  if (!options.projectId || options.busy || !options.question.trim()) return false;
  if (options.mode === 'hosted') return !options.statusLoading && options.hostedAvailable && !!options.allowance && Number.isFinite(options.allowance.remaining_usd) && options.allowance.remaining_usd > 0;
  return options.mode !== 'byok' || !!options.key.trim() && !!options.model.trim();
}
export function askMoney(value: number) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2 }).format(Math.max(0, value));
}
