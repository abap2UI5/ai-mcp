// Missing-checkout degradation: every tool that reads a sibling checkout must
// return a clear, actionable error (which repo, how to clone it, which env
// var) instead of crashing with a TypeError — and the server itself must boot.
//
// The env vars are authoritative (lib/repos.mjs): pointing all three at
// nonexistent directories forces the missing-checkout path deterministically,
// whether or not real siblings exist next to this repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const NOWHERE = path.join(ROOT, 'test', 'does-not-exist');

test('every sibling-dependent tool degrades with an actionable error when the checkouts are missing', async () => {
  const p = spawn('node', [path.join(ROOT, 'server.mjs')], {
    stdio: ['pipe', 'pipe', 'ignore'],
    env: {
      ...process.env,
      SAMPLES_CONTROLS_HOME: path.join(NOWHERE, 'samples-controls'),
      A2UI5_HOME: path.join(NOWHERE, 'abap2UI5'),
      AI_VIEW_CHECK_HOME: path.join(NOWHERE, 'linter'),
    },
  });
  let buf = '';
  p.stdout.on('data', (d) => (buf += d));
  const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
  const until = (pred, ms = 10000) =>
    new Promise((res, rej) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const msgs = buf
          .split('\n')
          .filter(Boolean)
          .map((l) => {
            try {
              return JSON.parse(l);
            } catch {
              return null;
            }
          })
          .filter(Boolean);
        const hit = msgs.find(pred);
        if (hit) {
          clearInterval(iv);
          res(hit);
        } else if (Date.now() - t0 > ms) {
          clearInterval(iv);
          rej(new Error('timeout waiting for MCP response'));
        }
      }, 50);
    });

  let id = 0;
  const call = async (name, args = {}) => {
    const reqId = ++id + 100;
    send({ jsonrpc: '2.0', id: reqId, method: 'tools/call', params: { name, arguments: args } });
    const msg = await until((m) => m.id === reqId);
    return msg.result;
  };
  const expectMissing = (result, repoRe, envVar) => {
    assert.equal(result.isError, true, `expected isError, got: ${JSON.stringify(result)}`);
    const text = result.content[0].text;
    assert.match(text, repoRe, `error must name the missing repo: ${text}`);
    assert.match(text, new RegExp(envVar), `error must name the env var: ${text}`);
    assert.match(text, /clone|checkout/i, `error must say how to fix it: ${text}`);
  };

  try {
    // the server still boots without any sibling checkout
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'missing-siblings', version: '0' } } });
    const init = await until((m) => m.id === 1);
    assert.equal(init.result.serverInfo.name, 'abap2ui5');
    assert.equal(init.result.serverInfo.version, PKG.version);

    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const list = await until((m) => m.id === 2);
    assert.deepEqual(
      list.result.tools.map((t) => t.name).sort(),
      ['backend', 'build_backend', 'capabilities', 'deploy_app', 'generation_rules', 'pitfalls', 'remove_app', 'run_app', 'scope_of', 'validate_view'],
    );

    // samples-controls-backed tools
    const CORPUS = /samples-controls checkout not found/;
    expectMissing(await call('capabilities', {}), CORPUS, 'SAMPLES_CONTROLS_HOME');
    expectMissing(await call('capabilities', { query: 'popup' }), CORPUS, 'SAMPLES_CONTROLS_HOME');
    expectMissing(await call('generation_rules', {}), CORPUS, 'SAMPLES_CONTROLS_HOME');
    expectMissing(await call('scope_of', { entities: ['sap.m.Wizard'] }), CORPUS, 'SAMPLES_CONTROLS_HOME');
    expectMissing(
      await call('deploy_app', { class_name: 'z2ui5_cl_demo', abap_source: 'CLASS z2ui5_cl_demo DEFINITION. INTERFACES z2ui5_if_app.' }),
      CORPUS,
      'SAMPLES_CONTROLS_HOME',
    );
    expectMissing(await call('build_backend', {}), CORPUS, 'SAMPLES_CONTROLS_HOME');
    expectMissing(await call('remove_app', {}), CORPUS, 'SAMPLES_CONTROLS_HOME');
    expectMissing(await call('remove_app', { class_name: 'z2ui5_cl_demo' }), CORPUS, 'SAMPLES_CONTROLS_HOME');

    // linter-backed tool
    expectMissing(
      await call('validate_view', { xml: '<mvc:View xmlns:mvc="sap.ui.core.mvc"/>' }),
      /linter checkout not found/,
      'AI_VIEW_CHECK_HOME',
    );

    // abap2UI5-backed tools (run_app checks samples-controls first — both missing here)
    expectMissing(await call('run_app', { class_name: 'z2ui5_cl_demo' }), CORPUS, 'SAMPLES_CONTROLS_HOME');
    // the pitfalls catalogues live in the abap2UI5 checkout, not in the corpus
    expectMissing(await call('pitfalls', {}), /abap2UI5 checkout not found/, 'A2UI5_HOME');
    expectMissing(await call('pitfalls', { area: 'view' }), /abap2UI5 checkout not found/, 'A2UI5_HOME');
    expectMissing(await call('backend', { action: 'start' }), /abap2UI5 checkout not found/, 'A2UI5_HOME');
    expectMissing(await call('backend', { action: 'restart' }), /abap2UI5 checkout not found/, 'A2UI5_HOME');

    // backend status/stop never need a checkout
    const status = await call('backend', { action: 'status' });
    assert.ok(!status.isError, `backend status must work without checkouts: ${JSON.stringify(status)}`);
    assert.equal(JSON.parse(status.content[0].text).built, false);
  } finally {
    p.kill();
  }
});
