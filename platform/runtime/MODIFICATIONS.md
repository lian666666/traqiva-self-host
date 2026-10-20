# Native upstream modifications

Source revision: Caveman v4.0.1, `d0be14f2dc92a99d12e717465d6908723ab9bfdb`, Apache-2.0.

The engine algorithms and SQLite recovery implementation retain their upstream behavior. `engine/compressors/invariants.go` renames the user-visible recovery instruction to `traqiva_retrieve`. The independent Traqiva entry point also rebrands elision markers and re-counts them.

The proxy source and corresponding tests rename closed recovery tool spellings from Caveman to Traqiva (bare, MCP namespace and Kilo-style variants). Each modified Go source carries a prominent modification notice. `proxy/internal/cloudlink/link.go` forces local-only, no-telemetry settings before any legacy cloud settings/credentials are inspected; no Caveman Cloud request or Auto routing may run. `proxy/cmd/caveman-proxy/main.go` defaults to `.traqiva` rather than `.caveman` when used directly. The launcher further supplies explicit Traqiva state paths, disables cache warm-ups and legacy telemetry, and keeps model selection unchanged.

`patch-proxy.mjs` records the reproducible transformations. The release build and tests document which behavior has actually been exercised; these modifications do not imply commercial Cloud parity.
