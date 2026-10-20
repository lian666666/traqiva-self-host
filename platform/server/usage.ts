export type Usage = { input_tokens: number; output_tokens: number; cached_tokens: number; token_basis: 'provider' };
export type Prices = { input_per_million: number; output_per_million: number; cached_input_per_million?: number };
const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
export function normalizeUsage(provider: 'openai' | 'anthropic', payload: any): Usage | null {
  const usage = payload?.response?.usage ?? payload?.message?.usage ?? payload?.usage;
  if (!usage || typeof usage !== 'object') return null;
  if (provider === 'anthropic') {
    const input = count(usage.input_tokens), output = count(usage.output_tokens);
    if (input === null || output === null) return null;
    const cached = count(usage.cache_read_input_tokens) ?? 0;
    return { input_tokens: input + cached + (count(usage.cache_creation_input_tokens) ?? 0), output_tokens: output, cached_tokens: cached, token_basis: 'provider' };
  }
  const input = count(usage.input_tokens ?? usage.prompt_tokens), output = count(usage.output_tokens ?? usage.completion_tokens);
  if (input === null || output === null) return null;
  const cached = count(usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens) ?? 0;
  if (cached > input) return null;
  return { input_tokens: input, output_tokens: output, cached_tokens: cached, token_basis: 'provider' };
}
export class UsageCollector {
  usage: Usage | null = null;
  private anthropicInput: number | null = null;
  private anthropicCached = 0;
  constructor(private provider: 'openai' | 'anthropic') {}
  accept(payload: any) {
    const complete = normalizeUsage(this.provider, payload);
    if (complete && !(this.provider === 'anthropic' && payload?.type === 'message_start')) this.usage = complete;
    if (this.provider === 'anthropic') {
      const start = payload?.message?.usage;
      if (count(start?.input_tokens) !== null) {
        this.anthropicInput = start.input_tokens + (count(start.cache_read_input_tokens) ?? 0) + (count(start.cache_creation_input_tokens) ?? 0);
        this.anthropicCached = count(start.cache_read_input_tokens) ?? 0;
      }
      const output = count(payload?.usage?.output_tokens);
      if (this.anthropicInput !== null && output !== null) this.usage = { input_tokens: this.anthropicInput, output_tokens: output, cached_tokens: this.anthropicCached, token_basis: 'provider' };
    }
  }
}
export function parseSseUsage(provider: 'openai' | 'anthropic', text: string) {
  const collector = new UsageCollector(provider);
  for (const block of text.replace(/\r\n/g, '\n').split('\n\n')) {
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (data && data !== '[DONE]') { try { collector.accept(JSON.parse(data)); } catch { /* A malformed event proves no usage. */ } }
  }
  return collector.usage;
}
// UTF-8 byte/4 heuristic, not a model tokenizer or a provider billing counter.
export function estimateTokens(text: string) { return Math.ceil(new TextEncoder().encode(text).byteLength / 4); }
export function computeCost(_model: string, usage: Usage | null, prices?: Prices): number | null {
  if (!usage || !prices || ![prices.input_per_million, prices.output_per_million, prices.cached_input_per_million ?? prices.input_per_million].every(x => Number.isFinite(x) && x >= 0)) return null;
  return ((usage.input_tokens - usage.cached_tokens) * prices.input_per_million + usage.cached_tokens * (prices.cached_input_per_million ?? prices.input_per_million) + usage.output_tokens * prices.output_per_million) / 1_000_000;
}
