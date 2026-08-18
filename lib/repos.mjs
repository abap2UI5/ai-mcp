/*
 * repos — locate the sibling checkouts this server orchestrates.
 *
 * ai-mcp is the thin MCP layer; the machinery lives in:
 *   abap2UI5        the framework (transpiler config, express shim, node/output)
 *   samples-controls the corpus (e2e-build, capabilities map, generation
 *                   rules, the src/zz_dev deploy sandbox, @openui5 packages)
 *   linter          (optional) the view validation gates (abap2UI5-linter)
 *
 * Resolution order per repo: an explicitly set env var is authoritative — it
 * must point at a real checkout, a wrong path resolves to null so the tool
 * reports the misconfiguration instead of silently using a sibling guess —
 * otherwise the sibling directory of this server is used. Returns null when
 * absent — each tool reports what is missing instead of failing the whole
 * server.
 *
 * Both sibling repositories have been RENAMED, and both renames are absorbed
 * here rather than left to break a working setup: a checkout made from an
 * older instruction keeps its directory name, and an env var somebody set
 * months ago keeps its name too. So each repo carries a list of directory
 * names (newest first) and a list of env vars (newest first), and an existing
 * install keeps working without being touched.
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

// explicit env var wins outright (even when it points nowhere); the sibling
// candidates are only guessed at when the user configured nothing
function resolveRepo(envVars, siblings, probe) {
  // the first env var that is SET decides, even if it points nowhere: that is
  // a misconfiguration to report, not a reason to fall through to a guess
  const explicit = [envVars].flat().map((v) => process.env[v]).find(Boolean);
  if (explicit) return firstExisting([explicit], probe);
  return firstExisting(siblings, probe);
}

/* Directory names the corpus checkout can carry, newest first. The repository
 * is github.com/abap2UI5/samples-controls today; it was `abap2UI5-api` before
 * that and `ai-demokit` before that. GitHub redirects the old paths, so a
 * clone made from an outdated README still sits in a directory named after
 * whichever name it was cloned under — all three resolve. */
export const CORPUS_DIRS = ['samples-controls', 'abap2UI5-api', 'ai-demokit'];

/** The corpus checkout: e2e-build, the capability map, the scope gate, the
 *  deploy sandbox and the @openui5 packages the render/boot path serves. */
export function resolveSamplesControls() {
  return resolveRepo(
    ['SAMPLES_CONTROLS_HOME', 'AI_DEMOKIT_HOME'],
    CORPUS_DIRS.map((d) => path.join(SERVER_ROOT, '..', d)),
    'scripts/e2e-build.mjs',
  );
}

export function resolveA2UI5() {
  const corpus = resolveSamplesControls();
  return resolveRepo(
    'A2UI5_HOME',
    [
      path.join(SERVER_ROOT, '..', 'abap2UI5'),
      // the in-repo clone the corpus' `npm run node:setup` creates — a
      // backend built there must be found here too
      corpus && path.join(corpus, '.abap2UI5'),
    ],
    'node/srv/express.mjs',
  );
}

/* The sample catalogue: 152 apps with what each one shows, which is what an
 * agent asking "is there already a sample for X" has to search. A different
 * repository from the corpus on purpose - samples-controls answers "which
 * CONTROL can I express" (416 ports of the UI5 demo kit), samples answers
 * "which PATTERN has somebody already built". Both questions come up while
 * building an app and neither answers the other. */
export const SAMPLES_DIRS = ['samples', 'abap2UI5-samples'];

export function resolveSamples() {
  return resolveRepo(
    'SAMPLES_HOME',
    SAMPLES_DIRS.map((d) => path.join(SERVER_ROOT, '..', d)),
    'SAMPLES.md',
  );
}

/* The third catalogue: apps that need something from the STACK - an OData
 * service, a RAP behavior definition, an APC channel, the Fiori launchpad.
 * They are a separate repository because they cannot be run on a bare
 * abap2UI5 install, which is exactly what an agent has to know before
 * proposing one. */
export const SAMPLES_STACK_DIRS = ['samples-stack', 'abap2UI5-samples-stack'];

export function resolveSamplesStack() {
  return resolveRepo(
    'SAMPLES_STACK_HOME',
    SAMPLES_STACK_DIRS.map((d) => path.join(SERVER_ROOT, '..', d)),
    'SAMPLES.md',
  );
}

/* The starter project. Not a catalogue and not a corpus: the files a new
 * repository begins with - both gate configs, the CI workflow, the abapGit
 * metadata and one working app class. An agent that has read the guide can
 * write the CLASS; what it cannot invent is the abaplint pin, the linter
 * config and the sidecar, and those are exactly what decides whether the
 * result imports into a system and passes a check. */
export const APP_TEMPLATE_DIRS = ['app-template', 'abap2UI5-app-template'];

export function resolveAppTemplate() {
  return resolveRepo(
    'APP_TEMPLATE_HOME',
    APP_TEMPLATE_DIRS.map((d) => path.join(SERVER_ROOT, '..', d)),
    'abaplint.jsonc',
  );
}

/* Directory names a linter checkout can carry, newest first: `linter` is the
 * repository's own name (github.com/abap2UI5/linter), the other two are what
 * `git clone` produced under its earlier names. The old names still resolve on
 * GitHub, so a checkout made from an outdated instruction is still found. */
export const VIEW_CHECK_DIRS = ['linter', 'abap2UI5-linter', 'ai-view-check'];

export function resolveViewCheck() {
  return resolveRepo(
    'AI_VIEW_CHECK_HOME',
    VIEW_CHECK_DIRS.map((d) => path.join(SERVER_ROOT, '..', d)),
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

/* Which project's abap2ui5lint.jsonc validate_view judges a source by.
 *
 * It used to be the corpus and only the corpus: an app in someone else's
 * repository was measured against samples-controls' rule overrides, allow
 * list and UI5 floor, and the tool had no argument to say otherwise — while
 * its own description promised the checked project's config was honoured.
 *
 * `find` is the linter's findConfigFrom (searches a directory upwards).
 * A named project is taken at its word: its config or none, never a silent
 * fallback onto a config the caller did not point at.
 */
export function resolveLintConfig(find, { projectDir, cwd, corpus } = {}) {
  if (projectDir) return find(projectDir) || null;
  return find(cwd) || (corpus ? find(corpus) : null) || null;
}
