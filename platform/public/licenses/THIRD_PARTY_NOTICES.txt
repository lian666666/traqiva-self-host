# Third-party source and research notices

The independent Traqiva Node CLI uses Node.js built-in modules and has no npm runtime dependencies. Its npm tarball does not bundle native binaries. Separately downloadable native engine and proxy integrate the Apache-2.0 Caveman v4.0.1 local runtime as described below. Full notices for the front end/server's actual bundled dependencies, including Geist Sans, Geist Mono (SIL Open Font License 1.1) and Lucide, are generated at [/licenses/BUNDLED_DEPENDENCIES.txt](/licenses/BUNDLED_DEPENDENCIES.txt).

The `caveman/` directory preserves the public upstream LICENSE, LICENSE-MIT, NOTICE, LICENSING and TRADEMARKS files consulted during source research. The native runtime subtree preserves an additional copy alongside the source.

## Native core actually incorporated

`platform/runtime/upstream/engine/`, `proxy/`, `mem/`, `shared/`, `go.mod` and `go.sum` were exported from the Apache-2.0 `v4.0.1` tag, revision `d0be14f2dc92a99d12e717465d6908723ab9bfdb`. Engine algorithms are retained; the recovery instruction is renamed to Traqiva. `cmd/traqiva-engine/` is an independent entry point choosing Traqiva-only state paths, verifying exact recovery, rebranding markers and re-counting them. Proxy changes rename recovery tools/state paths and force Caveman Cloud offline before settings/credential access. Modified Go files carry a prominent notice; `runtime/MODIFICATIONS.md` and `patch-proxy.mjs` describe reproducible edits. This does not incorporate the complete upstream client ecosystem or commercial Cloud server.

Native releases' `engine-notices.json` and `proxy-notices.json` contain full upstream license/notice texts, the Go runtime license and the license texts found in each actual dependency module closure (26 engine texts; 34 proxy texts). The respective manifest records SHA-256; the CLI installs notices alongside the binaries under `~/.traqiva`. Source records retain notices for any included pixel/font assets, even when not linked into a particular entry point. CGO is disabled, so releases do not link Zig/musl/mingw-w64 compiler runtimes or tree-sitter C grammars.

Research source: https://github.com/JuliusBrussee/caveman

Snapshot inspected: `bad48a0e1df55e05e3f52249afa35ecc1909ee76` (main, root/CLI version 4.0.1). The independently checked `v4.0.1` tag points to `d0be14f2dc92a99d12e717465d6908723ab9bfdb`.

Apache-2.0 applies to that repository from 3.0.0 onward. Earlier MIT/BSL releases keep their original terms. If additional code is adopted later, pin its actual source revision, preserve all relevant copyright and third-party notices, mark modifications prominently in modified files and extend this manifest to identify the files actually incorporated.

Caveman Cloud is separate commercial software, and the public local-runtime license does not cover its server or authenticated dashboard. Caveman's name and logos remain its owner's marks. Traqiva uses an independent brand and does not imply sponsorship or affiliation.

See the source-backed technical research in `../docs/CAPABILITIES.md`. Provider-counted traffic, local heuristic token estimates, quality evaluations and verified savings are different evidence categories; no upstream benchmark is a Traqiva product result.
