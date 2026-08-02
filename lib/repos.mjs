/*
 * repos — locate the sibling checkouts this server orchestrates.
 *
 * ai-mcp is the thin MCP layer; the machinery lives in:
 *   abap2UI5   the framework (transpiler config, express shim, node/output)
 *   ai-demokit the corpus (e2e-build, capabilities map, generation rules,
 *              the src/zz_dev deploy sandbox, @openui5 packages)
 *   abap2UI5-linter (optional) the view validation gates
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

export function resolveViewCheck() {
  // ai-view-check is the linter's pre-rename directory name
  return firstExisting(
    [
      process.env.AI_VIEW_CHECK_HOME,
      path.join(SERVER_ROOT, '..', 'abap2UI5-linter'),
      path.join(SERVER_ROOT, '..', 'ai-view-check'),
      '/home/user/abap2UI5-linter',
      '/home/user/ai-view-check',
    ],
    'lib/index.mjs',
  );
}
