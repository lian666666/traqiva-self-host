# Traqiva — self-hosted agent observability and local compression

A white-theme dashboard, API gateway, request traces, exact-match evaluations and local recoverable compression. Run your own Cloudflare Worker and D1 database. This repository contains application source, the independent Node CLI, selected Apache-2.0 native runtime source and separate platform downloads. It contains no hosted deployment's accounts, database, users or provider keys.

## Deploy your own instance

Install Node.js 22.13 or newer and authenticate Wrangler with your own Cloudflare account. Choose unused Worker and database names.

```sh
git clone https://github.com/lian666666/traqiva-self-host.git
cd traqiva-self-host/platform
npm ci
npx wrangler login
npm run self-host -- --account-id YOUR_CLOUDFLARE_ACCOUNT_ID --name YOUR_WORKER_NAME --database YOUR_DATABASE_NAME --dry-run
npm run self-host -- --account-id YOUR_CLOUDFLARE_ACCOUNT_ID --name YOUR_WORKER_NAME --database YOUR_DATABASE_NAME
```

The script verifies account access, refuses an existing Worker or database by default, creates your database, builds the CLI and website, applies migrations and deploys your Worker. Its generated `wrangler.self-host.jsonc` and `.self-host-state.json` are ignored by Git. Reuse the same checkout for subsequent deployments. See [the full deployment guide](platform/docs/SELF_HOST.md) for explicit reuse, CI, local development and optional Google/GitHub sign-in. Each deployment uses its own OAuth applications; [GitHub setup](platform/docs/GITHUB_AUTH.md) requests only read-only profile and email access.

Open your resulting URL and create your own account. No demo credentials are installed. API providers and native compression are optional, separate integrations. Model calls and Cloudflare resources may incur charges in your accounts.

## What is implemented

Read the [capability matrix and evidence boundaries](platform/docs/CAPABILITIES.md). Local engine compression and exact recovery are implemented. A tested synthetic log compressed from 15,429 to 467 bytes and recovered byte for byte; its 5,304 → 141 token figures are local estimates, not provider billing savings. A real experimental Codex session routed through the native proxy, but zero requests transformed because recovery could not be proven. This product does not automatically intercept an existing Codex desktop chat, implement Caveman's complete commercial Cloud service, or guarantee savings.

```sh
cd platform
npm run check
npm run lint
npm test
npm run test:cli
npm run test:self-host
```

## License

The independent application is Apache-2.0. Selected Caveman v4.0.1 local runtime code retains its original Apache-2.0 license and notices; earlier included works retain their stated terms. Read [third-party notices](platform/licenses/THIRD_PARTY_NOTICES.md), native source notices and generated dependency licenses. Caveman's name and marks are not used as Traqiva's brand; no affiliation is claimed.
