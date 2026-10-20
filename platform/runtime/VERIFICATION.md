# Native proxy verification — 2026-10-20

## Explicit setup

```sh
traqiva engine install --url https://YOUR-TRAQIVA.workers.dev
traqiva proxy install --url https://YOUR-TRAQIVA.workers.dev
traqiva proxy status
traqiva agent codex --auth chatgpt --
traqiva agent codex --auth api -- exec "YOUR TASK"
```

The launcher is experimental. It starts and authenticates its own loopback process, supplies temporary provider/MCP settings and `--no-daemon`, and shuts down only that owned process. It does not modify global config, copy auth files or take over an existing desktop chat. Its native proxy and MCP share `~/.traqiva/recovery.db`; missing recovery proof leaves requests untouched. No environment shortcut asserts recovery. The user's model and effort remain unchanged.

An official native Codex executable supporting `--no-daemon` is required. Set `TRAQIVA_CODEX_BIN` or `CODEX_CLI_PATH` to it when necessary. On Windows a `codex.cmd` npm shim is not an `.exe`; prompts are never interpolated into a shell string to work around that. Preflight checks the selected config and `login status`, refusing custom providers/active tables, non-official endpoints, profiles, conflicting routing flags and legacy Caveman integration. Default auth follows actual login status; explicit API mode supports a process environment key. Claude launch configuration exists but has not passed an end-to-end Claude test.

## What actually passed

- Source-built Windows engine: native log compression, persistent exact recovery and fail-open behavior. From the live website, an isolated explicit engine install verified SHA-256 and compressed one repetitive synthetic artifact from 2,212 to 79 offline BPE tokens with exact recovery. These are local estimates, not provider usage.
- Source-built Windows proxy: actual HTTP Responses traffic to a loopback mock shrank a repetitive tool-result request body to under half its original size, preserved user instructions and the error line, forwarded response SSE bytes exactly, and recovered the complete original through the matching Traqiva CCR store. This demonstrates that synthetic payload, not whole-session or billing savings.
- Actual bundled Codex CLI against a fake-key loopback provider: one `/v1/responses` request and local trace, with expected `MOCK_OK` output. No real provider key or real model completion was used for this check.
- Final real Codex ChatGPT synthetic task: correct JSON answer, exactly one shell command, two `/models` and two `/responses` requests reaching the native proxy with status 200. Global config SHA-256 was unchanged; no auth was copied. **Both Responses requests reported `recovery_unproven`, and zero requests were transformed.** Proxy provider usage was unavailable. This verifies subscription routing, **not automatic subscription compression, causal token savings or billing reduction**. No additional real model task was run after that result.
- CLI automated checks: 20 tests passed with no skips when source-built Windows artifacts were available, including protocol negotiation, authentication boundaries, explicit native download verification, actual compression, exact recovery and streaming errors. See runtime README for the separate upstream Go suite failures and unexecuted cross-platform targets.

`exec` has its own config vector in the tested Codex CLI. Routing overrides must be placed after that subcommand; a later child `-c` otherwise shadows root overrides. Tests cover this. The actual task above used the corrected form.

## Data and security boundaries

CloudLink settings return `offline` and `noTelemetry` **before any Caveman Cloud settings or credentials are read**. Automatic commercial Cloud routing cannot run; the policy has a dedicated test. Traqiva state paths and recovery tool names are distinct. Original provider/auth headers pass only to the selected official provider; Traqiva never stores provider credentials in its cloud telemetry.

The owned local run directory holds private logs, metadata SQLite and a receipt. Connected-project ingestion reads an explicit metadata allowlist, never prompt/tool/response bodies. Catalog `/models` calls do not count as LLM traces. Native compression events and local artifact/request estimates remain separate from provider-reported usage. Missing measurements are unavailable. A session with no observed routed inference request returns an explicit error and nonzero status.

Windows x64 binaries were executed. Linux x64 and macOS arm64 are cross-compiled only. Each release archive is below 25 MiB. Installation checks manifest/archive/binary/notices SHA-256 over the configured HTTPS origin; this is same-origin integrity, not an independently signed release. License texts accompany the engine and proxy separately. The browser sign-in, API-key cloud bridge (`traqiva serve`), manually configured MCP and experimental native launcher are different integration paths.
