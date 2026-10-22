import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Admin from '../src/pages/Admin';

vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
  return {
    ...actual,
    useApp: () => ({ session: null, reload: vi.fn(), notify: vi.fn() }),
  };
});

const render = () => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Admin, { billing: true })));

describe('Free workspace billing', () => {
  it('presents future allowances as an inactive plan preview alongside current free access', () => {
    const html = render();
    expect(html).toContain('Plan preview.');
    expect(html).toMatch(/Each month[^<]*<small>Planned<\/small>/);
    expect(html).toContain('100K events');
    expect(html).toContain('25K routing decisions');
    expect(html).toContain('600');
    expect(html).toContain('not active yet');
    expect(html).toContain('No payment method is collected');
    expect(html).toContain('Billed by your upstream provider');
    expect(html).not.toContain('name="card');
  });

  it('keeps the unavailable Team trial visibly disabled instead of offering checkout', () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Try Team free for 7 days<\/button>/);
    expect(html).toContain('Coming soon');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('href="https://checkout.');
  });
});
