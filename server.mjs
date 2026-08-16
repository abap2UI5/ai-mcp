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
 *   examples          which app already does this (three SAMPLES.md, live-parsed)
 *   generation_rules  the porting/building rulebook (generation-prompt.txt)
 *   pitfalls          the abap-check / ui5-check catalogues (defects a green CI misses)
 *   scope_of          in/out-of-scope verdict for a UI5 control (scope-of.mjs)
 *   validate_view     static gates via abap2UI5-linter (properties + render)
 *   deploy_app        write an app class into src/zz_dev/ (+ optional lint)
 *   build_backend     transpile framework + apps to the Node backend (e2e-build)
 *   run_app           boot the app headless, return page errors + a SCREENSHOT
 *   remove_app        delete a dev app from src/zz_dev/ again
 *   backend           start/stop/status of the express backend
 *
 * The intended agent loop: examples/capabilities -> deploy_app -> build_backend ->
 * run_app -> read the errors, LOOK at the screenshot -> edit -> repeat.
 */
import path from 'path';
import fs from 'fs';
import os from 'os';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { searchCapabilities, capabilitySummary } from './lib/capabilities.mjs';
import { searchExamples, exampleSummary, catalogueFiles } from './lib/examples.mjs';
import { searchPitfalls } from './lib/pitfalls.mjs';
import { resolveSamplesControls, resolveA2UI5, resolveViewCheck, resolveSamples, importViewCheck, resolveLintConfig, SERVER_ROOT } from './lib/repos.mjs';
import {
  deployApp,
  removeApp,
  listDevApps,
  lintApp,
  runScopeOf,
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
    name: 'examples',
    description:
      'Find a WORKING APP that already does what you are about to build, across ALL THREE sample '
      + 'repositories (~615 apps, live-parsed from their SAMPLES.md catalogues): abap2UI5/samples '
      + '(patterns — value help, navigation, trees, tables), abap2UI5/samples-controls (the UI5 demo '
      + 'kit rebuilt control by control — ask this for "how do I express sap.m.Wizard") and '
      + 'abap2UI5/samples-stack (apps that need an OData service, RAP, APC or the launchpad — only '
      + 'propose one when the user has that). This is the pattern question and it differs from '
      + '`capabilities`, which answers whether a UI5 control can be expressed at all. Ask this before '
      + 'writing an app from scratch. What comes back is a repository, a class name and its path: '
      + 'READ that class. It is a whole app that compiles, renders and is downported to three '
      + 'releases, which is worth more than any snippet. A repository that is not checked out is '
      + 'reported, not fatal — the others are still searched. Without arguments returns a summary.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'keywords matched against the catalogue title, description and search terms, e.g. "value help f4" or "table binding" or "routing"',
        },
        repo: {
          type: 'string',
          enum: ['samples', 'samples-controls', 'samples-stack'],
          description:
            'optional filter to one repository. Use `samples-controls` when the question is about a '
            + 'specific UI5 CONTROL, `samples-stack` when the app may depend on the system (OData, RAP, '
            + 'APC, launchpad), `samples` for everything else.',
        },
        area: {
          type: 'string',
          enum: ['samples', 'experimental-or-test'],
          description:
            'optional filter WITHIN abap2UI5/samples. `samples` is the supported set (src/01) and what '
            + 'you normally want; `experimental-or-test` is src/00 — work in progress and apps that '
            + 'exercise the framework from the outside, useful to read, not to copy wholesale.',
        },
        limit: { type: 'number', description: 'maximum entries to return (default 20)' },
      },
    },
  },
  {
    name: 'generation_rules',
    description:
      'The canonical rulebook for writing an abap2UI5 app with the generic view builder ' +
      '(dispatcher skeleton, view/attribute idioms, binding and event rules). Read it once before ' +
      'generating ABAP.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'pitfalls',
    description:
      'The catalogues of defects a green CI does NOT catch, read live from the abap2UI5 checkout: '
      + '`abap` covers ABAP that has to survive a real SAP system (abapGit round trip and import, '
      + 'activation, extended check, downport/transpiler, runtime), `view` covers the view side '
      + '(names the 1.71 floor does not have, layout that only works on a newer release, views that '
      + 'fail to load rather than to render, CSP). Every entry is a defect that actually shipped. '
      + 'Read it before finishing a change — validate_view catches what a rule can decide, this is '
      + 'the rest.',
    inputSchema: {
      type: 'object',
      properties: {
        area: {
          type: 'string',
          enum: ['abap', 'view', 'all'],
          description: 'which catalogue (default: all)',
        },
        query: {
          type: 'string',
          description: 'optional keywords — returns only the matching sections, e.g. "icon" or "abapgit sidecar"',
        },
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
      'z2ui5_cl_ui5_view_builder calls (or takes raw view XML), runs the UI5 property gate (@since floor, ' +
      'deprecation) and renders it headless with a typed mock model. Seconds instead of a build+boot — use it ' +
      'after writing ABAP, then deploy_app once it is clean. Each finding carries severity (error = the app ' +
      'breaks, warning = not necessarily on your target UI5, hint = advisory), a message and the line/column ' +
      'in the source you passed in; ok is false while any error or warning is left (hints are advisory). ' +
      'The checked project\'s abap2ui5lint.jsonc (rule overrides, allow list, UI5 floor) is honoured; explicit arguments win.',
    inputSchema: {
      type: 'object',
      properties: {
        abap_source: { type: 'string', description: 'ABAP class source building its view with z2ui5_cl_ui5_view_builder' },
        xml: { type: 'string', description: 'alternatively: raw view/fragment XML' },
        project_dir: {
          type: 'string',
          description:
            'the project this source belongs to — its abap2ui5lint.jsonc (searched upwards from here) supplies '
            + 'the rule overrides, allow list and UI5 floor, so a finding matches what that project\'s own CI says. '
            + 'Defaults to the working directory, then to the samples-controls corpus.',
        },
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
      'the ABAP or go full). Stops a running backend first. Only one build runs at a time: a second call with the ' +
      'same effective mode joins the in-flight build and returns its result; a call with a different mode fails ' +
      'fast with "build in progress" — retry when the running build has finished (a full build is never silently ' +
      'downgraded to an incremental result, and vice versa). Long builds emit MCP progress notifications (at most ' +
      'one per second, carrying the latest build output line) when the call includes a progressToken.',
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
      'screenshot as an image. The visual verification step of the loop — also works for the existing ports ' +
      'and z2ui5_cl_smpc_app_overview.',
    inputSchema: {
      type: 'object',
      properties: {
        class_name: { type: 'string', description: 'the app class to start, e.g. z2ui5_cl_my_app or z2ui5_cl_smpc_app_005' },
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

/* Every tool that reads a sibling checkout degrades to the same clear,
 * actionable error when the checkout is missing (instead of a TypeError from
 * path.join(null, ...)): which repo is absent, how to clone it, which env var
 * points at an existing checkout. The server itself always starts. */
const SIBLING_REPOS = {
  'samples-controls': {
    resolve: resolveSamplesControls,
    hint: 'clone https://github.com/abap2UI5/samples-controls as a sibling of ai-mcp, or point SAMPLES_CONTROLS_HOME at an existing checkout (AI_DEMOKIT_HOME, its former name, is still read)',
  },
  abap2UI5: {
    resolve: resolveA2UI5,
    hint: 'clone https://github.com/abap2UI5/abap2UI5 as a sibling of ai-mcp (or run `npm run node:setup` in samples-controls), or point A2UI5_HOME at an existing checkout',
  },
  samples: {
    resolve: resolveSamples,
    hint: 'clone https://github.com/abap2UI5/samples as a sibling of ai-mcp, or point SAMPLES_HOME at an existing checkout',
  },
  linter: {
    resolve: resolveViewCheck,
    hint: 'clone https://github.com/abap2UI5/linter as a sibling of ai-mcp, or point AI_VIEW_CHECK_HOME at an existing checkout',
  },
};

function missingSibling(...repos) {
  for (const name of repos) {
    const { resolve, hint } = SIBLING_REPOS[name];
    if (!resolve()) return toolError(`${name} checkout not found — ${hint}`);
  }
  return null;
}

/* Throttled MCP progress from a long child's output: one
 * notifications/progress per second at most, carrying the latest line as the
 * message and the number of lines seen so far as the (open-ended) progress
 * counter. Only wired up when the client asked for progress by sending a
 * progressToken (the MCP contract); notification failures never fail the
 * build. */
function progressReporter({ progressToken, sendNotification }) {
  if (progressToken === undefined || progressToken === null || !sendNotification) return undefined;
  let lines = 0;
  let lastSent = 0;
  return (line) => {
    lines += 1;
    const now = Date.now();
    if (now - lastSent < 1000) return;
    lastSent = now;
    Promise.resolve(
      sendNotification({
        method: 'notifications/progress',
        params: { progressToken, progress: lines, message: String(line).slice(0, 300) },
      }),
    ).catch(() => {});
  };
}

async function handle(name, args = {}, ctx = {}) {
  switch (name) {
    case 'capabilities': {
      const miss = missingSibling('samples-controls');
      if (miss) return miss;
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
    case 'examples': {
      /* Not `missingSibling`: one catalogue out of three being absent is not a
       * reason to refuse the other two. What was searched and what was not is
       * reported instead, so a thin answer is never mistaken for "nobody has
       * built this". All three absent IS an error - there is nothing to say. */
      const { found, missing } = catalogueFiles();
      if (!found.length) {
        return toolError(
          'no sample catalogue found — clone at least one of them as a sibling of ai-mcp:\n'
          + missing.map((m) => `  ${m.repo}: ${m.why}`).join('\n'),
        );
      }
      const searched = found.map((c) => c.repo);
      const notSearched = missing.map((m) => `${m.repo}: ${m.why}`);
      if (!args.query && !args.area && !args.repo) {
        return text({
          summary: exampleSummary(),
          hint: 'pass `query` (keywords) to get matching apps; each entry names a class to READ in its repository',
        });
      }
      const hits = searchExamples({
        query: args.query, area: args.area, repo: args.repo, limit: args.limit ?? 20,
      });
      return text({
        matches: hits.length,
        searched,
        ...(notSearched.length ? { notSearched } : {}),
        repositories: Object.fromEntries(found.map((c) => [c.repo, c.url])),
        next: 'read the `path` of the closest match, in the repository its `repo` names — it is a complete, gated app, not a fragment',
        entries: hits,
      });
    }
    case 'generation_rules': {
      const miss = missingSibling('samples-controls');
      if (miss) return miss;
      const p = path.join(resolveSamplesControls(), 'scripts', 'generation-prompt.txt');
      // the checkout can be there and the file not: an older revision, a
      // half-finished pull, a rename upstream. Say which file and what to do,
      // the way `pitfalls` does - a raw ENOENT reaches the agent as a stack
      // trace it cannot act on.
      if (!fs.existsSync(p)) {
        return toolError(`the samples-controls checkout has no scripts/generation-prompt.txt (looked in ${p}) — `
          + 'update it (git pull); the rulebook lives there');
      }
      const rules = fs.readFileSync(p, 'utf8');
      return text(
        rules +
          '\n\n---\nMore depth: AGENTS.md (conventions, gates), CAPABILITIES.md via the capabilities tool, ' +
          'and https://abap2ui5.github.io/docs/cookbook/overview for the cookbook.',
      );
    }
    case 'pitfalls': {
      // the catalogues live in the abap2UI5 checkout, not in the corpus
      const miss = missingSibling('abap2UI5');
      if (miss) return miss;
      const area = args.area || 'all';
      if (!['abap', 'view', 'all'].includes(area)) {
        return toolError(`unknown area '${area}' — use abap, view or all`);
      }
      const found = searchPitfalls({ area, query: args.query });
      if (!found) {
        return toolError('the abap2UI5 checkout has no .claude/skills/{abap-check,ui5-check}/SKILL.md — '
          + 'update it (git pull); the catalogues live there');
      }
      const total = found.reduce((n, c) => n + c.sections.length, 0);
      if (args.query && !total) {
        return text({
          matches: 0,
          hint: `nothing in the ${area} catalogue matches "${args.query}" — `
            + 'call it without a query to read the whole thing (it is meant to be read once per task)',
        });
      }
      return text({ matches: total, catalogues: found });
    }
    case 'scope_of': {
      const miss = missingSibling('samples-controls');
      if (miss) return miss;
      const entities = args.entities || [];
      if (!entities.length) return toolError('pass at least one entity, e.g. ["sap.m.Wizard"]');
      const { code, out } = await runScopeOf(entities);
      return text(`${out}\n\n(exit ${code}: 0 = all in scope, 1 = at least one out of scope or unresolved)`);
    }
    case 'deploy_app': {
      const miss = missingSibling('samples-controls');
      if (miss) return miss;
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
      const miss = missingSibling('linter');
      if (miss) return miss;
      if (!args.abap_source && !args.xml) return toolError('pass abap_source or xml');
      /* All through the linter's public surface (its package exports map):
       * checkFiles carries the render pool, the helper-method skip and the
       * render-error waivers; findings/config carry severity and project
       * config semantics. No internal file paths, no re-derived logic. */
      const lib = await importViewCheck('.');
      const { severityOf, severityRank, SEVERITIES } = await importViewCheck('./findings');
      const { findConfigFrom, loadConfig, applyConfig } = await importViewCheck('./config');

      // explicit tool arguments win; the checked project's abap2ui5lint.jsonc
      // fills the rest — an agent must not report findings the project's own
      // CI has deliberately configured away
      const opt = { minUi5: '1.71', allow: [], render: true, properties: true };
      const seen = new Set(['properties']);
      if (args.min_ui5) { opt.minUi5 = args.min_ui5; seen.add('minUi5'); }
      if (args.allow) opt.allow = args.allow;
      if (args.render === false) { opt.render = false; seen.add('render'); }
      /* Which project's config that is, in order: the one named, the one the
       * server was started in, the corpus. It used to be the corpus and only
       * the corpus, which is right for porting samples and wrong for everyone
       * else: an app in someone's own repository was judged by samples-
       * controls' rule overrides, allow list and UI5 floor, with no argument
       * to say otherwise — while this tool's description promised the
       * opposite. The chosen file is reported back as `config`. */
      const configFile = resolveLintConfig(findConfigFrom, {
        projectDir: args.project_dir,
        cwd: process.cwd(),
        corpus: resolveSamplesControls(),
      });
      if (configFile) {
        const cfg = loadConfig(configFile);
        delete cfg.baseline; // baseline is a repo-workflow concern; new source has no baseline entry
        applyConfig(opt, seen, cfg);
      }

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui5-validate-'));
      const file = path.join(dir, args.xml ? 'source.view.xml' : 'source.clas.abap');
      let result;
      try {
        fs.writeFileSync(file, args.xml || args.abap_source);
        [result] = await lib.checkFiles([file], opt);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }

      /* Every finding carries its severity, a ready-made message and (where
       * the gate could place it) line/column. ok follows the linter's failOn
       * threshold (project-configurable, default: errors AND warnings block).
       * A warning here means "not on the UI5 version you target" - and the
       * system the agent targets is the entire point of this gate, so it is
       * not advisory. Only hints are: nothing handling an event is a dead
       * control, unless the roundtrip alone was the intention. */
      const counts = { error: 0, warning: 0, hint: 0 };
      for (const f of result.findings) counts[severityOf(f)]++;
      counts[result.renderSeverity || 'error'] += result.renderErrors.length;
      const failOn = opt.failOn || 'warning';
      const ok = failOn === 'never' || SEVERITIES.slice(severityRank(failOn)).every((s) => counts[s] === 0);
      return text({
        ok,
        counts,
        findings: result.findings,
        renderErrors: result.renderErrors,
        reconstructedDocs: result.docs.length,
        skippedRender: result.skippedRender ? `view parts in helper methods (${result.helperTokens} calls) — not statically reconstructable` : undefined,
        notes: result.notes,
        config: configFile || undefined,
        hint: counts.error === 0 && counts.warning > 0
          ? 'what is left is about the UI5 version you target: fix it, raise min_ui5 if the system is newer, or accept it via allow'
          : counts.error === 0 && counts.hint > 0
            ? 'hints are advisory - an event without a handler is intended when the roundtrip alone is the point'
            : undefined,
      });
    }
    case 'build_backend': {
      // the build pipeline lives in samples-controls; the abap2UI5 checkout is
      // resolved (and clearly reported) by the build itself, which can also
      // bootstrap the in-repo .abap2UI5 clone on a full build
      const miss = missingSibling('samples-controls');
      if (miss) return miss;
      await stopBackend();
      const res = await buildBackend({ mode: args.mode || 'auto', onLine: progressReporter(ctx) });
      if (!res.ok) return toolError(`build failed (exit ${res.code}, mode ${res.mode || args.mode}):\n${res.tail}`);
      return text({ built: true, mode: res.mode, next: 'run_app { class_name } to boot and screenshot the app', tail: res.tail.split('\n').slice(-5).join('\n') });
    }
    case 'run_app': {
      // samples-controls serves the local @openui5 modules, abap2UI5 the backend
      const miss = missingSibling('samples-controls', 'abap2UI5');
      if (miss) return miss;
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
      if (action === 'start' || action === 'restart') {
        // status/stop work without any checkout; starting needs the backend
        const miss = missingSibling('abap2UI5');
        if (miss) return miss;
      }
      if (action === 'start') return text(await startBackend());
      if (action === 'stop') return text(await stopBackend());
      if (action === 'restart') {
        await stopBackend();
        return text(await startBackend());
      }
      return text(backendStatus());
    }
    case 'remove_app': {
      const miss = missingSibling('samples-controls');
      if (miss) return miss;
      if (!args.class_name) return text({ devApps: listDevApps() });
      const removed = removeApp(args.class_name);
      return text({ removed, note: removed ? 'run build_backend to update the served backend' : 'no such dev app' });
    }
    default:
      return toolError(`unknown tool: ${name}`);
  }
}

// the served version IS the package version — no hand-maintained copy to drift
const PKG = JSON.parse(fs.readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8'));

const server = new Server(
  { name: 'abap2ui5', version: PKG.version },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
  try {
    return await handle(req.params.name, req.params.arguments || {}, {
      progressToken: req.params._meta && req.params._meta.progressToken,
      sendNotification: extra && extra.sendNotification,
    });
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
console.error(`abap2ui5 MCP server ready (samples-controls: ${resolveSamplesControls()}, backend built: ${backendBuilt()})`);
