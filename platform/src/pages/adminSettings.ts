import { api, json } from '../api';
import type { Workspace } from '../types';

export function updateOrganizationName(name: string) {
  return api<{ workspace: Workspace }>('/api/workspace', json({ name }, 'PATCH'));
}

/** A display label only. The workspace API does not store a slug or URL. */
export function organizationSlug(name: string) {
  return name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'workspace';
}

export function deploymentMode(hostname: string) {
  if (hostname === 'traqiva.traqiva.workers.dev') return 'Hosted';
  if (['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return 'Local preview';
  return hostname ? 'Custom deployment' : 'Unavailable';
}
