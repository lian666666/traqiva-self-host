import { describe, expect, it } from 'vitest';
import { askEvidenceDays, buildAskEvidence } from '../server/ask-evidence';

describe('bounded project evidence for Ask', () => {
  it('allows only selected metadata and explains mixed measurement bases', () => {
    const result = buildAskEvidence('project-a', { stats: { requests: 2, input_tokens: 100, priced_requests: 1, estimated_cost_usd: 0.02, saved_tokens_basis: 'client_estimate', private: 'private-stats' }, models: [{ model: 'test-model', requests: 2, tokens: 100, cost: 0.02, prompt: 'private-model' }], series: [{ date: '2026-10-22', requests: 2, tokens: 100, cost: 0.02 }], traces: [{ id: 'trace-a', model: 'test-model', provider: 'test', status: 'success', token_basis: 'estimated', cost_basis: 'user_price_estimate', input_tokens: 100, request_json: 'private-request', response_json: 'private-response', routing: { private: true } }] }, 30);
    expect(result.context).toMatchObject({ project_id: 'project-a', period_days: 30, stats: { requests: 2, priced_requests: 1 }, utc_dates: { from: '2026-10-22', to: '2026-10-22' }, recent_trace_metadata: [{ id: 'trace-a', token_basis: 'estimated', cost_basis: 'user_price_estimate' }] });
    expect(result.context.evidence_limits.aggregate_token_basis).toContain('Mixed or unknown');
    expect(result.context.evidence_limits.aggregate_scope).toContain('Traqiva AI assistant calls are excluded');
    expect(result.context.evidence_limits.aggregate_cost_basis).toContain('possibly partial');
    expect(result.context.evidence_limits.cache_basis).toContain('unknown');
    const serialized = JSON.stringify(result);
    for (const privateValue of ['private-stats', 'private-model', 'private-request', 'private-response', 'routing']) expect(serialized).not.toContain(privateValue);
    expect(result.sources.find(source => source.type === 'trace_metadata')).toMatchObject({ trace_ids: ['trace-a'], href: '/app/traces?project=project-a' });
  });
  it('keeps zero activity evidence available without claiming the user never used the product', () => {
    const result = buildAskEvidence('empty', { stats: { requests: 0 }, models: [], traces: [], series: [] });
    expect(result.context.stats.requests).toBe(0);
    expect(result.context.stats.estimated_cost_usd).toBeNull();
    expect(result.context.evidence_limits.no_activity_inference).toContain('not that the user never used');
    expect(result.sources.map(source => source.type)).toEqual(['project_statistics', 'model_breakdown']);
  });
  it('bounds metadata rows, labels, invalid numbers and source URLs', () => {
    const result = buildAskEvidence('id?next=https://bad.invalid', { stats: { requests: -1, input_tokens: Infinity }, models: Array.from({ length: 40 }, () => ({ model: 'x'.repeat(200), requests: 1 })), traces: Array.from({ length: 20 }, (_, index) => ({ id: 'trace-' + index, token_basis: 'claimed', cost_basis: 'secret', request: { content: 'ignored' } })), series: Array.from({ length: 100 }, () => ({ date: 'bad date', requests: 1 })) }, 90);
    expect(result.context.models).toHaveLength(30); expect(result.context.models[0].model).toHaveLength(120);
    expect(result.context.recent_trace_metadata).toHaveLength(10); expect(result.context.daily_series).toHaveLength(90);
    expect(result.context.stats).toMatchObject({ requests: null, input_tokens: null });
    expect(result.context.recent_trace_metadata[0]).toMatchObject({ token_basis: 'unavailable', cost_basis: 'unavailable' });
    expect(result.context.daily_series[0].date).toBeNull();
    for (const source of result.sources) expect(new URL(source.href, 'https://test.invalid').searchParams.get('project')).toBe('id?next=https://bad.invalid');
  });
  it('accepts only supported evidence windows and redacts credential-shaped labels', () => {
    expect([undefined, '7', 30, '90'].map(askEvidenceDays)).toEqual([30, 7, 30, 90]);
    for (const value of ['8', -1, {}, [], 'infinity']) expect(() => askEvidenceDays(value)).toThrow('Choose 7, 30 or 90 days.');
    const result = buildAskEvidence('project', { models: [{ model: 'sk-this-is-a-long-test-token' }] });
    expect(result.context.models[0].model).toBe('[redacted]');
  });
});
