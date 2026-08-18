// Sibling-free unit tests (node --test): every unit here runs without the
// ai-demokit / abap2UI5 / linter checkouts. The stdio smoke lives in
// test/smoke.test.mjs and DOES need the siblings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stripJsonc, BENIGN, deployApp, removeApp } from '../lib/runtime.mjs';
import { parseCapabilities, searchCapabilities } from '../lib/capabilities.mjs';
import { parseExamples, searchExamples, CATALOGUES } from '../lib/examples.mjs';
import { CORPUS_DIRS, resolveLintConfig } from '../lib/repos.mjs';
import { sliceCatalogue } from '../lib/pitfalls.mjs';
import { sliceGuide, guideChapters } from '../lib/guide.mjs';
import { parseSizes } from '../lib/screenshot.mjs';
import { scaffold, validClassName, templateFiles, readSpec } from '../lib/scaffold.mjs';
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

test('deployApp rejects a class name outside the customer namespace', () => {
  for (const bad of ['acl_my_app', 'cl_my_app', 'my_app', '1cl_app', '']) {
    assert.throws(
      () => deployApp({ className: bad, source: 'x' }),
      /invalid class name/,
      `expected rejection for '${bad}'`,
    );
  }
});

/* The namespace this accepts is the CUSTOMER namespace, not the corpus' port
 * convention. It was `^z2ui5_cl_`, which is what the demo-kit ports are called
 * - and this server exists for an agent building its own app. abap2UI5's own
 * app-template ships `zcl_app_001`, so the recommended starting point was the
 * one name every tool here refused. */
test('deployApp accepts the customer-namespace names a user app actually has', () => {
  const source = (cls) => `CLASS ${cls} DEFINITION. INTERFACES z2ui5_if_app. ENDCLASS.`;
  for (const good of ['zcl_app_001', 'ycl_app', 'z2ui5_cl_my_app', 'zcx_error']) {
    // it gets past validation - what stops it here is the missing corpus
    // checkout it would write into, which is a different error entirely
    assert.doesNotThrow(
      () => { try { deployApp({ className: good, source: source(good) }); } catch (e) {
        if (/invalid class name/.test(e.message)) throw e;
      } },
      `expected '${good}' to pass the name gate`,
    );
  }
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
  for (const bad of ['acl_my_app', 'z2ui5_cl_' + 'a'.repeat(30), '', 'z2ui5_cl_a/b', 'zcl_a.b', 'zcl_a\\b', 'zcl a']) {
    assert.throws(() => removeApp(bad), /invalid class name/, `expected rejection for '${bad}'`);
  }
});

/* Widening the namespace must not widen what can be WRITTEN. Every one of
 * these is a name whose only purpose is to leave src/zz_dev, and each has to
 * die in the name gate rather than in path.join. */
test('a wider namespace is still no way out of the dev sandbox', () => {
  for (const escape of [
    '../../src/01/z2ui5_cl_smpc_app_001',
    'z2ui5_cl_x/../../../etc/passwd',
    '/etc/passwd',
    'zcl_app/../../x',
    'zcl_app .clas',
  ]) {
    assert.throws(() => deployApp({ className: escape, source: 'x' }), /invalid class name/, `deploy '${escape}'`);
    assert.throws(() => removeApp(escape), /invalid class name/, `remove '${escape}'`);
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
  '| Value Help: Suggestions and F4 Dialog<br><sub>f4 search help suggestion input</sub><br><sub>docs: [cookbook/expert_more/value_help](https://abap2ui5.github.io/docs/cookbook/expert_more/value_help)</sub> | [`Z2UI5_CL_SMP_APP_009`](src/01/z2ui5_cl_smp_app_009.clas.abap) |',
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

/* The catalogue is generated over in abap2UI5/samples and grew a second block of
 * small type - the `@docs` chapter links - under the keywords. A parser that
 * expected exactly one would match no rows at all, and the failure mode is the
 * quiet one: `examples` would answer "nothing found" for every query instead of
 * raising anything. */
test('a row keeps parsing when the catalogue adds another block of small type', () => {
  const f4 = parseExamples(SAMPLES_MD).find((e) => e.cls === 'Z2UI5_CL_SMP_APP_009');
  assert.equal(f4.label, 'Value Help: Suggestions and F4 Dialog');
  // and the docs link is not mistaken for a search term
  assert.equal(f4.keywords, 'f4 search help suggestion input');
  assert.equal(searchExamples({ query: 'f4', rawText: SAMPLES_MD }).length, 1);
  assert.equal(searchExamples({ query: 'cookbook', rawText: SAMPLES_MD }).length, 0);
});

/* The catalogues grew a SECOND kind of block under the title - the summary
 * sentence, in normal type rather than in <sub> - and the parser has to keep
 * the two apart. Mistaking the sentence for the search terms would rank every
 * sample by prose it did not choose to be found by; mistaking the terms for
 * the sentence would put "f4 search help suggestion input" where a human reads
 * a description. */
const SAMPLES_MD_WITH_SUMMARY = [
  '## Popup',
  '',
  '| Sample | Class |',
  '|---|---|',
  '| Value Help: Suggestions and F4 Dialog<br>The value help, both halves: suggestions while typing and the F4 dialog behind the field.<br><sub>f4 search help suggestion input</sub><br><sub>docs: [cookbook/expert_more/value_help](https://abap2ui5.github.io/docs/cookbook/expert_more/value_help)</sub> | [`Z2UI5_CL_SMP_APP_009`](src/01/z2ui5_cl_smp_app_009.clas.abap) |',
].join('\n');

test('the summary sentence and the search terms are told apart', () => {
  const [e] = parseExamples(SAMPLES_MD_WITH_SUMMARY);
  assert.equal(e.summary, 'The value help, both halves: suggestions while typing and the F4 dialog behind the field.');
  assert.equal(e.keywords, 'f4 search help suggestion input');
  assert.equal(e.label, 'Value Help: Suggestions and F4 Dialog');

  // the sentence is searchable, and a hit in it ranks BELOW a keyword hit
  assert.equal(searchExamples({ query: 'typing', rawText: SAMPLES_MD_WITH_SUMMARY }).length, 1);
  // the docs block is still not a search term
  assert.equal(searchExamples({ query: 'cookbook', rawText: SAMPLES_MD_WITH_SUMMARY }).length, 0);
});

/* A row that has NO summary yet must keep parsing: the three repositories add
 * the line at their own pace, and a parser that required it would answer
 * "nothing found" for a whole catalogue rather than fail loudly. */
test('a row without a summary still parses', () => {
  const e = parseExamples(SAMPLES_MD).find((x) => x.cls === 'Z2UI5_CL_SMP_APP_009');
  assert.equal(e.summary, '');
  assert.equal(e.keywords, 'f4 search help suggestion input');
});

/* The row shape is maintained in three OTHER repositories, and a new kind of
 * block has twice made every row unmatchable here. A block whose tag this
 * parser has never seen must cost it nothing - the sample still has to be
 * findable, because "no rows parsed" reads as "there are no samples for that"
 * rather than as a parse error. */
test('a row survives a block this parser has never seen', () => {
  const md = [
    '## Basics',
    '',
    '| Sample | Class |',
    '|---|---|',
    '| **Future** — Something<br>The sentence.<br><span>a block from a later generator</span><br><sub>terms here</sub> | [`Z2UI5_CL_SMP_APP_999`](src/01/z2ui5_cl_smp_app_999.clas.abap) |',
  ].join('\n');
  const [e] = parseExamples(md);
  assert.ok(e, 'the row with an unknown block was dropped');
  assert.equal(e.cls, 'Z2UI5_CL_SMP_APP_999');
  // and the two blocks this parser DOES read are still told apart correctly
  assert.equal(e.summary, 'The sentence.');
  assert.equal(e.keywords, 'terms here');
});

test('every catalogue names its repository and its env var when it is missing', () => {
  assert.deepEqual(CATALOGUES.map((c) => c.repo), ['samples', 'samples-controls', 'samples-stack']);
  for (const c of CATALOGUES) {
    assert.match(c.url, /^https:\/\/github\.com\/abap2UI5\//);
    assert.match(c.env, /_HOME$/);
  }
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

/* The `docs:` block is a per-sample list of the cookbook chapters somebody
 * decided that app is the worked example of - and this parser knew it only
 * well enough to SKIP it while looking for the keywords. So the agent got a
 * class to read and no way to reach the prose explaining what it demonstrates,
 * which is the half a human reviewer opens first. */
test('the docs links reach the caller instead of being skipped', () => {
  const [e] = parseExamples(SAMPLES_MD_WITH_SUMMARY);
  assert.deepEqual(e.docs, [{
    topic: 'cookbook/expert_more/value_help',
    url: 'https://abap2ui5.github.io/docs/cookbook/expert_more/value_help',
  }]);
  // several links in one block, as `samples` writes them
  const md = SAMPLES_MD_WITH_SUMMARY.replace(
    '<sub>docs: [cookbook/expert_more/value_help](https://abap2ui5.github.io/docs/cookbook/expert_more/value_help)</sub>',
    '<sub>docs: [a/b](https://x/a/b), [c/d](https://x/c/d)</sub>',
  );
  assert.deepEqual(parseExamples(md)[0].docs.map((d) => d.topic), ['a/b', 'c/d']);
  // a row without the block says so with an empty list, never undefined
  assert.deepEqual(parseExamples(SAMPLES_MD).find((x) => x.cls === 'Z2UI5_CL_SMP_APP_321').docs, []);
});

/* samples-controls writes the whole row header in bold with nothing after it,
 * and the row pattern required a dash after the bold half. So 430 of the 614
 * apps - the entire demo-kit catalogue - parsed as rows with NO header of their
 * own: `title` fell back to the section, and every port announced itself as the
 * LIBRARY it belongs to ("sap.m", 109 times over) while the control an agent
 * asked for survived only inside the keyword blob. */
test('a bold row header without a dash after it is still the title', () => {
  const md = [
    '### sap.m',
    '',
    '| Sample | Class |',
    '|---|---|',
    '| **sap.m.Bar**<br>Each screen is typically a Page with a header.<br><sub>bar sap.m header</sub> | [`Z2UI5_CL_SMPC_APP_002`](src/01/01/z2ui5_cl_smpc_app_002.clas.abap) |',
  ].join('\n');
  const [e] = parseExamples(md, 'samples-controls');
  assert.equal(e.title, 'sap.m.Bar');
  assert.equal(e.label, 'sap.m.Bar', 'the label must name the control, not the library');
  assert.equal(e.sub, '', 'nothing follows the header, so there is no sub-title - and no stray asterisks');
  assert.equal(e.section, 'sap.m');
  assert.equal(e.summary, 'Each screen is typically a Page with a header.');

  // and the dashed shape the other two catalogues use is untouched
  const [dashed] = parseExamples(SAMPLES_MD_WITH_SUMMARY);
  assert.equal(dashed.label, 'Value Help: Suggestions and F4 Dialog');
});

// --------------------------------------------------------------- guide ----
/* The app-building guide, sliced by chapter the way the pitfalls catalogues
 * are. The document itself lives in the abap2UI5 checkout; the slicing does
 * not need it. */

const GUIDE_MD = [
  '# Building apps with abap2UI5 — the agent guide',
  '',
  'Self-contained reference. When this guide and the code disagree, the code wins.',
  '',
  '## 1. The model in one paragraph',
  '',
  'An abap2UI5 app is one ABAP class implementing z2ui5_if_app.',
  '',
  '## 5. Events',
  '',
  'Register a named event and read it back on the next roundtrip.',
  '',
  '## 6. Popups, popovers, messages',
  '',
  'A popup is a second view displayed into the popup slot.',
].join('\n');

test('the guide keeps its intro as a section of its own', () => {
  const sections = sliceGuide(GUIDE_MD);
  assert.equal(sections.length, 4);
  assert.equal(sections[0].heading, '(intro)');
  assert.match(sections[0].body, /the code wins/, 'the "how to read this" half must survive');
  assert.deepEqual(guideChapters(GUIDE_MD).slice(1), ['1. The model in one paragraph', '5. Events', '6. Popups, popovers, messages']);
});

/* A chapter can be asked for by number or by a word in its heading. A NUMBER
 * has to mean the chapter number and nothing else: falling through to a
 * substring match made `section: "5"` also return the view-builder chapter,
 * whose heading carries `z2ui5_cl_ui5_view_builder`. A digit is a terrible
 * needle in a document about a framework with one in its name. */
test('a chapter can be asked for by number or by name, and a number means the number', () => {
  assert.deepEqual(sliceGuide(GUIDE_MD, { section: '5' }).map((s) => s.heading), ['5. Events']);
  assert.deepEqual(sliceGuide(GUIDE_MD, { section: 'events' }).map((s) => s.heading), ['5. Events']);
  assert.deepEqual(sliceGuide(GUIDE_MD, { section: 'popup' }).map((s) => s.heading), ['6. Popups, popovers, messages']);
  assert.deepEqual(sliceGuide(GUIDE_MD, { section: 'nope' }), []);
});

test('a guide query narrows to whole chapters that carry every term', () => {
  assert.deepEqual(sliceGuide(GUIDE_MD, { query: 'roundtrip' }).map((s) => s.heading), ['5. Events']);
  // AND, like every other search here
  assert.deepEqual(sliceGuide(GUIDE_MD, { query: 'roundtrip popup' }), []);
});

// ---------------------------------------------------------- screenshot ----
/* The viewport list screenshot_view takes. Refused rather than guessed at: a
 * size that quietly fell back to the default would return a picture of the
 * wrong viewport, and the viewport is the question being asked. */
test('a viewport is parsed, or refused by name', () => {
  assert.deepEqual(parseSizes(['390x844', '1280x900']), [
    { width: 390, height: 844 }, { width: 1280, height: 900 },
  ]);
  assert.equal(parseSizes([]), undefined, 'no sizes means the default, not an empty list');
  assert.equal(parseSizes(undefined), undefined);
  for (const bad of ['huge', '390', '390*844', '390x', 'x844', '390x844px']) {
    assert.throws(() => parseSizes([bad]), /invalid size/, `expected rejection for '${bad}'`);
  }
});

// ----------------------------------------------------------- scaffold ----
/* The class name is substituted into the sidecar's CLSNAME and into file
 * names, so it is validated before it is used. An object whose ABAP and whose
 * CLSNAME disagree looks right and does not activate - which is why
 * app-template ships a rename script rather than an instruction. */
test('a scaffold class name is an ABAP class name, or it is refused', () => {
  for (const ok of ['zcl_my_app', 'ycl_app', 'zcx_error', 'zcl_a1_b2']) {
    assert.equal(validClassName(ok), true, ok);
  }
  for (const bad of ['', 'zcl_', 'cl_my_app', 'zcl-my-app', '../etc/passwd',
    'zcl_app/../../x', 'zcl_my app', 'zcl_' + 'x'.repeat(30)]) {
    assert.equal(validClassName(bad), false, "expected refusal for '" + bad + "'");
  }
});

test('scaffolding renames the class in the ABAP, the sidecar and the file name', (t) => {
  const root = path.join(ROOT, '..', 'app-template');
  if (!fs.existsSync(path.join(root, 'abaplint.jsonc'))) {
    t.skip('app-template sibling not found');
    return;
  }
  const { files, missing } = scaffold(root, {
    cls: 'zcl_invoice_app', packageText: 'Invoice App', repo: 'invoice-app',
  });
  assert.deepEqual(missing, [], 'the template still has every file this serves');
  assert.equal(files.length, templateFiles(readSpec(root)).length);

  const at = (suffix) => files.find((f) => f.path.endsWith(suffix));
  assert.ok(at('src/zcl_invoice_app.clas.abap'), 'the class file is named after the class');
  assert.ok(at('src/zcl_invoice_app.clas.xml'), 'and so is its sidecar');
  assert.match(at('.clas.abap').text, /CLASS zcl_invoice_app DEFINITION/);
  // upper case in the sidecar, lower in the ABAP - that asymmetry is the bug
  assert.match(at('.clas.xml').text, /<CLSNAME>ZCL_INVOICE_APP<\/CLSNAME>/);
  assert.match(at('package.devc.xml').text, /<CTEXT>Invoice App<\/CTEXT>/);
  assert.match(at('.abapgit.xml').text, /<NAME>invoice-app<\/NAME>/);

  assert.ok(!files.some((f) => /zcl_app_001/i.test(f.text)),
    'no file still carries the template own class name');
  assert.ok(files.some((f) => f.path === 'AGENTS.md'),
    'the briefing ships with the project - an agent without one is the gap this closes');
});

test('scaffolding without a class name returns the template as it stands', (t) => {
  const root = path.join(ROOT, '..', 'app-template');
  if (!fs.existsSync(path.join(root, 'abaplint.jsonc'))) {
    t.skip('app-template sibling not found');
    return;
  }
  const { files } = scaffold(root, {});
  assert.ok(files.some((f) => f.path === 'src/zcl_app_001.clas.abap'));
});

test('a template missing a file reports it rather than shipping a shorter project', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2u5-tpl-'));
  // The description comes from the template too, so the fixture carries the
  // real one - a hand-written list here would be the copy this stopped keeping
  fs.cpSync(path.join(ROOT, '..', 'app-template', 'template.json'), path.join(dir, 'template.json'));
  fs.writeFileSync(path.join(dir, 'abaplint.jsonc'), '{}');
  const { files, missing, spec } = scaffold(dir, {});
  assert.deepEqual(files.map((f) => f.path), ['abaplint.jsonc']);
  assert.ok(missing.includes('src/zcl_app_001.clas.abap'));
  assert.equal(missing.length, templateFiles(spec).length - 1);
});

/* Without template.json there is no list to serve, and the point of reading
 * the template's own description is that this repo does not keep a second
 * one to fall back on. */
test('a template without its own description is reported, not guessed at', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2u5-nospec-'));
  fs.writeFileSync(path.join(dir, 'abaplint.jsonc'), '{}');
  const { files, noSpec } = scaffold(dir, {});
  assert.equal(noSpec, true);
  assert.deepEqual(files, []);
});
