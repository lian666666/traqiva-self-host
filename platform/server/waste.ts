import { estimateTokens } from './usage';
import type { Row } from './types';

export type WasteRule = { kind: string; title: string; description: string; evidence: Row };
export const WASTE_SAMPLE_LIMIT = 200;
export const WASTE_WINDOW_DAYS = 7;
function textContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map(part => part && typeof part === 'object' && typeof part.text === 'string' ? part.text : '').join('\n');
}
function leadingContext(request: unknown): string {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return '';
  const value = request as Row;
  let prefix = typeof value.instructions === 'string' ? value.instructions : '';
  const messages = value.messages ?? (Array.isArray(value.input) ? value.input : []);
  if (Array.isArray(messages)) for (const message of messages) {
    if (!message || !['system', 'developer'].includes(message.role)) break;
    prefix += `\n${textContent(message.content)}`;
  }
  return prefix.slice(0, 32768);
}
export function sampledWasteRules(rows: Row[], windowStart: string, windowEnd: string): WasteRule[] {
  const rules: WasteRule[] = [], base = { window_days: WASTE_WINDOW_DAYS, window_start: windowStart, window_end: windowEnd, sample_limit: WASTE_SAMPLE_LIMIT, sampled_requests: rows.length, request_character_limit: 65536, requests_with_bounded_payload: rows.filter(row => row.request_json).length, savings_verified: false };
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    let request: unknown; try { request = JSON.parse(row.request_json ?? 'null'); } catch { continue; }
    const prefix = leadingContext(request);
    if (prefix.length < 1024) continue;
    // Compare only bounded leading content. Different provider/model pairs are not cache-compatible.
    const key = JSON.stringify([row.provider, row.model, prefix.slice(0, 1024)]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const repeated = [...groups.values()].filter(group => group.length >= 3).sort((a, b) => b.length - a.length)[0];
  if (repeated) {
    const request = JSON.parse(repeated[0].request_json), sample = leadingContext(request).slice(0, 1024);
    rules.push({ kind: 'repeated-prefix', title: 'Review repeated leading context', description: `${repeated.length} of ${rows.length} sampled requests to the same provider/model share at least 1024 leading instruction characters. Keep stable instructions first and inspect cache eligibility. The prefix token count is a byte/4 estimate; it is not a saving.`, evidence: { ...base, method: 'leading_context_sample_v1', matching_requests: repeated.length, prefix_characters_compared: 1024, prefix_tokens_estimate: estimateTokens(sample), token_basis: 'utf8_bytes_div_4_estimate', trace_ids: repeated.map(row => row.id), provider: repeated[0].provider, model: repeated[0].model } });
  }
  const measured = rows.filter(row => row.status === 'success' && row.token_basis === 'provider' && Number.isSafeInteger(row.input_tokens) && row.input_tokens >= 1024 && Number.isSafeInteger(row.cached_tokens) && row.cached_tokens >= 0 && row.cached_tokens <= row.input_tokens);
  const input = measured.reduce((sum, row) => sum + row.input_tokens, 0), cached = measured.reduce((sum, row) => sum + row.cached_tokens, 0);
  if (measured.length >= 3 && cached / input < 0.25) rules.push({ kind: 'cache-coverage', title: 'Inspect low recorded cache coverage', description: `${measured.length} sampled successful requests with at least 1024 input tokens report ${((cached / input) * 100).toFixed(1)}% cached input. Review prefix stability, timing and provider cache requirements. Low cache use alone does not prove waste or a recoverable saving.`, evidence: { ...base, method: 'recorded_cache_ratio_v1', measured_requests: measured.length, covered_input_tokens: input, cached_input_tokens: cached, cached_input_ratio: cached / input, trace_ids: measured.map(row => row.id), basis: 'provider_usage_recorded_in_trace' } });
  return rules;
}
