import { describe, expect, it } from 'vitest';
import { moveReportSelection, reportHref, visibleInboxReports, type InboxReport } from '../src/pages/inboxReports';

const report = (id: string, extra: Partial<InboxReport> = {}): InboxReport => ({ id, title: `Report ${id}`, type: 'improvement', message: 'Observed project traffic', created_at: '2026-10-22T10:00:00Z', ...extra });

describe('Inbox report filtering and navigation', () => {
  it('searches recorded titles and content without adding missing reports', () => {
    const items = [report('slow', { title: 'Review latency', message: 'Slow upstream requests' }), report('failed', { message: 'Recorded timeout' })];
    expect(visibleInboxReports(items, false, ' LATENCY ').map(item => item.id)).toEqual(['slow']);
    expect(visibleInboxReports(items, false, 'TIMEOUT').map(item => item.id)).toEqual(['failed']);
    expect(visibleInboxReports(items, false, 'unrecorded')).toEqual([]);
    expect(visibleInboxReports([], false)).toEqual([]);
  });

  it('combines the selected report type with search and puts invalid timestamps last', () => {
    const items = [
      report('unknown-time', { created_at: 'invalid' }),
      report('old', { created_at: '2026-10-21T10:00:00Z' }),
      report('new', { type: 'update', created_at: '2026-10-22T11:00:00Z' }),
    ];
    expect(visibleInboxReports(items, false).map(item => item.id)).toEqual(['new', 'old', 'unknown-time']);
    expect(visibleInboxReports(items, false, 'traffic', 'update').map(item => item.id)).toEqual(['new']);
    expect(items.map(item => item.id)).toEqual(['unknown-time', 'old', 'new']);
  });

  it('keeps builder reports hidden for direct, encoded and normalized builder routes', () => {
    const items = [
      report('coding'),
      report('eval', { type: 'eval' }),
      report('builder', { href: '/app/experiments?run=recorded' }),
      report('encoded', { href: '/app/%65vals?run=recorded' }),
      report('normalized', { href: '/app/traces/../evals' }),
    ];
    expect(visibleInboxReports(items, false).map(item => item.id)).toEqual(['coding']);
    expect(visibleInboxReports(items, true)).toHaveLength(5);
  });

  it('moves from an empty selection and clamps at the ends of the current filtered list', () => {
    const items = [report('new'), report('old')];
    expect(moveReportSelection([], null, 1)).toBeNull();
    expect(moveReportSelection(items, null, 1)).toBe('new');
    expect(moveReportSelection(items, null, -1)).toBe('old');
    expect(moveReportSelection(items, 'new', -1)).toBe('new');
    expect(moveReportSelection(items, 'new', 1)).toBe('old');
    expect(moveReportSelection(items, 'old', 1)).toBe('old');
    expect(moveReportSelection([items[1]], 'new', 1)).toBe('old');
  });
});

describe('Inbox report destinations', () => {
  it('uses a safe internal destination or the actual finding destination', () => {
    expect(reportHref(report('trace', { href: '/app/traces?id=actual#input' }), false)).toBe('/app/traces?id=actual#input');
    expect(reportHref(report('finding'), false)).toBe('/app/improvements');
    expect(reportHref(report('unknown', { type: 'unknown' }), false)).toBeNull();
  });

  it.each(['https://outside.test/app/traces', '//outside.test/app/traces', '/app/../../outside', '/app/\\outside.test', '/app/%5coutside.test', '/app/%00traces', '/app/%'])('does not navigate to an unsafe destination: %s', href => {
    expect(reportHref(report('unsafe', { type: 'update', href }), false)).toBeNull();
  });

  it('prevents navigation to a hidden builder feature without changing the feature flag', () => {
    expect(reportHref(report('eval', { type: 'eval', href: '/app/%65vals' }), false)).toBeNull();
    expect(reportHref(report('eval', { type: 'eval' }), true)).toBe('/app/evals');
  });
});
