import type { Context, Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { hashPassword, hashSecret, id, now, randomSecret, readBodyText, sameOriginWrite } from './security';
import type { Env, Row } from './types';

type AppEnv = { Bindings: Env; Variables: { user: Row } };
type Ctx = Context<AppEnv>;
type Auth = { currentUser(c: Ctx): Promise<Row | null>; createSession(c: Ctx, userId: string): Promise<void>; authLimit(c: Ctx, email: string): Promise<void> };
type Config = { clientId: string; clientSecret: string; redirectUri: string };
const COOKIE = '__Host-traqiva_google_state';
const SESSION = 'traqiva_session';
const PATH = '/api/auth/google/callback';
const issuers = ['https://accounts.google.com', 'accounts.google.com'];
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), {
  timeoutDuration: 5000, cacheMaxAge: 3600_000, cooldownDuration: 30_000,
  [customFetch]: (url, init) => fetch(url, { ...init, redirect: 'manual' }),
});
class OAuthError extends Error { constructor(public code: string) { super(code); } }
function fail(code: string): never { throw new OAuthError(code); }
const one = (env: Env, sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).first<Row>();
const googleErrors = new Set(['invalid_request', 'invalid_client', 'invalid_grant', 'unauthorized_client', 'unsupported_grant_type', 'invalid_scope', 'access_denied', 'temporarily_unavailable', 'server_error']);
const exceptionClasses = new Set(['Error', 'TypeError', 'AbortError', 'TimeoutError', 'ApiError', 'SyntaxError']);
function exceptionClass(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  return exceptionClasses.has(name) ? name : 'Other';
}

function configured(env: Env, requestUrl: string): Config | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim(), clientSecret = env.GOOGLE_CLIENT_SECRET?.trim(), redirectUri = env.GOOGLE_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri || clientId.length > 256 || clientSecret.length > 4096 || !clientId.endsWith('.apps.googleusercontent.com')) return null;
  try {
    const redirect = new URL(redirectUri), request = new URL(requestUrl);
    if (redirect.protocol !== 'https:' || redirect.origin !== request.origin || redirect.pathname !== PATH || redirect.search || redirect.hash || redirect.username || redirect.password) return null;
    return { clientId, clientSecret, redirectUri };
  } catch { return null; }
}
export const googleAvailable = (env: Env, requestUrl: string) => Boolean(configured(env, requestUrl));
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
async function verifiedIdentity(config: Config, code: string, state: Row) {
  let token: unknown;
  let stage: 'fetch' | 'body' = 'fetch', status: number | null = null;
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: 'authorization_code', code_verifier: state.pkce_verifier }).toString(),
    });
    status = response.status;
    if (!response.ok) {
      let providerError = 'unknown';
      try {
        const errorBody = JSON.parse(await readBodyText(response, 16_384));
        if (typeof errorBody?.error === 'string' && googleErrors.has(errorBody.error)) providerError = errorBody.error;
      } catch { /* Provider details and malformed error bodies are deliberately excluded from diagnostics. */ }
      console.warn({ event: 'google_oauth_exchange_failed', stage: 'http', status, google_error: providerError });
      fail('google_exchange_failed');
    }
    stage = 'body';
    const body = JSON.parse(await readBodyText(response, 65_536));
    token = body?.id_token;
  } catch (error) {
    if (error instanceof OAuthError) throw error;
    console.warn({ event: 'google_oauth_exchange_failed', stage, status, error_class: exceptionClass(error) });
    fail('google_exchange_failed');
  }
  if (typeof token !== 'string' || token.length > 16_384) fail('invalid_identity');
  try {
    const { payload } = await jwtVerify(token, googleKeys, {
      issuer: issuers, audience: config.clientId, algorithms: ['RS256'], clockTolerance: 5,
      maxTokenAge: '10m', requiredClaims: ['iss', 'aud', 'exp', 'iat', 'sub', 'nonce', 'email', 'email_verified'],
    });
    if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255 || typeof payload.nonce !== 'string' || await hashSecret(payload.nonce) !== state.nonce_hash) fail('invalid_identity');
    if (payload.email_verified !== true || typeof payload.email !== 'string' || payload.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) fail('invalid_identity');
    if ((payload.azp !== undefined && payload.azp !== config.clientId) || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== config.clientId)) fail('invalid_identity');
    const email = payload.email.toLowerCase();
    const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim().slice(0, 80) : email.split('@')[0].slice(0, 80);
    return { subject: payload.sub, email, name };
  } catch { return fail('invalid_identity'); }
}

export function registerGoogleAuth(app: Hono<AppEnv>, auth: Auth) {
  app.use('/api/auth/google*', async (c, next) => { c.header('Referrer-Policy', 'no-referrer'); await next(); });
  app.get('/api/auth/google', async c => {
    try {
      const config = configured(c.env, c.req.url); if (!config) fail('google_unavailable');
      const intent = c.req.query('intent') ?? 'login';
      if (!['login', 'signup', 'link'].includes(intent)) fail('invalid_intent');
      const user = intent === 'link' ? await auth.currentUser(c) : null;
      if (intent === 'link' && !user) fail('signin_required');
      if (intent === 'link' && !sameOriginNavigation(c.req.raw)) fail('invalid_state');
      await auth.authLimit(c, 'google-start');
      const state = randomSecret(), cookie = randomSecret(), nonce = randomSecret(), verifier = randomSecret(), at = now();
      const sessionToken = intent === 'link' ? getCookie(c, SESSION) : undefined;
      await c.env.DB.prepare("INSERT INTO oauth_states(provider,state_hash,cookie_hash,nonce_hash,pkce_verifier,intent,user_id,session_hash,expires_at,created_at) VALUES('google',?,?,?,?,?,?,?,?,?)").bind(
        await hashSecret(state), await hashSecret(cookie), await hashSecret(nonce), verifier, intent, user?.id ?? null, sessionToken ? await hashSecret(sessionToken) : null,
        new Date(Date.parse(at) + 600_000).toISOString(), at,
      ).run();
      stateCookie(c, cookie);
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: 'openid email profile', state, nonce, code_challenge: await challenge(verifier), code_challenge_method: 'S256', prompt: 'select_account' }).toString();
      return c.redirect(url.href, 302);
    } catch (error) { return c.redirect(`/login?oauth_error=${error instanceof OAuthError ? error.code : 'google_failed'}`, 302); }
  });
  app.get(PATH, async c => {
    stateCookie(c, '', 0);
    try {
      const config = configured(c.env, c.req.url); if (!config) fail('google_unavailable');
      const stateValue = c.req.query('state'), cookie = getCookie(c, COOKIE);
      if (!stateValue || !cookie || !/^[a-f0-9]{64}$/.test(stateValue) || !/^[a-f0-9]{64}$/.test(cookie)) fail('invalid_state');
      // DELETE RETURNING makes state consumption a single atomic D1 operation, even for concurrent callbacks.
      const state = await one(c.env, "DELETE FROM oauth_states WHERE provider='google' AND state_hash=? AND cookie_hash=? AND expires_at>? RETURNING *", await hashSecret(stateValue), await hashSecret(cookie), now());
      if (!state) fail('invalid_state');
      const issuer = c.req.query('iss'); if (issuer && !issuers.includes(issuer)) fail('invalid_identity');
      if (c.req.query('error')) fail(c.req.query('error') === 'access_denied' ? 'access_denied' : 'google_exchange_failed');
      const code = c.req.query('code'); if (!code || code.length > 4096) fail('google_exchange_failed');
      const user = state.intent === 'link' ? await auth.currentUser(c) : null;
      if (state.intent === 'link') {
        const session = getCookie(c, SESSION);
        if (!user || user.id !== state.user_id || !session || await hashSecret(session) !== state.session_hash) fail('signin_required');
      }
      const identity = await verifiedIdentity(config, code, state);
      const existing = await one(c.env, "SELECT user_id FROM oauth_identities WHERE provider='google' AND subject=?", identity.subject);
      if (state.intent === 'link') {
        if (user!.email.toLowerCase() !== identity.email || (existing && existing.user_id !== user!.id)) fail('account_conflict');
        const linked = await one(c.env, "SELECT subject FROM oauth_identities WHERE provider='google' AND user_id=?", user!.id);
        if (linked && linked.subject !== identity.subject) fail('account_conflict');
        if (!existing) {
          try { await c.env.DB.prepare("INSERT INTO oauth_identities(provider,subject,user_id,created_at) VALUES('google',?,?,?)").bind(identity.subject, user!.id, now()).run(); }
          catch { fail('account_conflict'); }
        }
        return c.redirect('/app/admin?google=linked', 302);
      }
      if (existing) { await auth.createSession(c, existing.user_id); return c.redirect('/login?oauth=success', 302); }
      if (await one(c.env, 'SELECT id FROM users WHERE email=?', identity.email)) fail('email_signin_required');
      const userId = id(), workspaceId = id(), at = now(), password = await hashPassword(randomSecret(48));
      try {
        await c.env.DB.batch([
          c.env.DB.prepare('INSERT INTO users(id,name,email,password_hash,password_salt,password_iterations,password_enabled,created_at) VALUES(?,?,?,?,?,?,0,?)').bind(userId, identity.name, identity.email, password.hash, password.salt, password.iterations, at),
          c.env.DB.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').bind(workspaceId, `${identity.name}'s workspace`, at),
          c.env.DB.prepare("INSERT INTO members(workspace_id,user_id,role) VALUES(?,?,'owner')").bind(workspaceId, userId),
          c.env.DB.prepare("INSERT INTO projects(id,workspace_id,name,created_at) VALUES(?,?,'Traqiva',?)").bind(id(), workspaceId, at),
          c.env.DB.prepare("INSERT INTO oauth_identities(provider,subject,user_id,created_at) VALUES('google',?,?,?)").bind(identity.subject, userId, at),
        ]);
      } catch {
        const concurrent = await one(c.env, "SELECT user_id FROM oauth_identities WHERE provider='google' AND subject=?", identity.subject);
        if (concurrent) { await auth.createSession(c, concurrent.user_id); return c.redirect('/login?oauth=success', 302); }
        if (await one(c.env, 'SELECT id FROM users WHERE email=?', identity.email)) fail('email_signin_required');
        fail('google_failed');
      }
      await auth.createSession(c, userId);
      return c.redirect('/login?oauth=success&new=1', 302);
    } catch (error) { return c.redirect(`/login?oauth_error=${error instanceof OAuthError ? error.code : 'google_failed'}`, 302); }
  });
}
