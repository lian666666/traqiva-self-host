import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Home from '../src/pages/Home';

const state = vi.hoisted(() => ({ paths: [] as (string | null)[] }));
vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
  return { ...actual, useApp: () => ({ project: { id: 'evidence-project', name: 'Evidence project' } }), useResource: (path: string | null, initial: unknown) => { state.paths.push(path); return { data: initial, loading: false, error: '', refresh: vi.fn() }; } };
});
const render = (query = '') => renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [`/app/analytics${query}`] }, createElement(Home, { analytics: true })));
beforeEach(() => { state.paths = []; });
describe('Analytics evidence period deep links', () => {
  it('opens the source period instead of silently showing another date window', () => {
    for (const days of ['7', '30', '90']) {
      const html = render(`?days=${days}`);
      expect(state.paths).toContain(`/api/overview?project=evidence-project&days=${days}`);
      expect(html).toContain(`<option value="${days}" selected="">Last ${days} days</option>`);
    }
  });
  it('bounds untrusted query periods and retains the existing 14-day view', () => {
    render('?days=999'); expect(state.paths).toContain('/api/overview?project=evidence-project&days=7');
    render('?days=14'); expect(state.paths).toContain('/api/overview?project=evidence-project&days=14');
  });
});
