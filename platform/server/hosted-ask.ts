import type { Context, Hono } from 'hono';
import type { Env, Principal, Row } from './types';
import { ApiError, id, now, redactCredential, stringField } from './security';
import { getAiAllowance, reserveAiAllowance, settleAiAllowance, type AiAllowance } from './ai-allowance';
import { appendAskExchange, askConversationHistory } from './ask-conversations';
import { buildAskEvidence } from './ask-evidence';
import { countHostedInput, HOSTED_MODEL, HostedProviderError, hostedRequest, hostedReservationNanos, runHostedAsk } from './hosted-assistant';

type AppEnv = { Bindings: Env; Variables: { user: Row } };
type Auth = { userProject(c: Context<AppEnv>, projectId: unknown): Promise<Principal> };
type TraceWriter = (env: Env, principal: Principal, body: Row, source: string) => Promise<string>;
export const hostedAvailable = (env: Env) => env.HOSTED_ASK_ENABLED === 'true' && !!env.HOSTED_OPENAI_API_KEY?.trim();
export function publicAiAllowance(value: AiAllowance) {
  return { limit_usd: value.limit_nanos / 1e9, used_usd: value.used_nanos / 1e9, reserved_usd: value.reserved_nanos / 1e9, remaining_usd: value.remaining_nanos / 1e9, conservative_usd: value.uncertain_nanos / 1e9, reset: 'never' as const, accounting: value.accounting_basis };
}
export function registerHostedAskStatus(app: Hono<AppEnv>, auth: Auth) {
  app.get('/api/ask/status', async c => {
    const principal = await auth.userProject(c, c.req.query('project'));
    const allowance = await getAiAllowance(c.env.DB, principal.userId!);
    return c.json({ hosted: { available: hostedAvailable(c.env), model: HOSTED_MODEL, label: 'GPT-6 Luna', allowance: publicAiAllowance(allowance) } });
  });
}
export async function answerHostedAsk(c: Context<AppEnv>, principal: Principal, body: Row, data: Row, insertTrace: TraceWriter) {
  if (!principal.userId) throw new ApiError(401, 'Sign in to use the built-in model.');
  if (!hostedAvailable(c.env)) throw new ApiError(503, 'The built-in model is not configured. Project statistics remain available.');
  if (c.req.header('authorization') || body.provider !== undefined && body.provider !== 'openai' || body.model !== undefined && body.model !== HOSTED_MODEL) throw new ApiError(400, 'The built-in model uses its fixed server connection.');
  const question = stringField(body.question, 'question', 2000), key = c.env.HOSTED_OPENAI_API_KEY!.trim();
  const history = await askConversationHistory(c.env, principal, body.conversation_id);
  const { context, sources } = buildAskEvidence(principal.project.id, data, body.days);
  const before = await getAiAllowance(c.env.DB, principal.userId);
  if (!before.available) return c.json({ error: 'Your $1 lifetime AI allowance is exhausted. It does not reset automatically.', allowance: publicAiAllowance(before) }, 402);
  // A per-user rate guard also bounds token-count calls. Generation admission
  // remains the ledger's atomic cross-project predicate, never this read.
  const recent = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM ai_allowance_ledger WHERE user_id=? AND created_at>=?').bind(principal.userId, new Date(Date.now() - 60_000).toISOString()).first<{ count: number }>();
  if (recent && recent.count >= 20) throw new ApiError(429, 'Too many AI questions. Try again in a minute.');
  const prepared = hostedRequest({ key, question, context, history });
  let inputTokens: number;
  try { inputTokens = await countHostedInput(prepared, key); }
  catch (error) { if (error instanceof HostedProviderError) throw new ApiError(error.status, error.message); throw error; }
  const reservationNanos = hostedReservationNanos(inputTokens), requestId = id();
  const admission = await reserveAiAllowance(c.env.DB, { userId: principal.userId, requestId, projectId: principal.project.id, reservationNanos });
  if (!admission.admitted) return c.json({ error: 'Not enough AI allowance remains for this request, including pending usage. It does not reset automatically.', allowance: publicAiAllowance(admission.allowance) }, 402);
  const started = Date.now();
  let result: Awaited<ReturnType<typeof runHostedAsk>>;
  try { result = await runHostedAsk(prepared, key); }
  catch (problem) {
    const error = problem instanceof HostedProviderError ? problem : new HostedProviderError('The built-in model request failed.', 502);
    const measured = error.chargeNanos !== null && error.chargeNanos <= reservationNanos;
    const settled = await settleAiAllowance(c.env.DB, { userId: principal.userId, requestId, ...(error.notBilled ? { outcome: 'not_billed' as const } : measured ? { outcome: 'measured' as const, actualNanos: error.chargeNanos! } : { outcome: 'uncertain' as const }) });
    await insertTrace(c.env, principal, { provider: 'openai', model: HOSTED_MODEL, status: 'error', http_status: error.upstreamStatus ?? error.status, ...error.usage, token_basis: error.usage ? 'provider' : 'unavailable', latency_ms: Date.now() - started, request: { kind: 'hosted_project_assistant', sources, allowance_request_id: requestId }, response: { error: error.message, usage_accounting: settled.reservation.accounting_basis }, compressed: false }, 'assistant');
    return c.json({ error: error.message, upstream_status: error.upstreamStatus, method: 'llm', provider_called: true, model: HOSTED_MODEL, allowance: publicAiAllowance(settled.allowance) }, error.status);
  }
  const measured = result.chargeNanos !== null && result.chargeNanos <= reservationNanos;
  const settled = await settleAiAllowance(c.env.DB, { userId: principal.userId, requestId, ...(measured ? { outcome: 'measured' as const, actualNanos: result.chargeNanos! } : { outcome: 'uncertain' as const }) });
  const traceId = await insertTrace(c.env, principal, { provider: 'openai', model: HOSTED_MODEL, status: 'success', http_status: 200, ...result.usage, token_basis: result.usage ? 'provider' : 'unavailable', latency_ms: Date.now() - started, input_bytes: result.requestBytes, output_bytes: result.responseBytes, ...(measured ? { cost_usd: result.chargeNanos! / 1e9, cost_basis: 'user_price_estimate' } : {}), request: { kind: 'hosted_project_assistant', body_stored: false, sources, allowance_request_id: requestId }, response: { body_stored: false, usage_accounting: settled.reservation.accounting_basis }, compressed: false }, 'assistant');
  const conversation = await appendAskExchange(c.env, principal, { conversationId: body.conversation_id, question: redactCredential(question, key), answer: result.answer, sources, model: HOSTED_MODEL, method: 'llm' });
  return c.json({ answer: result.answer, sources, method: 'llm', provider_called: true, provider: 'openai', model: HOSTED_MODEL, trace_id: traceId, conversation_id: conversation.id, ...('message_id' in conversation ? { message_id: conversation.message_id } : {}), allowance: publicAiAllowance(settled.allowance), usage_accounting: settled.reservation.accounting_basis, answered_at: now() });
}
