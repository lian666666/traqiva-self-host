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
  it('shows the concise free plan and actual provider-cost boundary instead of a required naming form', () => {
    const html = render();
    expect(html).toContain('Start on Free');
    expect(html).toContain('$0. No card.');
    expect(html).toContain('Account settings');
    expect(html).not.toContain('Give your project a home.');
    expect(html).not.toContain('autoFocus');
    expect(html).not.toContain('25K');
    expect(html).not.toContain('600 minutes');
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
