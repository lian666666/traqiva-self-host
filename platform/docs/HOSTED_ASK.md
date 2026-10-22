# Hosted Ask

Ask Traqiva can answer questions using the signed-in user's authorized project evidence and private chat history. It sends bounded statistics, model summaries and recent trace metadata to OpenAI; raw traffic request/response bodies and other users' projects are excluded. Evidence links point back to the selected project's analytics and traces. The assistant cannot browse the web, run commands, execute tools or create evaluations.

## Operator setup

Self-hosted installations leave hosted Ask disabled by default. The installation operator supplies and pays for OpenAI access; the template includes no provider credential or sponsored account credit.

1. Apply **all** D1 migrations before deploying, including `0008_ai_allowance.sql` and `0009_ask_conversations.sql`.
2. Store `HOSTED_OPENAI_API_KEY` as a Worker **secret**, never a frontend variable, checked-in file or chat message.
3. Set the Worker variable `HOSTED_ASK_ENABLED` to the string `"true"`. Both this flag and the secret are required. Set the flag to `"false"` to disable new hosted requests.
4. Build and deploy, then check authenticated `/api/ask/status?project=PROJECT_ID`. A configured status does not prove that a live model call works.

For this repository's existing deployment, use its named Wrangler profile:

```sh
npx wrangler d1 migrations apply traqiva-platform --remote --profile traqiva
npx wrangler secret put HOSTED_OPENAI_API_KEY --profile traqiva
npm run build
npx wrangler deploy --profile traqiva
```

Enter the secret privately at the terminal prompt. Configure the enable flag in the Worker's variables or merge it into Wrangler's `vars` configuration. Independent installations use their own database, account and appropriate Wrangler profile.

## Fixed provider policy and allowance

Hosted requests use `gpt-6-luna`, Responses API, the default service tier, low reasoning/verbosity, `store:false`, no streaming and no tools. Explicit caching is configured without breakpoints, disabling cache reads and writes. The generation cap is 1,600 output tokens, including reasoning; token-count preflight rejects inputs above 65,536 tokens. Requests also have a 65,536-byte payload limit.

Each authenticated **user account** receives a **$1 lifetime allowance shared across all projects**. It has no expiration or automatic reset. Deleting a project does not refund spending or pending reservations. This is a per-account application policy; it neither limits the operator's total OpenAI bill nor guarantees one allowance per unique person.

The D1 ledger uses integer USD nano-units: `$1 = 1,000,000,000`. Before generation, one conditional write atomically reserves:

```text
(preflight_input_tokens + 1,024) × 125 + 1,600 × 500 nano-USD
```

The framing margin and higher input reservation rate provide headroom. Concurrent requests cannot reserve more than the user's remaining allowance, and a reservation ID authorizes only one upstream attempt. Settlement uses validated provider-reported usage at 100 nano-USD per input token and 500 per output token, releasing the unused reservation. These are usage-priced amounts, not invoice reconciliation.

Unknown usage, timeouts and uncertain failures consume the full reserved bound. Interrupted reservations remain held indefinitely. Explicit known-not-billed rejections can release their reservation; completed settlements are immutable. Exhaustion returns HTTP 402. There is no automatic credit purchase or top-up. Free statistics mode does not call a model. BYOK mode uses the user's supplied provider key and is billed separately from this hosted allowance.

## Privacy, retention and verification

Conversations are scoped to the current user, workspace and project. Successful exchanges are stored in D1. Chat history currently requires separate operator removal and is **not** deleted by the traffic-retention job. The allowance ledger is also independent of traffic retention. `store:false` controls Responses storage; it is not a promise about all provider-side data retention.

Automated checks use synthetic data and mocked providers. Passing them does not establish that an operator's key is configured, permitted to use this model, funded or tested against the live API.

The maintained Traqiva deployment was tested on **2026-10-22** with one real hosted Responses call. OpenAI reported 1,339 input tokens, 57 output tokens and zero cached tokens. The ledger settled **$0.0001624** from provider usage at the configured prices, releasing its unused reservation; the successful answer and allowance remained after a browser reload. Trace records contained metadata only, with request/response bodies excluded. This verifies that deployment and key at that time; independent installations still need their own live check. It does not establish coding-agent installation or token savings.

Provider policy and short-context Standard prices were checked on **2026-10-22**: **$0.10 input / $0.50 output per million tokens**; the reservation uses the higher $0.125 input rate. Operators must review pricing and compatible request settings when updating this integration. Sources: [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), [token counting](https://developers.openai.com/api/docs/guides/token-counting).
