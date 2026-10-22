import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Marketing from '../src/Marketing';

vi.mock('../src/api', () => ({ useApp: () => ({ session: null, notify: vi.fn() }) }));
beforeEach(() => { vi.stubGlobal('location', { origin: 'https://traqiva.example.test' }); });

const renderPricing = () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Marketing)));
  return html.match(/<section class="landing-pricing"[^>]*>[\s\S]*?<\/section>/)?.[0] ?? '';
};

describe('Public pricing policy preview', () => {
  it('shows the requested Free policy in the coding workspace without advertising the disabled builder', () => {
    const html = renderPricing();
    const text = html.replace(/<[^>]*>/g, ' ');
    expect(text).toMatch(/Free\s*\$0/);
    for (const value of ['No card', '100K', '600', '25K', '$1 per user in total', '$50', '64 KB']) expect(text).toContain(value);
    expect(text).not.toContain('$10');
    expect(text).toContain('Lifetime allowance; no automatic reset');
    expect(text).toMatch(/one person/i);
    expect(text).toMatch(/next month/i);
    expect(text).toMatch(/per product/i);
    expect(text).toMatch(/standard rates/i);
    expect(text).toMatch(/started 64 KB/i);
    expect(html).not.toMatch(/agents you build|evaluations|CLOUD WORKSPACE/i);
  });

  it('separates the hosted lifetime allowance from the monthly traffic preview', () => {
    const html = renderPricing();
    expect(html).toContain('Monthly traffic allowances, paid upgrades and Team trials are not active yet.');
    expect(html).toContain('built-in Ask allowance is separate and does not renew monthly');
    const text = html.replace(/<[^>]*>/g, ' ');
    expect(text).toMatch(/Each month\s*(?:·\s*)?Planned/i);
    expect(text).toMatch(/Past that\s*(?:·\s*)?Planned/i);
    expect(html).toContain('Gateway and your-key model calls are billed separately by your provider');
  });

  it('keeps the Team trial unavailable and offers no payment or credit-grant action', () => {
    const html = renderPricing();
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Try Team free for 7 days<\/button>/);
    expect(html).toContain('Coming soon');
    expect(html).toContain('href="/signup"');
    const actions = html.match(/<(?:button|a)\b[^>]*>[\s\S]*?<\/(?:button|a)>/g)?.join('') ?? '';
    expect(actions).not.toMatch(/href="[^"]*(?:checkout|payment|trial|credits)|Add (?:a )?card|Buy credits/);
    expect(html).not.toContain('name="card');
  });

  it('retains the free local CLI offer independently of the workspace policy', () => {
    const html = renderPricing();
    const local = html.split('</article>')[0];
    expect(local).toContain('LOCAL CLI');
    expect(local).toContain('Free');
    expect(local).toContain('Open-source software');
    expect(local).toContain('No account required for local compression');
    expect(local).toContain('Install the CLI');
  });
});
