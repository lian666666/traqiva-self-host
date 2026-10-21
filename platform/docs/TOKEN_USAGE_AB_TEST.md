# Real Codex token A/B test — 2026-10-21

Traqiva reduced Codex-reported input usage by **29.27%** in this deliberately small synthetic log-extraction experiment. This tested **explicitly compressing an artifact before putting it into the model's input**. It did not demonstrate automatic compression of an existing desktop chat, a subscription-quota increase, invoice savings, or general coding-quality equivalence.

## Measured result

| Run order | Input | Cached input | Output | Input + output | Five required facts correct |
| --- | ---: | ---: | ---: | ---: | --- |
| A: original 1 | 20,756 | 0 | 88 | 20,844 | Yes |
| B: Traqiva-compressed 1 | 14,681 | 0 | 96 | 14,777 | Yes |
| B: Traqiva-compressed 2 | 14,681 | 0 | 91 | 14,772 | Yes |
| A: original 2 | 20,756 | 0 | 95 | 20,851 | Yes |

- Mean input: 20,756 → 14,681 tokens, a reduction of 6,075 tokens (**29.27%**).
- Mean output: 91.5 → 93.5 tokens.
- Mean input plus output: 20,847.5 → 14,774.5 tokens (**29.13%** lower).
- All four responses returned the exact required `code`, `service`, `retry`, `release_id` and `incident_id`. No tools, file commands, web calls or retrieval were used in these four runs.
- Cached input was zero in every included run. This particular difference was not a prompt-cache hit-rate difference.

Counts come from each completed real Codex task's `turn.completed.usage`, not Traqiva's byte/4 or offline tokenizer estimates. Input includes cached input, and output already includes reasoning; neither is added twice. The CLI-reported counters were not independently reconciled with an invoice or raw upstream response. See the [official JSONL usage format](https://learn.chatgpt.com/docs/non-interactive-mode).

## Controlled setup

- Windows x64, official desktop-matching Codex CLI `0.163.0-alpha.10.2`.
- Same model and reasoning effort in every run: `gpt-6.1-sol`, `ultra`.
- Four fresh, ephemeral sessions in A → B → B → A order. The task, answer schema, working directory and child configuration were the same; the supplied log representation was the variable.
- Existing normal ChatGPT sign-in. Authentication files were not copied or printed. Global Codex configuration hashes stayed unchanged.
- Child-only `--ignore-user-config`, `--no-daemon`, disabled plugins/hooks, and a read-only sandbox. This deliberately excludes unrelated desktop MCP/configuration differences from the input experiment.
- Synthetic log with a repeated successful-event block and distinct release/error identifiers. These five requested facts were fixed before compression. This is one content shape and one extraction task, not a broad benchmark.
- The actual Traqiva native engine was installed from the Traqiva HTTPS release origin into isolated temporary state. The original was **22,688 bytes** and the compressed representation **354 bytes**; exact original recovery passed before model calls. Those byte counts are a separate measurement from model usage.

Original synthetic artifact SHA-256: `2dc00b05f14bcceff6ccce80b2ed5d951c63cf7f7e8411b9d68c5432d0852796`.

## Automatic routing and this desktop chat

The automatic file-reading control could not complete in this environment: the child execution policy rejected its `Get-Content` call. One read-only attempt and one isolated workspace-write attempt both returned unknown answers without a completed command. Their usage is excluded from the successful four-run comparison. The benchmark stopped before starting the corresponding Traqiva proxy branch; this is **an unavailable automatic-path result**, not a measured zero-percent improvement.

A separate read-only audit found no Traqiva MCP entry, exposed Traqiva tools, or identified Traqiva proxy connection in the existing desktop chat. These A/B results therefore must not be attributed to that ongoing conversation. Earlier native proxy routing tests and their `recovery_unproven` limitation remain documented in [runtime verification](../runtime/VERIFICATION.md).

## Reproduce explicitly

This optional script makes real model calls and consumes the signed-in account's quota. It is not included in `npm test`, and is not bundled inside the downloadable npm CLI package. Use the repository checkout and an official Codex executable with matching supported flags.

```powershell
cd platform
$env:TRAQIVA_BENCHMARK_CODEX_BIN = 'PATH_TO_OFFICIAL_CODEX.exe'
$env:TRAQIVA_BENCHMARK_MODEL = 'gpt-6.1-sol'
$env:TRAQIVA_BENCHMARK_EFFORT = 'ultra'
$env:TRAQIVA_BENCHMARK_ORIGIN = 'https://YOUR-TRAQIVA.workers.dev'
$env:TRAQIVA_BENCHMARK_MODE = 'input'
node cli/tests/token-usage-ab.mjs
```

The script prints the temporary evidence directory, saves raw JSONL privately outside the repository, checks exact recovery and configuration integrity, and reports missing usage/quality failures explicitly. `automatic` and `all` modes separately exercise the file-reading launcher comparison; they require command execution to be permitted in the chosen child sandbox. It never changes global policy to make a failed test pass.

No private transcript, auth file, project key or personal desktop token history is included in this report. No production traces or public dashboard savings were seeded by this experiment.
