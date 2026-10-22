import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Controls from '../src/pages/Controls';

const state = vi.hoisted(() => ({
  project: { id: 'project-controls', name: 'Live project' } as { id: string; name: string } | null,
  loading: false,
  error: '',
  settings: {
    enabled: false,
    provider: 'openai',
    tiers: {
      small: { model: 'small-configured-model', reasoning_effort: null },
      balanced: { model: 'balanced-configured-model', reasoning_effort: 'medium' },
      reasoning: { model: 'reasoning-configured-model', reasoning_effort: 'high' },
    },
    small_max_chars: 1200,
    balanced_max_chars: 6000,
    waste_checks_enabled: true,
    updated_at: null,
  },
  findings: 0,
}));

vi.mock('../src/api', () => ({
  useApp: () => ({ project: state.project, notify: vi.fn() }),
  useResource: (path: string | null, initial: unknown) => path?.startsWith('/api/auto')
    ? { data: { settings: state.loading || state.error ? null : state.settings, sentinel: 'traqiva-auto', method: 'rules_v1' }, loading: state.loading, error: state.error, refresh: vi.fn() }
    : { data: path ? { items: Array.from({ length: state.findings }, (_, index) => ({ id: `finding-${index}`, status: 'open' })) } : initial, loading: false, error: '', refresh: vi.fn() },
  api: vi.fn(),
  json: vi.fn(),
}));

const render = () => renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(Controls)));

beforeEach(() => {
  state.project = { id: 'project-controls', name: 'Live project' };
  state.loading = false;
  state.error = '';
  state.settings.enabled = false;
  state.settings.waste_checks_enabled = true;
  state.findings = 0;
});

describe('Real project controls', () => {
  it('shows saved routing models and efforts without claiming an unverified saving', () => {
    state.settings.enabled = true;
    const html = render();
    expect(html).toContain('Six controls');
    expect(html).toContain('Live project');
    expect(html).toContain('value="small-configured-model"');
    expect(html).toContain('<option value="medium" selected="">');
    expect(html).toMatch(/role="switch"[^>]*aria-label="Enable Auto routing"[^>]*checked=""/);
    expect(html).toContain('traqiva-auto');
    expect(html).toContain('Explicit model names pass through unchanged.');
    expect(html).toContain('No quality or savings guarantee.');
    expect(html).not.toContain('Verified savings');
  });

  it('does not report routing as off before its actual settings have loaded', () => {
    state.loading = true;
    const html = render();
    expect(html).toContain('Loading routing settings');
    expect(html).not.toContain('Auto is off');
    expect(html).not.toContain('value="small-configured-model"');
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
  });

  it('keeps failed loads visible and prevents saving unknown project settings', () => {
    state.error = 'Could not load routing settings';
    const html = render();
    expect(html).toContain('Could not load routing settings');
    expect(html).toContain('Try again');
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).not.toContain('Auto is off');
  });

  it('identifies four local tools without pretending browser settings configure a device', () => {
    const html = render();
    for (const name of ['Say Less', 'Read Less', 'Blocks', 'Browse']) expect(html).toContain(name);
    expect(html).toContain('Local status is not available in this browser.');
    expect(html).toContain('traqiva controls status');
    expect(html).toContain('Tools run only when invoked');
    expect(html).not.toContain('All six features are active');
  });

  it('offers manual analysis using real recorded traffic and links to its findings', () => {
    state.findings = 2;
    const html = render();
    expect(html).toContain('Waste Fixes');
    expect(html).toContain('Analyze recorded traffic');
    expect(html).toContain('2 open findings');
    expect(html).toContain('href="/app/improvements"');
    expect(html).toContain('Cache findings are recommendations');
  });

  it('uses the persisted Waste switch and prevents analysis when it is off', () => {
    state.settings.waste_checks_enabled = false;
    const html = render();
    expect(html).toContain('Waste checks are off');
    expect(html).not.toMatch(/aria-label="Enable Waste checks"[^>]*checked=""/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Analyze recorded traffic<\/button>/);
  });

  it('requires a selected project before displaying project-level controls', () => {
    state.project = null;
    const html = render();
    expect(html).toContain('Select a project');
    expect(html).not.toContain('Enable Auto routing');
    expect(html).not.toContain('Analyze recorded traffic');
  });
});
