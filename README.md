# mcp-server

**The MCP server for abap2UI5** — gives any AI coding agent (Claude Code,
Cursor, VS Code Copilot, or any MCP client) the full abap2UI5 development
loop, without an SAP system:

```
examples -> app_guide -> validate_view + screenshot_view -> deploy_app -> build_backend -> run_app -> pitfalls
(has somebody  (how an app  (SECONDS, no system:        (write ABAP,  (transpile      (boot headless,  (what a green
 built it       is built)    is the view legal,          lint)         to Node)        errors +         run still
 already?)                   and what does it LOOK like)                               SCREENSHOT)      does not prove)
```

The agent writes an ABAP class, validates the view **and looks at a picture of
it** in seconds, deploys it, boots it in a real browser and looks at the
running app — then iterates. Everything runs locally on infrastructure that
already guards the abap2UI5 ecosystem in CI: the abaplint transpiler +
open-abap runtime, the framework's express shim, the
[samples-controls](https://github.com/abap2UI5/samples-controls) build and boot
gates, and the [linter](https://github.com/abap2UI5/linter) validation core.

## Documentation

**→ [The MCP server, in full](https://abap2ui5.github.io/docs/advanced/mcp_server.html)**
— what MCP means here, the three setup levels and what each one buys, how to
register the server with your client, every tool with what the agent gets from
it, and the loop they are meant to be used in.

**→ [Building with AI](https://abap2ui5.github.io/docs/get_started/ai.html)** —
the whole AI setup in rising order of effort. This server is the top rung; the
cheaper ones matter first.

## Quick start

Level 1 — `validate_view` and `screenshot_view`, the two tools most work
happens at (~3 MB, a minute):

```sh
git clone https://github.com/abap2UI5/linter        # AI_VIEW_CHECK_HOME
git clone https://github.com/abap2UI5/mcp-server
cd linter && npm ci && cd ../mcp-server && npm ci
```

Register it with Claude Code:

```sh
claude mcp add abap2ui5 -- node /path/to/mcp-server/server.mjs
```

Cursor, VS Code and Claude Desktop take the standard stdio shape — the
[documentation](https://abap2ui5.github.io/docs/advanced/mcp_server.html#registering-it-with-your-client)
has the JSON, and the two further levels (the sample catalogues and deploying,
then the headless build-and-boot loop). A tool whose prerequisites are missing
answers with a message naming what it needs; the server starts either way.

The [abap2UI5 VS Code extension](https://github.com/abap2UI5/vscode-extension)
registers this server for you, and adds a second one of its own for the tools
that need a real SAP system.

## Tools

| Tool | What it does |
|---|---|
| `capabilities` | Whether abap2UI5 can express a UI5 feature at all, from the verified capability map |
| `app_guide` | How to build an app, live from the framework checkout |
| `scaffold_app` | The files a new project starts from, live from app-template; `{ class: … }` renames throughout, sidecar `CLSNAME` included |
| `examples` | Search the three sample catalogues — answers with a class to read, never a snippet to trust |
| `generation_rules` | The rulebook for porting a UI5 demo-kit sample into samples-controls |
| `pitfalls` | The defects a green run does not catch: `{ area: "abap" }` and `{ area: "view" }` |
| `scope_of` | In/out-of-scope verdict for a UI5 control |
| `validate_view` | The linter's gates in seconds, judged by your project's own `abap2ui5lint.jsonc` |
| `screenshot_view` | See the view in seconds — no build, no backend |
| `deploy_app` | Write the class + abapGit sidecar into the gitignored sandbox, then abaplint it |
| `build_backend` | Rebuild the transpiled Node backend; incremental after the first full build |
| `run_app` | Boot an app headless: status, real page errors, and a **screenshot** |
| `backend` | `status` / `start` / `stop` / `restart` of the local express backend |
| `remove_app` | Delete a dev app from the sandbox, or list the deployed ones |

`screenshot_view` and `run_app` answer the same question at three orders of
magnitude apart: the first photographs the reconstructed **view** with no
backend, the second the **running app** after a build. Most iterations should
end at the first.

## Notes

- **Dev sandbox:** deployed apps land in the samples-controls checkout's
  gitignored `src/zz_dev/` — nothing an agent deploys can leak into a commit.
- **Port:** the backend listens on 3000 (`A2UI5_MCP_PORT` overrides).
- **Timeouts:** every spawned child is killed (whole process tree) when it
  exceeds its limit — lint/scope 5 min, build 30 min by default;
  `A2UI5_MCP_LINT_TIMEOUT_MS`, `A2UI5_MCP_SCOPE_TIMEOUT_MS` and
  `A2UI5_MCP_BUILD_TIMEOUT_MS` override (values in ms).
- **UI5 sources** are served from the samples-controls checkout's `@openui5`
  packages, so booting needs no network. The built theme CSS is not in those
  packages — with network access it loads from the CDN (styled screenshots);
  without, apps render unstyled but structurally complete. `A2UI5_MCP_OFFLINE=1`
  forces the hermetic behaviour.
- **Chromium:** uses the Playwright-managed browser; if absent, falls back to a
  system chromium (`A2UI5_MCP_CHROMIUM` overrides the executable path).
- **If you set this up earlier:** the corpus repository was `ai-demokit`, then
  `abap2UI5-api`, and is `samples-controls` today. Nothing needs changing — an
  existing checkout is still found under any of the three directory names, and
  `AI_DEMOKIT_HOME` is still read alongside `SAMPLES_CONTROLS_HOME`.
- **Real-system deployment** stays what it is today: abapGit. This server is
  the inner dev loop; the real-system half lives in the
  [VS Code extension](https://github.com/abap2UI5/vscode-extension), whose own
  MCP server exposes it as `run_app_on_system`. Both servers are registered in
  the same editor window, which is why that tool is not called `run_app`.

## Working on this repository

```sh
npm ci
npm test
```

`AGENTS.md` carries the conventions, `CONTRIBUTING.md` and `RELEASING.md` the
rest of the workflow.
