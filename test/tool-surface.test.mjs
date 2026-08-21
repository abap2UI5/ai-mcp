// The tool surface has ONE source: the TOOLS array in lib/tools.mjs. It used
// to be hand-duplicated in four places - the server.mjs header comment, the
// README table, AGENTS.md, and the test name lists - and every copy drifted in
// its own way (AGENTS.md called that out as a known trap). This gate is what
// replaced the copies: the tests now IMPORT the names, and the two documents
// that still spell them out for humans (the README table) or count them
// (AGENTS.md) are checked here against the array on every `npm test`.
//
// Sibling-free on purpose: lib/tools.mjs is data, and the documents are in
// this repository, so a bare CI checkout runs the whole gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS, TOOL_NAMES } from '../lib/tools.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('every tool has a name, a documenting description and an object schema', () => {
  assert.ok(TOOLS.length > 0);
  for (const t of TOOLS) {
    assert.match(t.name, /^[a-z][a-z0-9_]*$/, `tool name '${t.name}' must be a lowercase identifier`);
    // the description is the ONLY documentation the agent reads (AGENTS.md);
    // one that fits a tooltip is one that says nothing
    assert.ok(t.description && t.description.length > 60, `'${t.name}' needs a real description, not a label`);
    assert.equal(t.inputSchema?.type, 'object', `'${t.name}' input schema must be an object schema`);
  }
  assert.equal(new Set(TOOL_NAMES).size, TOOLS.length, 'tool names must be unique');
});

test('the README tool table lists exactly the TOOLS names', () => {
  // the table rows: | `tool_name` | what it does |
  const readme = read('README.md');
  const listed = [...readme.matchAll(/^\| `([a-z0-9_]+)` \|/gm)].map((m) => m[1]).sort();
  assert.deepEqual(listed, TOOL_NAMES,
    'README.md "Tools" table and lib/tools.mjs disagree - update the table (one row per tool, `name` in backticks)');
});

/* Anywhere a document writes the COUNT out ("14 tools"), it is making a claim
 * about the array - so every such phrase in the repo's prose must carry the
 * array's length. A count nobody re-derives is a count that drifts; this is
 * the re-derivation. */
test('every written-out tool count matches the TOOLS array', () => {
  for (const file of ['README.md', 'AGENTS.md', 'server.mjs', 'CONTRIBUTING.md']) {
    const text = read(file);
    for (const m of text.matchAll(/(\d+)\s+tools\b/g)) {
      assert.equal(Number(m[1]), TOOLS.length,
        `${file} says "${m[0]}" but lib/tools.mjs defines ${TOOLS.length} tools`);
    }
  }
});

/* The two stdio suites used to keep hand-written name lists of their own (the
 * fourth copy). They now import TOOL_NAMES; what is asserted here is that no
 * hand list has crept back in - a literal tool name in an assertion list is
 * the tell. (Importing the test files would re-register their tests, so the
 * check reads the source instead.) */
test('the stdio suites derive their name lists instead of keeping copies', () => {
  for (const file of ['test/smoke.test.mjs', 'test/missing-siblings.test.mjs']) {
    const text = read(file);
    assert.match(text, /TOOL_NAMES/, `${file} must assert the derived TOOL_NAMES`);
    assert.ok(!/\[\s*'app_guide'/.test(text), `${file} keeps a hand-written tool-name list again`);
  }
});
