import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Ask from '../src/pages/Ask';
import type { AskConversationDetail, AskStatus } from '../src/pages/askWorkspaceData';

const state = vi.hoisted(() => ({ project: 'project-real', paths: [] as (string | null)[], status: null as AskStatus | null, statusLoading: false, statusError: '', chats: [] as Record<string, unknown>[], detail: null as AskConversationDetail | null, detailLoading: false, detailError: '', historyError: '' }));
vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
  return { ...actual, useApp: () => ({ project: state.project ? { id: state.project, name: 'Real project' } : null, session: { projects: [{ id: 'project-real', name: 'Real project' }, { id: 'project-other', name: 'Other project' }] }, setProject: vi.fn() }), useResource: (path: string | null, initial: unknown) => {
    state.paths.push(path);
    if (path?.startsWith('/api/ask/status?')) return { data: state.status || initial, loading: state.statusLoading, error: state.statusError, refresh: vi.fn() };
    if (path?.startsWith('/api/ask/conversations?')) return { data: { items: state.chats }, loading: false, error: state.historyError, refresh: vi.fn() };
    return { data: state.detail || initial, loading: state.detailLoading, error: state.detailError, refresh: vi.fn() };
  } };
});
function render(path = '/app/ask') { return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(Ask))); }
beforeEach(() => {
  state.project = 'project-real'; state.paths = []; state.chats = []; state.detail = null; state.statusLoading = false; state.statusError = ''; state.detailLoading = false; state.detailError = ''; state.historyError = '';
  state.status = { hosted: { available: true, model: 'gpt-6-luna', label: 'GPT-6 Luna', allowance: { limit_usd: 1, used_usd: .2, reserved_usd: .1, remaining_usd: .7, reset: 'never' } } };
});

describe('Ask evidence workspace', () => {
  it('defaults to the built-in model with a real lifetime balance and concise composer', () => {
    const html = render();
    expect(state.paths).toContain('/api/ask/status?project=project-real');
    expect(state.paths).toContain('/api/ask/conversations?project=project-real');
    expect(html).toContain('What should we look into?');
    expect(html).toContain('<option value="hosted" selected="">GPT-6 Luna</option>');
    expect(html).toContain('$0.70 left'); expect(html).toContain('$0.20 used of $1.00'); expect(html).toContain('$0.10 reserved');
    expect(html).toContain('Lifetime allowance · does not reset'); expect(html).toContain('conservative reservation');
    expect(html).toContain('Uses OpenAI with your question, recent chat and selected project metadata. Raw trace bodies are not sent.');
    expect(html).toContain('aria-label="Ask evidence period"'); expect(html).toContain('<option value="30" selected="">Last 30 days</option>');
    expect(html).not.toContain('Provider API key'); expect(html).not.toContain('value="byok"'); expect(html).not.toContain('132.1K tokens');
  });

  it('keeps exhausted credit visible and disables paid sends while offering statistics', () => {
    state.status!.hosted.allowance.remaining_usd = 0;
    const html = render('/app/ask?question=Analyze');
    expect(html).toContain('Your $1 lifetime AI allowance has been used or reserved.');
    expect(html).toContain('Use project statistics');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Send question"/);
  });

  it('falls back to statistics when hosted AI is unavailable without pretending a model was called', () => {
    state.status!.hosted.available = false;
    const html = render('/app/ask?question=Analyze');
    expect(html).toContain('Built-in AI is unavailable.');
    expect(html).toContain('Unavailable until enabled'); expect(html).not.toContain('$0.70 left');
    expect(html).toContain('<option value="statistics" selected="">Project statistics</option>');
    expect(html).toContain('Computed project statistics · no model call');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Send question"/);
  });

  it('never displays an initial fake allowance while status is loading or failed', () => {
    state.statusLoading = true;
    const loading = render('/app/ask?question=Analyze');
    expect(loading).toContain('Checking allowance…'); expect(loading).not.toContain('$0.70 left');
    expect(loading).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Send question"/);
    state.statusLoading = false; state.statusError = 'Status unavailable';
    const failed = render(); expect(failed).toContain('Allowance unavailable'); expect(failed).toContain('Project statistics remain available');
  });

  it('loads persisted chats with selectable history and source-derived evidence', () => {
    state.chats = [{ id: 'chat-real', title: 'Is caching working?', updated_at: '2026-10-22T17:00:00Z' }];
    state.detail = { conversation: { id: 'chat-real', title: 'Is caching working?' }, messages: [{ id: 'answer-real', role: 'assistant', content: 'Only one request has reported cache usage.', method: 'llm', model: 'gpt-6-luna', sources: [{ type: 'project_statistics', project_id: 'project-real', days: 30, href: 'https://unsafe.example' }, { type: 'model_breakdown', project_id: 'project-other' }] }] };
    const html = render('/app/ask?chat=chat-real');
    expect(state.paths).toContain('/api/ask/conversations/chat-real?project=project-real');
    expect(html).toContain('aria-pressed="true"'); expect(html).toContain('Only one request has reported cache usage.');
    expect(html).toContain('How this was answered'); expect(html).toContain('Copy answer');
    expect(html).toContain('href="/app/analytics?days=30"'); expect(html).not.toContain('unsafe.example'); expect(html).not.toContain('Model breakdown');
  });

  it('does not expose old detail content while another conversation loads or fails', () => {
    state.detail = { conversation: null, messages: [{ role: 'assistant', content: 'Stale answer must stay hidden' }] };
    state.detailLoading = true;
    const loading = render('/app/ask?chat=new-chat'); expect(loading).toContain('Loading conversation…'); expect(loading).not.toContain('Stale answer');
    state.detailLoading = false; state.detailError = 'Conversation not found';
    const failed = render('/app/ask?chat=new-chat'); expect(failed).toContain('Conversation not found'); expect(failed).not.toContain('Stale answer');
    expect(failed).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Send question"/);
  });

  it('does not request scoped resources or expose stale conversations without a project', () => {
    state.project = ''; state.chats = [{ id: 'stale', title: 'Private earlier chat' }];
    const html = render(); expect(state.paths).toEqual([null, null, null]); expect(html).toContain('Choose a project to start');
    expect(html).not.toContain('Private earlier chat'); expect(html).not.toContain('$0.70 left');
  });
});
