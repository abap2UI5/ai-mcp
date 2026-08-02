#!/usr/bin/env node
/*
 * abap2UI5 MCP server — the generate -> deploy -> run -> LOOK loop for AI
 * coding agents, without an SAP system.
 *
 * Speaks MCP over stdio. Register it in any MCP client, e.g. Claude Code:
 *
 *   claude mcp add abap2ui5 -- node ai-mcp/server.mjs
 *
 * Tools (each wraps infrastructure this repo already trusts in CI):
 *   capabilities      what abap2UI5 can express (CAPABILITIES.md, live-parsed)
 *   generation_rules  how to BUILD an app (abap2UI5 docs/agents/building-apps.md)
 *   porting_rules     the ai-demokit porting brief (generation-prompt.txt)
 *   example_app       read an existing ai-demokit port (ABAP source + sidecar)
 *   scope_of          in/out-of-scope verdict for a UI5 control (scope-of.mjs)
 *   validate_view     static gates via abap2UI5-linter (properties + render)
 *   deploy_app        write an app class into src/zz_dev/ (+ optional lint)
 *   build_backend     transpile framework + apps to the Node backend (e2e-build)
 *   run_app           boot the app headless, return page errors + a SCREENSHOT
 *   remove_app        delete a dev app from src/zz_dev/ again
 *   backend           start/stop/status of the express backend
 *
 * The intended agent loop: capabilities -> deploy_app -> build_backend ->
 * run_app -> read the errors, LOOK at the screenshot -> edit -> repeat.
 */
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { searchCapabilities, capabilitySummary } from './lib/capabilities.mjs';
import { readExampleApp, searchExampleApps } from './lib/example-app.mjs';
import { resolveA2UI5, resolveAiDemokit, resolveViewCheck, SERVER_ROOT } from './lib/repos.mjs';
import {
  deployApp,
  removeApp,
  listDevApps,
  lintApp,
  buildBackend,
  backendBuilt,
  backendStatus,
  startBackend,
  stopBackend,
  runApp,
} from './lib/runtime.mjs';

const TOOLS = [
  {
    name: 'capabilities',
    description:
      'Query what abap2UI5 can express, from the verified capability map (CAPABILITIES.md — every entry ' +
      'names a proving port). Call this BEFORE deciding a UI5 feature cannot be built. ' +
      'Without arguments returns a summary; with `query` returns matching entries ' +
      '(status: direct | workaround | needs-live-test | not-expressible).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'keywords matched against feature/how/evidence, e.g. "tree binding" or "dialog"' },
        status: {
          type: 'string',
          enum: ['direct', 'workaround', 'needs-live-test', 'not-expressible'],
          description: 'optional filter on the capability status',
        },
      },
    },
  },
  {
    name: 'generation_rules',
    description:
      'The canonical guide for BUILDING an abap2UI5 app (app class template, lifecycle, view building ' +
      'with z2ui5_cl_ai_xml, two-way binding, events, popups) — the abap2UI5 repo\'s agent guide, read ' +
      'live. Read it once before generating ABAP. For porting official UI5 demo kit samples inside ' +
      'ai-demokit use porting_rules instead.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'porting_rules',
    description:
      'The porting brief for rebuilding an official UI5 demo kit sample 1:1 as an ai-demokit port class ' +
      '(ai-demokit scripts/generation-prompt.txt). Only for porting work inside the ai-demokit corpus — ' +
      'for building a NEW app use generation_rules.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'example_app',
    description:
      'Read an existing ai-demokit port as a working example: returns the full ABAP source plus the ' +
      'meta/<class>.json sidecar summary (ported sample, entity, verification status, deviations). ' +
      'capabilities answers cite evidence like "app 044" — this tool is how you read that code: ' +
      '{ class_name: "z2ui5_cl_ai_app_044" } or { query: "app 044" } or { query: "pdf popup" } ' +
      '(free-text search over the sidecars and CAPABILITIES.md, best match + other candidates).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'keywords or an app number, e.g. "tree table" or "app 044"' },
        class_name: { type: 'string', description: 'exact port class, e.g. z2ui5_cl_ai_app_044' },
      },
    },
  },
  {
    name: 'scope_of',
    description:
      'Authoritative in/out-of-scope verdict for UI5 control entities (exists since UI5 <= 1.71, not ' +
      'deprecated), read from the OpenUI5 source JSDoc. Needs an OpenUI5 checkout (OPENUI5_SRC or ' +
      '../fork-openui5).',
    inputSchema: {
      type: 'object',
      properties: {
        entities: {
          type: 'array',
          items: { type: 'string' },
          description: 'control entities, e.g. ["sap.m.Wizard", "sap.f.SidePanel"]',
        },
      },
      required: ['entities'],
    },
  },
  {
    name: 'deploy_app',
    description:
      'Deploy an abap2UI5 app: writes <class_name>.clas.abap (+ abapGit sidecar) into the gitignored ' +
      'dev sandbox src/zz_dev/ and lints it with the repo abaplint config. The class must implement ' +
      'z2ui5_if_app. After deploying, run build_backend once (rebuilds the transpiled Node backend), ' +
      'then run_app to see it. Set lint:false to skip the lint (faster, not recommended).',
    inputSchema: {
      type: 'object',
      properties: {
        class_name: { type: 'string', description: 'lowercase class name matching ^z2ui5_cl_..., <= 30 chars, e.g. z2ui5_cl_my_app' },
        abap_source: { type: 'string', description: 'full ABAP source of the class (CLASS ... DEFINITION + IMPLEMENTATION)' },
        description: { type: 'string', description: 'short class description (abapGit DESCRIPT)' },
        lint: { type: 'boolean', description: 'run abaplint after writing (default true)' },
      },
      required: ['class_name', 'abap_source'],
    },
  },
  {
    name: 'validate_view',
    description:
      'Fast static validation via abap2UI5-linter, BEFORE the build/run loop: reconstructs the view from the ' +
      'z2ui5_cl_ai_xml builder calls (or takes raw view XML), runs the UI5 property gate (@since floor, ' +
      'deprecation) and renders it headless with a typed mock model. Seconds instead of a build+boot — use it ' +
      'after writing ABAP, then deploy_app once it is clean. Each finding carries severity (error = the app ' +
      'breaks, warning = not necessarily on your target UI5, hint = advisory), a message and the line/column ' +
      'in the source you passed in; ok is false while any error or warning is left (hints are advisory).',
    inputSchema: {
      type: 'object',
      properties: {
        abap_source: { type: 'string', description: 'ABAP class source building its view with z2ui5_cl_ai_xml' },
        xml: { type: 'string', description: 'alternatively: raw view/fragment XML' },
        min_ui5: { type: 'string', description: 'UI5 floor for the property gate (default 1.71)' },
        allow: { type: 'array', items: { type: 'string' }, description: 'accepted deviations, e.g. ["sap.m.GenericTile.systemInfo"]' },
        render: { type: 'boolean', description: 'run the headless render gate (default true)' },
      },
    },
  },
  {
    name: 'build_backend',
    description:
      'Rebuild the transpiled Node backend so run_app picks up deployed/edited ABAP. mode auto (default) is ' +
      'incremental when a prior full build exists: only src/zz_dev/ is re-copied and re-transpiled (~1-2 min). ' +
      'mode full runs the complete e2e-build (downport + transpile, tens of minutes) — needed once initially, or ' +
      'when framework/port sources changed, or when the incremental transpile rejects a construct (then simplify ' +
      'the ABAP or go full). Stops a running backend first.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['auto', 'incremental', 'full'], description: 'default auto' },
      },
    },
  },
  {
    name: 'run_app',
    description:
      'Boot an app class headless in Chromium against the local backend (?app_start=<class>) and LOOK at it: ' +
      'returns booted/ok, real page errors + failed backend calls (benign UI5 noise filtered), and a full-page ' +
      'screenshot as an image. The visual verification step of the loop — also works for the 276 existing ports ' +
      'and z2ui5_cl_ai_app_overview.',
    inputSchema: {
      type: 'object',
      properties: {
        class_name: { type: 'string', description: 'the app class to start, e.g. z2ui5_cl_my_app or z2ui5_cl_ai_app_005' },
        timeout_ms: { type: 'number', description: 'boot timeout in ms (default 60000)' },
      },
      required: ['class_name'],
    },
  },
  {
    name: 'backend',
    description: 'Manage the local express backend serving the transpiled apps: status | start | stop | restart. ' +
      'run_app starts it automatically; use this for diagnostics or to free the port.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'start', 'stop', 'restart'], description: 'default: status' },
      },
    },
  },
  {
    name: 'remove_app',
    description: 'Remove a previously deployed dev app from src/zz_dev/ (takes effect in the served backend after the next build_backend). Without class_name lists the deployed dev apps.',
    inputSchema: {
      type: 'object',
      properties: {
        class_name: { type: 'string', description: 'the dev app class to remove; omit to list deployed dev apps' },
      },
    },
  },
];

function text(s) {
  return { content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] };
}

function toolError(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

async function runScopeOf(entities) {
  return new Promise((resolve) => {
    const child = spawn('node', [path.join(resolveAiDemokit(), 'scripts', 'scope-of.mjs'), ...entities], { cwd: resolveAiDemokit() });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out: out.trim() }));
  });
}

// scope-of.mjs reads the control JSDoc from an OpenUI5 checkout: OPENUI5_SRC,
// else ../fork-openui5 next to ai-demokit. Without it every entity comes back
// UNRESOLVED — check up front and say what to do instead of relaying that.
function openUi5Src(demokit) {
  const dir = process.env.OPENUI5_SRC
    ? path.resolve(process.env.OPENUI5_SRC)
    : path.resolve(demokit, '..', 'fork-openui5');
  return fs.existsSync(path.join(dir, 'src')) ? dir : { missing: dir };
}

async function handle(name, args = {}) {
  switch (name) {
    case 'capabilities': {
      if (!args.query && !args.status) {
        const s = capabilitySummary();
        return text({
          summary: s,
          hint: 'pass `query` (keywords) and/or `status` to get the matching entries; statuses: direct, workaround, needs-live-test, not-expressible',
        });
      }
      const hits = searchCapabilities({ query: args.query, status: args.status });
      return text({ matches: hits.length, entries: hits });
    }
    case 'generation_rules': {
      const a2 = resolveA2UI5();
      if (!a2) {
        return toolError('abap2UI5 checkout not found — set A2UI5_HOME or clone https://github.com/abap2UI5/abap2UI5 as a sibling (the building-apps guide lives there)');
      }
      const p = path.join(a2, 'docs', 'agents', 'building-apps.md');
      if (!fs.existsSync(p)) {
        return toolError(`building-apps guide not found at ${p} — pull a current abap2UI5 checkout (docs/agents/building-apps.md)`);
      }
      const rules = fs.readFileSync(p, 'utf8');
      return text(
        rules +
          '\n\n---\nMore depth: CAPABILITIES.md via the capabilities tool, example_app for working port sources, ' +
          'and https://abap2ui5.github.io/docs/llms.txt as further reading.',
      );
    }
    case 'porting_rules': {
      const demokit = resolveAiDemokit();
      if (!demokit) {
        return toolError('ai-demokit checkout not found — set AI_DEMOKIT_HOME or clone it as a sibling (the porting brief lives there)');
      }
      const rules = fs.readFileSync(path.join(demokit, 'scripts', 'generation-prompt.txt'), 'utf8');
      return text(
        rules +
          '\n\n---\nMore depth: the ai-demokit AGENTS.md (conventions, gates) and CAPABILITIES.md via the capabilities tool.',
      );
    }
    case 'example_app': {
      if (args.class_name) return text(readExampleApp(args.class_name));
      if (args.query) return text(searchExampleApps(args.query));
      return toolError('pass class_name (e.g. z2ui5_cl_ai_app_044) or query (e.g. "app 044", "tree table")');
    }
    case 'scope_of': {
      const entities = args.entities || [];
      if (!entities.length) return toolError('pass at least one entity, e.g. ["sap.m.Wizard"]');
      const demokit = resolveAiDemokit();
      if (!demokit) return toolError('ai-demokit checkout not found — set AI_DEMOKIT_HOME or clone it as a sibling (scope-of.mjs lives there)');
      const ui5 = openUi5Src(demokit);
      if (ui5.missing) {
        return toolError(
          `OpenUI5 checkout not found — scope_of reads the control JSDoc from the OpenUI5 sources. ` +
            `Clone them to ${ui5.missing} (git clone --depth 1 https://github.com/SAP/openui5 "${ui5.missing}") ` +
            `or set OPENUI5_SRC to an existing checkout.`,
        );
      }
      const { code, out } = await runScopeOf(entities);
      return text(`${out}\n\n(exit ${code}: 0 = all in scope, 1 = at least one out of scope or unresolved)`);
    }
    case 'deploy_app': {
      const res = deployApp({
        className: args.class_name,
        source: args.abap_source,
        description: args.description,
      });
      const reply = { deployed: res.class, file: res.abapPath };
      if (args.lint !== false) {
        reply.lint = await lintApp(res.class);
        if (!reply.lint.ok) {
          reply.hint = 'fix the lint findings and deploy again; build_backend is only worth running on a clean lint';
        }
      }
      if (!reply.lint || reply.lint.ok) {
        reply.next = 'run build_backend once, then run_app to see the app';
      }
      return text(reply);
    }
    case 'validate_view': {
      const vc = resolveViewCheck();
      if (!vc) {
        return toolError('abap2UI5-linter checkout not found — set AI_VIEW_CHECK_HOME or clone https://github.com/abap2UI5/linter as a sibling');
      }
      if (!args.abap_source && !args.xml) return toolError('pass abap_source or xml');
      const lib = await import(path.join(vc, 'lib', 'index.mjs'));
      const opts = {
        minUi5: args.min_ui5 || '1.71',
        allow: args.allow || [],
        render: args.render !== false,
        properties: true,
        snapshot: path.join(vc, 'data', 'properties.json'),
      };
      let result;
      if (args.xml) {
        result = lib.checkXmlSource(args.xml, opts);
        if (opts.render) {
          const { openRenderer } = await import(path.join(vc, 'lib', 'render.mjs'));
          const renderer = await openRenderer();
          try {
            for (const xml of result.docs) result.renderErrors.push(...(await renderer.render({ xml, model: {} })));
          } finally {
            await renderer.close();
          }
        }
      } else {
        result = lib.checkAbapSource(args.abap_source, opts);
        if (opts.render && result.docs.length && result.helperTokens === 0) {
          const { openRenderer } = await import(path.join(vc, 'lib', 'render.mjs'));
          const renderer = await openRenderer();
          try {
            for (const xml of result.docs) result.renderErrors.push(...(await renderer.render({ xml, model: result.model })));
          } finally {
            await renderer.close();
          }
        }
      }
      /* Every finding carries its severity, a ready-made message and (where
       * the gate could place it) line/column. ok follows the linter's own
       * default threshold: errors AND warnings block. A warning here means
       * "not on the UI5 version you target" - and the system the agent
       * targets is the entire point of this gate, so it is not advisory.
       * Only hints are: nothing handling an event is a dead control, unless
       * the roundtrip alone was the intention, which the agent may know. */
      const counts = { error: result.renderErrors.length, warning: 0, hint: 0 };
      for (const f of result.findings) counts[f.severity || 'error']++;
      return text({
        ok: counts.error === 0 && counts.warning === 0,
        counts,
        findings: result.findings,
        renderErrors: result.renderErrors,
        reconstructedDocs: result.docs.length,
        skippedRender: result.helperTokens > 0 ? `view parts in helper methods (${result.helperTokens} calls) — not statically reconstructable` : undefined,
        notes: result.notes,
        hint: counts.error === 0 && counts.warning > 0
          ? 'what is left is about the UI5 version you target: fix it, raise min_ui5 if the system is newer, or accept it via allow'
          : counts.error === 0 && counts.hint > 0
            ? 'hints are advisory - an event without a handler is intended when the roundtrip alone is the point'
            : undefined,
      });
    }
    case 'build_backend': {
      await stopBackend();
      const res = await buildBackend({ mode: args.mode || 'auto' });
      if (!res.ok) return toolError(`build failed (exit ${res.code}, mode ${res.mode || args.mode}):\n${res.tail}`);
      return text({ built: true, mode: res.mode, next: 'run_app { class_name } to boot and screenshot the app', tail: res.tail.split('\n').slice(-5).join('\n') });
    }
    case 'run_app': {
      const res = await runApp({ className: args.class_name, timeoutMs: args.timeout_ms || 60000 });
      const report = {
        class: res.class,
        booted: res.booted,
        ok: res.ok,
        errors: res.errors,
        screenshot: res.screenshotPath,
      };
      const content = [{ type: 'text', text: JSON.stringify(report, null, 2) }];
      if (res.base64) content.push({ type: 'image', data: res.base64, mimeType: 'image/png' });
      return { content, isError: !res.booted };
    }
    case 'backend': {
      const action = args.action || 'status';
      if (action === 'start') return text(await startBackend());
      if (action === 'stop') return text(await stopBackend());
      if (action === 'restart') {
        await stopBackend();
        return text(await startBackend());
      }
      return text(backendStatus());
    }
    case 'remove_app': {
      if (!args.class_name) return text({ devApps: listDevApps() });
      const removed = removeApp(args.class_name);
      return text({ removed, note: removed ? 'run build_backend to update the served backend' : 'no such dev app' });
    }
    default:
      return toolError(`unknown tool: ${name}`);
  }
}

const server = new Server(
  { name: 'abap2ui5', version: '0.1.1' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    return await handle(req.params.name, req.params.arguments || {});
  } catch (e) {
    return toolError(String((e && e.message) || e));
  }
});

process.on('SIGINT', async () => {
  await stopBackend().catch(() => {});
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await stopBackend().catch(() => {});
  process.exit(0);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`abap2ui5 MCP server ready (ai-demokit: ${resolveAiDemokit()}, backend built: ${backendBuilt()})`);
