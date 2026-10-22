import { afterEach, describe, expect, it, vi } from 'vitest';
import { deploymentMode, organizationSlug, updateOrganizationName } from '../src/pages/adminSettings';

afterEach(() => vi.unstubAllGlobals());

describe('Organization settings', () => {
  it('saves only the new name so unrelated workspace settings remain server-owned', async () => {
    let requestBody: unknown;
    let requestMethod: unknown;
    let requestPath: unknown;
    vi.stubGlobal('fetch', async (path: string, options: RequestInit) => {
      requestPath = path;
      requestMethod = options.method;
      requestBody = JSON.parse(String(options.body));
      return new Response(JSON.stringify({ workspace: { id: 'workspace-42', name: 'New organization', retention_days: 90, mode: 'optimize', autopilot: 'off', monthly_budget: 250 } }), { status: 200 });
    });
    const result = await updateOrganizationName('New organization');
    expect(requestPath).toBe('/api/workspace');
    expect(requestMethod).toBe('PATCH');
    expect(requestBody).toEqual({ name: 'New organization' });
    expect(result.workspace.retention_days).toBe(90);
    expect(result.workspace.monthly_budget).toBe(250);
  });

  it('derives a readable slug without turning organization names into routes', () => {
    expect(organizationSlug('  Research & Delivery  ')).toBe('research-delivery');
    expect(organizationSlug('Café Studio')).toBe('cafe-studio');
    expect(organizationSlug('产品团队')).toBe('产品团队');
  });

  it('identifies the known hosted origin and avoids inferring deployment ownership', () => {
    expect(deploymentMode('traqiva.traqiva.workers.dev')).toBe('Hosted');
    expect(deploymentMode('localhost')).toBe('Local preview');
    expect(deploymentMode('127.0.0.1')).toBe('Local preview');
    expect(deploymentMode('my-installation.example.test')).toBe('Custom deployment');
    expect(deploymentMode('')).toBe('Unavailable');
  });
});
