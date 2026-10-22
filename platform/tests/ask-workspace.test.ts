import { describe, expect, it } from 'vitest';
import { askCanSend, askEvidence, askMoney, askProjectPath, askQuestions, type AskAllowance } from '../src/pages/askWorkspaceData';

const allowance: AskAllowance = { limit_usd: 1, used_usd: .2, reserved_usd: .1, remaining_usd: .7, reset: 'never' };
const ready = { question: 'Analyze evidence', busy: false, projectId: 'p', mode: 'hosted' as const, statusLoading: false, hostedAvailable: true, allowance, key: '', model: '' };

describe('Ask workspace safety and presentation', () => {
  it('requires a usable allowance and server availability for hosted sends', () => {
    expect(askCanSend(ready)).toBe(true);
    expect(askCanSend({ ...ready, allowance: { ...allowance, remaining_usd: 0 } })).toBe(false);
    expect(askCanSend({ ...ready, allowance: { ...allowance, remaining_usd: NaN } })).toBe(false);
    expect(askCanSend({ ...ready, hostedAvailable: false })).toBe(false);
    expect(askCanSend({ ...ready, statusLoading: true })).toBe(false);
    expect(askCanSend({ ...ready, projectId: undefined })).toBe(false);
    expect(askCanSend({ ...ready, busy: true })).toBe(false);
  });
  it('keeps statistics usable without model credit and requires both BYOK fields', () => {
    expect(askCanSend({ ...ready, mode: 'statistics', allowance: undefined, hostedAvailable: false })).toBe(true);
    expect(askCanSend({ ...ready, mode: 'byok', key: '', model: 'user-model' })).toBe(false);
    expect(askCanSend({ ...ready, mode: 'byok', key: 'private-test-key', model: 'user-model' })).toBe(true);
  });
  it('derives internal evidence routes and rejects cross-project and arbitrary external sources', () => {
    expect(askEvidence([{ type: 'project_statistics', project_id: 'p', days: 7, href: 'https://evil.test' }, { type: 'model_breakdown', project_id: 'other' }, { type: 'unknown', project_id: 'p', href: '/app/admin' }, null], 'p')).toEqual([{ label: 'Project statistics · 7 days', href: '/app/analytics?days=7', traceIds: [] }]);
    expect(askEvidence([{ type: 'recent_traces', project_id: 'p', days: 999, trace_ids: ['known', 12, null] }], 'p')).toEqual([{ label: 'Recorded traces', href: '/app/traces', traceIds: ['known'] }]);
  });
  it('encodes project resources and keeps unavailable balances distinct from zero', () => {
    expect(askProjectPath('/api/ask/status', 'p&foreign')).toBe('/api/ask/status?project=p%26foreign');
    expect(askProjectPath('/api/ask/status')).toBeNull();
    expect(askMoney(NaN)).toBe('—'); expect(askMoney(0)).toBe('$0.00'); expect(askMoney(.0002)).toBe('$0.0002');
  });
  it('offers only implemented evidence analysis questions', () => {
    expect(askQuestions.map(item => item.command)).toEqual(['/investigate', '/cache', '/compare']);
    expect(JSON.stringify(askQuestions)).not.toMatch(/create an evaluator|create a scenario|build a dashboard/i);
  });
});
