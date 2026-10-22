import { describe, expect, it } from 'vitest';
import { workspaceUsageRows, type WorkspaceUsageData } from '../src/components/workspaceUsageData';

const data: WorkspaceUsageData = {
  ai: { available: true, allowance: { limit_usd: 1, used_usd: .0001624, reserved_usd: 0, remaining_usd: .9998376, reset: 'never' } },
  observability: { events: 3, limit: 100000, enforced: false },
  agent_runs: { minutes: null, limit: 600, enforced: false },
  routing: { decisions: 0, limit: 25000, enforced: false },
  range: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-22T17:00:00.000Z' }, plan_enforced: false,
};

describe('separate workspace and hosted AI usage', () => {
  it('shows the real lifetime AI balance separately from monthly preview counts', () => {
    const rows = workspaceUsageRows(data);
    expect(rows.map(row => row.label)).toEqual(['AI credits', 'Observability', 'Agent runs', 'Routing']);
    expect(rows[0].value).toBe('$0.9998 left');
    expect(rows[0].detail).toContain('Lifetime');
    expect(rows[1].value).toBe('3 / 100K');
    expect(rows[1].detail).toContain('preview');
    expect(rows[3].value).toBe('0 / 25K');
  });
  it('does not turn unmetered agent minutes into a fictitious zero balance', () => {
    const row = workspaceUsageRows(data)[2];
    expect(row.value).toBe('Not metered');
    expect(row.fraction).toBeNull();
    expect(row.detail).toContain('not measured');
  });
  it('does not invent allowances on a missing response or enable a disabled model', () => {
    expect(workspaceUsageRows(null).every(row => row.value === 'Unavailable')).toBe(true);
    expect(workspaceUsageRows({ ...data, ai: { ...data.ai, available: false } })[0].value).toBe('Unavailable');
    expect(workspaceUsageRows({ ...data, ai: { ...data.ai, allowance: { ...data.ai.allowance, remaining_usd: 0 } } })[0].value).toBe('$0.00 left');
  });
});
