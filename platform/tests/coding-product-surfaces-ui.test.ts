import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Marketing from '../src/Marketing';
import GetStartedPanel from '../src/landing/GetStartedPanel';
import FreePlanStep from '../src/components/FreePlanStep';

const flags = vi.hoisted(() => ({ builder: false }));
vi.mock('../src/features/agentBuilder', () => ({ get AGENT_BUILDER_ENABLED() { return flags.builder; } }));
vi.mock('../src/api', () => ({ useApp: () => ({ session: null, notify: vi.fn() }) }));
const render = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(MemoryRouter, null, element));
beforeEach(() => { flags.builder = false; vi.stubGlobal('location', { origin: 'https://traqiva.example.test' }); });

describe('Coding-agent product launch surfaces', () => {
  it('keeps the homepage focused on coding agents without advertising the disabled builder product', () => {
    const html = render(createElement(Marketing));
    expect(html).toContain('Recoverable compression for coding agents');
    expect(html).toContain('Create your workspace');
    expect(html).not.toContain('Agents you build');
    expect(html).not.toContain('agents you build');
    expect(html).not.toContain('Cloud workspace');
    expect(html).not.toContain('TRAQIVA CLOUD');
    expect(html).not.toContain('evaluations');
    expect(html).not.toContain('exact-match evaluation');
  });
  it('offers an account for coding activity alongside local setup, with no builder offer', () => {
    const html = render(createElement(GetStartedPanel, { origin: 'https://traqiva.example.test', onClose: vi.fn() }));
    expect(html).toContain('Agents you run');
    expect(html).toContain('Coding workspace');
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain('Agents you build');
    expect(html).not.toContain('TRAQIVA CLOUD');
  });
  it('describes only the currently available coding workspace in the free-plan step', () => {
    const html = render(createElement(FreePlanStep, { email: 'alex@example.invalid', name: 'My coding project', busy: false, saving: false, onNameChange: vi.fn(), onSubmit: vi.fn(), onBack: vi.fn() }));
    expect(html).toContain('Start on Free');
    expect(html).toContain('100K events');
    expect(html).toContain('Plan preview.');
    expect(html).not.toContain('evaluations');
  });
  it('retains the isolated builder offers for a future release switch', () => {
    flags.builder = true;
    expect(render(createElement(GetStartedPanel, { origin: 'https://traqiva.example.test', onClose: vi.fn() }))).toContain('Agents you build');
    expect(render(createElement(Marketing))).toContain('Agents you build');
  });
});
