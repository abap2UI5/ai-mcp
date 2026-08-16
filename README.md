# ai-mcp

**The MCP server for abap2UI5** — gives any AI coding agent (Claude Code,
Cursor, VS Code Copilot, or any MCP client) the full abap2UI5 development
loop, without an SAP system:

```
capabilities -> validate_view -> deploy_app -> build_backend -> run_app -> pitfalls
 (what can        (static gates:     (write ABAP,    (transpile       (boot headless,    (what a green
  I express?)      props + render)    lint)           to Node)         errors +           run still
                                                                       SCREENSHOT)        does not prove)
```

The agent writes an ABAP class, validates the view in seconds, deploys it,
boots it in a real browser and **looks at the screenshot** — then iterates.
Everything runs locally on infrastructure that already guards the abap2UI5
ecosystem in CI: the abaplint transpiler + open-abap runtime, the framework's
express shim, the [samples-controls](https://github.com/abap2UI5/samples-controls) build
and boot gates, and the [abap2UI5-linter](https://github.com/abap2UI5/linter)
validation core.

## Setup

The tools need different things, so you can stop at the level you need. Each
step adds the ones below it.

### Level 1 — validate views (~3 MB, a minute)

`validate_view` alone, which is the tool you reach for most: it reconstructs
the view your ABAP builds and checks it against the UI5 API.

```sh
git clone https://github.com/abap2UI5/linter   # AI_VIEW_CHECK_HOME
git clone https://github.com/abap2UI5/ai-mcp
cd linter && npm ci && cd ../ai-mcp && npm ci
```

The other tools answer with an actionable message naming what is missing
rather than failing — the server starts either way.

### Level 2 — the catalogues and deploying (~110 MB)

`capabilities`, `generation_rules`, `pitfalls`, `scope_of`, `deploy_app`.

```sh
git clone https://github.com/abap2UI5/abap2UI5          # A2UI5_HOME
git clone https://github.com/abap2UI5/samples-controls  # SAMPLES_CONTROLS_HOME
cd abap2UI5 && npm ci && cd ../samples-controls && npm ci
```

### Level 3 — see the app (a browser, and time)

`build_backend` + `run_app`: the screenshot loop.

```sh
npx playwright install chromium
```

Then one `build_backend { mode: "full" }`, which transpiles the framework and
the corpus to Node. **Budget tens of minutes for that first build** — every
later one is incremental (~1–2 min). It is the slowest thing here by far, and
it is what buys an agent the ability to look at what it built.

> **If you set this up earlier:** the corpus repository was `ai-demokit`, then
> `abap2UI5-api`, and is `samples-controls` today. Nothing needs changing — an
> existing checkout is still found under any of the three directory names, and
> `AI_DEMOKIT_HOME` is still read alongside `SAMPLES_CONTROLS_HOME`.

### Register it with your client

**Claude Code:**

```sh
claude mcp add abap2ui5 -- node /path/to/ai-mcp/server.mjs
```

**Cursor** (`.cursor/mcp.json`), **VS Code** (`.vscode/mcp.json`), **Claude
Desktop** (`claude_desktop_config.json`) and anything else that reads the
standard stdio shape:

```json
{
  "mcpServers": {
    "abap2ui5": {
      "command": "node",
      "args": ["/path/to/ai-mcp/server.mjs"],
      "env": {
        "AI_VIEW_CHECK_HOME": "/path/to/linter",
        "A2UI5_HOME": "/path/to/abap2UI5",
        "SAMPLES_CONTROLS_HOME": "/path/to/samples-controls"
      }
    }
  }
}
```

The three `env` entries are only needed if the checkouts are not siblings of
`ai-mcp`; drop the ones you stopped short of. VS Code wants the same object
under a top-level `"servers"` key rather than `"mcpServers"`.

The [abap2UI5 VS Code extension](https://github.com/abap2UI5/vscode-extension)
registers this server for you, and adds a second one of its own for the tools
that need a real SAP system.

## Tools

| Tool | What it does |
|---|---|
| `capabilities` | Query the verified capability map (samples-controls CAPABILITIES.md, parsed live — no drift). Ask before assuming a UI5 feature is impossible: `{ query: "tree binding" }`, `{ status: "not-expressible" }` |
| `generation_rules` | The rulebook for writing an app with the generic view builder |
| `pitfalls` | The catalogues of defects **a green CI does not catch**, parsed live from the abap2UI5 checkout: `{ area: "abap" }` (abapGit round trip and import, activation, extended check, downport/transpiler, runtime) and `{ area: "view" }` (names the 1.71 floor does not have, layout that only works on a newer release, views that fail to *load*). Every entry is a defect that actually shipped, with its evidence. `validate_view` decides what a rule can decide — this is the rest |
| `scope_of` | In/out-of-scope verdict for UI5 controls (since <= 1.71, not deprecated) |
| `validate_view` | **Seconds, not minutes**: static property gate + headless render via abap2UI5-linter, from ABAP source or raw XML — run this after writing, before deploying. Findings come with a severity, a message and the line/column in the source you passed in. Judged by your project's own `abap2ui5lint.jsonc`: pass `{ project_dir: "/path/to/your/repo" }`, or let it take the directory the server runs in |
| `deploy_app` | Write `<class>.clas.abap` + abapGit sidecar into the gitignored sandbox `src/zz_dev/` (in the samples-controls checkout), then abaplint it |
| `build_backend` | Rebuild the transpiled Node backend. `mode: auto` is **incremental** after the first full build (~1-2 min per iteration); `mode: full` runs the complete e2e-build |
| `run_app` | Boot any app class headless (`?app_start=<class>`), return boot status, real page errors (benign UI5 noise filtered) and a full-page **screenshot as an image** |
| `backend` | `status` / `start` / `stop` / `restart` of the local express backend |
| `remove_app` | Delete a dev app from the sandbox (or list the deployed ones) |

`run_app` works for new dev apps and equally for the existing samples-controls
ports and `z2ui5_cl_smpc_app_overview` — useful as a reference: "run the closest
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
7. `pitfalls` before you call it done — the defects no gate here can see: what
   the class does on a *real* system (abapGit import, activation, the extended
   check) and what the view does on the *oldest* one. A green loop is not the
   same as a shipped app.

## Notes

- **Dev sandbox:** deployed apps land in the samples-controls checkout's gitignored
  `src/zz_dev/` — nothing an agent deploys can leak into a commit. Promote a
  finished app by moving it into a real package deliberately.
- **Port:** the backend listens on 3000 (`A2UI5_MCP_PORT` overrides).
- **Timeouts:** every spawned child is killed (whole process tree) when it
  exceeds its limit — lint/scope 5 min, build 30 min by default;
  `A2UI5_MCP_LINT_TIMEOUT_MS`, `A2UI5_MCP_SCOPE_TIMEOUT_MS` and
  `A2UI5_MCP_BUILD_TIMEOUT_MS` override (values in ms).
- **UI5 sources:** modules are served from the samples-controls checkout's
  `@openui5` packages, so booting needs no network. The built theme CSS is
  not in those packages — with network access it loads from the CDN (styled
  screenshots); without, apps render unstyled but structurally complete.
  `A2UI5_MCP_OFFLINE=1` forces the hermetic behaviour.
- **Chromium:** uses the Playwright-managed browser; if absent, falls back to
  a system chromium (`A2UI5_MCP_CHROMIUM` overrides the executable path).
- **Real system deployment** stays what it is today: abapGit. This server is
  the inner dev loop; a `run_app_system` backend (launch URL + auth proxy, as
  solved in the [VS Code extension](https://github.com/abap2UI5/vscode-extension))
  is the planned second stage.
