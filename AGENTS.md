# AGENTS.md — ai-mcp

Single source of truth for agents working on the **abap2UI5 MCP server** —
the `capabilities → deploy_app → build_backend → run_app` loop exposed to MCP
clients, no SAP system required.

> This entire project is in **English**. Source files are **7-bit ASCII**
> (stated at `lib/capabilities.mjs` — keep it that way repo-wide).

## The one thing to understand first: this repo cannot work alone

ai-mcp **bundles no content**. Every tool reads live from sibling checkouts,
resolved per call in `lib/repos.mjs` (explicit env var, then the `../<name>`
sibling of this repo — plus, for abap2UI5, the in-repo `.abap2UI5` clone that
ai-demokit's `npm run node:setup` creates). A **set env var is
authoritative**: when it points at a directory without the expected checkout,
the repo resolves to null and the tool reports the misconfiguration — there
is no silent fallback to the sibling guess.

| Env var | Default sibling | Used for |
| --- | --- | --- |
| `AI_DEMOKIT_HOME` | `../ai-demokit` | CAPABILITIES.md (re-parsed on every query), `scripts/generation-prompt.txt`, `scripts/scope-of.mjs`, `scripts/e2e-build.mjs`, `abaplint.jsonc`, `src/zz_dev/` (deploy target), `node_modules/@openui5/*` (UI5 runtime for screenshots) |
| `A2UI5_HOME` | `../abap2UI5` | `node/srv/express.mjs` (backend server), `node/downport/` + `node/setup/abap_transpile.json` (incremental build), `node/output/` |
| `AI_VIEW_CHECK_HOME` | `../linter` (legacy aliases: `../abap2UI5-linter`, `../ai-view-check`) | `validate_view`: dynamic import of the linter's package `exports` entries `.`, `./findings`, `./config` (via `importViewCheck`) |

Also: `A2UI5_MCP_PORT`, `A2UI5_MCP_OFFLINE=1` (no CDN fallback for UI5),
`A2UI5_MCP_CHROMIUM` (browser path), and the child-process timeouts
`A2UI5_MCP_LINT_TIMEOUT_MS` / `A2UI5_MCP_SCOPE_TIMEOUT_MS` (default 5 min)
and `A2UI5_MCP_BUILD_TIMEOUT_MS` (default 30 min).

A missing checkout degrades **per tool** (the server still starts;
`resolve*` returns null and the affected tool returns a uniform, actionable
error — which repo, how to clone it, which env var; see `missingSibling` in
`server.mjs`) — `validate_view` needs the linter, `run_app`/`backend` need
the core repo, almost everything else needs ai-demokit. The README calls the
linter "optional"; that is true for 8 of 9 tools and fatal for
`validate_view`. `test/missing-siblings.test.mjs` pins this contract per
tool by pointing all three env vars at nonexistent directories.

### The compatibility surface — renames upstream break tools here silently

These upstream file names/shapes are load-bearing for ai-mcp. When one
changes upstream, this repo must change in the same breath:

- ai-demokit: `CAPABILITIES.md` **table format** (4 columns, status emoji —
  parser + legend in `lib/capabilities.mjs`), `scripts/generation-prompt.txt`,
  `scripts/scope-of.mjs` CLI output, `scripts/e2e-build.mjs`, `abaplint.jsonc`,
  the `src/zz_dev/` package convention.
- abap2UI5 core: `node/srv/express.mjs`, `node/setup/abap_transpile.json`,
  `node/downport/`, `node/output/init.mjs`.
- abap2UI5-linter: the package `exports` map entries `.`, `./findings` and
  `./config` (and the shapes behind them: `checkFiles`, `severityOf` /
  `severityRank` / `SEVERITIES`, `findConfigFrom` / `loadConfig` /
  `applyConfig`) — imported **via the exports map** by `importViewCheck` in
  `lib/repos.mjs`, so internal file-layout refactors there are safe, but a
  removed or renamed export breaks `validate_view` even while the linter's
  own tests stay green.

## Side effects on sibling repos — expected, not a bug

The server **writes into the sibling checkouts**. When you (or another
agent) find these artifacts in a dirty sibling worktree, ai-mcp caused them:

- `<ai-demokit>/.abaplint-mcp-dev.jsonc` — patched lint config for deployed
  dev apps (gitignored there).
- `<ai-demokit>/src/zz_dev/*.clas.abap` + `.clas.xml` + `package.devc.xml` —
  deployed dev apps (`remove_app` deletes them again).
- `<abap2UI5>/e2e-transpile.json` — temporary incremental-build config
  (deleted on close).
- `<abap2UI5>/node/` — a clone of `open-abap-core` during builds.

## Build & verify

```bash
npm install          # @modelcontextprotocol/sdk + playwright
npm start            # run the server on stdio (for an MCP client)
```

```bash
npm test             # node --test: sibling-free units + the stdio smoke
```

`test/unit.test.mjs` covers the units that need no sibling checkout
(stripJsonc, the CAPABILITIES.md parser via its rawText parameter, the
deployApp validation error paths, the BENIGN console filter);
`test/missing-siblings.test.mjs` boots the real server with the sibling env
vars pointed at nonexistent directories and asserts every sibling-dependent
tool degrades with its actionable error (this one runs everywhere);
`test/smoke.test.mjs` boots the real server over stdio (initialize, 9 tools,
a capabilities query) and **skips itself when the ai-demokit sibling is
absent**, so `npm test` is green in a bare checkout and exercises the full
path in a sibling workspace. CI (`.github/workflows/ci.yml`) runs `npm test`
on every push/PR. Manual stdio driving, when a test is not enough:

```bash
node -e '
const { spawn } = require("child_process");
const p = spawn("node", ["server.mjs"], { stdio: ["pipe","pipe","inherit"] });
p.stdout.on("data", (d) => process.stdout.write(d));
const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
send({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"smoke",version:"0"}}});
send({jsonrpc:"2.0",id:2,method:"tools/list"});
setTimeout(() => { send({jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"capabilities",arguments:{query:"popup"}}}); setTimeout(()=>p.kill(),2000); }, 500);
'
```

Expect: an `initialize` result, 9 tools in `tools/list`, and capability rows
for "popup". Pure units that are testable without any sibling checkout (add
tests here first): `stripJsonc` (`lib/runtime.mjs`), the CAPABILITIES.md
table parser (`lib/capabilities.mjs`), the class-name/`z2ui5_if_app`
validation in `deployApp`, the `BENIGN` console-noise filter.

## Timing expectations

`build_backend` full build is **tens of minutes** (transpiles the whole
framework); the incremental path is ~1–2 minutes. Set tool/agent timeouts
accordingly — a "hung" build is usually just a slow transpile. Every spawned
child carries its own hard timeout (`spawnWithTimeout` in `lib/runtime.mjs`
kills the whole process tree on expiry): lint and scope default to 5 minutes
(`A2UI5_MCP_LINT_TIMEOUT_MS`, `A2UI5_MCP_SCOPE_TIMEOUT_MS`), the build to 30
minutes (`A2UI5_MCP_BUILD_TIMEOUT_MS`) — raise the env var when a machine is
legitimately slower.

## Maintenance traps (learned, do not repeat)

- The **tool list in the `server.mjs` header comment** and the **server
  `version`** are duplicated by hand — update both when adding a tool or
  bumping `package.json` (they have drifted before: a missing `remove_app`
  row, `1.0.0` vs `0.1.0`).
- `lib/repos.mjs` exports **`VIEW_CHECK_DIRS`**: the checker's own directory
  name `linter` plus the **pre-rename aliases** `abap2UI5-linter` and
  `ai-view-check`, in that order. The VS Code extension mirrors the same list
  by hand in `src/mcp.ts` and `src/viewcheck.ts` — change all three together,
  and drop an alias only in a coordinated change across both repos.
- The README's setup section and the sibling-layout table above must stay in
  sync — the README is the user-facing copy, this file is the contract.

## Related repositories

| Repository | Relation |
| --- | --- |
| [ai-demokit](https://github.com/abap2UI5/ai-demokit) | Content substrate: capabilities, rules, scope, deploy target, UI5 runtime |
| [abap2UI5](https://github.com/abap2UI5/abap2UI5) | Runtime substrate: transpiled backend + express server |
| [abap2UI5-linter](https://github.com/abap2UI5/linter) | `validate_view` implementation (imported via its package `exports` map) |
| [vscode-extension](https://github.com/abap2UI5/vscode-extension) | Registers this server for MCP clients in the editor (`src/mcp.ts`) |
