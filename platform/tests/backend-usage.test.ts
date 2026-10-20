import { describe, expect, it } from 'vitest';
import { computeCost, normalizeUsage, parseSseUsage } from '../server/usage';
import { gradeCases } from '../server/index';
describe('provider-normalized usage and honest evaluation', () => {
  it('reads OpenAI Responses final usage and cached token counters', () => {
    expect(normalizeUsage('openai', { response: { usage: { input_tokens: 180, output_tokens: 12, input_tokens_details: { cached_tokens: 100 } } } })).toEqual({ input_tokens: 180, output_tokens: 12, cached_tokens: 100, token_basis: 'provider' });
    expect(normalizeUsage('openai', { usage: { prompt_tokens: 3, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 4 } } })).toBeNull();
    expect(normalizeUsage('openai', { error: { message: 'failed' } })).toBeNull();
  });
  it('uses final cumulative Anthropic output rather than summing events', () => {
    const events = 'event: message_start\r\ndata: {"type":"message_start","message":{"usage":{"input_tokens":20,"output_tokens":0,"cache_read_input_tokens":30,"cache_creation_input_tokens":10}}}\r\n\r\ndata: {"type":"message_delta","usage":{"output_tokens":4}}\r\n\r\ndata: {"type":"message_delta","usage":{"output_tokens":8}}\r\n\r\n';
    expect(parseSseUsage('anthropic', events)).toEqual({ input_tokens: 60, output_tokens: 8, cached_tokens: 30, token_basis: 'provider' });
  });
  it('does not count missing or malformed stream usage as zero measured tokens', () => {
    expect(parseSseUsage('openai', 'data: {malformed}\n\ndata: [DONE]\n\n')).toBeNull();
    expect(parseSseUsage('anthropic', 'data: {"type":"message_start","message":{"usage":{"input_tokens":20,"output_tokens":0}}}\n\n')).toBeNull();
  });
  it('has no implicit price for an unknown model and prices cached input once', () => {
    const usage = { input_tokens: 100, output_tokens: 10, cached_tokens: 40, token_basis: 'provider' as const };
    expect(computeCost('anything', usage)).toBeNull();
    expect(computeCost('anything', usage, { input_per_million: 2, output_per_million: 4, cached_input_per_million: 1 })).toBeCloseTo(0.0002);
  });
  it('grades actual supplied strings with exact match and no simulated model call', () => {
    expect(gradeCases([{ input: 'a', expected: 'same', actual: 'same' }, { input: 'b', expected: 'same', actual: 'Same' }]).passed).toBe(1);
  });
});
