export type InboxReport = {
  id: string; title: string; body?: string; message?: string; description?: string;
  type?: string; created_at: string; href?: string;
};

const builderTypes = new Set(['eval', 'evaluation', 'experiment', 'dataset', 'scorer', 'monitor', 'review', 'scenario', 'quality-gate', 'quality_gate']);
const builderRoute = /^\/app\/(?:evals|experiments|datasets|scorers|monitors|reviews|scenarios|quality-gates)(?:[/?#]|$)/;

const hasUnsafePathCharacters = (value: string) => Array.from(value).some(character => character === '\\' || character.charCodeAt(0) <= 32);

function internalHref(href: string | undefined) {
  if (!href?.startsWith('/app/') || hasUnsafePathCharacters(href)) return null;
  try {
    const url = new URL(href, 'https://traqiva.invalid');
    const path = decodeURIComponent(url.pathname);
    if (url.origin !== 'https://traqiva.invalid' || !path.startsWith('/app/') || hasUnsafePathCharacters(path)) return null;
    return { href: `${url.pathname}${url.search}${url.hash}`, path };
  } catch { return null; }
}

export function reportType(report: InboxReport) { return report.type || 'update'; }
export function reportTypeLabel(type: string) {
  const labels: Record<string, string> = { improvement: 'Improvement', eval: 'Evaluation', update: 'Project update' };
  return labels[type] || type.replace(/[-_]/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
}
export function reportBody(report: InboxReport) { return report.body || report.message || report.description || ''; }

export function visibleInboxReports(items: InboxReport[], includeBuilder: boolean, search = '', type = '') {
  const query = search.trim().toLocaleLowerCase();
  return items.filter(item => {
    if (!includeBuilder && (builderTypes.has(reportType(item).toLowerCase()) || builderRoute.test(internalHref(item.href)?.path || ''))) return false;
    return (!type || reportType(item) === type) && (!query || [item.title, reportBody(item), reportTypeLabel(reportType(item))].some(value => value.toLocaleLowerCase().includes(query)));
  }).sort((left, right) => (Date.parse(right.created_at) || 0) - (Date.parse(left.created_at) || 0));
}

export function reportHref(report: InboxReport, includeBuilder: boolean) {
  const target = internalHref(report.href);
  if (target && (includeBuilder || !builderRoute.test(target.path))) return target.href;
  if (report.type === 'improvement') return '/app/improvements';
  if (report.type === 'eval' && includeBuilder) return '/app/evals';
  return null;
}

export function moveReportSelection(items: InboxReport[], selectedId: string | null, direction: -1 | 1) {
  if (!items.length) return null;
  const index = items.findIndex(item => item.id === selectedId);
  if (index < 0) return items[direction === 1 ? 0 : items.length - 1].id;
  return items[Math.max(0, Math.min(items.length - 1, index + direction))].id;
}

export function isReportTypingTarget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('input, textarea, select, [role="textbox"], [role="combobox"], [contenteditable]:not([contenteditable="false"])');
}
