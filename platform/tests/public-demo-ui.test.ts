import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import InteractiveDemo from '../src/demo/InteractiveDemo';
import { createDemoState } from '../src/demo/demoState';

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
});
