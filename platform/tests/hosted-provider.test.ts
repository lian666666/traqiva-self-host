import { afterEach, describe, expect, it, vi } from 'vitest';
import { countHostedInput, hostedCostNanos, hostedRequest, runHostedAsk, HostedProviderError } from '../server/hosted-assistant';

afterEach(() => vi.unstubAllGlobals());
describe('fixed hosted OpenAI contract and budget evidence', () => {
  it('pins the model, tier, output cap and no-storage/no-cache policy while redacting secrets', async () => {
    const prepared = hostedRequest({ key: 'hosted-private-key', question: 'Analyze hosted-private-key', context: { prompts: 'hosted-private-key' }, history: [] });
    const body = JSON.parse(prepared.body);
    expect(body).toMatchObject({ model: 'gpt-6-luna', service_tier: 'default', store: false, stream: false, max_output_tokens: 1600, reasoning: { effort: 'low' }, prompt_cache_options: { mode: 'explicit', ttl: '30m' } });
    expect(prepared.body).not.toContain('hosted-private-key');
    expect(body.tools).toBeUndefined();
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ object: 'response.input_tokens', input_tokens: 1000 })));
    vi.stubGlobal('fetch', fetcher);
    expect(await countHostedInput(prepared, 'hosted-private-key')).toBe(1000);
    expect(fetcher.mock.calls[0][0]).toBe('https://api.openai.com/v1/responses/input_tokens');
    const countBody = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(countBody).toEqual({ model: body.model, instructions: body.instructions, input: body.input });
  });
  it('prices only valid default-tier provider counters, without invented cached or output usage', () => {
    expect(hostedCostNanos({ model: 'gpt-6-luna', service_tier: 'default', usage: { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } })).toBe(150000);
    for (const response of [
      { model: 'other', usage: { input_tokens: 1, output_tokens: 1 } },
      { model: 'gpt-6-luna', service_tier: 'priority', usage: { input_tokens: 1, output_tokens: 1 } },
      { model: 'gpt-6-luna', service_tier: 'default', usage: { input_tokens: 1 } },
      { model: 'gpt-6-luna', service_tier: 'default', usage: { input_tokens: 1, output_tokens: 1601 } },
    ]) expect(hostedCostNanos(response)).toBeNull();
  });
  it('keeps unknown completion failures billable and never exposes upstream error text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret-echo', { status: 500 })));
    await expect(runHostedAsk(hostedRequest({ key: 'private', question: 'Hi', context: {}, history: [] }), 'private')).rejects.toMatchObject({ notBilled: false, upstreamStatus: 500 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret-echo', { status: 401 })));
    try { await runHostedAsk(hostedRequest({ key: 'private', question: 'Hi', context: {}, history: [] }), 'private'); }
    catch (error) { expect(error).toBeInstanceOf(HostedProviderError); expect(error).toMatchObject({ notBilled: true }); expect((error as Error).message).not.toContain('secret-echo'); }
  });
  it('captures real usage before rejecting an incomplete answer and bounds token-count failures', async () => {
    const prepared = hostedRequest({ key: 'private', question: 'Hi', context: {}, history: [] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'incomplete', model: 'gpt-6-luna', service_tier: 'default', usage: { input_tokens: 100, output_tokens: 1600 }, output: [] }))));
    await expect(runHostedAsk(prepared, 'private')).rejects.toMatchObject({ chargeNanos: 810000, notBilled: false });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ input_tokens: 1000000 }))));
    await expect(countHostedInput(prepared, 'private')).rejects.toThrow('too large');
  });
});
