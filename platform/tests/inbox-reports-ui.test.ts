import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Inbox from '../src/pages/Inbox';

const state = vi.hoisted(() => ({
  items: [] as Record<string, unknown>[], loading: false, error: '', project: 'project-real', paths: [] as (string | null)[],
}));
vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
  return {
    ...actual,
    useApp: () => ({ project: state.project ? { id: state.project, name: 'Real project' } : null }),
    useResource: (path: string | null) => {
      state.paths.push(path);
      return { data: { items: state.items }, loading: state.loading, error: state.error, refresh: vi.fn() };
    },
  };
});
const render = () => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Inbox)));
beforeEach(() => { state.items = []; state.loading = false; state.error = ''; state.project = 'project-real'; state.paths = []; });

describe('Inbox report workspace', () => {
  it('provides searchable reports and an unselected detail pane for a successful empty inbox', () => {
    const html = render();
    expect(state.paths).toContain('/api/inbox?project=project-real');
    expect(html).toContain('aria-label="Search reports"');
    expect(html).toContain('aria-label="Filter report type"');
    expect(html).toContain('aria-label="Refresh reports"');
    expect(html).toContain('Nothing needs you');
    expect(html).toContain('Select a report');
    expect(html).toContain('0 reports');
    expect(html).toContain('aria-label="Previous report" disabled');
    expect(html).toContain('aria-label="Next report" disabled');
  });

  it('sorts actual report rows newest first and leaves their details unselected', () => {
    state.items = [
      { id: 'older', type: 'improvement', title: 'Review slow requests', message: 'Recorded requests exceeded the latency threshold.', created_at: '2026-10-21T10:00:00Z' },
      { id: 'newer', type: 'improvement', title: 'Review failed requests', message: 'A recorded request failed.', created_at: '2026-10-22T10:00:00Z' },
    ];
    const html = render();
    expect(html.indexOf('Review failed requests')).toBeLessThan(html.indexOf('Review slow requests'));
    expect(html).toContain('2 reports');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('Select a report');
    expect(html).not.toContain('Nothing needs you');
  });

  it('keeps loading and failures distinct from an empty successful response', () => {
    state.loading = true;
    const loading = render();
    expect(loading).toContain('Loading reports');
    expect(loading).not.toContain('Nothing needs you');
    state.loading = false; state.error = 'Reports could not be loaded';
    const failed = render();
    expect(failed).toContain('Reports could not be loaded');
    expect(failed).toContain('Try again');
    expect(failed).not.toContain('Nothing needs you');
  });

  it('does not load a resource or show previous items without a selected project', () => {
    state.project = '';
    state.items = [{ id: 'previous', title: 'Previous project report', created_at: '2026-10-22T10:00:00Z' }];
    const html = render();
    expect(state.paths).toEqual([null]);
    expect(html).toContain('Choose a project');
    expect(html).not.toContain('Previous project report');
  });
});
