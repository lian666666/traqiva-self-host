import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DemoMetricDialog } from '../src/demo/DemoMetricDialog';
import { createDemoState, demoSummary } from '../src/demo/demoState';
import { DemoChart, demoCompactNumber, demoHeadlineMoney } from '../src/demo/demoUi';

describe('Public demo metric inspection', () => {
  it('gives charts readable units, period endpoints, and an identified selected day', () => {
    const html = renderToStaticMarkup(createElement(DemoChart, {
      values: [10, 30], dates: ['2026-10-20', '2026-10-21'], selectedIndex: 1,
      formatValue: value => `${value} requests`, label: 'Sample request volume',
    }));
    expect(html).toContain('30 requests');
    expect(html).toContain('15 requests');
    expect(html).toContain('0 requests');
    expect(html).toContain('Oct 20');
    expect(html).toContain('Oct 21');
    expect(html).toContain('<title>Sample request volume. Selected: Oct 21, 30 requests</title>');
    expect(html).toContain('<span>30 requests</span>');
    expect(html.indexOf('</svg>')).toBeLessThan(html.indexOf('<span>30 requests</span>'));
  });

  it('uses compact headline counts without hiding small dollar amounts', () => {
    expect(demoCompactNumber(216_800)).toBe('216.8K');
    expect(demoCompactNumber(60)).toBe('60');
    expect(demoHeadlineMoney(0.6789)).toBe('$0.68');
    expect(demoHeadlineMoney(Number.NaN)).toBe('$0.00');
  });

  it('opens a modal tied to the whole selected period, not hidden trace filters', () => {
    const state = { ...createDemoState(), days: 7 as const, query: 'nothing-matches', model: 'not-a-model' };
    const html = renderToStaticMarkup(createElement(DemoMetricDialog, {
      metric: 'requests', state, onClose: () => {}, onInspect: () => {}, onAnalytics: () => {},
    }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('14');
    expect(html).toContain('Inspect day');
    expect(html).toContain('type="range"');
    expect(html).toContain('Inspect sample traces');
    expect(html).toContain('Fictional sample');
    expect(html).not.toContain('NaN');
  });

  it('distinguishes input-token volume from its cached share without claiming savings', () => {
    const state = createDemoState();
    const summary = demoSummary(state);
    const renderMetric = (metric: 'cache' | 'input') => renderToStaticMarkup(createElement(DemoMetricDialog, {
      metric, state, onClose: () => {}, onInspect: () => {}, onAnalytics: () => {},
    }));
    expect(renderMetric('input')).toContain(demoCompactNumber(summary.inputTokens));
    expect(renderMetric('input')).toContain('Input tokens');
    expect(renderMetric('cache')).toContain(`${summary.cachePercent!.toFixed(1)}%`);
    expect(renderMetric('cache')).toContain('Uncached input');
    expect(renderMetric('cache')).not.toContain('verified savings');
  });
});
