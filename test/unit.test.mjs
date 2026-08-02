// Sibling-free unit tests (node --test): every unit here runs without the
// ai-demokit / abap2UI5 / linter checkouts. The stdio smoke lives in
// test/smoke.test.mjs and DOES need the siblings.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsonc, BENIGN, deployApp } from '../lib/runtime.mjs';
import { parseCapabilities, searchCapabilities } from '../lib/capabilities.mjs';
import { rankExamplePorts } from '../lib/example-app.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------ stripJsonc ----

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

// --------------------------------------------------- example_app ranking ----
// rankExamplePorts is pure: the fixtures stand in for the meta/ sidecars and
// CAPABILITIES.md, so the ranking is testable without the ai-demokit sibling.

const PORT_METAS = [
  { class: 'z2ui5_cl_ai_app_044', sample: 'sap.m.sample.PDFViewerPopup', entity: 'sap.m.PDFViewer', deviations: [{ type: 'NOTE', what: 'popup mode via follow_up_action' }] },
  { class: 'z2ui5_cl_ai_app_045', sample: 'sap.m.sample.RangeSlider', entity: 'sap.m.RangeSlider', deviations: [] },
  { class: 'z2ui5_cl_ai_app_051', sample: 'sap.m.sample.Table', entity: 'sap.m.Table', deviations: [] },
];
const PORT_CAPS = [
  '| UI5 feature | Status | How | Evidence |',
  '|---|---|---|---|',
  '| Composite range properties | ok | split into scalars | app 045 |',
].join('\n');

test('rankExamplePorts pins an explicit app number', () => {
  const ranked = rankExamplePorts({ query: 'app 44', metas: PORT_METAS });
  assert.equal(ranked[0].class, 'z2ui5_cl_ai_app_044');
});

test('rankExamplePorts matches sidecar fields, all-terms hits first', () => {
  const ranked = rankExamplePorts({ query: 'pdf popup', metas: PORT_METAS });
  assert.equal(ranked[0].class, 'z2ui5_cl_ai_app_044');
});

test('rankExamplePorts promotes the port a matching CAPABILITIES.md row cites', () => {
  const ranked = rankExamplePorts({ query: 'composite range', metas: PORT_METAS, capabilitiesText: PORT_CAPS });
  assert.equal(ranked[0].class, 'z2ui5_cl_ai_app_045');
});

test('rankExamplePorts returns nothing for an empty or unmatched query', () => {
  assert.deepEqual(rankExamplePorts({ query: '', metas: PORT_METAS }), []);
  assert.deepEqual(rankExamplePorts({ query: 'zzzz-not-there', metas: PORT_METAS }), []);
});

// ------------------------------------------- server.mjs contract gates ----
// The tool list in the server.mjs header comment and the server version are
// maintained by hand (AGENTS.md maintenance traps) - gate the drift here.

function serverSource() {
  return fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8');
}

test('header-comment tool list exactly matches the TOOLS array', () => {
  const src = serverSource();
  const header = src.slice(0, src.indexOf('*/'));
  const documented = [...header.matchAll(/^ \* {3}([a-z_]+) {2,}\S/gm)].map((m) => m[1]);
  const toolsBlock = src.slice(src.indexOf('const TOOLS = ['), src.indexOf('\n];'));
  const declared = [...toolsBlock.matchAll(/name: '([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(declared.length > 0, 'TOOLS array parsed');
  // same set of names (the two lists group differently, so order-insensitive)
  assert.deepEqual([...documented].sort(), [...declared].sort(), 'server.mjs header comment tool list drifted from the TOOLS array');
  assert.equal(new Set(declared).size, declared.length, 'duplicate tool name in TOOLS');
});

test('server version matches package.json', () => {
  const src = serverSource();
  const m = src.match(/name: 'abap2ui5', version: '([^']+)'/);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(m, 'server version literal found');
  assert.equal(m[1], pkg.version, 'server.mjs version drifted from package.json');
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

// ------------------------------------------------------- BENIGN filter ----

test('BENIGN patterns match known console noise and not real errors', () => {
  const noise = BENIGN.some((re) => re.test('Failed to load resource: favicon.ico 404'));
  const real = BENIGN.some((re) => re.test("TypeError: Cannot read properties of undefined (reading 'getModel')"));
  assert.equal(noise, true); // known console noise is filtered
  assert.equal(real, false); // a real JS error is never swallowed
});
