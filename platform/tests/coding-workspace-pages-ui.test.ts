import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Gateway from '../src/pages/Gateway';
import Inbox from '../src/pages/Inbox';

const state = vi.hoisted(() => ({ builder: false, items: [] as Record<string, unknown>[], resources: [] as string[] }));
vi.mock('../src/features/agentBuilder', () => ({ get AGENT_BUILDER_ENABLED() { return state.builder; } }));
vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
  return {
    ...actual,
    useApp: () => ({ project: { id: 'coding-project', name: 'Coding project' }, session: { workspace: { mode: 'observe' } }, notify: vi.fn() }),
    useResource: (path: string) => { state.resources.push(path); return { data: { items: path.startsWith('/api/inbox') ? state.items : [] }, error: '', refresh: vi.fn() }; },
  };
});
const render = (page: typeof Gateway | typeof Inbox) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(page)));
beforeEach(() => { state.builder = false; state.items = []; state.resources = []; vi.stubGlobal('location', { origin: 'https://traqiva.example.test' }); });

describe('Coding workspace pages', () => {
  it('keeps real project-key management without advertising application SDK setup', () => {
    const html = render(Gateway);
    expect(html).toContain('Your coding project. Your keys.');
    expect(html).toContain('Create API key');
    expect(html).toContain('Project API keys');
    expect(html).toContain('Connect your coding agent');
    expect(html).not.toContain('OpenAI-compatible gateway');
    expect(html).not.toContain('API clients');
    expect(state.resources).toContain('/api/keys?project=coding-project');
  });
  it('hides previous evaluation notifications and links while preserving coding findings', () => {
    state.items = [
      { id: 'eval', type: 'eval', title: 'Old evaluation result', message: 'An exact match run.', created_at: '2026-10-22T00:00:00Z' },
      { id: 'link', title: 'Builder test run', href: '/app/evals?run=previous', created_at: '2026-10-22T00:00:00Z' },
      { id: 'coding', type: 'improvement', title: 'Coding input finding', href: '/app/improvements', created_at: '2026-10-22T00:00:00Z' },
    ];
    const html = render(Inbox);
    expect(html).toContain('Coding input finding');
    expect(html).not.toContain('Old evaluation result');
    expect(html).not.toContain('Builder test run');
    expect(html).not.toContain('/app/evals');
  });
  it('shows the honest empty state when only hidden builder notifications remain', () => {
    state.items = [{ id: 'eval', type: 'eval', title: 'Old evaluation result', created_at: '2026-10-22T00:00:00Z' }];
    expect(render(Inbox)).toContain('Nothing needs you');
  });
  it('retains the independent builder content for a later release', () => {
    state.builder = true;
    state.items = [{ id: 'eval', type: 'eval', title: 'Evaluation result', created_at: '2026-10-22T00:00:00Z' }];
    expect(render(Gateway)).toContain('OpenAI-compatible gateway');
    expect(render(Inbox)).toContain('Evaluation result');
  });
});
