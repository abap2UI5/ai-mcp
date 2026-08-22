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
import { RESOURCES, RESOURCE_URIS, RESOURCE_TEMPLATES } from '../lib/resources.mjs';
import { PROMPTS, PROMPT_NAMES } from '../lib/prompts.mjs';

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

/* The resource surface gets the same treatment as the tools the moment it
 * exists: one source (lib/resources.mjs), and the documents that spell it out
 * are checked against it. */
test('every resource has a stable URI, a name, a description and a mime type', () => {
  assert.ok(RESOURCES.length > 0);
  for (const r of RESOURCES) {
    assert.match(r.uri, /^abap2ui5:\/\/[a-z0-9/-]+$/, `resource URI '${r.uri}' must be a stable abap2ui5:// path`);
    assert.match(r.name, /^[a-z][a-z0-9-]*$/, `resource name '${r.name}' must be a lowercase identifier`);
    assert.ok(r.description && r.description.length > 60, `'${r.uri}' needs a real description, not a label`);
    assert.ok(r.mimeType, `'${r.uri}' must declare a mime type`);
  }
  assert.equal(new Set(RESOURCE_URIS).size, RESOURCES.length, 'resource URIs must be unique');
});

test('the README resources table lists exactly the RESOURCES URIs plus the templates', () => {
  const readme = read('README.md');
  const listed = [...readme.matchAll(/^\| `(abap2ui5:\/\/[^`]+)` \|/gm)].map((m) => m[1]).sort();
  const expected = [...RESOURCE_URIS, ...RESOURCE_TEMPLATES.map((t) => t.uriTemplate)].sort();
  assert.deepEqual(listed, expected,
    'README.md "Resources" table and lib/resources.mjs disagree - update the table (one row per resource/template, URI in backticks)');
});

test('every written-out resource count matches the RESOURCES array', () => {
  for (const file of ['README.md', 'AGENTS.md', 'server.mjs', 'CONTRIBUTING.md']) {
    const text = read(file);
    for (const m of text.matchAll(/(\d+)\s+resources\b/g)) {
      assert.equal(Number(m[1]), RESOURCES.length,
        `${file} says "${m[0]}" but lib/resources.mjs defines ${RESOURCES.length} resources`);
    }
  }
});

/* And the prompt surface: one source (lib/prompts.mjs), checked against the
 * documents that name it. A prompt orchestrates the EXISTING tools, so every
 * tool a prompt sends the agent to must actually be in the TOOLS array — a
 * renamed tool must fail here, not in an agent's session. */
test('every prompt is declared in full and every prompt name in the README is real', () => {
  assert.ok(PROMPTS.length >= 1 && PROMPTS.length <= 2, 'one or two prompts, deliberately no more');
  const readme = read('README.md');
  for (const p of PROMPTS) {
    assert.match(p.name, /^[a-z][a-z0-9-]*$/, `prompt name '${p.name}' must be a lowercase identifier`);
    assert.ok(p.description && p.description.length > 60, `'${p.name}' needs a real description, not a label`);
    assert.ok(Array.isArray(p.arguments) && p.arguments.length, `'${p.name}' must declare its arguments`);
    assert.ok(readme.includes(`\`${p.name}\``), `README.md must document the prompt '${p.name}'`);
  }
  assert.equal(new Set(PROMPT_NAMES).size, PROMPTS.length, 'prompt names must be unique');
});

test('every tool a rendered prompt names exists in the TOOLS array', async () => {
  const { getPrompt } = await import('../lib/prompts.mjs');
  const args = { 'build-an-abap2ui5-app': { task: 'x' }, 'port-a-ui5-sample': { sample: 'x' } };
  for (const p of PROMPTS) {
    const text = getPrompt(p.name, args[p.name]).messages.map((m) => m.content.text).join('\n');
    const named = [...text.matchAll(/`([a-z][a-z0-9_]*)`/g)].map((m) => m[1]);
    assert.ok(named.length > 4, `prompt '${p.name}' must actually orchestrate tools`);
    for (const tool of named) {
      if (tool === 'client' || tool === 'z2ui5_if_app') continue; // API names, not tools
      assert.ok(TOOL_NAMES.includes(tool),
        `prompt '${p.name}' sends the agent to '${tool}', which lib/tools.mjs does not define`);
    }
  }
});

test('every written-out prompt count matches the PROMPTS array', () => {
  for (const file of ['README.md', 'AGENTS.md', 'server.mjs', 'CONTRIBUTING.md']) {
    const text = read(file);
    for (const m of text.matchAll(/(\d+)\s+prompts\b/g)) {
      assert.equal(Number(m[1]), PROMPTS.length,
        `${file} says "${m[0]}" but lib/prompts.mjs defines ${PROMPTS.length} prompts`);
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
