import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import InteractiveDemo from '../src/demo/InteractiveDemo';
import { createDemoState, demoReducer, demoSummary } from '../src/demo/demoState';
import { DemoHome } from '../src/demo/DemoHome';
import { demoBriefs } from '../src/demo/demoData';
import { demoCompactNumber } from '../src/demo/demoUi';

const render = () => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(InteractiveDemo)));
describe('Anonymous public demo', () => {
  it('renders a white-first workspace with a permanent fictional-data notice and reset', () => {
    const html = render();
    expect(html.includes('data-demo-theme="light"')).toBe(true);
    expect(html.includes('Interactive demo · fictional data')).toBe(true);
    expect(html.includes('Changes reset on reload')).toBe(true);
    expect(html.includes('Reset demo')).toBe(true);
    expect(html.includes('Good morning, Demo')).toBe(true);
  });
  it('exposes the product modules as demo navigation rather than private app links', () => {
    const html = render();
    for (const name of ['Home','Gateway','Analytics','Traces','Dashboards','Improvements','Experiments','Datasets','Scorers','Governance','Settings']) expect(html.includes(name)).toBe(true);
    expect(html.includes('href="/app/')).toBe(false);
    expect(html.includes('href="/signup"')).toBe(true);
  });
  it('starts with an isolated fixture, not a real project or account credential', () => {
    expect(createDemoState()).toMatchObject({view:'home',theme:'light',keyVisible:false,evaluationResults:null});
    const html=render();
    expect(html.includes('demo_only_not_a_credential')).toBe(false);
    expect(html.includes('verified monetary savings')).toBe(false);
    expect(html.includes('Auto-caching saved')).toBe(false);
  });
  it('shows period-wide overview numbers even after a trace search, with distinct useful metrics', () => {
    const state={...createDemoState(),days:7 as const,query:'no-matching-trace',model:'not-a-model'};
    const summary=demoSummary({...state,query:'',model:''});
    const html=renderToStaticMarkup(createElement(DemoHome,{state,dispatch:()=>{},go:()=>{}}));
    expect(html).toContain(demoCompactNumber(summary.inputTokens));
    expect(html.replace(/<[^>]*>/g,'')).toContain('14 requests');
    for(const name of ['Spend: details','Input cached: details','Requests: details','Input tokens: details','3 open findings. Review evidence.'])expect(html).toContain(name);
    expect(html).toContain('Inspect Invoice extraction requests');
    expect(html).not.toContain('Cache coverage');
    expect(html).not.toContain('Potential per day');
  });
  it('reflects reviewed findings in the overview instead of leaving a stale next action', () => {
    const state=demoBriefs.reduce((current,brief)=>demoReducer(current,{type:'review-brief',id:brief.id,status:'reviewed'}),createDemoState());
    const html=renderToStaticMarkup(createElement(DemoHome,{state,dispatch:()=>{},go:()=>{}}));
    expect(html).toContain('0 open findings. Review evidence.');
    expect(html).toContain('All findings reviewed');
    expect(html).not.toContain('Reliability Give repeated failures');
  });
});
