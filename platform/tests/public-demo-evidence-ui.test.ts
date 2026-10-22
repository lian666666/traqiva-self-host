import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { demoBriefs, demoTraces } from '../src/demo/demoData';
import { createDemoState, type DemoState } from '../src/demo/demoState';
import { DemoTraffic } from '../src/demo/DemoTraffic';
import { DemoWorkspace } from '../src/demo/DemoWorkspace';

function renderWorkspace(state: DemoState) {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(DemoWorkspace, {state, dispatch: () => {}, go: () => {}})));
}
function renderTraffic(state: DemoState) {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(DemoTraffic, {state, dispatch: () => {}, go: () => {}})));
}

describe('Public demo evidence journey', () => {
  it('links an improvement to actual matching coding-agent traces without a deferred evaluation next step', () => {
    const html = renderWorkspace({...createDemoState(), view: 'improvements'});
    expect(html).toContain('aria-label="Inspect demo-trace-001"');
    expect(html).toContain('4 matching requests');
    expect(html).toContain('Inspect matching requests');
    expect(html).not.toContain('Test a change');
    expect(html).not.toContain('exact-match cases');
    expect(html).not.toContain('potential/day');
    expect(html).not.toContain('Potential per day');
  });
  it('shows a coding-agent connection path without SDK or project-key examples', () => {
    const html=renderTraffic({...createDemoState(),view:'gateway'});
    expect(html).toContain('Connect a coding agent');
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain('Connect an SDK');
    expect(html).not.toContain('JavaScript');
    expect(html).not.toContain('demo_only_not_a_credential');
  });
  it('keeps quality dashboards and quality notifications out of the coding-agent release', () => {
    const dashboard=renderTraffic({...createDemoState(),view:'dashboards'});
    const inbox=renderWorkspace({...createDemoState(),view:'inbox'});
    expect(dashboard).not.toContain('>Quality<');
    expect(inbox).not.toContain('One sample answer needs a closer look');
    expect(createDemoState().notifications).toHaveLength(2);
  });

  it('does not keep a reviewed brief open under an empty open filter', () => {
    const state = createDemoState();
    state.view = 'improvements';
    state.briefStatus = Object.fromEntries(demoBriefs.map(brief => [brief.id, 'reviewed']));
    const html = renderWorkspace(state);
    expect(html).toContain('No open briefs');
    expect(html).not.toContain('demo-brief-detail');
  });

  it('keeps the sample period and request accounting visible in trace details', () => {
    const trace = demoTraces.at(-1)!;
    const html = renderTraffic({...createDemoState(), view: 'traces', selectedTrace: trace.id});
    expect(html).toContain('aria-label="Demo time range"');
    expect(html).toContain('Input tokens');
    expect(html).toContain('Output tokens');
    expect(html).toContain('Priced cost');
    expect(html).toContain('Sample time · UTC');
    expect(html).toContain('tabindex="-1"');
  });

  it('refreshes an existing sample answer for the selected period', () => {
    const html = renderWorkspace({...createDemoState(), view: 'ask', days: 7, question: 'How much did this demo spend?', answer: 'STALE_30DAY_ANSWER'});
    expect(html).toContain('14 fictional request');
    expect(html).not.toContain('STALE_30DAY_ANSWER');
    expect(html).toContain('No model call');
  });

  it('exposes analytics period selection and a trace drilldown per model', () => {
    const html = renderTraffic({...createDemoState(), view: 'analytics'});
    expect(html).toContain('aria-label="Demo time range"');
    expect(html).toContain('aria-label="Inspect atlas-reasoning traces"');
    expect(html).toContain('Show matching requests');
  });
});
