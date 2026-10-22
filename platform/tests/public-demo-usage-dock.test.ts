import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import InteractiveDemo from '../src/demo/InteractiveDemo';
import { DemoAssistantDock } from '../src/demo/DemoAssistantDock';
import { createDemoState, demoAnswer, demoReducer, demoSummary } from '../src/demo/demoState';

describe('Separate fictional demo usage and assistant', () => {
  it('shows four labeled sample meters and a Traqiva AI launcher on the project overview', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(InteractiveDemo)));
    expect(html).toContain('Sample usage · no charges');
    for (const label of ['AI credits', 'Observability', 'Agent runs', 'Routing']) expect(html).toContain(label);
    expect(html).toContain('60 / 100K');
    expect(html).toContain('No run duration recorded in this sample');
    expect(html).toContain('No routing decisions recorded in this sample');
    expect(html).toContain('aria-label="Open Traqiva AI sample chat"');
    expect(html).toContain('Traqiva AI');
  });

  it('keeps local assistant questions separate from fictional coding-agent traffic', () => {
    const initial = createDemoState();
    const before = demoSummary(initial);
    let next = demoReducer(initial, { type: 'set', key: 'question', value: 'How much did this demo spend?' });
    next = demoReducer(next, { type: 'set', key: 'answer', value: demoAnswer(next.question, next) });
    expect(next.answer).toContain('fictional request records');
    expect(demoSummary(next)).toEqual(before);
  });

  it('opens a clearly labeled local sample assistant with close and full-view controls', () => {
    const initial = createDemoState();
    const state = { ...initial, question: 'How much did this demo spend?', answer: 'answered' };
    const html = renderToStaticMarkup(createElement(DemoAssistantDock, { state, dispatch: () => {}, go: () => {}, open: true, onOpenChange: () => {} }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('Sample answers only · no model call or charge.');
    expect(html).toContain(`${demoSummary(initial).requests} fictional request records`);
    expect(html).toContain('Minimize Traqiva AI sample chat');
    expect(html).toContain('Expand Traqiva AI sample chat');
    expect(html).toContain('Close Traqiva AI sample chat');
    expect(html).not.toContain('GPT-6 Luna');
    expect(html).not.toContain('/api/ask');
  });
});
