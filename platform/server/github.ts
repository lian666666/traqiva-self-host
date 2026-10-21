import type { Context, Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { hashPassword, hashSecret, id, now, randomSecret, readBodyText, sameOriginWrite } from './security';
import type { Env, Row } from './types';

type AppEnv = { Bindings: Env; Variables: { user: Row } };
type Ctx = Context<AppEnv>;
type Auth = { currentUser(c: Ctx): Promise<Row | null>; createSession(c: Ctx, userId: string): Promise<void>; authLimit(c: Ctx, email: string): Promise<void> };
type Config = { clientId: string; clientSecret: string; redirectUri: string };
const COOKIE = '__Host-traqiva_github_state';
const SESSION = 'traqiva_session';
const PATH = '/api/auth/github/callback';
class OAuthError extends Error { constructor(public code: string) { super(code); } }
function fail(code: string): never { throw new OAuthError(code); }
const one = (env: Env, sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).first<Row>();
const printableCredential = (value: string) => Array.from(value).every(char => char.charCodeAt(0) >= 33 && char.charCodeAt(0) <= 126);

function configured(env: Env, requestUrl: string): Config | null {
  const clientId = env.GITHUB_CLIENT_ID?.trim(), clientSecret = env.GITHUB_CLIENT_SECRET?.trim(), redirectUri = env.GITHUB_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri || clientId.length > 256 || clientSecret.length > 4096 || !printableCredential(clientId)) return null;
  try {
    const redirect = new URL(redirectUri), request = new URL(requestUrl);
    if (redirect.protocol !== 'https:' || redirect.origin !== request.origin || redirect.pathname !== PATH || redirect.search || redirect.hash || redirect.username || redirect.password) return null;
    return { clientId, clientSecret, redirectUri };
  } catch { return null; }
}
export const githubAvailable = (env: Env, requestUrl: string) => Boolean(configured(env, requestUrl));
function stateCookie(c: Ctx, value: string, maxAge = 600) {
  setCookie(c, COOKIE, value, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge });
}
function sameOriginNavigation(request: Request) {
  if (sameOriginWrite(request)) return true;
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  try { return new URL(request.headers.get('referer') ?? '').origin === new URL(request.url).origin; } catch { return false; }
}
async function challenge(verifier: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...digest)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
async function providerJson(url: string, init: RequestInit) {
  try {
    // Workers supports manual, not redirect:error. Never follow token/API redirects.
    const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) fail('github_exchange_failed');
    return JSON.parse(await readBodyText(response, 65_536));
  } catch { return fail('github_exchange_failed'); }
}
async function verifiedIdentity(config: Config, code: string, state: Row, desiredEmail?: string) {
  const token = await providerJson('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, code_verifier: state.pkce_verifier }).toString(),
  });
  if (typeof token?.access_token !== 'string' || !token.access_token || token.access_token.length > 16_384 || !printableCredential(token.access_token) || typeof token.token_type !== 'string' || token.token_type.toLowerCase() !== 'bearer') fail('github_exchange_failed');
  // Access/refresh tokens live only in this callback. They never enter D1 or logs.
  const headers = { authorization: `Bearer ${token.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'Traqiva', 'x-github-api-version': '2026-03-10' };
  const profile = await providerJson('https://api.github.com/user', { headers });
  if (!Number.isSafeInteger(profile?.id) || profile.id <= 0) fail('invalid_identity');
  const emails: unknown = await providerJson('https://api.github.com/user/emails?per_page=100', { headers });
  if (!Array.isArray(emails) || emails.length > 100) fail('github_email_required');
  const verified = emails.filter((item): item is { email: string; verified: true; primary?: boolean } => Boolean(item && typeof item === 'object' && item.verified === true && typeof item.email === 'string' && item.email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email)));
  if (!verified.length) fail('github_email_required');
  const selected = desiredEmail ? verified.find(item => item.email.toLowerCase() === desiredEmail.toLowerCase()) : verified.find(item => item.primary === true) ?? verified[0];
  if (!selected) fail('account_conflict');
  const email = selected.email.toLowerCase();
  const name = typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim().slice(0, 80) : typeof profile.login === 'string' && profile.login.trim() ? profile.login.trim().slice(0, 80) : email.split('@')[0].slice(0, 80);
  return { subject: String(profile.id), email, name };
}

export function registerGithubAuth(app: Hono<AppEnv>, auth: Auth) {
  const errorRedirect = (c: Ctx, error: unknown) => c.redirect(`/login?oauth_error=${error instanceof OAuthError ? error.code : 'github_failed'}&oauth_provider=github`, 302);
  app.use('/api/auth/github*', async (c, next) => { c.header('Referrer-Policy', 'no-referrer'); await next(); });
  app.get('/api/auth/github', async c => {
    try {
      const config = configured(c.env, c.req.url); if (!config) fail('github_unavailable');
      const intent = c.req.query('intent') ?? 'login';
      if (!['login', 'signup', 'link'].includes(intent)) fail('invalid_intent');
      const user = intent === 'link' ? await auth.currentUser(c) : null;
      if (intent === 'link' && !user) fail('signin_required');
      if (intent === 'link' && !sameOriginNavigation(c.req.raw)) fail('invalid_state');
      await auth.authLimit(c, 'github-start');
      const state = randomSecret(), cookie = randomSecret(), verifier = randomSecret(), at = now();
      const sessionToken = intent === 'link' ? getCookie(c, SESSION) : undefined;
      await c.env.DB.prepare("INSERT INTO oauth_states(provider,state_hash,cookie_hash,nonce_hash,pkce_verifier,intent,user_id,session_hash,expires_at,created_at) VALUES('github',?,?,?,?,?,?,?,?,?)").bind(
        await hashSecret(state), await hashSecret(cookie), await hashSecret(randomSecret()), verifier, intent, user?.id ?? null, sessionToken ? await hashSecret(sessionToken) : null,
        new Date(Date.parse(at) + 600_000).toISOString(), at,
      ).run();
      stateCookie(c, cookie);
      const url = new URL('https://github.com/login/oauth/authorize');
      url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, scope: 'read:user user:email', state, code_challenge: await challenge(verifier), code_challenge_method: 'S256' }).toString();
      return c.redirect(url.href, 302);
    } catch (error) { return errorRedirect(c, error); }
  });
  app.get(PATH, async c => {
    stateCookie(c, '', 0);
    try {
      const config = configured(c.env, c.req.url); if (!config) fail('github_unavailable');
      const stateValue = c.req.query('state'), cookie = getCookie(c, COOKIE);
      if (!stateValue || !cookie || !/^[a-f0-9]{64}$/.test(stateValue) || !/^[a-f0-9]{64}$/.test(cookie)) fail('invalid_state');
      const state = await one(c.env, "DELETE FROM oauth_states WHERE provider='github' AND state_hash=? AND cookie_hash=? AND expires_at>? RETURNING *", await hashSecret(stateValue), await hashSecret(cookie), now());
      if (!state) fail('invalid_state');
      if (c.req.query('error')) fail(c.req.query('error') === 'access_denied' ? 'access_denied' : 'github_exchange_failed');
      const code = c.req.query('code'); if (!code || code.length > 4096) fail('github_exchange_failed');
      let user = state.intent === 'link' ? await auth.currentUser(c) : null;
      const checkLinkSession = async () => {
        user = await auth.currentUser(c);
        const session = getCookie(c, SESSION);
        if (!user || user.id !== state.user_id || !session || await hashSecret(session) !== state.session_hash) fail('signin_required');
      };
      if (state.intent === 'link') await checkLinkSession();
      const identity = await verifiedIdentity(config, code, state, user?.email);
      const existing = await one(c.env, "SELECT user_id FROM oauth_identities WHERE provider='github' AND subject=?", identity.subject);
      if (state.intent === 'link') {
        // A logout/session revocation during the provider round trip cannot authorize linking.
        await checkLinkSession();
        if (user!.email.toLowerCase() !== identity.email || (existing && existing.user_id !== user!.id)) fail('account_conflict');
        const linked = await one(c.env, "SELECT subject FROM oauth_identities WHERE provider='github' AND user_id=?", user!.id);
        if (linked && linked.subject !== identity.subject) fail('account_conflict');
        if (!existing) {
          try { await c.env.DB.prepare("INSERT INTO oauth_identities(provider,subject,user_id,created_at) VALUES('github',?,?,?)").bind(identity.subject, user!.id, now()).run(); }
          catch { fail('account_conflict'); }
        }
        return c.redirect('/app/admin?github=linked', 302);
      }
      if (existing) { await auth.createSession(c, existing.user_id); return c.redirect('/login?oauth=success', 302); }
      if (await one(c.env, 'SELECT id FROM users WHERE email=?', identity.email)) fail('email_signin_required');
      const userId = id(), workspaceId = id(), at = now(), password = await hashPassword(randomSecret(48));
      try {
        await c.env.DB.batch([
          c.env.DB.prepare('INSERT INTO users(id,name,email,password_hash,password_salt,password_iterations,password_enabled,created_at) VALUES(?,?,?,?,?,?,0,?)').bind(userId, identity.name, identity.email, password.hash, password.salt, password.iterations, at),
          c.env.DB.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').bind(workspaceId, `${identity.name}'s workspace`, at),
          c.env.DB.prepare("INSERT INTO members(workspace_id,user_id,role) VALUES(?,?,'owner')").bind(workspaceId, userId),
          c.env.DB.prepare("INSERT INTO projects(id,workspace_id,name,created_at) VALUES(?,?,'My project',?)").bind(id(), workspaceId, at),
          c.env.DB.prepare("INSERT INTO oauth_identities(provider,subject,user_id,created_at) VALUES('github',?,?,?)").bind(identity.subject, userId, at),
        ]);
      } catch {
        const concurrent = await one(c.env, "SELECT user_id FROM oauth_identities WHERE provider='github' AND subject=?", identity.subject);
        if (concurrent) { await auth.createSession(c, concurrent.user_id); return c.redirect('/login?oauth=success', 302); }
        if (await one(c.env, 'SELECT id FROM users WHERE email=?', identity.email)) fail('email_signin_required');
        fail('github_failed');
      }
      await auth.createSession(c, userId);
      return c.redirect('/login?oauth=success&new=1', 302);
    } catch (error) { return errorRedirect(c, error); }
  });
}
