import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../server/index';
import { hashPassword } from '../server/security';
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
const clientId = 'test.apps.googleusercontent.com';
let db: SqliteDatabase, env: Env;
let signing: Awaited<ReturnType<typeof generateKeyPair>>, jwk: Record<string, unknown>;
beforeAll(async () => { signing = await generateKeyPair('RS256'); jwk = { ...await exportJWK(signing.publicKey), kid: 'google-test-key', alg: 'RS256', use: 'sig' }; });
beforeEach(() => { db = new SqliteDatabase(); env = { DB: db, GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: 'private-google-client-secret', GOOGLE_REDIRECT_URI: `${origin}/api/auth/google/callback` }; });
afterEach(() => { db.raw.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const request = (path: string, cookie = '', options: RequestInit = {}) => app.fetch(new Request(`${origin}${path}`, { ...options, headers: { cookie, ...options.headers } }), env);
const cookieParts = (response: Response) => (response.headers.getSetCookie()).map(value => value.split(';')[0]);
async function start(intent = 'login', cookie = '') {
  const response = await request(`/api/auth/google?intent=${intent}`, cookie, { headers: { 'sec-fetch-site': 'same-origin' } });
  expect(response.status).toBe(302);
  const url = new URL(response.headers.get('location')!);
  return { response, url, state: url.searchParams.get('state')!, nonce: url.searchParams.get('nonce')!, cookie: cookieParts(response)[0] };
}
async function token(nonce: string, claims: Record<string, unknown> = {}, key = signing.privateKey) {
  return new SignJWT({ email: 'google@example.test', email_verified: true, name: 'Google User', nonce, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'google-test-key' }).setIssuer(String(claims.iss ?? 'https://accounts.google.com'))
    .setAudience(claims.aud as string ?? clientId).setSubject(String(claims.sub ?? 'google-sub-1'))
    .setIssuedAt(claims.iat as number ?? Math.floor(Date.now() / 1000)).setExpirationTime(claims.exp as number ?? Math.floor(Date.now() / 1000) + 3600).sign(key);
}
function googleFetch(idToken: string, status = 200) {
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') { expect(init?.redirect).toBe('manual'); return Response.json({ keys: [jwk] }, { headers: { 'cache-control': 'max-age=3600' } }); }
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('manual');
    return Response.json(status === 200 ? { id_token: idToken, access_token: 'must-not-persist', refresh_token: 'must-not-persist-refresh' } : { error: 'raw-sensitive-provider-error' }, { status });
  });
  vi.stubGlobal('fetch', fetcher); return fetcher;
}
const callback = (flow: Awaited<ReturnType<typeof start>>, cookie = flow.cookie, suffix = '') => request(`/api/auth/google/callback?state=${flow.state}&code=one-time-code${suffix}`, cookie);
async function passwordAccount() {
  const response = await request('/api/auth/register', '', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Password User', email: 'google@example.test', password: 'A long password for this test' }) });
  expect(response.status).toBe(201); return { cookie: cookieParts(response)[0], data: await response.json() as any };
}

describe('Google authorization code OIDC with real signatures and SQL state', () => {
  it('advertises availability only when fully configured for this exact callback origin', async () => {
    expect(await (await request('/api/auth/providers')).json()).toEqual({ google: true });
    delete env.GOOGLE_CLIENT_SECRET;
    expect(await (await request('/api/auth/providers')).json()).toEqual({ google: false });
    expect((await request('/api/auth/google')).headers.get('location')).toBe('/login?oauth_error=google_unavailable');
    env.GOOGLE_CLIENT_SECRET = 'secret'; env.GOOGLE_REDIRECT_URI = 'https://other.test/api/auth/google/callback';
    expect(await (await request('/api/auth/providers')).json()).toEqual({ google: false });
  });
  it('uses bounded state, nonce, PKCE S256 and a host-only secure cookie without exposing secrets', async () => {
    const flow = await start('signup');
    expect(flow.url.origin + flow.url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(flow.url.searchParams.get('scope')).toBe('openid email profile');
    expect(flow.url.searchParams.get('response_type')).toBe('code');
    expect(flow.url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(flow.url.searchParams.get('redirect_uri')).toBe(env.GOOGLE_REDIRECT_URI);
    expect(flow.response.headers.get('set-cookie')).toMatch(/HttpOnly.*Secure.*SameSite=Lax|Secure.*HttpOnly.*SameSite=Lax/);
    expect(flow.response.headers.get('set-cookie')).toContain('Max-Age=600');
    expect(flow.response.headers.get('set-cookie')).not.toContain('Domain=');
    expect(flow.response.headers.get('referrer-policy')).toBe('no-referrer');
    const row = db.raw.prepare('SELECT * FROM oauth_states').get() as any;
    expect(row.state_hash).not.toBe(flow.state); expect(row.nonce_hash).not.toBe(flow.nonce);
    expect(new Date(row.expires_at).getTime() - new Date(row.created_at).getTime()).toBe(600_000);
    expect(flow.url.href).not.toContain('private-google-client-secret');
    expect(flow.url.href).not.toContain(row.pkce_verifier);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(row.pkce_verifier));
    expect(Buffer.from(digest).toString('base64url')).toBe(flow.url.searchParams.get('code_challenge'));
  });
  it('creates a new user, owner workspace, empty default project and application session, never storing Google tokens', async () => {
    const flow = await start('signup'); const fetcher = googleFetch(await token(flow.nonce));
    const response = await callback(flow);
    expect(response.headers.get('location')).toBe('/login?oauth=success&new=1');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const sessionCookie = cookieParts(response).find(value => value.startsWith('traqiva_session='))!;
    const session = await (await request('/api/session', sessionCookie)).json() as any;
    expect(session.user).toMatchObject({ name: 'Google User', email: 'google@example.test', google_linked: true });
    expect(session.projects).toHaveLength(1); expect(session.activeProject.name).toBe('My project');
    expect(db.raw.prepare('SELECT role FROM members').get()).toEqual({ role: 'owner' });
    expect(db.raw.prepare('SELECT password_enabled FROM users').get()).toEqual({ password_enabled: 0 });
    expect(db.raw.prepare('SELECT count(*) AS n FROM traces').get()).toEqual({ n: 0 });
    expect(db.raw.prepare('SELECT count(*) AS n FROM oauth_states').get()).toEqual({ n: 0 });
    expect(db.raw.prepare('SELECT provider,subject,user_id FROM oauth_identities').get()).toMatchObject({ provider: 'google', subject: 'google-sub-1', user_id: session.user.id });
    const exchange = fetcher.mock.calls.find(([url]) => String(url) === 'https://oauth2.googleapis.com/token')!;
    const form = new URLSearchParams(exchange[1]!.body as string);
    expect(form.get('grant_type')).toBe('authorization_code'); expect(form.get('code_verifier')).toBeTruthy();
    expect(form.get('redirect_uri')).toBe(env.GOOGLE_REDIRECT_URI);
    const dump = Array.from(db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).map(row => db.raw.prepare(`SELECT * FROM "${row.name}"`).all());
    expect(JSON.stringify(dump)).not.toContain('must-not-persist'); expect(JSON.stringify(dump)).not.toContain('private-google-client-secret');
    // Even a matching stored password must not enable password authentication for an OAuth-only account.
    const known = await hashPassword('arbitrary-guess');
    db.raw.prepare('UPDATE users SET password_hash=?,password_salt=?,password_iterations=?').run(known.hash, known.salt, known.iterations);
    const password = await request('/api/auth/login', '', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'google@example.test', password: 'arbitrary-guess' }) });
    expect(password.status).toBe(401); expect(await password.json()).toEqual({ error: 'Email or password is incorrect.' });
    const returning = await start(); googleFetch(await token(returning.nonce, { email: 'changed-google-email@example.test' }));
    expect((await callback(returning)).headers.get('location')).toBe('/login?oauth=success');
    expect(db.raw.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 1 });
    expect(db.raw.prepare('SELECT email FROM users').get()).toEqual({ email: 'google@example.test' });
  });
  it('requires matching browser cookie, live state and one-time atomic consumption before any token exchange', async () => {
    const flow = await start(); const fetcher = googleFetch(await token(flow.nonce));
    expect((await callback(flow, '')).headers.get('location')).toBe('/login?oauth_error=invalid_state');
    expect(fetcher).not.toHaveBeenCalled();
    expect((await callback(flow, '__Host-traqiva_google_state=wrong')).headers.get('location')).toBe('/login?oauth_error=invalid_state');
    expect(fetcher).not.toHaveBeenCalled();
    expect((await request('/api/auth/google/callback?code=code', flow.cookie)).headers.get('location')).toBe('/login?oauth_error=invalid_state');
    expect((await callback(flow)).headers.get('location')).toBe('/login?oauth=success&new=1');
    expect((await callback(flow)).headers.get('location')).toBe('/login?oauth_error=invalid_state');
    expect(fetcher.mock.calls.filter(([url]) => String(url) === 'https://oauth2.googleapis.com/token')).toHaveLength(1);
    const expired = await start(); db.raw.prepare('UPDATE oauth_states SET expires_at=?').run('2000-01-01T00:00:00.000Z');
    expect((await callback(expired)).headers.get('location')).toBe('/login?oauth_error=invalid_state');
  });
  it('permits exactly one concurrent callback and one token exchange for the same state', async () => {
    const flow = await start(); const fetcher = googleFetch(await token(flow.nonce));
    const responses = await Promise.all([callback(flow), callback(flow)]);
    expect(responses.map(response => response.headers.get('location')).sort()).toEqual(['/login?oauth=success&new=1', '/login?oauth_error=invalid_state'].sort());
    expect(fetcher.mock.calls.filter(([url]) => String(url) === 'https://oauth2.googleapis.com/token')).toHaveLength(1);
    expect(db.raw.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 1 });
  });
  it.each(['nonce', 'missing_nonce', 'issuer', 'audience', 'expiration', 'future_iat', 'unverified_email', 'subject', 'azp', 'signature'])("rejects invalid %s without creating an identity", async field => {
    const flow = await start(); const claims: Record<string, unknown> = {};
    if (field === 'nonce') claims.nonce = 'wrong';
    if (field === 'missing_nonce') claims.nonce = undefined;
    if (field === 'issuer') claims.iss = 'https://evil.test';
    if (field === 'audience') claims.aud = 'other-client';
    if (field === 'expiration') claims.exp = Math.floor(Date.now() / 1000) - 60;
    if (field === 'future_iat') claims.iat = Math.floor(Date.now() / 1000) + 3600;
    if (field === 'unverified_email') claims.email_verified = false;
    if (field === 'subject') claims.sub = '';
    if (field === 'azp') claims.azp = 'other-client';
    const key = field === 'signature' ? (await generateKeyPair('RS256')).privateKey : signing.privateKey;
    googleFetch(await token(flow.nonce, claims, key));
    expect((await callback(flow)).headers.get('location')).toBe('/login?oauth_error=invalid_identity');
    expect(db.raw.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 0 });
    expect((await callback(flow)).headers.get('location')).toBe('/login?oauth_error=invalid_state');
  });
  it('does not take over an existing email account, but allows an explicit same-session link', async () => {
    const account = await passwordAccount(), flow = await start(); googleFetch(await token(flow.nonce));
    expect((await callback(flow)).headers.get('location')).toBe('/login?oauth_error=email_signin_required');
    expect(db.raw.prepare('SELECT count(*) AS n FROM oauth_identities').get()).toEqual({ n: 0 });
    expect((await request('/api/auth/google?intent=link')).headers.get('location')).toBe('/login?oauth_error=signin_required');
    expect((await request('/api/auth/google?intent=link', account.cookie, { headers: { 'sec-fetch-site': 'cross-site' } })).headers.get('location')).toBe('/login?oauth_error=invalid_state');
    const linked = await start('link', account.cookie); googleFetch(await token(linked.nonce));
    expect((await callback(linked, `${linked.cookie}; ${account.cookie}`)).headers.get('location')).toBe('/app/admin?google=linked');
    expect(db.raw.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 1 });
    const session = await (await request('/api/session', account.cookie)).json() as any;
    expect(session.user.google_linked).toBe(true);
    expect(db.raw.prepare('SELECT user_id FROM oauth_identities').get()).toEqual({ user_id: account.data.user.id });
  });
  it('refuses linking across a replaced session or a different verified email', async () => {
    const account = await passwordAccount(), flow = await start('link', account.cookie); const fetcher = googleFetch(await token(flow.nonce));
    expect((await callback(flow)).headers.get('location')).toBe('/login?oauth_error=signin_required');
    expect(fetcher).not.toHaveBeenCalled();
    const replaced = await start('link', account.cookie);
    const login = await request('/api/auth/login', '', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'google@example.test', password: 'A long password for this test' }) });
    expect(login.status).toBe(200);
    expect((await callback(replaced, `${replaced.cookie}; ${cookieParts(login)[0]}`)).headers.get('location')).toBe('/login?oauth_error=signin_required');
    expect(fetcher).not.toHaveBeenCalled();
    const mismatch = await start('link', account.cookie); googleFetch(await token(mismatch.nonce, { email: 'another@example.test' }));
    expect((await callback(mismatch, `${mismatch.cookie}; ${account.cookie}`)).headers.get('location')).toBe('/login?oauth_error=account_conflict');
    expect(db.raw.prepare('SELECT count(*) AS n FROM oauth_identities').get()).toEqual({ n: 0 });
  });
  it('never moves a Google subject already owned by a different user, even if its email changes to the linking email', async () => {
    const ownerFlow = await start(); googleFetch(await token(ownerFlow.nonce, { email: 'original-owner@example.test' }));
    expect((await callback(ownerFlow)).headers.get('location')).toBe('/login?oauth=success&new=1');
    const owner = db.raw.prepare('SELECT user_id FROM oauth_identities').get() as any;
    const account = await passwordAccount(), link = await start('link', account.cookie); googleFetch(await token(link.nonce));
    expect((await callback(link, `${link.cookie}; ${account.cookie}`)).headers.get('location')).toBe('/login?oauth_error=account_conflict');
    expect(db.raw.prepare('SELECT user_id FROM oauth_identities').get()).toEqual({ user_id: owner.user_id });
  });
  it('returns stable errors for provider rejection and failed code exchange, consumes state and never echoes Google errors', async () => {
    const denied = await start(); const fetcher = googleFetch('irrelevant');
    const response = await callback(denied, denied.cookie, '&error=access_denied&error_description=sensitive');
    expect(response.headers.get('location')).toBe('/login?oauth_error=access_denied'); expect(fetcher).not.toHaveBeenCalled();
    const failed = await start(); googleFetch('irrelevant', 400);
    const error = await callback(failed);
    expect(error.headers.get('location')).toBe('/login?oauth_error=google_exchange_failed');
    expect(await error.text()).not.toContain('raw-sensitive-provider-error');
    expect((await callback(failed)).headers.get('location')).toBe('/login?oauth_error=invalid_state');
    expect(db.raw.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 0 });
  });
  it('maps network and malformed token responses to stable errors without a fake session', async () => {
    const flow = await start(); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network private error')));
    expect((await callback(flow)).headers.get('location')).toBe('/login?oauth_error=google_exchange_failed');
    const malformed = await start(); vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid JSON')));
    expect((await callback(malformed)).headers.get('location')).toBe('/login?oauth_error=google_exchange_failed');
    expect(db.raw.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });
  it('rejects a token endpoint redirect without following it or sending credentials to another host', async () => {
    const flow = await start();
    const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(init?.redirect).toBe('manual');
      return new Response(null, { status: 302, headers: { location: 'https://untrusted.example.test/capture' } });
    });
    vi.stubGlobal('fetch', fetcher);
    expect((await callback(flow)).headers.get('location')).toBe('/login?oauth_error=google_exchange_failed');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(db.raw.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 0 });
  });
  it('logs only bounded allowlisted exchange diagnostics, never provider details or credentials', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const http = await start();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'invalid_grant', error_description: 'sensitive-code-token-email', client_secret: 'private-google-client-secret' }, { status: 400 })));
    expect((await callback(http)).headers.get('location')).toBe('/login?oauth_error=google_exchange_failed');
    expect(warn).toHaveBeenLastCalledWith({ event: 'google_oauth_exchange_failed', stage: 'http', status: 400, google_error: 'invalid_grant' });
    const unsafe = await start();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'private-google-client-secret', error_description: 'sensitive-code-token-email' }, { status: 401 })));
    await callback(unsafe);
    expect(warn).toHaveBeenLastCalledWith({ event: 'google_oauth_exchange_failed', stage: 'http', status: 401, google_error: 'unknown' });
    const network = await start(); const error = new Error('private-google-client-secret sensitive-code-token-email'); error.name = 'private-google-client-secret';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error)); await callback(network);
    expect(warn).toHaveBeenLastCalledWith({ event: 'google_oauth_exchange_failed', stage: 'fetch', status: null, error_class: 'Other' });
    const malformed = await start(); vi.stubGlobal('fetch', vi.fn(async () => new Response('sensitive-code-token-email'))); await callback(malformed);
    expect(warn).toHaveBeenLastCalledWith({ event: 'google_oauth_exchange_failed', stage: 'body', status: 200, error_class: 'SyntaxError' });
    const serialized = JSON.stringify(warn.mock.calls);
    expect(serialized).not.toContain('sensitive-code-token-email'); expect(serialized).not.toContain('private-google-client-secret');
    expect(serialized).not.toContain('one-time-code'); expect(serialized).not.toContain('https://');
  });
});
