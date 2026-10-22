import { ApiError, scrubSecrets } from './security';
import type { Row } from './types';

export type AskSource = { type: string; project_id: string; days: number; title: string; href: string; trace_ids?: string[] };
const MODEL_LIMIT = 30, TRACE_LIMIT = 10, SERIES_LIMIT = 90;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e15 ? value : null;
// eslint-disable-next-line no-control-regex -- Untrusted metadata labels cannot carry terminal control characters.
const label = (value: unknown, max = 120): string | null => typeof value === 'string' ? scrubSecrets(value).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : null;
const records = (value: unknown): Row[] => Array.isArray(value) ? value.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
const fields = <K extends string>(row: Row, keys: K[]): Record<K, number | null> => Object.fromEntries(keys.map(key => [key, number(row[key])])) as Record<K, number | null>;
export function askEvidenceDays(value: unknown): 7 | 30 | 90 {
  if (value === undefined || value === null || value === '') return 30;
  const days = Number(value);
  if (![7, 30, 90].includes(days)) throw new ApiError(400, 'Choose 7, 30 or 90 days.');
  return days as 7 | 30 | 90;
}

// Only explicitly allowed metadata reaches the model. Overview can contain
// additional private/raw fields in future without silently expanding this view.
export function buildAskEvidence(projectId: string, data: Row, daysValue: unknown = 30) {
  const days = askEvidenceDays(daysValue), stats = data.stats && typeof data.stats === 'object' ? data.stats : {};
  const models = records(data.models).slice(0, MODEL_LIMIT).map(row => ({ model: label(row.model), ...fields(row, ['requests', 'tokens', 'cost']) }));
  const traces = records(data.traces).slice(0, TRACE_LIMIT).map(row => ({
    id: label(row.id, 64), model: label(row.model), provider: label(row.provider, 64),
    status: ['success', 'error'].includes(row.status) ? row.status : null,
    ...fields(row, ['http_status', 'input_tokens', 'output_tokens', 'cached_tokens', 'latency_ms', 'cost_usd']),
    token_basis: ['provider', 'estimated', 'unavailable'].includes(row.token_basis) ? row.token_basis : 'unavailable',
    cost_basis: ['client_reported', 'user_price_estimate', 'unavailable'].includes(row.cost_basis) ? row.cost_basis : 'unavailable',
    source: label(row.source, 40), compressed: Boolean(row.compressed), created_at: label(row.created_at, 32),
  }));
  const series = records(data.series).slice(0, SERIES_LIMIT).map(row => ({ date: /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : null, ...fields(row, ['requests', 'tokens', 'cost']) }));
  const from = series.find(row => row.date)?.date ?? null, to = [...series].reverse().find(row => row.date)?.date ?? null;
  const context = {
    project_id: projectId, period_days: days, utc_dates: { from, to },
    stats: { ...fields(stats, ['requests', 'input_tokens', 'output_tokens', 'cached_tokens', 'cache_available_requests', 'cache_covered_input_tokens', 'estimated_cost_usd', 'errors', 'avg_latency_ms', 'saved_tokens', 'usage_available_requests', 'priced_requests', 'compression_events', 'compression_estimated_saved_tokens']), saved_tokens_basis: stats.saved_tokens_basis === 'client_estimate' ? 'client_estimate' : 'unavailable' },
    models, daily_series: series, recent_trace_metadata: traces,
    evidence_limits: {
      model_limit: MODEL_LIMIT, recent_trace_limit: TRACE_LIMIT, daily_series_limit: SERIES_LIMIT,
      aggregate_scope: 'Project traces in the selected UTC period, including manual imports and assistant calls where present; these are not automatically coding-agent requests. Recent trace metadata is only a sample.',
      aggregate_token_basis: 'Mixed or unknown: aggregate tokens can combine provider-reported and estimated usage. Per-trace token_basis is authoritative only for that sampled trace.',
      aggregate_cost_basis: 'Recorded cost subtotal, possibly partial and estimated; not an invoice or verified savings. priced_requests gives price coverage.',
      cache_basis: 'Cache totals may include estimates. Use cache_available_requests and cache_covered_input_tokens for coverage; missing cache is unknown, not measured zero.',
      no_activity_inference: 'Zero recorded traces establishes no recorded traces in this period, not that the user never used Traqiva or an agent.',
      unavailable_content: 'No raw prompts, request bodies, response bodies, private keys or complete conversations are included in this evidence.',
    },
  };
  const projectQuery = encodeURIComponent(projectId), sources: AskSource[] = [
    { type: 'project_statistics', project_id: projectId, days, title: 'Activity & spend', href: `/app/analytics?project=${projectQuery}&days=${days}` },
    { type: 'model_breakdown', project_id: projectId, days, title: 'Model breakdown', href: `/app/analytics?project=${projectQuery}&days=${days}` },
  ];
  if (traces.length) sources.push({ type: 'trace_metadata', project_id: projectId, days, title: 'Evidence', href: `/app/traces?project=${projectQuery}`, trace_ids: traces.map(row => row.id).filter((value): value is string => Boolean(value)) });
  return { context, sources };
}
