# Implemented capabilities and evidence

This is a source-built derivative of selected public Caveman v4.0.1 local components plus an independently implemented Traqiva application. It is not the complete Caveman product. The comparison below uses the [pinned upstream README](https://github.com/JuliusBrussee/caveman/blob/v4.0.1/README.md), [licensing statement](https://github.com/JuliusBrussee/caveman/blob/v4.0.1/LICENSING.md) and the actual code delivered here. Upstream's published benchmark numbers are not Traqiva measurements.

| Capability | Traqiva implementation | Practical boundary |
| --- | --- | --- |
| Local compression engine | Selected Apache-2.0 engine, tokenizers, compressors and persistent content recovery; independent Traqiva entry point | Input-dependent. CGO disabled; structural code compression supports Go, not the complete tree-sitter language set |
| Exact recovery / MCP | Node CLI, local CCR database, `traqiva_retrieve`; `compress`, `recover` and MCP tools | Native text stays local; handles require the matching retained local database. Cloud JSON fallback stores an authorized project artifact on your Worker |
| Request proxy | Public native proxy fork, forced commercial Cloud offline; explicit child Codex CLI launcher | Experimental. Does not modify global config or intercept an existing desktop conversation. Claude automatic launcher not implemented |
| API gateway and provider usage | OpenAI Responses/Chat Completions and Anthropic Messages; SSE passthrough, provider counters when reported | Requires a user's API key; missing usage is unavailable, not zero; no arbitrary upstream-host proxy |
| Traces and analytics | D1-backed projects, request traces, token/cost metadata and filters | Only connected/imported traffic is visible. A dashboard cannot infer unseen desktop requests |
| Compression events | Separate estimated token/byte event table, native metadata upload and JSON minification lab | Events are not provider requests. Local estimates are not billing reductions |
| Improvements | Deterministic metadata checks for repetition, error rates and cache candidates | Suggestions, not a continuous self-optimizing model or proof a recommended change was deployed |
| Verified savings | Display of evidence status and measurement boundaries; narrow explicit-input token A/B below | No invoice verification or general coding-quality benchmark; no measured automatic desktop reduction |
| Evaluations | User-defined exact-match cases, runs and recorded outcomes | Not a general semantic-quality evaluator or Caveman Cloud's full evaluation service |
| Ask | BYOK OpenAI/Anthropic question answering over selected project metadata | Explicit calls only, user's provider billing; not server-sponsored or automatically running |
| Authentication and projects | Email/password, Google OIDC, GitHub OAuth, explicit social account linking, workspace/project membership, project keys, onboarding | Each social provider needs the deployment owner's own OAuth client. Email ownership verification/reset mail, SSO/passkeys and commercial billing are not implemented |
| Model/effort routing | User-selected model forwarded | Automatic “cheapest correct model” / effort routing is not implemented |
| Other upstream components | No claim | “Say less” voice integration, complete read-less hooks, Blocks/memory, browse, commercial organization/credits/billing ecosystem are not reproduced |

## Actual checks

On 2026-10-21 the hosted release completed real GitHub consent with only `read:user user:email`, explicit linking to an existing Google account, sign-out, and GitHub sign-in. The authenticated user, workspace, active project and project count stayed the same; both provider links persisted. New-account creation and failure paths were checked through controlled OAuth tests, not a second live GitHub identity. The final application suite passed 125 tests, alongside lint, TypeScript and the production build. See [GitHub setup and verification](GITHUB_AUTH.md).

On 2026-10-21 a four-run real Codex A/B test used the same `gpt-6.1-sol / ultra` and synthetic extraction task in A→B→B→A order. Explicitly supplying the Traqiva-compressed log reduced Codex-reported input from **20,756 to 14,681 tokens (29.27%)**, with all five required facts correct in every run and zero cached-input tokens. Mean input plus output fell **29.13%**. This is one explicit-precompression task, not automatic desktop or billing savings. The automatic file-reading control was blocked by its child execution policy, so that path has no completed A/B result. See the [complete measurement and reproduction record](TOKEN_USAGE_AB_TEST.md).

On 2026-10-20 a clean Windows CLI installation downloaded the native engine from the deployed HTTPS manifest, verified its archive SHA-256 and compressed a synthetic 240-line log containing a unique error. Input **15,429 bytes**, output **467 bytes**, offline BPE estimates **5,304 → 141 tokens**. Recovery returned the original byte for byte, checked with Node Buffers. No provider/model call occurred. This demonstrates recoverable local compression on that fixture; it does not measure a complete agent session, semantic task quality or a bill reduction.

A separate real Codex ChatGPT session successfully routed two Responses requests through the experimental proxy and returned the correct synthetic result. Both requests used the safe `recovery_unproven` passthrough path: **zero transformations**. Provider usage was unavailable. The global Codex config hash remained unchanged and authentication files were not copied. Routing succeeded; subscription token savings were not demonstrated.

Local mock-upstream tests also demonstrate conversion of an eligible tool response, byte-exact SSE passthrough and matching CCR recovery. A mock is useful for regression testing and is not a real-model quality or billing experiment. Linux amd64 and macOS arm64 artifacts were cross-compiled, not executed in this validation environment.

The complete upstream test suite is not reported as passing. In no-CGO builds the upstream release-shape test expects TypeScript/JavaScript/Python parsers not present here; CloudLink's online-cache test is incompatible with forced-offline policy. Selected entrypoint, CCR, compressors, tokenizer, OpenAI/Anthropic provider and Traqiva offline-guard tests passed. See [native verification](../runtime/VERIFICATION.md).

## License and privacy boundary

The selected public v4.0.1 revision is `d0be14f2dc92a99d12e717465d6908723ab9bfdb`. Apache-2.0 permits reuse under its conditions; original notices, included third-party licenses and prominent modification statements are preserved. It does not grant Caveman's commercial Cloud source or its trademarks. Read [third-party notices](../licenses/THIRD_PARTY_NOTICES.md) and source license files.

Native compression originals remain under the local Traqiva home. Only allowlisted compression/traffic metadata is uploaded when a project is connected. The proxy's commercial Cloud link is disabled before legacy Cloud settings or credentials can be read. API gateway operations necessarily send the user's requested content and provider key to that selected provider. Cloud JSON recovery deliberately stores the submitted original in the user's project; do not confuse that separate service with native local-only storage.
