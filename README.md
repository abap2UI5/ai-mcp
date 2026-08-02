# ai-mcp

**The MCP server for abap2UI5** — gives any AI coding agent (Claude Code,
Cursor, VS Code Copilot, or any MCP client) the full abap2UI5 development
loop, without an SAP system:

```
capabilities -> validate_view -> deploy_app -> build_backend -> run_app
 (what can        (static gates:     (write ABAP,    (transpile       (boot headless,
  I express?)      props + render)    lint)           to Node)         errors + SCREENSHOT)
```

The agent writes an ABAP class, validates the view in seconds, deploys it,
boots it in a real browser and **looks at the screenshot** — then iterates.
Everything runs locally on infrastructure that already guards the abap2UI5
ecosystem in CI: the abaplint transpiler + open-abap runtime, the framework's
express shim, the [ai-demokit](https://github.com/abap2UI5/ai-demokit) build
and boot gates, and the [abap2UI5-linter](https://github.com/abap2UI5/abap2UI5-linter)
validation core.

## Setup

The server orchestrates sibling checkouts (override locations with env vars):

```sh
git clone https://github.com/abap2UI5/abap2UI5        # A2UI5_HOME
git clone https://github.com/abap2UI5/ai-demokit      # AI_DEMOKIT_HOME
git clone https://github.com/abap2UI5/abap2UI5-linter # AI_VIEW_CHECK_HOME (required for validate_view)
git clone https://github.com/abap2UI5/ai-mcp
cd abap2UI5 && npm ci && cd ../ai-demokit && npm ci && cd ../abap2UI5-linter && npm ci && cd ../ai-mcp && npm ci
npx playwright install chromium
```

Register in your MCP client, e.g. Claude Code:

```sh
claude mcp add abap2ui5 -- node /path/to/ai-mcp/server.mjs
```

## Tools

| Tool | What it does |
|---|---|
| `capabilities` | Query the verified capability map (ai-demokit CAPABILITIES.md, parsed live — no drift). Ask before assuming a UI5 feature is impossible: `{ query: "tree binding" }`, `{ status: "not-expressible" }` |
| `generation_rules` | The rulebook for writing an app with the generic view builder |
| `scope_of` | In/out-of-scope verdict for UI5 controls (since <= 1.71, not deprecated) |
| `validate_view` | **Seconds, not minutes**: static property gate + headless render via abap2UI5-linter, from ABAP source or raw XML — run this after writing, before deploying. Findings come with a severity, a message and the line/column in the source you passed in |
| `deploy_app` | Write `<class>.clas.abap` + abapGit sidecar into the gitignored sandbox `src/zz_dev/` (in the ai-demokit checkout), then abaplint it |
| `build_backend` | Rebuild the transpiled Node backend. `mode: auto` is **incremental** after the first full build (~1-2 min per iteration); `mode: full` runs the complete e2e-build |
| `run_app` | Boot any app class headless (`?app_start=<class>`), return boot status, real page errors (benign UI5 noise filtered) and a full-page **screenshot as an image** |
| `backend` | `status` / `start` / `stop` / `restart` of the local express backend |
| `remove_app` | Delete a dev app from the sandbox (or list the deployed ones) |

`run_app` works for new dev apps and equally for the existing ai-demokit
ports and `z2ui5_cl_ai_app_overview` — useful as a reference: "run the closest
existing port, look at it, then build mine".

## The intended agent loop

1. `capabilities { query: ... }` — check the feature is expressible (and how)
   before writing a line of ABAP.
2. `generation_rules` — once per session.
3. Write the class, `validate_view` — fix findings in seconds.
4. `deploy_app` — abaplint against the full framework context.
5. `build_backend` — incremental after the first full build.
6. `run_app` — read the errors, **look at the screenshot**. Edit, validate,
   deploy, build, run again.

## Notes

- **Dev sandbox:** deployed apps land in the ai-demokit checkout's gitignored
  `src/zz_dev/` — nothing an agent deploys can leak into a commit. Promote a
  finished app by moving it into a real package deliberately.
- **Port:** the backend listens on 3000 (`A2UI5_MCP_PORT` overrides).
- **UI5 sources:** modules are served from the ai-demokit checkout's
  `@openui5` packages, so booting needs no network. The built theme CSS is
  not in those packages — with network access it loads from the CDN (styled
  screenshots); without, apps render unstyled but structurally complete.
  `A2UI5_MCP_OFFLINE=1` forces the hermetic behaviour.
- **Chromium:** uses the Playwright-managed browser; if absent, falls back to
  a system chromium (`A2UI5_MCP_CHROMIUM` overrides the executable path).
- **Real system deployment** stays what it is today: abapGit. This server is
  the inner dev loop; a `run_app_system` backend (launch URL + auth proxy, as
  solved in the [VS Code extension](https://github.com/abap2UI5-addons/vscode-extension))
  is the planned second stage.
