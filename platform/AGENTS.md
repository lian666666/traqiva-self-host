# Traqiva self-host template

Work in `platform/`. The application uses React/Vite, Hono, Cloudflare Workers and D1. The independent Node client is in `platform/cli`; selected native runtime source is in `platform/runtime`.

Use your own explicitly selected Cloudflare account and fresh Worker/database names. Deploy with `npm run self-host -- --account-id ... --name ... --database ...`. Do not infer deployment ownership from a matching name. Do not commit environment files, credentials, generated self-host config/state, local databases, caches or user records.

Do not invent traffic, savings, evaluations, OAuth success or upstream feature parity. Local token estimates are distinct from provider usage and counterfactual savings. Preserve upstream licenses, notices and modification statements. Run the relevant tests, lint and build before publishing changes.
