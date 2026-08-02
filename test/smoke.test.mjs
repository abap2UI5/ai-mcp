// stdio smoke: boots the real server and drives the MCP handshake. Needs the
// ai-demokit sibling checkout (the server reads its content live) - the test
// SKIPS cleanly when it is absent, so `npm test` stays green in a bare CI
// checkout while still exercising the full path in a sibling workspace.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAiDemokit } from '../lib/repos.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HAVE_DEMOKIT = !!resolveAiDemokit();

test('stdio smoke: initialize, 11 tools, a capabilities query', { skip: !HAVE_DEMOKIT && 'ai-demokit sibling not found' }, async () => {
  const p = spawn('node', [path.join(ROOT, 'server.mjs')], { stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = '';
  p.stdout.on('data', (d) => (buf += d));
  const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
  const until = (pred, ms = 5000) =>
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

  try {
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } });
    const init = await until((m) => m.id === 1);
    assert.equal(init.result.serverInfo.name, 'abap2ui5');

    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const list = await until((m) => m.id === 2);
    assert.equal(list.result.tools.length, 11);

    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'capabilities', arguments: { query: 'popup' } } });
    const caps = await until((m) => m.id === 3);
    assert.ok(JSON.stringify(caps.result).length > 200, 'capabilities query returned content');

    send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'example_app', arguments: { query: 'app 044' } } });
    const ex = await until((m) => m.id === 4);
    assert.ok(JSON.stringify(ex.result).includes('z2ui5_cl_ai_app_044'), 'example_app resolved the cited port');
  } finally {
    p.kill();
  }
});
