import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Onboarding from '../src/Onboarding';
import type { Session } from '../src/types';

const state = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock('../src/api', () => ({
  useApp: () => ({ session: state.session, loading: false, error: '', reload: async () => {}, setProject: () => {} }),
  api: vi.fn(), json: vi.fn(), date: vi.fn(),
}));
vi.mock('../src/useConnectionStatus', () => ({ useConnectionStatus: () => ({ status: null, online: true, checking: false, error: '', refresh: vi.fn() }) }));
const render = () => renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/onboarding'] }, createElement(Onboarding)));
beforeEach(() => {
  vi.stubGlobal('location', { origin: 'https://traqiva.example.test' });
  state.session = { user: { id: 'free-user', name: 'Alex', email: 'alex@example.test' }, workspace: null, projects: [{ id: 'existing-project', name: 'Existing project' }], activeProject: { id: 'existing-project', name: 'Existing project' }, setup: { stage: 'project', goals: ['coding'], project_id: 'existing-project' }, terms: { version: 'test', accepted: false, accepted_at: null } };
});
describe('Stage two free workspace', () => {
  it('shows the requested pricing policy while keeping unavailable credits and paid actions explicit', () => {
    const html = render();
    expect(html).toContain('Start on Free');
    expect(html).toContain('$0. No card.');
    expect(html).toContain('Account settings');
    expect(html).not.toContain('Give your project a home.');
    expect(html).not.toContain('autoFocus');
    expect(html).toContain('100K events');
    expect(html).toContain('600 minutes of agent runs');
    expect(html).toContain('25K routing decisions');
    expect(html).toContain('$1 per user in total');
    expect(html).toContain('Lifetime allowance; no automatic reset');
    expect(html).toContain('at most $50 a month per product');
    expect(html).toContain('one event per started 64 KB');
    expect(html).toContain('One person.');
    expect(html).toContain('Monthly traffic allowances, paid upgrades and Team trials are not active yet.');
    expect(html).toContain('does not renew monthly');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Try Team free for 7 days/);
    expect(html).not.toContain('Caveman');
    expect(html).not.toContain('quality checks');
    expect(html).not.toContain('evals');
    expect(html).not.toContain('Start free trial');
    expect(html.toLowerCase()).toContain('billed separately');
    expect(html).not.toContain('name="card');
    expect(html).toContain('Back');
  });
  it('keeps one current dot at the second step', () => {
    const html = render();
    const dots = html.slice(html.indexOf('class="step-dots"'));
    expect(dots.match(/class="active"/g)).toHaveLength(1);
    expect(dots).toMatch(/<span class=""><\/span><span class="active"><\/span><span class=""><\/span>/);
  });
  it('preserves the existing first and third steps', () => {
    state.session!.setup!.stage = 'goals';
    expect(render()).toContain('What do you want to do?');
    state.session!.setup!.stage = 'connect';
    expect(render()).toContain('Review your workspace terms');
    expect(render()).not.toContain('Start on Free');
  });
});
