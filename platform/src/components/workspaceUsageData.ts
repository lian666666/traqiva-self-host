import { askMoney, type AskAllowance } from '../pages/askWorkspaceData';

export type WorkspaceUsageData = {
  ai: { available: boolean; allowance: AskAllowance };
  observability: { events: number; limit: number; enforced: false };
  agent_runs: { minutes: number | null; limit: number; enforced: false };
  routing: { decisions: number; limit: number; enforced: false };
  range: { from: string; to: string }; plan_enforced: false;
};
export type WorkspaceUsageRow = { label: string; value: string; detail: string; fraction: number | null };
const count = (value: number) => new Intl.NumberFormat('en', { notation: value >= 1000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
const usd = askMoney;
const valid = (value: number) => Number.isFinite(value) && value >= 0;
const fraction = (used: number, limit: number) => valid(used) && valid(limit) && limit > 0 ? Math.min(1, used / limit) : null;
export function workspaceUsageRows(data: WorkspaceUsageData | null): WorkspaceUsageRow[] {
  const allowance = data?.ai.allowance;
  return [
    { label: 'AI credits', value: allowance && data?.ai.available && valid(allowance.remaining_usd) ? `${usd(allowance.remaining_usd)} left` : 'Unavailable', fraction: allowance ? fraction(allowance.used_usd + allowance.reserved_usd, allowance.limit_usd) : null, detail: allowance ? `Lifetime allowance per user across projects. ${usd(allowance.used_usd)} used${allowance.reserved_usd ? `; ${usd(allowance.reserved_usd)} reserved` : ''}. Does not reset. Built-in Ask only.` : 'Built-in Ask allowance could not be loaded.' },
    { label: 'Observability', value: data && valid(data.observability.events) ? `${count(data.observability.events)} / ${count(data.observability.limit)}` : 'Unavailable', fraction: data ? fraction(data.observability.events, data.observability.limit) : null, detail: 'External project request records this UTC month across the workspace. 100K plan preview; quota enforcement and 64 KB billing units are not active.' },
    { label: 'Agent runs', value: data ? data.agent_runs.minutes === null ? 'Not metered' : `${count(data.agent_runs.minutes)} / ${count(data.agent_runs.limit)}` : 'Unavailable', fraction: data && data.agent_runs.minutes !== null ? fraction(data.agent_runs.minutes, data.agent_runs.limit) : null, detail: 'Agent runtime minutes are not measured. The 600-minute monthly plan is a preview; request latency is not agent runtime.' },
    { label: 'Routing', value: data && valid(data.routing.decisions) ? `${count(data.routing.decisions)} / ${count(data.routing.limit)}` : 'Unavailable', fraction: data ? fraction(data.routing.decisions, data.routing.limit) : null, detail: 'Recorded gateway routing decisions this UTC month across the workspace. 25K plan preview; quota enforcement is not active.' },
  ];
}
