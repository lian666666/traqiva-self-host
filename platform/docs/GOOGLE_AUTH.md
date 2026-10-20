# Optional Google sign-in for your deployment

Google OAuth is disabled until you supply your own Web application client. No hosted deployment's credentials, Google project, users or OAuth registration are included.

1. In your Google Cloud project's Google Auth Platform, configure Branding, Audience and Data Access. Request only `openid email profile`.
2. Create a **Web application** OAuth client. Add the exact redirect URI `https://YOUR_DEPLOYMENT/api/auth/google/callback` with no extra trailing slash. The runtime requires a same-origin HTTPS callback.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` as Worker secrets using `--config wrangler.self-host.jsonc` and your chosen profile. The secret is server-only; never use `VITE_` variables or commit it.
4. Check `/api/auth/providers` reports `google: true`, then complete real Google consent, callback, onboarding, logout and repeat sign-in. A configured endpoint alone is not evidence sign-in works.

Only name/email/profile scopes qualify for Google's basic-sign-in Testing exception. Adding API scopes changes restrictions. Successful login does not mean the app has verified branding or a Production audience. Supply real homepage/privacy/terms URLs and a domain you can verify when publishing verified external branding. See [Google Audience](https://support.google.com/cloud/answer/15549945?hl=en), [Branding](https://support.google.com/cloud/answer/15549049?hl=en) and [redirect URI rules](https://developers.google.com/identity/protocols/oauth2/web-server#redirect-uri-validation-rules).

The server uses OIDC signature/issuer/audience/nonce/verified-email checks, state binding and one-use state. Tokens are not stored. Existing password accounts are never silently merged by matching email: sign in with the password and explicitly link the same verified Google email from Admin. Linking is bound to that exact active session. This explicit-link browser journey must still be tested for your deployment; unit tests are not a replacement for consent testing.

In local split-port development use email/password or tests. This release does not implement a real Google login across the separate Vite/API development origins; use your HTTPS Worker deployment for end-to-end OAuth.
