# Traqiva CLI 0.1.0

A small, independently implemented Node.js client for your Traqiva deployment and optional native compression runtime. Node.js 22.13 or newer; no package dependencies. The package name is `traqiva-cli-local`, and the installed command is `traqiva`.

This version supplies a real API-key gateway bridge, trace ingestion, optional local native compression with exact recovery, a cloud lossless JSON fallback, an MCP interface and an experimental native coding-agent launcher. Native binaries are separately source-built from the Apache-2.0 Caveman local runtime and downloaded only by explicit install commands. It does not alter global agent settings or claim verified token/billing savings.

## Install the deployment's package

Download `traqiva-cli-0.1.0.tgz` from your deployment's `/downloads/` page, then:

```sh
npm install --global ./traqiva-cli-0.1.0.tgz
traqiva --help
```

Or run the source without a global install:

```sh
node platform/cli/bin/traqiva.mjs --help
```

This package has not been published to the public npm registry. Do not assume `npx traqiva` or another similarly named package is this code.

## Connect

Create a project and project ingest key in the Traqiva web app. Replace the placeholders:

```sh
traqiva connect --url https://YOUR-TRAQIVA.workers.dev --project PROJECT_ID --key PROJECT_INGEST_KEY
traqiva status
```

`connect` checks `/api/connection` and the returned project ID before saving anything. It prints project/workspace identity, never the key. The saved file is `~/.traqiva/config.json`; `TRAQIVA_HOME` selects an isolated directory. The key is stored in this file, not in source code. File mode is set to `0600` on systems that enforce Unix permissions; Windows uses the enclosing user profile's ACLs. Keep this private directory out of Git. Arguments typed directly into a shell can enter that shell's history; for a private shell session, read the key into a temporary shell variable before invoking the command.

Only HTTPS origins are accepted, except loopback HTTP for local development. Paths, embedded credentials, query strings and fragments are refused. Redirects are not followed with the project credential.

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

The process binds only to loopback, rejects browser-origin requests and does not accept arbitrary destination URLs. Its `/health` endpoint reports local process health, not proof that a provider request worked. Traffic passes through your configured Traqiva service to the provider. This is API-key routing; ChatGPT/Claude subscription routing and automatic model selection are outside this release.

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

Adding MCP tools does not intercept all model requests. The host agent decides when to call them. Never advertise the agent as connected to the provider bridge until an actual routed request appears in Traces.

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

The generated name is `traqiva-cli-local-0.1.0.tgz`; the web distribution renames it to `traqiva-cli-0.1.0.tgz`. The tarball includes only `bin/`, `lib/`, README and license/notice files, not local settings, test fixtures or credentials. Test fixtures use temporary `TRAQIVA_HOME` directories and a loopback mock service; they make no model-provider calls and do not change host agent configuration.

The CLI source is independent implementation under Apache-2.0. The accompanying platform research distinguishes the reusable Apache-licensed Caveman local core from its separate proprietary Cloud service. No Caveman brand assets or binary runtime are bundled in this npm tarball; the optional native downloads carry their source provenance and all required license texts.
