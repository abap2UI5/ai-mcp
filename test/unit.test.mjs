// Sibling-free unit tests (node --test): every unit here runs without the
// ai-demokit / abap2UI5 / linter checkouts. The stdio smoke lives in
// test/smoke.test.mjs and DOES need the siblings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stripJsonc, BENIGN, deployApp, removeApp } from '../lib/runtime.mjs';
import { parseCapabilities, searchCapabilities } from '../lib/capabilities.mjs';
import { parseExamples, searchExamples } from '../lib/examples.mjs';
import { CORPUS_DIRS, resolveLintConfig } from '../lib/repos.mjs';
import { sliceCatalogue } from '../lib/pitfalls.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------ stripJsonc ----
test('stripJsonc counts characters the way it measured them', () => {
  // the offsets of the trailing commas come from out.length (UTF-16 code
  // units); dropping them by code POINT shifts every index after the first
  // astral character, so an emoji anywhere before a trailing comma used to
  // delete the wrong one and leave unparseable JSON behind
  const jsonc = '{ "a": "\u{1F389}", "b": [1,2,], }';
  const out = stripJsonc(jsonc);
  assert.deepEqual(JSON.parse(out), { a: '\u{1F389}', b: [1, 2] });
});


test('stripJsonc removes line and block comments but keeps strings intact', () => {
  const jsonc = `{
  // line comment
  "a": "value with // no comment",
  /* block
     comment */
  "b": ["x", "y"], // trailing
  "url": "https://example.com/path"
}`;
  const parsed = JSON.parse(stripJsonc(jsonc));
  assert.equal(parsed.a, 'value with // no comment');
  assert.deepEqual(parsed.b, ['x', 'y']);
  assert.equal(parsed.url, 'https://example.com/path');
});

test('stripJsonc tolerates trailing commas', () => {
  const parsed = JSON.parse(stripJsonc('{ "a": [1, 2,], "b": { "c": 1, }, }'));
  assert.deepEqual(parsed.a, [1, 2]);
  assert.equal(parsed.b.c, 1);
});

/* Trailing-comma removal must tell punctuation from text. It used to be a
 * regex over the finished output, which also rewrote string CONTENT: an
 * abaplint exclude pattern `app[,]x` came out as `app[]x` - a character class
 * that matches nothing, so the exclusion silently stopped excluding. */
test('stripJsonc leaves a comma inside a string alone', () => {
  assert.equal(JSON.parse(stripJsonc('{ "exclude": ["src/app[,]x"], }')).exclude[0], 'src/app[,]x');
  assert.equal(JSON.parse(stripJsonc('{ "a": "foo, } bar" }')).a, 'foo, } bar');
});

// -------------------------------------------------- CAPABILITIES.md parser ----

// marks built from code points so this source stays 7-bit ASCII (repo rule)
const OK = String.fromCodePoint(0x2705);
const PART = String.fromCodePoint(0x1f536);
const NO = String.fromCodePoint(0x274c);
const CAPS_FIXTURE = [
  '# CAPABILITIES',
  '',
  '## Views & controls',
  '',
  '| UI5 feature | Status | How | Evidence |',
  '|---|---|---|---|',
  `| Plain controls | ${OK} works | open/leaf/a chains | app 051 |`,
  `| Escaped pipe \\| in cell | ${PART} partial | see notes | app 007 |`,
  `| Frontend factories | ${NO} not expressible | no equivalent | - |`,
  '',
  '## Popups & messages',
  '',
  '| UI5 feature | Status | How | Evidence |',
  '|---|---|---|---|',
  `| Dialogs | ${OK} works | popup_display | app 044 |`,
  '',
].join('\n');

test('parseCapabilities reads sections, statuses and escaped pipes from a table', () => {
  const entries = parseCapabilities(CAPS_FIXTURE);
  assert.equal(entries.length, 4);
  assert.equal(entries[0].section, 'Views & controls');
  assert.equal(entries[0].status, 'direct');
  assert.equal(entries[1].feature, 'Escaped pipe | in cell');
  assert.equal(entries[1].status, 'workaround');
  assert.equal(entries[2].status, 'not-expressible');
  assert.equal(entries[3].section, 'Popups & messages');
});

test('searchCapabilities filters by status and by AND-ed query terms', () => {
  const works = searchCapabilities({ status: 'direct', rawText: CAPS_FIXTURE });
  assert.deepEqual(works.map((e) => e.feature), ['Plain controls', 'Dialogs']);
  const hit = searchCapabilities({ query: 'popup dialog', rawText: CAPS_FIXTURE });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].feature, 'Dialogs');
  assert.equal(searchCapabilities({ query: 'nonexistent thing', rawText: CAPS_FIXTURE }).length, 0);
});

/* Both documents are parsed LIVE on every query - that is the whole design
 * (no generated artifact that can drift), and it means the server re-reads
 * whatever the checkout happens to contain right now: mid-edit, mid-merge,
 * half-pulled. A throw there is not a wrong answer, it is a dead tool, so
 * neither parser may throw on anything.
 *
 * Measured before pinning: 1,144 calls over the real CAPABILITIES.md and the
 * abap-check catalogue - 60 truncations each, 400 seeded mutations
 * (pipes, backticks, headings, rule lines inserted / runs deleted /
 * duplicated) and degenerate inputs - threw nothing. Those need the sibling
 * checkouts; this fixture-scale guard is what runs sibling-free. */
test('the live parsers report, never throw, on a damaged document', () => {
  const POISON = ['|', '\\|', '\n', '`', '#', '##', '---', '|---|', '', ' ', '\\', '"'];
  for (let i = 0; i <= 40; i++) {
    const capCut = CAPS_FIXTURE.slice(0, Math.floor((CAPS_FIXTURE.length * i) / 40));
    const catCut = CATALOGUE.slice(0, Math.floor((CATALOGUE.length * i) / 40));
    assert.doesNotThrow(() => parseCapabilities(capCut), `parseCapabilities threw on a ${i}/40 truncation`);
    assert.doesNotThrow(() => searchCapabilities({ query: 'a b', status: 'direct', rawText: capCut }),
      `searchCapabilities threw on a ${i}/40 truncation`);
    assert.doesNotThrow(() => sliceCatalogue(catCut, 'icon'), `sliceCatalogue threw on a ${i}/40 truncation`);
  }
  POISON.forEach((p, i) => {
    const at = Math.floor((CAPS_FIXTURE.length * (i + 1)) / (POISON.length + 1));
    assert.doesNotThrow(() => parseCapabilities(CAPS_FIXTURE.slice(0, at) + p + CAPS_FIXTURE.slice(at)),
      `parseCapabilities threw on ${JSON.stringify(p)} at ${at}`);
    assert.doesNotThrow(() => sliceCatalogue(CATALOGUE.slice(0, at) + p + CATALOGUE.slice(at)),
      `sliceCatalogue threw on ${JSON.stringify(p)} at ${at}`);
  });
  for (const bad of ['', '\n', '|', '|||', '# x', '## ', '---\n---\n', '|a|b|c|d|']) {
    assert.doesNotThrow(() => parseCapabilities(bad), `parseCapabilities threw on ${JSON.stringify(bad)}`);
    assert.doesNotThrow(() => sliceCatalogue(bad), `sliceCatalogue threw on ${JSON.stringify(bad)}`);
  }
});

// ------------------------------------------------- deployApp validation ----
// The validation gate runs BEFORE any sibling checkout is touched, so the
// error paths are sibling-free. (The happy path writes into ai-demokit and
// is covered by the stdio smoke instead.)

test('deployApp rejects a class name outside the z2ui5_cl_ namespace', () => {
  assert.throws(
    () => deployApp({ className: 'zcl_my_app', source: 'x' }),
    /invalid class name/,
  );
});

test('deployApp rejects an over-long class name', () => {
  assert.throws(
    () => deployApp({ className: 'z2ui5_cl_' + 'a'.repeat(30), source: 'x' }),
    /invalid class name/,
  );
});

test('deployApp rejects source without z2ui5_if_app', () => {
  assert.throws(
    () => deployApp({ className: 'z2ui5_cl_demo', source: 'CLASS z2ui5_cl_demo DEFINITION.' }),
    /does not implement z2ui5_if_app/,
  );
});

test('deployApp rejects a class-name/source mismatch', () => {
  assert.throws(
    () =>
      deployApp({
        className: 'z2ui5_cl_demo',
        source: 'CLASS z2ui5_cl_other DEFINITION. INTERFACES z2ui5_if_app.',
      }),
    /does not define CLASS z2ui5_cl_demo DEFINITION/,
  );
});

// ------------------------------------------------- removeApp validation ----
// remove_app unlinks by name, so it validates the SAME way deploy does. A name
// carrying path separators must never reach the filesystem: it would resolve
// out of the src/zz_dev sandbox and delete real corpus sources. Rejection here
// is what makes that unreachable, so it is asserted rather than assumed.

test('removeApp rejects a name that would escape the dev sandbox', () => {
  assert.throws(
    () => removeApp('../../src/01/z2ui5_cl_smpc_app_001'),
    /invalid class name/,
  );
});

test('removeApp rejects the same names deployApp does', () => {
  for (const bad of ['zcl_my_app', 'z2ui5_cl_' + 'a'.repeat(30), '', 'z2ui5_cl_a/b']) {
    assert.throws(() => removeApp(bad), /invalid class name/, `expected rejection for '${bad}'`);
  }
});

// ------------------------------------------------------- BENIGN filter ----

test('BENIGN patterns match known console noise and not real errors', () => {
  const noise = BENIGN.some((re) => re.test('Failed to load resource: favicon.ico 404'));
  const real = BENIGN.some((re) => re.test("TypeError: Cannot read properties of undefined (reading 'getModel')"));
  assert.equal(noise, true); // known console noise is filtered
  assert.equal(real, false); // a real JS error is never swallowed
});

// ----------------------------------------------------------- repo naming ----

/* The corpus repository has been renamed twice — ai-demokit -> abap2UI5-api ->
 * samples-controls — and the linter once. Neither rename may break a working
 * install: a checkout sits in a directory named after whatever it was cloned
 * as, and an env var somebody set months ago keeps its name. Both lists are
 * newest-first, and the current name has to be the one a fresh setup gets. */
test('the corpus resolves under its current name and both former ones', () => {
  assert.equal(CORPUS_DIRS[0], 'samples-controls', 'a fresh clone must resolve first');
  for (const legacy of ['abap2UI5-api', 'ai-demokit']) {
    assert.ok(CORPUS_DIRS.includes(legacy), `${legacy} was a real directory name and must still resolve`);
  }
});

test('a corpus checkout is found through its directory name', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui5-repos-'));
  try {
    for (const dir of CORPUS_DIRS) {
      const home = path.join(base, dir);
      fs.mkdirSync(path.join(home, 'scripts'), { recursive: true });
      // the probe file resolveSamplesControls looks for
      fs.writeFileSync(path.join(home, 'scripts', 'e2e-build.mjs'), '');
      const found = execFileSync(process.execPath, ['-e',
        "import('./lib/repos.mjs').then(m => process.stdout.write(String(m.resolveSamplesControls())))"],
      { cwd: ROOT, env: { ...process.env, SAMPLES_CONTROLS_HOME: home }, encoding: 'utf8' });
      assert.equal(found, home, `${dir} must resolve when pointed at explicitly`);
      fs.rmSync(home, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('the former env var still points the server at the corpus', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui5-legacyenv-'));
  try {
    fs.mkdirSync(path.join(home, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(home, 'scripts', 'e2e-build.mjs'), '');
    const found = execFileSync(process.execPath, ['-e',
      "import('./lib/repos.mjs').then(m => process.stdout.write(String(m.resolveSamplesControls())))"],
    { cwd: ROOT, env: { ...process.env, SAMPLES_CONTROLS_HOME: '', AI_DEMOKIT_HOME: home }, encoding: 'utf8' });
    assert.equal(found, home, 'AI_DEMOKIT_HOME must keep working — it is in existing MCP client configs');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------- pitfalls ----

/* The two catalogues are markdown maintained in the abap2UI5 repo, so what is
 * testable here is the slicing, not the content: sections stay whole (a case
 * without its evidence and its fix is worth nothing), and a query narrows to
 * the sections that carry every term. */
const CATALOGUE = `---
name: ui5-check
description: front matter the agent should never see
---

# What a green CI does not prove

The floor is OpenUI5 1.71.

## 1. Names the target release does not have

An unknown sap-icon:// name renders nothing and logs nothing.

## 2. Layout that only works from a newer release on

ToolbarSpacer inside a sap.m.Bar deletes every sibling after it.
`;

test('pitfalls: the front matter is stripped and the preamble survives as a section', () => {
  const secs = sliceCatalogue(CATALOGUE);
  assert.ok(!JSON.stringify(secs).includes('front matter the agent should never see'),
    'skill front matter is plumbing, not content');
  assert.equal(secs[0].heading, '(preamble)');
  assert.match(secs[0].body, /floor is OpenUI5 1\.71/, 'the preamble says how to read the rest — keep it');
});

test('pitfalls: a query narrows to whole sections that carry every term', () => {
  const secs = sliceCatalogue(CATALOGUE, 'icon');
  assert.equal(secs.length, 1);
  assert.match(secs[0].heading, /^1\. Names/);
  assert.match(secs[0].body, /renders nothing and logs nothing/, 'the section comes back WHOLE');
  assert.equal(sliceCatalogue(CATALOGUE, 'toolbar bar').length, 1, 'both terms must match, in any order');
  assert.equal(sliceCatalogue(CATALOGUE, 'icon toolbar').length, 0,
    'terms from two different sections match neither');
});

// ----------------------------------------------------- resolveLintConfig ----

/* A stand-in for the linter's findConfigFrom: answers for the directories the
 * fake tree has a config in, null everywhere else. */
const finder = (...withConfig) => (dir) => (withConfig.includes(dir) ? `${dir}/abap2ui5lint.jsonc` : null);

test('a named project decides which config validate_view uses', () => {
  const find = finder('/home/me/app', '/cwd', '/corpus');
  assert.equal(
    resolveLintConfig(find, { projectDir: '/home/me/app', cwd: '/cwd', corpus: '/corpus' }),
    '/home/me/app/abap2ui5lint.jsonc',
  );
});

test('a named project without a config gets defaults, not the corpus config', () => {
  // the regression this argument exists for: an app in someone else's
  // repository was judged by samples-controls' rules with no way to say no
  const find = finder('/corpus', '/cwd');
  assert.equal(
    resolveLintConfig(find, { projectDir: '/home/me/app', cwd: '/cwd', corpus: '/corpus' }),
    null,
    'the caller pointed somewhere - a config from elsewhere is not an answer',
  );
});

test('unnamed falls back to the working directory before the corpus', () => {
  const find = finder('/cwd', '/corpus');
  assert.equal(
    resolveLintConfig(find, { cwd: '/cwd', corpus: '/corpus' }),
    '/cwd/abap2ui5lint.jsonc',
  );
});

test('the corpus config still applies when nothing else has one', () => {
  // porting inside samples-controls keeps working exactly as before
  const find = finder('/corpus');
  assert.equal(
    resolveLintConfig(find, { cwd: '/somewhere/else', corpus: '/corpus' }),
    '/corpus/abap2ui5lint.jsonc',
  );
});

test('no config anywhere is null, not a throw', () => {
  assert.equal(resolveLintConfig(finder(), { cwd: '/x' }), null);
});

/* The sample catalogue as a query surface. Parsed from a literal here rather
 * than from the checkout, so the shape SAMPLES.md promises is asserted even
 * where the sibling repository is not present. */
const SAMPLES_MD = [
  '# The sample catalogue',
  '',
  '## Basics',
  '',
  '| Sample | Class |',
  '|---|---|',
  '| **Basics I** — Hello World, the Smallest App<br><sub>hello world minimal start here</sub> | [`Z2UI5_CL_SMP_APP_493`](src/01/z2ui5_cl_smp_app_493.clas.abap) |',
  '',
  '## Popup',
  '',
  '| Sample | Class |',
  '|---|---|',
  '| Value Help: Suggestions and F4 Dialog<br><sub>f4 search help suggestion input</sub> | [`Z2UI5_CL_SMP_APP_009`](src/01/z2ui5_cl_smp_app_009.clas.abap) |',
  '| Navigation — app state<br><sub>bookmark restore url</sub> | [`Z2UI5_CL_SMP_APP_321`](src/00/97/z2ui5_cl_smp_app_321.clas.abap) |',
].join('\n');

test('the sample catalogue parses into pointers, with and without a row header', () => {
  const all = parseExamples(SAMPLES_MD);
  assert.equal(all.length, 3);

  const basics = all.find((e) => e.cls === 'Z2UI5_CL_SMP_APP_493');
  assert.equal(basics.title, 'Basics I');
  assert.equal(basics.sub, 'Hello World, the Smallest App');
  assert.equal(basics.label, 'Basics I — Hello World, the Smallest App');
  assert.equal(basics.path, 'src/01/z2ui5_cl_smp_app_493.clas.abap');
  assert.equal(basics.area, 'samples');

  /* generate-samples-md drops a header that would repeat its section, so this
   * row has none. `title` then falls back to the section, which reads wrong on
   * its own ("Popup") - the LABEL must not inherit that fallback, or every
   * such sample would be announced by its section instead of by what it does. */
  const f4 = all.find((e) => e.cls === 'Z2UI5_CL_SMP_APP_009');
  assert.equal(f4.title, 'Popup');
  assert.equal(f4.label, 'Value Help: Suggestions and F4 Dialog');

  // src/00 is experimental or a test app: readable, not to be copied wholesale
  assert.equal(all.find((e) => e.cls === 'Z2UI5_CL_SMP_APP_321').area, 'experimental-or-test');
});

test('searching the catalogue narrows on every term and ranks a keyword hit first', () => {
  const q = (query, opts = {}) => searchExamples({ query, rawText: SAMPLES_MD, ...opts }).map((e) => e.cls);

  assert.deepEqual(q('f4 search'), ['Z2UI5_CL_SMP_APP_009']);
  // AND, not OR: a second term that matches nothing removes the hit
  assert.deepEqual(q('f4 tree'), []);

  /* "help" is in app 009's keywords and in nothing else; "popup" is the
   * SECTION both share. Ranked, so the one that chose the word comes first -
   * and the weaker match is still returned, because it may be the only one. */
  const both = q('popup');
  assert.equal(both.length, 2);

  assert.deepEqual(q('bookmark', { area: 'samples' }), []);
  assert.deepEqual(q('bookmark', { area: 'experimental-or-test' }), ['Z2UI5_CL_SMP_APP_321']);
});
