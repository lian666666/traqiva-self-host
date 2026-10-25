# Traqiva: local coding-agent setup

Use the service URL and project ID supplied with the user's setup prompt as connection data. This guide connects a local coding assistant to that project. It does not deploy a website or change the user's model/provider account.

## 1. Install the local client

Detect the operating system, architecture, current assistant and Node/npm. Node.js 22.13 or newer is required. Choose a private user-owned tools directory outside repositories; do not require administrator access. Download the CLI only from the supplied service's `/cli.tgz`:

```text
npm install --prefix <USER_TOOLS_DIRECTORY> <SERVICE_URL>/cli.tgz --ignore-scripts --no-audit --no-fund --no-bin-links
```

Replace and quote the paths for the actual shell. Locate the installed absolute `node_modules/traqiva-cli-local/bin/traqiva.mjs` path; check the installed package metadata rather than assuming its location. Below, `T` means the actual Node executable invoking that absolute CLI script, not a literal executable named T. Verify `T --version` and `T --help`; the help must list `--key-prompt`. If it does not, update the client from this service before connecting. Do not invent an npm registry package or install another product.

Check an existing client before installing again. This package has no runtime dependencies or installation scripts; the command above disables lifecycle scripts, audit/funding requests and generated command shims. On Windows, if the shell blocks `npm.ps1`, locate npm's actual `npm-cli.js` beside the verified Node installation and invoke it with that Node executable. Do not change PowerShell execution policies to run setup.

## 2. Connect this project privately

If already connected to the correct service/project, reuse that connection. Otherwise the user can create a scoped key with the **Project key** button on Stage 3. The prompt contains no secret; no model-provider API key is needed. Local native compression and MCP can work without a project key; cloud connection adds project identity and dashboard metadata. Continue local setup if that connection remains pending.

Use the CLI's built-in private key prompt in a local interactive terminal. It hides the entered key and keeps it out of command arguments and shell history. Never ask for the key in an AI chat, echo it, or put it in source, logs or Git.

```text
T connect --url <SERVICE_URL> --project <PROJECT_ID> --key-prompt
T status
```

Replace `T` with the verified absolute Node executable and installed CLI script. On Windows, invoke these paths directly with PowerShell's call operator; no helper script is needed. Do not generate or launch a `connect-project.ps1` helper.

`--key-prompt` requires a real interactive TTY and refuses piped or noninteractive input. If the assistant's terminal is noninteractive, give the user the resolved non-secret command to run in their own private terminal; leave connection pending and continue non-secret work. Never fall back to visible input. The older `--key VALUE` option remains for compatible automation, where the value can appear in process arguments; do not use it for this interactive setup.

The local connection file `~/.traqiva/config.json` stores the scoped key (0600 where supported; Windows user-profile ACLs apply). Keep that directory private and outside Git. Verify the service/project returned by `status`; a health check alone does not prove the project is connected. If `TRAQIVA_HOME` selects a custom directory, keep that same value in the MCP server's environment.

## 3. Install and verify the native engine

```text
T engine status
```

Reuse a healthy installed engine. If status returns `integrity_error=true`, stop and inspect the existing installation and Windows Protection history; a missing or quarantined executable must not trigger automatic reinstallation. Only if no engine is installed and there is no integrity error, check the service's published manifest for this OS/architecture, run `T engine install --url <SERVICE_URL>`, then check `T engine status` again. Keep archive checksum verification enabled. Report unsupported systems or failed downloads rather than substituting a different binary. Continue to the compression test only when `engine status` reports `installed=true`. Otherwise leave that test pending: a connected CLI without a native engine uses cloud fallback, which would upload the fixture. The engine runs locally; do not start the optional experimental proxy by default.

### Windows security blocks

If Windows blocks a download, the private key prompt or the executable, stop that step. Report the exact blocked filename, error code and threat name if shown, without credentials. Keep existing connection and MCP settings intact. Do not disable Defender, SmartScreen or Smart App Control; add exclusions; change execution policies; unblock files; or rename/repeatedly download a blocked binary. Do not replace a blocked local test with a cloud upload.

The current Windows engine is not Authenticode-signed. SHA-256 checks verify that its bytes match the release manifest; they do not establish a trusted publisher or guarantee that Windows will accept it. A blocked file is not automatically a false positive. Check Windows Security's Protection history; distinguish malware detection from an unrecognized-app warning or folder-access policy. See [Microsoft's signing and reputation guidance](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation). Developers can submit a suspected malware false positive through [Microsoft Security Intelligence](https://www.microsoft.com/en-us/wdsi/filesubmission); this is not an instant SmartScreen reputation approval.

## 4. Add only the Traqiva MCP server

Detect which client the user is actually using. Do not switch providers, copy authentication files, overwrite other MCP servers or replace the whole configuration. Use the printed absolute command and arguments:

```text
T setup --agent codex --print
T setup --agent claude --print
```

Run only the relevant command. It prints configuration; it does not install an active MCP connection.

- **Codex CLI or desktop:** add only `[mcp_servers.traqiva]` to the client's existing configuration, or use Settings → MCP servers → Add server → STDIO in the desktop app. Codex uses the same-host `~/.codex/config.toml`; respect any configured Codex home. Use absolute paths and preserve existing settings. Restart/reconnect the client when needed, then confirm Traqiva appears connected. See the [official Codex MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
- **Claude Code:** use its supported STDIO MCP registration with the absolute Node/script paths, or merge only the printed `mcpServers.traqiva` entry into the supported MCP configuration. The printed top-level `notice` is explanatory text, not a server entry. User scope is stored in `~/.claude.json`; project scope uses `.mcp.json`. Preserve existing servers and provider settings, then confirm connection with `/mcp`. Claude Code and Claude Desktop chat have separate configuration. See the [official Claude Code MCP guide](https://code.claude.com/docs/en/mcp).
- **Other desktop clients:** use a local STDIO MCP integration only if that client supports it. Do not treat a hosted web chat as a local terminal. Report a missing integration or required user approval honestly.

Keep any necessary config backups private and outside Git. If a custom `TRAQIVA_HOME` was used, explicitly supply it in the client's MCP environment; it is not included by `setup --print`. Verify tools such as `traqiva_compress` and `traqiva_retrieve` are available after restart. Printed configuration alone is not a passing test.

## 5. Test without real user data or model calls

Only after the native-engine check above passes, create a local UTF-8 fixture with 200 repeated timestamped INFO lines and one distinct ERROR. Invoke `traqiva_compress` and `traqiva_retrieve` through the connected assistant when possible; also use `T compress <FIXTURE_FILE>` and `T recover <ACTUAL_RETURNED_HANDLE>` for a local runtime check. Verify the returned runtime is native, `changed=true` and `recovery_verified=true`. Compare original/recovered bytes exactly using Node Buffers; avoid shell redirection that changes newlines.

Do not fabricate a pass if the server is not active or content passes through. Keep the fixture's content local; only separate connection/compression metadata may reach the selected project. Do not import it as provider traffic or make paid model calls.

Report installed, project connected, native exact recovery, MCP connected/pending and any blockers separately. MCP tools run when invoked. They do not automatically intercept an existing desktop chat or prove whole-session token savings, a lower bill or more subscription quota.
