/*
 * repos — locate the sibling checkouts this server orchestrates.
 *
 * ai-mcp is the thin MCP layer; the machinery lives in:
 *   abap2UI5   the framework (transpiler config, express shim, node/output)
 *   ai-demokit the corpus (e2e-build, capabilities map, generation rules,
 *              the src/zz_dev deploy sandbox, @openui5 packages)
 *   linter     (optional) the view validation gates (abap2UI5-linter)
 *
 * Resolution order per repo: explicit env var, sibling directory, known
 * sandbox default. Returns null when absent — each tool reports what is
 * missing instead of failing the whole server.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function firstExisting(cands, probe) {
  for (const c of cands) {
    if (c && fs.existsSync(path.join(c, probe))) return path.resolve(c);
  }
  return null;
}

export function resolveA2UI5() {
  return firstExisting(
    [process.env.A2UI5_HOME, path.join(SERVER_ROOT, '..', 'abap2UI5'), '/home/user/abap2UI5'],
    'node/srv/express.mjs',
  );
}

export function resolveAiDemokit() {
  return firstExisting(
    [process.env.AI_DEMOKIT_HOME, path.join(SERVER_ROOT, '..', 'ai-demokit'), '/home/user/ai-demokit'],
    'scripts/e2e-build.mjs',
  );
}

/* Directory names a linter checkout can carry, newest first: `linter` is the
 * repository's own name (github.com/abap2UI5/linter), the other two are what
 * `git clone` produced under its earlier names. The old names still resolve on
 * GitHub, so a checkout made from an outdated instruction is still found. */
export const VIEW_CHECK_DIRS = ['linter', 'abap2UI5-linter', 'ai-view-check'];

export function resolveViewCheck() {
  return firstExisting(
    [
      process.env.AI_VIEW_CHECK_HOME,
      ...VIEW_CHECK_DIRS.map((d) => path.join(SERVER_ROOT, '..', d)),
      ...VIEW_CHECK_DIRS.map((d) => `/home/user/${d}`),
    ],
    'lib/index.mjs',
  );
}
