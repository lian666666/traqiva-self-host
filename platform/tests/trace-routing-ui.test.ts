import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Trace } from '../src/types';
import { TraceDrawer } from '../src/pages/Traces';

const state = vi.hoisted(() => ({ trace: null as Trace | null }));
vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
  return { ...actual, useApp: () => ({ notify: vi.fn() }), useResource: () => ({ data: { trace: state.trace, request: null, response: null }, loading: false, error: '', refresh: vi.fn() }) };
});
const render = () => renderToStaticMarkup(createElement(TraceDrawer, { id: 'trace-routing', onClose: () => {} }));

beforeEach(() => {
  state.trace = { id: 'trace-routing', model: 'provider-model', provider: 'openai', status: 200, input_tokens: 19, output_tokens: 3, cached_tokens: null, latency_ms: 200, cost_usd: null, input_bytes: 90, output_bytes: 20, original_tokens: null, optimized_tokens: null, token_basis: 'provider', saved_tokens: null, created_at: '2026-10-22T08:00:00.000Z', source: 'gateway', compressed: false };
});

describe('Trace routing evidence', () => {
  it('renders the recorded Auto selection, effort, and inspectable rule without claiming verified quality', () => {
    state.trace!.routing = { requested_model: 'traqiva-auto', selected_model: 'actual-selected-model', tier: 'reasoning', reasoning_effort: 'high', reason: 'complexity_keyword', method: 'rules_v1', quality_verified: false };
    const html = render();
    expect(html).toContain('Auto routing decision');
    expect(html).toContain('actual-selected-model');
    expect(html).toContain('<dt>Tier</dt><dd>reasoning</dd>');
    expect(html).toContain('<dt>Reasoning effort</dt><dd>high</dd>');
    expect(html).toContain('complexity_keyword');
    expect(html).toContain('rules_v1');
    expect(html).toContain('Quality not verified');
    expect(html).toContain('Transform applied');
    expect(html).toContain('Input reductions are reported separately from billing savings.');
  });

  it('keeps provider-default effort explicit instead of inventing a level', () => {
    state.trace!.routing = { requested_model: 'traqiva-auto', selected_model: 'selected-small-model', tier: 'small', reasoning_effort: null, reason: 'short_request', method: 'rules_v1', quality_verified: false };
    expect(render()).toContain('<dt>Reasoning effort</dt><dd>Provider default</dd>');
  });

  it('does not label an explicit-model or legacy trace as Auto routed', () => {
    expect(render()).not.toContain('Auto routing decision');
    expect(render()).not.toContain('Quality not verified');
    state.trace!.routing = null;
    expect(render()).not.toContain('Auto routing decision');
  });
});
