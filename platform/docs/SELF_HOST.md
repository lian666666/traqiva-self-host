# Deploy your own Traqiva

Use the clean public template, not an export of the private development repository's history. The template preserves the `platform/` layout and includes application source, migrations, Node CLI, native runtime source, prebuilt native downloads and licenses. No hosted database, user account, OAuth client or provider key is shared.

## First deployment

Install Node.js 22.13 or newer; Node 24 LTS is suitable. You need your own Cloudflare account with Workers and D1 access. Authentication can use `npx wrangler login`, an explicitly selected named profile, or a suitably scoped `CLOUDFLARE_API_TOKEN`. Do not paste secrets into chat, commit them or put them in browser variables.

```sh
git clone https://github.com/lian666666/traqiva-self-host.git
cd traqiva-self-host/platform
npm ci
npx wrangler login
npm run self-host -- --account-id YOUR_CLOUDFLARE_ACCOUNT_ID --name YOUR_WORKER_NAME --database YOUR_DATABASE_NAME --dry-run
npm run self-host -- --account-id YOUR_CLOUDFLARE_ACCOUNT_ID --name YOUR_WORKER_NAME --database YOUR_DATABASE_NAME
```

Replace all uppercase placeholders. Names must be 3–63 lowercase letters/digits/internal hyphens, starting with a letter. Choose fresh names. Add `--profile YOUR_PROFILE` if using a named Wrangler login. The dry run makes no network requests or file writes; it shows the exact target and plan.

The real command creates `wrangler.self-host.jsonc` and a local ownership receipt, verifies the requested account is authenticated, checks whether the Worker exists, lists D1 databases in that account, creates a fresh named database, builds the CLI and website, applies all migrations to the `DB` binding and deploys only that generated configuration. Every cloud command uses its explicit configuration and selected account. Authentication/network errors are failures, not evidence a resource is absent.

The script refuses an existing Worker or database by default. `--reuse-existing` explicitly authorizes migrations to an existing database; **separately**, `--reuse-existing-worker` authorizes replacing an existing Worker. Use these only for resources you own and intend to change. Successful subsequent deployments in the same checkout recognize the receipt and exact configuration. A modified config, changed target, missing receipt or inconsistent database ID is refused. No automatic deletion or rollback occurs after a failure.

Generated config/state files are ignored by Git. Keep them locally for repeat deployments; they contain resource identifiers, not provider keys. The template's `wrangler.jsonc` has no account or database ID and is not your production deployment record. Running `npm run deploy -- ...` in the exported template invokes the same explicit-target bootstrap.

Open the printed URL, register an account, choose your goals and project, accept the displayed workspace terms, then connect an integration or explicitly skip that step. Generate a project key when connecting and test the integration you need. A deployed Worker is not proof a provider/model/agent has been connected. Email/password works independently of optional Google sign-in. Email verification, password reset delivery and SMTP are not implemented; registration itself does not prove email ownership.

## GitHub Actions

The public template includes a **manual** `Deploy your Traqiva` workflow. Add repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, then provide your Worker/database names. The token needs access to the selected account, Workers script editing and D1 editing; it must allow Wrangler's account identity/access check. Never reuse another deployment owner's credentials. Each CI checkout is fresh, so repeat runs require explicit resource-reuse checkboxes. These controls do not grant access to accounts your token cannot access.

There is no verified one-click Deploy button in this release. Cloudflare supports [Deploy buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/) and [automatic resource provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning); this template uses an explicit, testable bootstrap so D1 creation and migration ordering are visible. See [official D1 CLI commands](https://developers.cloudflare.com/workers/wrangler/commands/d1/) for manual administration.

## Local development

```sh
npm run db:local
npm run dev:api
# In a second terminal:
npm run dev
```

The UI runs on port 5173 and API on 8789. Local data stays in Wrangler's ignored local state. Run `npm run check`, `npm run lint`, `npm test`, `npm run test:cli` and `npm run test:self-host`. The dev split supports email authentication; real Google OAuth requires the same-origin HTTPS deployment described below. `scripts/verify-live.mjs` performs a live integration test with synthetic data; inspect it before authorizing writes to your deployment.

## Optional Google sign-in

Create **your own** Google Web OAuth client, requesting only `openid email profile`, with exact callback `https://YOUR_DEPLOYMENT/api/auth/google/callback`. Set Worker secrets using the generated configuration:

```sh
npx wrangler secret put GOOGLE_CLIENT_ID --config wrangler.self-host.jsonc
npx wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler.self-host.jsonc
npx wrangler secret put GOOGLE_REDIRECT_URI --config wrangler.self-host.jsonc
```

Pass your selected `--profile` as needed. Enter each value interactively, not in command arguments. No credentials are included in the template. See [Google configuration](GOOGLE_AUTH.md). New Google users receive their own workspace; a verified-email collision with a password account requires password sign-in and an explicit link. No automatic account merge by email occurs. OAuth tokens are not retained. A basic sign-in flow does not prove Google brand verification or Production publishing.

## Optional GitHub sign-in

Create your own GitHub OAuth App with exact callback `https://YOUR_DEPLOYMENT/api/auth/github/callback`; leave wildcard matching and device flow disabled. Configure `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `GITHUB_REDIRECT_URI` as Worker secrets using your generated `wrangler.self-host.jsonc` and selected profile. Only `read:user user:email` are requested. Credentials are not included in the template. See [GitHub setup and account-linking behavior](GITHUB_AUTH.md). Existing-account email matches require an explicit authenticated link; they never silently merge accounts.

## Providers, native runtime and costs

Native compression and recovery can run locally without a paid model. Install the CLI from your deployment's `/downloads/traqiva-cli-0.1.0.tgz`, then use `traqiva engine install --url https://YOUR_DEPLOYMENT`. Native downloads are separate and SHA-256 checked. Windows was executed; Linux/macOS binaries were cross-compiled. Go source and reproducible build scripts are included if you prefer rebuilding. Read [runtime limits](../runtime/README.md).

The cloud gateway and Ask use the end user's OpenAI or Anthropic API key. Keys are forwarded for the requested operation and not stored. These calls may be billed by the provider. The experimental native Codex launcher is a separate integration and does not intercept an existing desktop chat. See [capabilities](CAPABILITIES.md).

Cloudflare Workers requests/CPU, static assets, D1 reads/writes/storage and scheduled runs are charged under **your** Cloudflare plan. Provider billing is separate. This guide promises neither a permanently free deployment nor a fixed amount of savings. Review current [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/). The daily scheduled scan reads your recorded request metadata; it is not a background LLM crawler.
