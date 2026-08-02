/*
 * example-app — read the existing ai-demokit ports as evidence.
 *
 * `capabilities` answers cite proving ports ("app 044"), but citing code an
 * agent cannot read is a dead end. This module resolves a port class to its
 * ABAP source in the ai-demokit checkout (src/**) plus the meta/<class>.json
 * sidecar (sample, entity, verification status, deviations). A free-text
 * query is ranked against the sidecars and the CAPABILITIES.md rows, so
 * "pdf popup" and "app 044" both land on z2ui5_cl_ai_app_044.
 *
 * Everything is read live from the checkout on every call (same principle as
 * lib/capabilities.mjs: no generated artifact that can drift). The ranking
 * itself is pure (rankExamplePorts) so it stays testable without siblings.
 */
import fs from 'fs';
import path from 'path';
import { resolveAiDemokit } from './repos.mjs';

function demokit() {
  const d = resolveAiDemokit();
  if (!d) throw new Error('ai-demokit checkout not found — set AI_DEMOKIT_HOME or clone it as a sibling (the ports and their meta sidecars live there)');
  return d;
}

// meta/<class>.json, reduced to what an agent needs to judge the port as
// evidence: what it ports, whether it was verified, and where it deviates
export function metaSummary(meta) {
  if (!meta) return null;
  return {
    class: meta.class,
    sample: meta.sample,
    entity: meta.entity,
    status: meta.status,
    checked: meta.checked && meta.checked.note,
    deviations: (meta.deviations || []).map((d) => ({ type: d.type, what: d.what })),
  };
}

function readMeta(root, className) {
  const p = path.join(root, 'meta', `${className}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function listMetas(root = demokit()) {
  const dir = path.join(root, 'meta');
  if (!fs.existsSync(dir)) return [];
  const metas = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const m = readMeta(root, f.replace(/\.json$/, ''));
    if (m && m.class) metas.push(m);
  }
  return metas;
}

// the sidecar's `file` field is authoritative; a class without a sidecar
// (e.g. z2ui5_cl_ai_app_overview) is found by walking src/
function findSource(root, className, meta) {
  if (meta && meta.file) {
    const p = path.join(root, meta.file);
    if (fs.existsSync(p)) return p;
  }
  const target = `${className}.clas.abap`;
  const stack = [path.join(root, 'src')];
  while (stack.length) {
    const dir = stack.pop();
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === target) return p;
    }
  }
  return null;
}

export function readExampleApp(className) {
  const root = demokit();
  const cls = String(className || '').toLowerCase();
  if (!/^z2ui5_cl_[a-z0-9_]+$/.test(cls)) {
    throw new Error(`invalid class name '${className}' — expected a port class like z2ui5_cl_ai_app_044`);
  }
  const meta = readMeta(root, cls);
  const file = findSource(root, cls, meta);
  if (!file) {
    throw new Error(`no port class ${cls} in the ai-demokit checkout (${root}) — try example_app { query } to search, or capabilities for the map`);
  }
  return {
    class: cls,
    file,
    meta: metaSummary(meta),
    source: fs.readFileSync(file, 'utf8'),
  };
}

/*
 * Rank the ports against a free-text query. Pure — the callers feed it the
 * parsed sidecars and the CAPABILITIES.md text, tests feed it fixtures.
 *   - an explicit app number ("app 044", "44") pins that port
 *   - sidecar fields (class, sample, entity, deviation notes) match per term,
 *     all-terms matches rank above partial ones
 *   - CAPABILITIES.md rows that match promote the ports their evidence cites,
 *     so a capability-level query lands on the proving port
 */
export function rankExamplePorts({ query, metas, capabilitiesText = '' }) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const known = new Set(metas.map((m) => m.class));
  const scores = new Map();
  const bump = (cls, n) => {
    if (known.has(cls)) scores.set(cls, (scores.get(cls) || 0) + n);
  };

  const num = String(query).match(/\b(\d{1,3})\b/);
  if (num) bump(`z2ui5_cl_ai_app_${num[1].padStart(3, '0')}`, 100);

  for (const m of metas) {
    const hay = [m.class, m.sample, m.entity, ...(m.deviations || []).map((d) => d.what)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const hit = terms.filter((t) => hay.includes(t)).length;
    if (hit) bump(m.class, hit === terms.length ? 10 + hit : hit);
  }

  for (const line of capabilitiesText.split('\n')) {
    if (!line.startsWith('|')) continue;
    const low = line.toLowerCase();
    const hit = terms.filter((t) => low.includes(t)).length;
    if (!hit) continue;
    for (const ref of low.matchAll(/\bapps?[ _](\d{3})\b/g)) {
      bump(`z2ui5_cl_ai_app_${ref[1]}`, hit * 5);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([cls, score]) => ({ class: cls, score }));
}

export function searchExampleApps(query) {
  const root = demokit();
  const metas = listMetas(root);
  const capsPath = path.join(root, 'CAPABILITIES.md');
  const capsText = fs.existsSync(capsPath) ? fs.readFileSync(capsPath, 'utf8') : '';
  const ranked = rankExamplePorts({ query, metas, capabilitiesText: capsText });
  if (!ranked.length) {
    return { matches: 0, hint: 'no port matched — try other keywords, an app number ("app 044"), or the capabilities tool first' };
  }
  const best = readExampleApp(ranked[0].class);
  const others = ranked.slice(1, 8).map((r) => {
    const m = metas.find((x) => x.class === r.class);
    return { class: r.class, sample: m && m.sample, entity: m && m.entity };
  });
  return { matches: ranked.length, best, others };
}
