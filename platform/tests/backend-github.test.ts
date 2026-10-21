import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../server/index';
import type { Database, Env, Statement } from '../server/types';

class SqliteStatement implements Statement {
  values: unknown[] = [];
  constructor(public owner: SqliteDatabase, public sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>() { return (this.owner.raw.prepare(this.sql).get(...this.values as never[]) ?? null) as T | null; }
  async all<T>() { return { results: this.owner.raw.prepare(this.sql).all(...this.values as never[]) as T[] }; }
  async run() { return this.owner.raw.prepare(this.sql).run(...this.values as never[]); }
}
class SqliteDatabase implements Database {
  raw = new DatabaseSync(':memory:');
  constructor() { const root = new URL('../migrations/', import.meta.url); for (const name of readdirSync(root).filter(name => name.endsWith('.sql')).sort()) this.raw.exec(readFileSync(new URL(name, root), 'utf8')); }
  prepare(sql: string) { return new SqliteStatement(this, sql); }
  async batch(statements: Statement[]) { this.raw.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); this.raw.exec('COMMIT'); return results; } catch (error) { this.raw.exec('ROLLBACK'); throw error; } }
}
const origin = 'https://app.test';
type GithubEnv = Env & { GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string; GITHUB_REDIRECT_URI?: string };
let db: SqliteDatabase, env: GithubEnv;
beforeEach(() => { db = new SqliteDatabase(); env = { DB: db, GITHUB_CLIENT_ID: 'synthetic-oauth-client', GITHUB_CLIENT_SECRET: 'private-github-client-secret', GITHUB_REDIRECT_URI: origin + '/api/auth/github/callback', GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'private-google-client-secret', GOOGLE_REDIRECT_URI: origin + '/api/auth/google/callback' }; });
afterEach(() => { db.raw.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const request = (path: string, cookie = '', options: RequestInit = {}) => app.fetch(new Request(origin + path, { ...options, headers: { cookie, ...options.headers } }), env);
const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]);
const errorLocation = (code: string) => `/login?oauth_error=${code}&oauth_provider=github`;
async function start(intent = 'login', cookie = '') {
  const response = await request('/api/auth/github?intent=' + intent, cookie, { headers: { 'sec-fetch-site': 'same-origin' } });
  expect(response.status).toBe(302);
  const url = new URL(response.headers.get('location')!, origin);
  return { response, url, state: url.searchParams.get('state')!, cookie: cookies(response).find(value => value.startsWith('__Host-traqiva_github_state='))! };
}
const callback = (flow: Awaited<ReturnType<typeof start>>, cookie = flow.cookie, suffix = '') => request(`/api/auth/github/callback?state=${flow.state}&code=one-time-code${suffix}`, cookie);
const email = 'github@example.test';
function githubFetch({ profile = { id: 73001, login: 'synthetic-user', name: 'GitHub User', email: 'untrusted-public@example.test' } as any, emails = [{ email, verified: true, primary: true }] as any, tokenBody = { access_token: 'synthetic-token-never-store', token_type: 'bearer', scope: 'read:user,user:email', refresh_token: 'synthetic-refresh-never-store' } as any, status = 200 } = {}) {
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); expect(init?.redirect).toBe('manual');
    if (url === 'https://github.com/login/oauth/access_token') {
      expect(init?.method).toBe('POST'); expect(new Headers(init?.headers).get('accept')).toBe('application/json');
      return Response.json(tokenBody, { status });
    }
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-token-never-store');
    expect(new Headers(init?.headers).get('user-agent')).toBe('Traqiva');
    if (url === 'https://api.github.com/user') return Response.json(profile);
    expect(url).toBe('https://api.github.com/user/emails?per_page=100'); return Response.json(emails);
  });
  vi.stubGlobal('fetch', fetcher); return fetcher;
}
async function passwordAccount(address = email) {
  const response = await request('/api/auth/register', '', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Existing User', email: address, password: 'A long password for this test' }) });
  expect(response.status).toBe(201); return { cookie: cookies(response)[0], data: await response.json() as any };
}

describe('GitHub OAuth authorization code flow with SQL state and verified email', () => {
  it('migrates populated Google identities and pending states without changing ownership or cascade constraints', () => {
    const legacy = new DatabaseSync(':memory:'), root = new URL('../migrations/', import.meta.url), at = '2026-10-21T00:00:00.000Z';
    try {
      for (const name of readdirSync(root).filter(name => name.endsWith('.sql') && name < '0005').sort()) legacy.exec(readFileSync(new URL(name, root), 'utf8'));
      legacy.prepare('INSERT INTO users(id,name,email,password_hash,password_salt,password_iterations,created_at) VALUES(?,?,?,?,?,?,?)').run('legacy-user', 'Legacy', 'legacy@example.test', 'hash', 'salt', 100000, at);
      legacy.prepare("INSERT INTO oauth_identities(provider,subject,user_id,created_at) VALUES('google','legacy-google','legacy-user',?)").run(at);
      legacy.prepare("INSERT INTO oauth_states(state_hash,cookie_hash,nonce_hash,pkce_verifier,intent,user_id,expires_at,created_at) VALUES('state','cookie','nonce','verifier','login','legacy-user',?,?)").run(at, at);
      legacy.exec(readFileSync(new URL('0005_github_oauth.sql', root), 'utf8'));
      expect(legacy.prepare('SELECT provider,subject,user_id FROM oauth_identities').get()).toEqual({ provider: 'google', subject: 'legacy-google', user_id: 'legacy-user' });
      expect(legacy.prepare('SELECT provider,pkce_verifier FROM oauth_states').get()).toEqual({ provider: 'google', pkce_verifier: 'verifier' });
      legacy.prepare("INSERT INTO oauth_identities(provider,subject,user_id,created_at) VALUES('github','73001','legacy-user',?)").run(at);
      expect(() => legacy.prepare("INSERT INTO oauth_identities(provider,subject,user_id,created_at) VALUES('other','1','legacy-user',?)").run(at)).toThrow(/CHECK/);
      expect(legacy.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      legacy.prepare("DELETE FROM users WHERE id='legacy-user'").run();
      expect(legacy.prepare('SELECT count(*) AS n FROM oauth_identities').get()).toEqual({ n: 0 });
      expect(legacy.prepare('SELECT count(*) AS n FROM oauth_states').get()).toEqual({ n: 0 });
    } finally { legacy.close(); }
  });
  it('advertises exact-origin HTTPS configuration and leaves Google independently available', async () => {
    expect(await (await request('/api/auth/providers')).json()).toEqual({ google: true, github: true });
    delete env.GITHUB_CLIENT_SECRET;
    expect(await (await request('/api/auth/providers')).json()).toEqual({ google: true, github: false });
    expect((await request('/api/auth/github')).headers.get('location')).toBe(errorLocation('github_unavailable'));
    env.GITHUB_CLIENT_SECRET = 'secret';
    for (const uri of ['https://other.test/api/auth/github/callback', 'http://app.test/api/auth/github/callback', origin + '/api/auth/github/callback?extra=1', origin + '/wrong']) {
      env.GITHUB_REDIRECT_URI = uri;
      expect(await (await request('/api/auth/providers')).json()).toMatchObject({ github: false });
    }
  });
  it('uses only read:user/user:email, state browser binding and PKCE S256 without disclosing its verifier or secret', async () => {
    const flow = await start('signup');
    expect(flow.url.origin + flow.url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(flow.url.searchParams.get('scope')).toBe('read:user user:email');
    expect(flow.url.searchParams.get('redirect_uri')).toBe(env.GITHUB_REDIRECT_URI);
    expect(flow.url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(flow.response.headers.get('set-cookie')).toContain('HttpOnly'); expect(flow.response.headers.get('set-cookie')).toContain('Secure');
    expect(flow.response.headers.get('set-cookie')).toContain('SameSite=Lax'); expect(flow.response.headers.get('set-cookie')).toContain('Max-Age=600');
    expect(flow.response.headers.get('set-cookie')).not.toContain('Domain='); expect(flow.response.headers.get('referrer-policy')).toBe('no-referrer');
    const state = db.raw.prepare('SELECT * FROM oauth_states').get() as any;
    expect(state.provider).toBe('github'); expect(state.state_hash).not.toBe(flow.state);
    expect(new Date(state.expires_at).getTime() - new Date(state.created_at).getTime()).toBe(600_000);
    expect(Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state.pkce_verifier))).toString('base64url')).toBe(flow.url.searchParams.get('code_challenge'));
    expect(flow.url.href).not.toContain(state.pkce_verifier); expect(flow.url.href).not.toContain('private-github-client-secret');
  });
  it('creates an OAuth-only account and owner workspace, keeps tokens ephemeral, and returns by stable numeric identity', async () => {
    const flow = await start('signup'), fetcher = githubFetch();
    const response = await callback(flow);
    expect(response.headers.get('location')).toBe('/login?oauth=success&new=1');
    const cookie = cookies(response).find(value => value.startsWith('traqiva_session='))!;
    const session = await (await request('/api/session', cookie)).json() as any;
    expect(session.user).toMatchObject({ name: 'GitHub User', email, github_linked: true, google_linked: false });
    expect(session.projects).toHaveLength(1); expect(session.setup.stage).toBe('goals');
    expect(db.raw.prepare('SELECT provider,subject,user_id FROM oauth_identities').get()).toEqual({ provider: 'github', subject: '73001', user_id: session.user.id });
    expect(db.raw.prepare('SELECT password_enabled FROM users').get()).toEqual({ password_enabled: 0 });
    const form = new URLSearchParams(fetcher.mock.calls[0][1]?.body as string);
    expect(form.get('code_verifier')).toBeTruthy(); expect(form.get('redirect_uri')).toBe(env.GITHUB_REDIRECT_URI);
    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const dump = JSON.stringify(tables.map(row => db.raw.prepare(`SELECT * FROM "${row.name}"`).all()));
    expect(dump).not.toContain('synthetic-token-never-store'); expect(dump).not.toContain('synthetic-refresh-never-store'); expect(dump).not.toContain('private-github-client-secret');
    const returning = await start(); githubFetch({ profile: { id: 73001, login: 'renamed-user', name: 'Renamed' }, emails: [{ email: 'changed@example.test', verified: true, primary: true }] });
    const back = await callback(returning); expect(back.headers.get('location')).toBe('/login?oauth=success');
    const again = await (await request('/api/session', cookies(back).find(value => value.startsWith('traqiva_session='))!)).json() as any;
    expect(again.user.id).toBe(session.user.id); expect(again.workspace.id).toBe(session.workspace.id); expect(again.projects[0].id).toBe(session.projects[0].id);
    expect(db.raw.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 1 });
  });
  it('requires live matching browser state, permits one concurrent callback and consumes failures', async () => {
    const flow = await start(), fetcher = githubFetch();
    expect((await callback(flow, '')).headers.get('location')).toBe(errorLocation('invalid_state')); expect(fetcher).not.toHaveBeenCalled();
    expect((await callback(flow, '__Host-traqiva_github_state=wrong')).headers.get('location')).toBe(errorLocation('invalid_state'));
    const results = await Promise.all([callback(flow), callback(flow)]);
    expect(results.map(response => response.headers.get('location')).sort()).toEqual(['/login?oauth=success&new=1', errorLocation('invalid_state')].sort());
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/access_token'))).toHaveLength(1);
    const expired = await start(); db.raw.prepare("UPDATE oauth_states SET expires_at='2000-01-01T00:00:00.000Z'").run();
    expect((await callback(expired)).headers.get('location')).toBe(errorLocation('invalid_state'));
  });
  it('deduplicates two independent valid sign-in flows for one numeric identity without duplicating workspaces', async () => {
    const a = await start(), b = await start(); githubFetch();
    const responses = await Promise.all([callback(a), callback(b)]);
    expect(responses.map(response => response.headers.get('location')).sort()).toEqual(['/login?oauth=success', '/login?oauth=success&new=1'].sort());
    expect(db.raw.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 1 });
    expect(db.raw.prepare('SELECT count(*) AS n FROM workspaces').get()).toEqual({ n: 1 });
    expect(db.raw.prepare('SELECT count(*) AS n FROM projects').get()).toEqual({ n: 1 });
  });
  it('binds states to the provider, so neither callback can consume the other provider proof', async () => {
    const response = await request('/api/auth/google'); const googleUrl = new URL(response.headers.get('location')!);
    const googleCookieValue = cookies(response)[0].split('=')[1];
    const flow = await start(); const fetcher = githubFetch();
    const wrong = await request(`/api/auth/github/callback?state=${googleUrl.searchParams.get('state')}&code=code`, '__Host-traqiva_github_state=' + googleCookieValue);
    expect(wrong.headers.get('location')).toBe(errorLocation('invalid_state'));
    const reverse = await request(`/api/auth/google/callback?state=${flow.state}&code=code`, '__Host-traqiva_google_state=' + flow.cookie.split('=')[1]);
    expect(reverse.headers.get('location')).toBe('/login?oauth_error=invalid_state'); expect(fetcher).not.toHaveBeenCalled();
    expect(db.raw.prepare('SELECT count(*) AS n FROM oauth_states').get()).toEqual({ n: 2 });
    expect((await callback(flow)).headers.get('location')).toBe('/login?oauth=success&new=1');
  });
  it('does not auto-link an email collision and only explicitly links the exact signed-in session and verified address', async () => {
    const account = await passwordAccount();
    const collision = await start(); githubFetch();
    expect((await callback(collision)).headers.get('location')).toBe(errorLocation('email_signin_required'));
    expect(db.raw.prepare('SELECT count(*) AS n FROM oauth_identities').get()).toEqual({ n: 0 });
    const linked = await start('link', account.cookie);
    // The existing account email may be a verified secondary address rather than GitHub's primary address.
    githubFetch({ emails: [{ email: 'primary@example.test', verified: true, primary: true }, { email: email.toUpperCase(), verified: true, primary: false }] });
    expect((await callback(linked, linked.cookie + '; ' + account.cookie)).headers.get('location')).toBe('/app/admin?github=linked');
    const session = await (await request('/api/session', account.cookie)).json() as any;
    expect(session.user.github_linked).toBe(true); expect(session.workspace.id).toBe(account.data.workspace.id); expect(session.projects).toHaveLength(1);
  });
  it('refuses unauthenticated/cross-origin link starts, changed sessions and mismatched verified email', async () => {
    expect((await request('/api/auth/github?intent=link')).headers.get('location')).toBe(errorLocation('signin_required'));
    const account = await passwordAccount();
    expect((await request('/api/auth/github?intent=link', account.cookie, { headers: { origin: 'https://attacker.test', 'sec-fetch-site': 'cross-site' } })).headers.get('location')).toBe(errorLocation('invalid_state'));
    const rotated = await start('link', account.cookie), fetcher = githubFetch();
    const login = await request('/api/auth/login', '', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'A long password for this test' }) });
    expect((await callback(rotated, rotated.cookie + '; ' + cookies(login)[0])).headers.get('location')).toBe(errorLocation('signin_required')); expect(fetcher).not.toHaveBeenCalled();
    const wrongEmail = await start('link', account.cookie); githubFetch({ emails: [{ email: 'other@example.test', verified: true, primary: true }] });
    expect((await callback(wrongEmail, wrongEmail.cookie + '; ' + account.cookie)).headers.get('location')).toBe(errorLocation('account_conflict'));
    expect(db.raw.prepare('SELECT count(*) AS n FROM oauth_identities').get()).toEqual({ n: 0 });
  });
  it('rejects an identity already linked elsewhere and a different GitHub identity already linked to this user', async () => {
    const owner = await passwordAccount(), other = await passwordAccount('other@example.test');
    db.raw.prepare("INSERT INTO oauth_identities(provider,subject,user_id,created_at) VALUES('github','73001',?,?)").run(owner.data.user.id, new Date().toISOString());
    const takeover = await start('link', other.cookie); githubFetch({ emails: [{ email: 'other@example.test', verified: true, primary: true }] });
    expect((await callback(takeover, takeover.cookie + '; ' + other.cookie)).headers.get('location')).toBe(errorLocation('account_conflict'));
    const replacement = await start('link', owner.cookie); githubFetch({ profile: { id: 73002 } });
    expect((await callback(replacement, replacement.cookie + '; ' + owner.cookie)).headers.get('location')).toBe(errorLocation('account_conflict'));
    expect(db.raw.prepare('SELECT subject,user_id FROM oauth_identities').get()).toEqual({ subject: '73001', user_id: owner.data.user.id });
  });
  it('rechecks the active session after provider exchange so a concurrent logout cannot authorize linking', async () => {
    const account = await passwordAccount(), flow = await start('link', account.cookie), fetcher = githubFetch();
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const response = await fetcher(input, init);
      if (String(input).includes('/user/emails')) db.raw.prepare('DELETE FROM sessions').run();
      return response;
    });
    expect((await callback(flow, flow.cookie + '; ' + account.cookie)).headers.get('location')).toBe(errorLocation('signin_required'));
    expect(db.raw.prepare('SELECT count(*) AS n FROM oauth_identities').get()).toEqual({ n: 0 });
  });
  it.each([null, [], [{ email, verified: false, primary: true }], [{ email: 'not-an-email', verified: true, primary: true }]].map(emails => ({ emails })))('requires a verified email from the authenticated email endpoint: $emails', async ({ emails }) => {
    const flow = await start(); githubFetch({ emails });
    expect((await callback(flow)).headers.get('location')).toBe(errorLocation('github_email_required'));
    expect(db.raw.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 0 });
  });
  it.each([null, { id: '73001' }, { id: 0 }, { id: 1.2 }, { id: Number.MAX_SAFE_INTEGER + 1 }])('rejects invalid stable numeric GitHub identity: %j', async profile => {
    const flow = await start(); githubFetch({ profile });
    expect((await callback(flow)).headers.get('location')).toBe(errorLocation('invalid_identity'));
  });
  it('maps denied/network/malformed/redirect responses to bounded errors without sessions or leaked credentials', async () => {
    const denied = await start(), fetcher = githubFetch();
    expect((await callback(denied, denied.cookie, '&error=access_denied&error_description=do-not-echo')).headers.get('location')).toBe(errorLocation('access_denied')); expect(fetcher).not.toHaveBeenCalled();
    for (const response of [new Response('private-provider-details', { status: 500 }), new Response(null, { status: 302, headers: { location: 'https://attacker.test/capture' } }), new Response('not JSON'), Response.json({ access_token: null })]) {
      const flow = await start(); vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => { expect(init?.redirect).toBe('manual'); return response; }));
      const result = await callback(flow); expect(result.headers.get('location')).toBe(errorLocation('github_exchange_failed')); expect(await result.text()).not.toContain('private');
      expect((await callback(flow)).headers.get('location')).toBe(errorLocation('invalid_state'));
    }
    const network = await start(); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private-client-secret')));
    expect((await callback(network)).headers.get('location')).toBe(errorLocation('github_exchange_failed'));
    expect(db.raw.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });
  it.each(['https://api.github.com/user', 'https://api.github.com/user/emails?per_page=100'])('does not follow an authenticated API redirect: %s', async endpoint => {
    const flow = await start(), fetcher = githubFetch();
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === endpoint) { expect(init?.redirect).toBe('manual'); return new Response(null, { status: 302, headers: { location: 'https://attacker.test/capture' } }); }
      return fetcher(input, init);
    });
    expect((await callback(flow)).headers.get('location')).toBe(errorLocation('github_exchange_failed'));
    expect(db.raw.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });
});
