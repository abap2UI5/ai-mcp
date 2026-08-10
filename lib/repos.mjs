/*
 * repos — locate the sibling checkouts this server orchestrates.
 *
 * ai-mcp is the thin MCP layer; the machinery lives in:
 *   abap2UI5   the framework (transpiler config, express shim, node/output)
 *   ai-demokit the corpus (e2e-build, capabilities map, generation rules,
 *              the src/zz_dev deploy sandbox, @openui5 packages)
 *   linter     (optional) the view validation gates (abap2UI5-linter)
 *
 * Resolution order per repo: explicit env var, then sibling directory of this
 * server. Returns null when absent — each tool reports what is missing
 * instead of failing the whole server.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

export const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function firstExisting(cands, probe) {
  for (const c of cands) {
    if (c && fs.existsSync(path.join(c, probe))) return path.resolve(c);
  }
  return null;
}

export function resolveAiDemokit() {
  return firstExisting(
    [process.env.AI_DEMOKIT_HOME, path.join(SERVER_ROOT, '..', 'ai-demokit')],
    'scripts/e2e-build.mjs',
  );
}

export function resolveA2UI5() {
  const demokit = resolveAiDemokit();
  return firstExisting(
    [
      process.env.A2UI5_HOME,
      path.join(SERVER_ROOT, '..', 'abap2UI5'),
      // the in-repo clone ai-demokit's `npm run node:setup` creates — a
      // backend built there must be found here too
      demokit && path.join(demokit, '.abap2UI5'),
    ],
    'node/srv/express.mjs',
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
    ],
    'package.json',
  );
}

/* Import a module from the linter checkout through its package.json `exports`
 * map — the only file-layout contract the linter maintains. Reaching for
 * lib/<file>.mjs directly would couple this server to an internal layout that
 * a refactor may change while the linter's own tests stay green. */
export async function importViewCheck(sub = '.') {
  const vc = resolveViewCheck();
  if (!vc) return null;
  const pkg = JSON.parse(fs.readFileSync(path.join(vc, 'package.json'), 'utf8'));
  const entry = (pkg.exports || {})[sub];
  // an export target is either a plain path or a conditional-exports object
  // ({ types, import, default, ... }) — resolve it the way Node would
  const target =
    typeof entry === 'string' ? entry : entry && (entry.import ?? entry.node ?? entry.default);
  if (typeof target !== 'string') {
    throw new Error(`linter checkout at ${vc} does not export '${sub}' — update the checkout (git pull)`);
  }
  return import(pathToFileURL(path.join(vc, target)).href);
}
