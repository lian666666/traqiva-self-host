import { ApiError, now } from './security';
import type { Env, Row } from './types';

type Effort = 'low' | 'medium' | 'high';
type Tier = 'small' | 'balanced' | 'reasoning';
type Choice = { model: string; reasoning_effort: Effort | null };
export type AutoSettings = { enabled: boolean; waste_checks_enabled: boolean; provider: 'openai'; tiers: Record<Tier, Choice>; small_max_chars: number; balanced_max_chars: number; updated_at: string | null };
export const AUTO_MODEL = 'traqiva-auto';
export function defaultAutoSettings(): AutoSettings {
  return { enabled: false, waste_checks_enabled: true, provider: 'openai', tiers: { small: { model: '', reasoning_effort: null }, balanced: { model: '', reasoning_effort: null }, reasoning: { model: '', reasoning_effort: null } }, small_max_chars: 1200, balanced_max_chars: 6000, updated_at: null };
}
export async function autoSettings(env: Env, projectId: string): Promise<AutoSettings> {
  const row = await env.DB.prepare('SELECT settings_json,updated_at FROM project_auto_settings WHERE project_id=?').bind(projectId).first<Row>();
  return row ? { ...defaultAutoSettings(), ...JSON.parse(row.settings_json), updated_at: row.updated_at } : defaultAutoSettings();
}
export function validateAutoSettings(body: Row, current: AutoSettings): AutoSettings {
  const settings = { ...current, ...body, updated_at: now() } as AutoSettings;
  if (typeof settings.enabled !== 'boolean' || typeof settings.waste_checks_enabled !== 'boolean') throw new ApiError(400, 'Auto and waste-check switches must be booleans.');
  if (settings.provider !== 'openai') throw new ApiError(400, 'Auto currently supports OpenAI-compatible Responses and Chat Completions requests only.');
  if (![settings.small_max_chars, settings.balanced_max_chars].every(value => Number.isInteger(value) && value >= 256 && value <= 200000) || settings.balanced_max_chars <= settings.small_max_chars) throw new ApiError(400, 'Routing character thresholds must be integers from 256 to 200000; balanced must exceed small.');
  const tiers = {} as Record<Tier, Choice>;
  for (const tier of ['small', 'balanced', 'reasoning'] as const) {
    const choice = settings.tiers?.[tier];
    if (!choice || typeof choice !== 'object' || Array.isArray(choice) || typeof choice.model !== 'string') throw new ApiError(400, `Provide a ${tier} model choice.`);
    const model = choice.model.trim(), effort = choice.reasoning_effort ?? null;
    if ((settings.enabled && !model) || model.length > 200 || (model && (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(model) || model === AUTO_MODEL || /^(?:sk[-_]|tq_|trq_|gh[pousr]_|github_pat_|AIza|AQ\.|Bearer)/i.test(model)))) throw new ApiError(400, `Enter an explicit compatible ${tier} model name, never an API key.`);
    if (effort !== null && !['low', 'medium', 'high'].includes(effort)) throw new ApiError(400, 'Reasoning effort must be low, medium, high, or null for the provider default.');
    tiers[tier] = { model, reasoning_effort: effort };
  }
  return { enabled: settings.enabled, waste_checks_enabled: settings.waste_checks_enabled, provider: 'openai', tiers, small_max_chars: settings.small_max_chars, balanced_max_chars: settings.balanced_max_chars, updated_at: settings.updated_at };
}
export type RoutingDecision = { requested_model: string; selected_model: string; tier: Tier; reasoning_effort: string | null; reason: string; method: 'rules_v1'; quality_verified: false };
export function routeAuto(payload: Row, settings: AutoSettings, path: string): { payload: Row; routing: RoutingDecision } {
  if (!settings.enabled) throw new ApiError(400, 'Auto is disabled for this project. Configure compatible model choices or send an explicit provider model.');
  if (path !== '/v1/responses' && path !== '/v1/chat/completions') throw new ApiError(400, 'Auto supports OpenAI Responses and Chat Completions only. Send an explicit model for this endpoint.');
  // This deterministic policy is intentionally inspectable. It is not a quality-trained router.
  const text = JSON.stringify(payload.input ?? payload.messages ?? ''), contextChars = JSON.stringify(payload).length;
  const hasTools = Array.isArray(payload.tools) && payload.tools.length > 0;
  const complex = /\b(architect(?:ure)?|security|trade[ -]?offs?|debug|prove|reason(?:ing)?|design.*system)\b|架构|安全|调试|推理|证明/i.test(text);
  const continuation = Boolean(payload.previous_response_id || payload.conversation);
  const tier: Tier = hasTools || complex || continuation || contextChars > settings.balanced_max_chars ? 'reasoning' : contextChars > settings.small_max_chars ? 'balanced' : 'small';
  const reason = hasTools ? 'tools_present' : continuation ? 'conversation_context_unavailable' : complex ? 'complexity_keyword' : contextChars > settings.balanced_max_chars ? 'large_request' : contextChars > settings.small_max_chars ? 'medium_request' : 'short_request';
  const choice = settings.tiers[tier], routed: Row = { ...payload, model: choice.model };
  if (choice.reasoning_effort) {
    if (path === '/v1/responses') {
      if (payload.reasoning === undefined) routed.reasoning = { effort: choice.reasoning_effort };
      else if (payload.reasoning && typeof payload.reasoning === 'object' && !Array.isArray(payload.reasoning) && !Object.hasOwn(payload.reasoning, 'effort')) routed.reasoning = { ...payload.reasoning, effort: choice.reasoning_effort };
    } else if (!Object.hasOwn(payload, 'reasoning_effort')) routed.reasoning_effort = choice.reasoning_effort;
  }
  const effort = path === '/v1/responses' ? routed.reasoning?.effort : routed.reasoning_effort;
  return { payload: routed, routing: { requested_model: AUTO_MODEL, selected_model: choice.model, tier, reasoning_effort: typeof effort === 'string' ? effort : null, reason, method: 'rules_v1', quality_verified: false } };
}
