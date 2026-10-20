# Traqiva native compression runtime

This is a source-built native integration of the Apache-2.0 Caveman **v4.0.1** local compression engine and proxy, not its commercial Cloud service. Upstream tag revision: `d0be14f2dc92a99d12e717465d6908723ab9bfdb`.

`upstream/engine/`, `proxy/`, `mem/` and `shared/` are selected upstream subtrees, including recovery, tokenizer, adapters, tests and embedded assets. `upstream/go.mod` and `go.sum` pin dependencies. They do not include the commercial server or complete upstream client ecosystem. Original `LICENSE`, `LICENSE-MIT`, `NOTICE`, licensing and trademark notices travel with the source. All required module and Go runtime license texts are also included in generated download notices. Modified source files carry a prominent notice; `MODIFICATIONS.md` and `patch-proxy.mjs` record the changes.

`upstream/cmd/traqiva-engine/` is an independently written Traqiva entry point. It uses the unmodified engine algorithms but:

- chooses `TRAQIVA_HOME`, default `~/.traqiva`, and `recovery.db` explicitly;
- sets a 1 MiB input limit and a default 512 MiB retained-original budget;
- verifies exact recovery before publishing a changed result;
- prefixes local handles with `local:` to distinguish them from cloud artifacts;
- presents Traqiva-branded elision markers and re-counts changed output with the same offline tokenizer;
- labels all token figures as local `inferred` estimates and never verified savings;
- emits JSON suitable for the Traqiva Node client, not an agent-traffic proxy.

The source uses Go 1.26.9 or newer. The release was built using Go **1.27.3**, downloaded from https://go.dev/dl/ and checked against official https://go.dev/dl/?mode=json metadata. Windows amd64 SDK zip SHA-256: `f26081f438319757f8a1b46d7d0b2c5ec7583d4038e485e0aa725cfde7885fff`. No global Go install is required; set `TRAQIVA_GO` to your reviewed Go executable.

```sh
node platform/runtime/build.mjs
node platform/runtime/build-proxy.mjs
```

The build uses `CGO_ENABLED=0`, `-trimpath`, `-buildvcs=false` and `-ldflags "-s -w"`. It cross-compiles Windows amd64, Linux amd64 and macOS arm64, creates separately downloadable gzip artifacts and a SHA-256 manifest under `platform/public/downloads/`, and generates license notices from the actual dependency closure. Local uncompressed build outputs are ignored by Git.

```sh
cd platform/runtime/upstream
CGO_ENABLED=0 go test ./cmd/traqiva-engine ./engine/ccr ./engine/compressors ./engine/tokens
CGO_ENABLED=0 go test ./proxy/internal/cloudlink -run Traqiva -count=1
```

Windows tests actually execute compression, persistent recovery, local proxy traffic and failure behavior. Cross-compilation does not constitute running the Linux/macOS binaries. The no-cgo code compressor parses Go; it does not include the full tree-sitter language set. Do not report the whole upstream suite as passing: `go test ./engine` fails `TestReleaseShapeReadListingsCompress` for TypeScript, JavaScript and Python in this no-cgo build; the complete CloudLink package fails its upstream online-only `TestCacheTTLIsReadFromTheBody` because Traqiva forces CloudLink offline; Windows Application Control blocked the Gemini provider test binary. Selected engine/CCR/compressor/tokenizer, OpenAI/Anthropic provider and Traqiva-specific offline policy tests passed. Availability and effectiveness depend on input, build and proven recovery. Never promise a fixed compression ratio.

Install only with an explicit client command:

```sh
traqiva engine install --url https://YOUR_TRAQIVA_ORIGIN
traqiva engine status
traqiva compress ./build.log
traqiva recover local:ccr_HANDLE
```

No text is sent to the cloud for native compression. If a project is connected, only the separate compression event's counts, sizes, algorithm and local handle are uploaded; these are not LLM requests or provider token usage. Native originals remain in the local recovery database. Preserve that database while handles are in use. Without a native install, the client explicitly reports `runtime: "cloud"` and uses the independently implemented lossless JSON service.

The experimental `traqiva proxy install` / `traqiva agent codex` path is documented with actual verification and important limits in [VERIFICATION.md](./VERIFICATION.md). A real ChatGPT task was routed successfully, but recovery was unproven and **zero requests were compressed**. This is not a claim of automatic subscription token savings.
