# GitHub sign-in

Traqiva uses GitHub's authorization-code flow with S256 PKCE and a one-time, browser-bound state. This is account sign-in, not a repository integration. Requested scopes are only `read:user user:email`. GitHub passwords are entered at GitHub, never Traqiva. See [GitHub's OAuth flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) and [email API](https://docs.github.com/en/rest/users/emails#list-email-addresses-for-the-authenticated-user).

## Configure your own deployment

1. In GitHub Settings → Developer settings → OAuth Apps, register an application with your Traqiva homepage URL and an exact callback:

   ```text
   https://YOUR_DEPLOYMENT/api/auth/github/callback
   ```

2. Keep wildcard matching and device flow disabled. Leave token expiration enabled. Create a client secret; keep it private.
3. Apply the D1 migrations, including `0005_github_oauth.sql`, before deploying this handler. Existing Google identities are preserved.
4. Set all three server bindings on your Worker:

   ```sh
   npx wrangler secret put GITHUB_CLIENT_ID --config wrangler.self-host.jsonc
   npx wrangler secret put GITHUB_CLIENT_SECRET --config wrangler.self-host.jsonc
   npx wrangler secret put GITHUB_REDIRECT_URI --config wrangler.self-host.jsonc
   ```

   Use your selected named Wrangler profile if applicable. Enter values interactively, not in command arguments. The redirect binding must exactly match your registered HTTPS callback and current deployment origin. Never prefix credentials with `VITE_`, commit them, or reuse the hosted service's OAuth application for another deployment.
5. `GET /api/auth/providers` returns `github: true` when the three bindings have a valid configuration. This indicates configuration availability, not a completed authorization test.
6. Open `/signup` or `/login` and choose **Continue with GitHub**. Review the GitHub consent screen. After authorization, a new account enters onboarding; returning accounts retain their workspace and project.

For local Wrangler development, blank placeholders are documented in `.env.example`. Social sign-in requires the registered HTTPS deployment; email/password remains available independently.

## Identity and account linking

- The stable GitHub numeric user ID identifies an account, not its mutable username or public profile email. The server reads verified email records from GitHub's authenticated email endpoint; an unverified or missing email cannot create a session.
- A new GitHub identity with an email already used by an existing Traqiva account does **not** automatically merge accounts. Sign in using the original method, then explicitly choose **Connect GitHub account** in account settings. The connected GitHub email must match the account email.
- Linking is bound to the same signed-in session that started the request and preserves workspace membership. A different account, changed session, expired state, denied authorization or replay produces a clear failure.
- GitHub access/refresh tokens and authorization codes are not retained in D1 or browser storage. Only the provider ID and short-lived state proof are stored. Callback queries are redacted from Worker observability logs.
- A canceled authorization returns to sign-in with a message. An unavailable GitHub service does not disable email/password or Google.

## Verify

Run the backend OAuth tests, frontend login tests, lint and production build. Controlled HTTP tests cover provider responses and state/identity handling; they are separate from a real browser authorization. Verify the deployed click → GitHub consent → callback → authenticated session path, then sign out and repeat login to confirm account reuse. Do not treat a configured button, a 302 redirect or `github: true` alone as successful sign-in.

## Hosted verification — 2026-10-21

The hosted release was verified in a real desktop browser: **Connect GitHub account → GitHub consent for Traqiva → account connected**, followed by **Sign out → Continue with GitHub → authenticated Home**. Session reads confirmed the same user, workspace, active project and project count as before linking. Google stayed connected, GitHub remained connected, and no duplicate project was created. Browser error/warning logs were empty for the exercised flow. The white sign-in page and real consent screen were visually checked.

The application suite passed **125 tests**, including 23 GitHub backend cases, with lint, TypeScript and the production build passing. The self-host tooling suite passed 10 tests. Migration `0005_github_oauth.sql` was applied before the handler deployment. Controlled tests cover new-account onboarding, email collisions, explicit link conflicts, state expiry/replay, cross-provider callbacks, provider failures and Google identity preservation. A brand-new GitHub identity and a mobile browser were not exercised live; these are separate from the successful existing-account link/sign-in check. Secrets, consent codes, private session identifiers and screenshots are not included in this repository.
