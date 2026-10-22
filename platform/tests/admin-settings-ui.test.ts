import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Admin from '../src/pages/Admin';
import type { Session } from '../src/types';

const state = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
  return {
    ...actual,
    useApp: () => ({ session: state.session, project: state.session?.activeProject, reload: vi.fn(), notify: vi.fn(), setProject: vi.fn() }),
    useResource: () => ({ data: { google: true, github: true }, loading: false, error: '' }),
  };
});

function render(path = '/app/admin') {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(Admin)));
}

beforeEach(() => {
  state.session = {
    user: { id: 'owner-1', name: 'Taylor', email: 'taylor@example.test', google_linked: false, github_linked: true },
    workspace: { id: 'workspace-real-42', name: 'Research Workspace', retention_days: 90, mode: 'optimize', autopilot: 'off', monthly_budget: 250 },
    projects: [{ id: 'project-real-9', name: 'Support assistant' }],
    activeProject: { id: 'project-real-9', name: 'Support assistant' },
  };
});

describe('Admin Settings', () => {
  it('shows the current workspace identity without suggesting the display slug is a stored URL', () => {
    const html = render();
    expect(html).toContain('Admin Settings');
    expect(html).toContain('workspace-real-42');
    expect(html).toContain('Research Workspace');
    expect(html).toContain('research-workspace');
    expect(html).toContain('Display only');
    expect(html).toContain('not a workspace URL');
    expect(html).toContain('Copy organization ID');
    expect(html).toContain('Copy organization slug');
  });

  it('keeps repository access separate from an already connected GitHub login', () => {
    const html = render();
    expect(html).toContain('Repository integration is not enabled');
    expect(html).toContain('GitHub sign-in does not grant repository access');
    expect(html).toContain('Not connected');
    expect(html).toContain('href="/app/admin?tab=security"');
    expect(html).not.toContain('Repository connected');
  });

  it('keeps the current retention and gateway preferences accessible from System', () => {
    const html = render('/app/admin?section=system');
    expect(html).toContain('Retention window');
    expect(html).toContain('<option value="90" selected="">90 days</option>');
    expect(html).toMatch(/<input(?=[^>]*checked="")(?=[^>]*value="optimize")[^>]*>/);
    expect(html).toContain('<option value="off" selected="">Off');
    expect(html).toContain('value="250"');
  });

  it('renders the actual account connections on Security and after an OAuth callback', () => {
    expect(render('/app/admin?tab=security')).toContain('GitHub sign-in');
    expect(render('/app/admin?github=linked')).toContain('GitHub is connected to your account.');
  });

  it('lists the current projects and owner without offering unavailable team management', () => {
    const projects = render('/app/admin?tab=projects');
    expect(projects).toContain('Support assistant');
    expect(projects).toContain('project-real-9');
    const team = render('/app/admin?tab=team');
    expect(team).toContain('taylor@example.test');
    expect(team).toMatch(/<button[^>]*disabled=""[^>]*>Invite a teammate<\/button>/);
    expect(team).toContain('not enabled');
  });

  it('keeps unsupported settings unavailable and routes Billing to the existing plan page', () => {
    const html = render();
    for (const label of ['Single sign-on', 'Data sources', 'Judges', 'Webhooks']) {
      expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>[^<]*${label}`));
    }
    expect(html).toContain('href="/app/billing"');
  });
});
