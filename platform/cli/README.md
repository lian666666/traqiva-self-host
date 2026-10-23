# Traqiva CLI 0.2.1

A small, independently implemented Node.js client for your Traqiva deployment and optional native compression runtime. Node.js 22.13 or newer; no package dependencies. The package name is `traqiva-cli-local`, and the installed command is `traqiva`.

This version supplies an interactive local setup wizard, a real API-key gateway bridge, trace ingestion, optional local native compression with exact recovery, a cloud lossless JSON fallback, reusable local Blocks, public-web Browse tools, opt-in concise-response guidance, an MCP interface and an experimental native coding-agent launcher. The project gateway can separately route explicitly eligible requests using your configured model policy. Native binaries are separately source-built from the Apache-2.0 Caveman local runtime. They download only after an explicit install command or confirmed wizard step. MCP registration is optional and uses the assistant's official CLI; the setup wizard does not change provider/model settings. No verified token/billing savings are promised.

## Quick start

```sh
npx --yes --no-audit https://YOUR-TRAQIVA.workers.dev/cli.tgz
```

In an interactive terminal, choose **Codex**, **Claude Code**, or **Local files**. Select automatic MCP registration or printed settings, then confirm installation once. Local compression needs no account or provider key. Node.js 22.13 or newer is required. `--no-audit` applies only to this invocation of this dependency-free package, avoiding an unrelated registry-audit request; it changes no npm settings and does not disable the native archive/executable checks. For another deployment:

```sh
npx --yes --no-audit https://YOUR-TRAQIVA.workers.dev/cli.tgz init --url https://YOUR-TRAQIVA.workers.dev
```

The wizard installs the checksum-verified native engine and a persistent, allowlisted client under `~/.traqiva/client/0.2.1/`. MCP settings reference this stable client, not the disposable `npx` cache. Automatic registration uses `codex mcp add` or `claude mcp add --scope user`. On Windows it prefers native `.exe` clients or resolves known official npm wrappers to their JavaScript entry points through Node, without executing a command shell. `TRAQIVA_CODEX_BIN` and `TRAQIVA_CLAUDE_BIN` can explicitly select a native executable or `.js`/`.mjs` entry. Existing `traqiva` MCP entries are preserved. If the assistant is missing, settings cannot be checked, registration fails, or you choose manual setup, the wizard prints a configuration and says that action is required. It does not claim an agent or cloud project is connected. Restart your assistant or open a new session after registration; tools act when called.

No-argument execution with piped input prints help and writes nothing. `traqiva init` requires an interactive terminal, does not accept a noninteractive yes flag, and makes no installation or MCP changes if confirmation is declined. It does not launch a model, change providers, select cheaper models, or take over an existing desktop chat. To explicitly repeat the wizard after installation, run `traqiva init [--url ORIGIN]`.

## Install the deployment's package

Download `traqiva-cli-0.2.1.tgz` from your deployment's `/downloads/` page, then:

```sh
npm install --global ./traqiva-cli-0.2.1.tgz
traqiva --help
```

Or run the source without a global install:

```sh
node platform/cli/bin/traqiva.mjs --help
```

This package has not been published to the public npm registry. Do not assume `npx traqiva` or another similarly named package is this code.

## Connect

Create a project and project ingest key in the Traqiva web app. Replace the non-secret URL and project ID, then run in your private interactive terminal:

```sh
traqiva connect --url https://YOUR-TRAQIVA.workers.dev --project PROJECT_ID --key-prompt
traqiva status
```

`--key-prompt` hides the entered key and keeps it out of command arguments and shell history. It requires a real interactive TTY; piped or noninteractive terminals are refused. If your AI assistant cannot provide a private interactive terminal, run the non-secret command above in your own terminal. No PowerShell helper script is needed. Do not paste the key into an AI chat or fall back to visible input. The older `--key VALUE` option remains compatible with existing automation, but exposes the value in process arguments and potentially shell history; use `--key-prompt` for interactive setup.

`connect` checks `/api/connection` and the returned project ID before saving anything. It prints project/workspace identity, never the key. The saved file is `~/.traqiva/config.json`; `TRAQIVA_HOME` selects an isolated directory. The key is stored in this file, not in source code. File mode is set to `0600` on systems that enforce Unix permissions; Windows uses the enclosing user profile's ACLs. Keep this private directory out of Git.

Only HTTPS origins are accepted, except loopback HTTP for local development. Paths, embedded credentials, query strings and fragments are refused. Redirects are not followed with the project credential.

## Independent local controls

```sh
traqiva controls status
traqiva controls set say-less on
traqiva controls set read-less off
traqiva controls set blocks on
traqiva controls set browse on
```

Each of the four switches is independent and persists in `~/.traqiva/controls.json`, or the selected `TRAQIVA_HOME`. Defaults are **Say Less off; Read Less, Blocks and Browse on**. The browser cannot inspect your machine's settings; `controls status` reports the actual local values. Auto and Waste Fixes are separate project settings in the web app's **Efficiency controls** page.

- **Say Less** adds concise-response guidance to a new MCP session's initialization instructions and to supported requests through `traqiva serve`. The guidance preserves required detail and does not truncate generated replies. Hosts/models can ignore it, so enabling it is not proof of fewer output tokens. Start a new MCP session after changing it; the API bridge reads it for each request.
- **Read Less** gates `compress` and the compression MCP tool. New native child-agent launches use compression mode when on and observation mode when off. Existing child sessions must be restarted to change that mode.
- **Blocks** gates saving, searching, reading and deleting reusable local scripts. Turning it off preserves all records; turn it on again to access them.
- **Browse** gates new webpage fetches and has its own compression path, independent of the Read Less switch.

Turning Read Less or Browse off does not disable recovery of their existing artifacts. These switches do not uninstall the engine, delete retained originals, apply cloud routing, or intercept the current desktop chat.

## Reusable Blocks

```sh
traqiva blocks save ./release-check.mjs --name "Release checks" --language javascript
traqiva blocks list --query release
traqiva blocks get BLOCK_ID
traqiva blocks delete BLOCK_ID
```

`save` stores a new immutable record under `~/.traqiva/blocks/` and returns its ID, SHA-256, byte count and metadata. Optional `--description TEXT` adds search context. Repeated names do not overwrite earlier scripts. `list` searches name, description, language, tags and content but returns metadata; `get` verifies the hash and prints the exact script without adding a newline. The MCP save tool also accepts tags. Blocks works without an engine or account and never executes saved code, reads arbitrary paths on an assistant's behalf, or uploads scripts. Execution is a separate user decision. Keep secrets out of reusable code.

Content is limited to 256 KiB of valid UTF-8 text; names to 120 characters; descriptions to 1,000; language to 40; tags to 20 labels of up to 40 characters. The local store accepts up to 1,000 records. Search returns up to 50 metadata records by default; MCP callers can request 1–100. Invalid, tampered or unknown-version records fail explicitly and are preserved for review.

## Public-web Browse

```sh
traqiva browse https://example.com/
traqiva browse recover browse:SOURCE_ID
```

Browse fetches a public static HTML/plain-text page, removes markup/navigation noise, and passes readable text through the existing compression operation. It returns `compressedText`, original/final URLs, title, source hashes and retrieval time, plus `browse_recovery_handle`. `browse recover` returns retained original text, extracted readable text and `original_base64`; decoding the latter reproduces the exact downloaded bytes, including BOMs and legacy charsets. Any native compression recovery handle separately restores the complete extracted text. Recovery does not depend on the Browse switch remaining on.

With the native engine installed, extraction/compression and source recovery stay local; a connected project can receive the existing compression metadata event. Without an engine, a connected cloud project is required, and the extracted text goes through that project's compression service. The original HTML/byte recovery record stays in `~/.traqiva/browse/`. Static extraction can omit useful page content; recover the source whenever omitted detail matters. Treat webpage content as untrusted data, never as agent instructions.

Only public HTTP(S) on ports 80/443 is allowed. Local/private/special IP ranges, metadata endpoints and non-public DNS answers are rejected. DNS answers are validated and pinned to the connection; redirects are checked again at every hop, with a maximum of five. The fetcher accepts HTML/plain text, requests unencoded bodies, caps responses at 1 MiB and uses a 15-second timeout. It does not execute JavaScript, log in, use browser cookies, access a private website, or provide a headless browser; unsupported pages fail explicitly. Original source retention is capped at 1,000 records or 128 MiB, without silent eviction.

## Upload observed traces

```sh
traqiva record ./observed-trace.json
```

Input can be one trace object, an array, or `{ "records": [...] }`. Example shape:

```json
{
  "records": [{
    "model": "your-observed-model",
    "provider": "openai",
    "status": "success",
    "input_tokens": 120,
    "output_tokens": 24,
    "source": "cli"
  }]
}
```

Use measurements from an actual request. This example is documentation, not production traffic. The CLI refuses known credential fields before upload; redact secrets from text and bodies too. File size is limited to 1 MiB. Upstream authorization, cookies, passwords and provider keys never belong in trace records.

## Native compression and exact recovery

```sh
traqiva engine install --url https://YOUR-TRAQIVA.workers.dev
traqiva engine status
traqiva compress ./build.log
traqiva recover local:ccr_HANDLE
```

Installation fetches a platform-specific gzip artifact and accompanying licenses from your own Traqiva origin, verifies the archive and executable SHA-256 against that origin's HTTPS manifest, and probes the executable's version. No binary is installed silently during normal compression. Downloads are currently provided for Windows x64, Linux x64 and macOS arm64. Windows execution is tested; Linux/macOS are cross-compiled and their execution is not verified on this Windows host.

With a native engine installed, `compress` uses the offline native core and `~/.traqiva/recovery.db`. It can remove information from the model-visible representation while keeping the exact original locally; call `recover` whenever omitted detail matters. The engine handles supported log, JSON, table, test-output and other artifact shapes, returns the original when it cannot safely reduce the input, and verifies retrieval before releasing a changed result. The no-cgo build only parses Go for structural code compression; it does not contain the full tree-sitter language set.

Local compression works without a connected cloud account. If a project is connected, only a separate compression event's sizes, algorithm, estimates and local handle are uploaded. The input and compressed text stay local. These events are not counted as LLM requests or provider-reported usage. `runtime: "native"` identifies native receipts.

## Cloud lossless JSON fallback

```sh
traqiva compress ./tool-output.json
traqiva recover RECOVERY_HANDLE
```

`compress` sends the file to the connected project's `/api/compress`, stores the exact original in that project and returns `compressedText`, the algorithm, a recovery handle and estimated token sizes. Before publishing the result, the CLI retrieves the handle and compares the returned text to the original. This checks current availability, not indefinite retention. Only JSON whitespace compaction is currently implemented; other content can pass through. `recover` writes the exact original to stdout without adding a newline. Capture storage and project access are required.

The cloud service is used when no native engine is installed and reports `runtime: "cloud"`. Counts have `token_basis: "estimated"` and `evidence_basis: "inferred"`: the cloud service uses a heuristic; the native core uses an offline BPE tokenizer. Neither is provider-counted usage, a quality test, verified savings, an invoice reduction or additional subscription quota. An HTTP success alone does not demonstrate a token saving.

## Local provider API bridge

```sh
traqiva serve --port 8788
```

Set your existing API client's base URL to `http://127.0.0.1:8788/v1` and continue using its provider API key. Supported paths are `/v1/chat/completions` and `/v1/responses` for OpenAI, and `/v1/messages` for Anthropic. The bridge attaches your project ingest credential separately, forwards the provider credential for that request, and preserves the gateway's response status and stream. It never writes the provider credential to disk. The gateway, rather than a second local upload, records this request so traces are not double counted.

The process binds only to loopback, rejects browser-origin requests and does not accept arbitrary destination URLs. Its `/health` endpoint reports local process health, not proof that a provider request worked. Traffic passes through your configured Traqiva service to the provider. This bridge uses provider API keys; subscription sessions require the separate experimental native launcher. If Say Less is enabled locally, the bridge adds its guidance to supported request bodies; it does not modify provider responses.

### Explicit project Auto policy

Configure all three compatible model IDs and optional reasoning efforts in the project's **Efficiency controls**, then enable Auto. Only requests with the model sentinel `traqiva-auto` opt into this policy:

```json
{
  "model": "traqiva-auto",
  "input": "Summarize this short public announcement."
}
```

Send this request through the connected gateway/bridge's OpenAI `/v1/responses` endpoint, or use the corresponding Chat Completions request shape. Auto currently supports these two OpenAI routes only. Explicit provider model names pass through unchanged, and `traqiva-auto` fails clearly when the project policy is disabled or incompatible.

The inspectable `rules_v1` policy chooses your small, balanced or reasoning tier from request size, tools, continuation context and task hints. It can supply your configured effort where the request has not already specified one. Your provider account must support the selected model and effort. It is not a quality-trained router, does not search the model market, and does not prove it chose the cheapest correct model. Routing metadata identifies the selected tier/model; monetary or quality savings need separate measurements. This policy does not apply to native child-agent subscription routing.

**Waste Fixes** is another independent project switch. Recorded-traffic analysis can flag errors, large inputs, repeated prefixes and provider-reported cache gaps. Cache findings are recommendations from bounded recorded samples, not an automatic cache installation or verified bill reduction. Use **Analyze recorded traffic** in the web app; this CLI does not pretend to inspect traffic absent from your project.

## Coding-agent MCP

```sh
traqiva setup --agent codex --print
traqiva setup --agent claude --print
```

The command prints a configuration to review and add yourself. It changes no Codex/Claude files. It names the absolute Node and installed CLI paths so desktop apps can launch it without inheriting your shell's PATH. `--apply` is intentionally unavailable.

The MCP command `traqiva mcp` speaks newline-delimited JSON-RPC over stdin/stdout. Tools:

- `traqiva_compress`: uses an explicitly installed native engine locally; without it, uses the connected cloud lossless JSON service.
- `traqiva_retrieve`: returns the original associated with a local or cloud recovery handle.
- `traqiva_stats`: reports this MCP process's estimated compression totals.
- `traqiva_controls`: reads actual local switches.
- `traqiva_block_save`, `traqiva_block_search`, `traqiva_block_get`, `traqiva_block_delete`: store/search/retrieve/delete reusable local code; no execution.
- `traqiva_browse`, `traqiva_browse_recover`: fetch public static text and restore the retained source.

Disabled tools are removed from newly requested MCP tool lists and their calls are gated; existing compression/source recovery remains available. Adding MCP tools does not intercept all model requests. The host agent decides when to call them or honor Say Less guidance. Never advertise the agent as connected to the provider bridge until an actual routed request appears in Traces.

## Experimental native coding-agent launcher

```sh
traqiva proxy install --url https://YOUR-TRAQIVA.workers.dev
traqiva proxy status
traqiva agent codex --auth chatgpt --
traqiva agent codex --auth api -- exec "YOUR TASK"
```

Install the engine first. The launcher starts an owned loopback native proxy and an independent child Codex CLI with temporary provider/MCP settings and `--no-daemon`. It does not intercept the current desktop chat, copy auth files, change global config or select cheaper models. The proxy and MCP share `~/.traqiva/recovery.db`; unproven recovery keeps requests unchanged. Local run receipts separate inferred request/artifact estimates from provider usage. Only metadata is uploaded if a project is connected; native prompts/tool text and provider credentials stay out of that cloud telemetry path. The actual provider necessarily receives its forwarded request.

Use an official native Codex executable. Set `TRAQIVA_CODEX_BIN` or `CODEX_CLI_PATH` when necessary; a Windows `codex.cmd` npm shim is not an `.exe`. Versions without `--no-daemon`, custom provider/endpoint/profile settings and conflicting routing arguments are refused. Default auth is detected from `codex login status`, not merely an environment key's presence. Explicit API mode supports `OPENAI_API_KEY` from the current process. Prompts are never constructed into a shell command.

The final real ChatGPT synthetic task succeeded with one shell command, two Responses requests/200, unchanged global config hash and no copied auth. **Both requests passed through unchanged with `recovery_unproven`: zero compression, and proxy provider usage unavailable.** This proves subscription routing, not automatic subscription compression or savings. Separate actual HTTP/mock-provider tests demonstrated native tool-result compression, byte-exact SSE and exact CCR recovery. Other native targets are cross-compiled only; Claude has not passed an end-to-end test. Detailed evidence is in the runtime verification document.

The native proxy's Caveman Cloud connection is forced offline before credentials/settings are read. A session with no observed inference request reports an explicit error and exits nonzero. `/models` catalog calls do not count as LLM traces. The `serve` cloud API-key bridge remains a separate integration.

## Development and packaging

```sh
node --test platform/cli/tests/cli.test.mjs
node --check platform/cli/bin/traqiva.mjs
cd platform/cli
npm pack --pack-destination ../public/downloads
```

The generated name is `traqiva-cli-local-0.2.1.tgz`; the web distribution renames it to `traqiva-cli-0.2.1.tgz` and supplies the short `/cli.tgz` URL. The tarball includes only `bin/`, `lib/`, README and license/notice files, not local settings, test fixtures or credentials. Test fixtures use temporary `TRAQIVA_HOME` directories, fake assistant subprocesses and a loopback mock service; they make no model-provider calls and do not change host agent configuration. Automatic MCP registration was exercised with isolated fake assistant CLIs; real Codex/Claude registration was not executed for this release. The native installation and compression tests are recorded separately. Browse tests additionally exercise the real Windows engine against an isolated HTTP fixture, exact source/byte recovery, public-address/redirect checks, size/content-type/time limits and tamper rejection. A separate public HTTPS extraction probe succeeded against `example.com`; it is not evidence of model billing savings.

The CLI source is independent implementation under Apache-2.0. The accompanying platform research distinguishes the reusable Apache-licensed Caveman local core from its separate proprietary Cloud service. No Caveman brand assets or binary runtime are bundled in this npm tarball; the optional native downloads carry their source provenance and all required license texts.
