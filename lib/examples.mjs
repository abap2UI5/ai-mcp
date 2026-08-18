/*
 * examples — the three sample catalogues as one queryable index of working apps.
 *
 * The question this answers is "has somebody already built X". `capabilities`
 * answers the neighbouring one — "can abap2UI5 express this UI5 feature at
 * all" — from samples-controls' CAPABILITIES.md. Neither answers the other: a
 * control being expressible says nothing about how an app that uses it is put
 * together, and a pattern being demonstrated says nothing about which controls
 * are reachable.
 *
 * THREE repositories, because the answer was in three places and this tool only
 * knew one of them:
 *
 *   samples           152 apps - the PATTERNS. Value help, navigation between
 *                     apps, trees, tables, timers. Runs on a bare abap2UI5.
 *   samples-stack      32 apps - the same, but each needs something from the
 *                     SYSTEM: an OData service, a RAP behavior definition, an
 *                     APC channel, the Fiori launchpad. Worth proposing only
 *                     when the user has that.
 *   samples-controls  the UI5 demo kit rebuilt control by control - the largest
 *                     of the three. The answer to "how do I express
 *                     sap.m.Wizard", which the other two rarely have.
 *
 * They were not searchable together because only one had a catalogue in this
 * shape. All three render the identical row now, from the same two lines on
 * the class (`" @summary`, `" @keywords`), so one parser reads all of them.
 *
 * Parsed ON EVERY QUERY rather than indexed into a generated artefact, so what
 * the agent sees is always exactly what the file says. Each file is itself
 * generated from the classes, and each repository gates the two lines, so the
 * search terms this reads cannot quietly go missing.
 *
 * A missing checkout is not an error here: the tool answers from the
 * catalogues that ARE present and names the ones it could not read, because a
 * partial answer to "has somebody built this" is worth more than a refusal.
 *
 * What comes back is a POINTER, never a copy: repository, class name and path.
 * The agent reads the class - a whole app that compiles, renders and is
 * downported to three releases - instead of a fragment that would have to be
 * kept in step with it here.
 *
 * Parsed shape per entry:
 *   { repo, area, section, title, sub, summary, label, keywords, docs, cls, path }
 */
import fs from 'fs';
import path from 'path';
import { resolveSamples, resolveSamplesStack, resolveSamplesControls } from './repos.mjs';

/* The catalogues, in the order an agent should prefer them: a pattern that
 * runs anywhere, then a control port, then one that needs the stack. */
export const CATALOGUES = [
  {
    repo: 'samples',
    url: 'https://github.com/abap2UI5/samples',
    env: 'SAMPLES_HOME',
    resolve: resolveSamples,
    what: 'patterns - runs on a bare abap2UI5 install',
  },
  {
    repo: 'samples-controls',
    url: 'https://github.com/abap2UI5/samples-controls',
    env: 'SAMPLES_CONTROLS_HOME',
    resolve: resolveSamplesControls,
    what: 'the UI5 demo kit, control by control',
  },
  {
    repo: 'samples-stack',
    url: 'https://github.com/abap2UI5/samples-stack',
    env: 'SAMPLES_STACK_HOME',
    resolve: resolveSamplesStack,
    what: 'needs something from the system - OData, RAP, APC, the launchpad',
  },
];

/** Which catalogues can be read right now, and which are missing and why. */
export function catalogueFiles() {
  const found = [];
  const missing = [];
  for (const c of CATALOGUES) {
    const root = c.resolve();
    const file = root && path.join(root, 'SAMPLES.md');
    if (file && fs.existsSync(file)) found.push({ ...c, root, file });
    else if (root) missing.push({ ...c, why: `${c.repo} checkout at ${root} has no SAMPLES.md — update it (git pull)` });
    else missing.push({ ...c, why: `${c.repo} checkout not found — clone ${c.url} as a sibling of ai-mcp, or point ${c.env} at an existing checkout` });
  }
  return { found, missing };
}

/* One catalogue row:
 *
 *   | **Basics I** — Hello World<br>What the sample shows.<br><sub>hello world minimal</sub> | [`Z2UI5_CL_SMP_APP_493`](src/01/z2ui5_cl_smp_app_493.clas.abap) |
 *
 * The bold half is present only where the row carries a header of its own
 * (the generators drop one that would just repeat its section), so both shapes
 * have to parse.
 *
 * And the dash after it is optional, because samples-controls writes the whole
 * header in bold and nothing after it:
 *
 *   | **sap.m.Bar**<br>Each screen of a mobile application...<br><sub>bar sap.m header</sub> | [`Z2UI5_CL_SMPC_APP_002`](src/01/01/z2ui5_cl_smpc_app_002.clas.abap) |
 *
 * Requiring the dash made that whole catalogue - at the time 430 of the 614
 * apps - parse
 * as a row with NO header: the title fell back to the section, so every port in
 * the file announced itself as the LIBRARY it belongs to, and the one thing an
 * agent asks this tool for, the control, survived only inside the keyword blob
 * and inside `sub` with its asterisks still on.
 *
 * After the title come the blocks, and they are matched as ONE group and split
 * afterwards rather than as a fixed sequence. A regex that counted them would
 * match nothing at all the day another is added, and this parser failing looks
 * like "there are no samples for that" rather than like a parse error - which
 * is exactly what happened when the catalogues grew the `@docs` links, and
 * would have happened again when they grew the summary.
 *
 *   <br>text                the summary sentence (normal type)
 *   <br><sub>text</sub>     the search terms, then the docs links
 */
const ROW = /^\|\s*(?:\*\*(?<title>[^*]+)\*\*\s*(?:(?:—|--)\s*)?)?(?<sub>[^|<]*?)\s*(?<blocks>(?:<br>(?:<[a-z]+>[^<]*<\/[a-z]+>|[^<]*))*)\s*\|\s*\[`(?<cls>[A-Z0-9_]+)`\]\((?<path>[^)]+)\)\s*\|/;

/* The blocks under a row title, in order, as `{ tag, text }`.
 *
 * A block wrapped in a tag nobody here knows is kept as a block with that tag
 * and then ignored by both readers below - which is the whole reason the row
 * pattern accepts any tag rather than `<sub>` alone. Twice now a new KIND of
 * block has made every row unmatchable over here, and that failure reads as
 * "there are no samples for that" rather than as a parse error. */
function blocksOf(blocks) {
  return [...(blocks || '').matchAll(/<br>(?:<([a-z]+)>([^<]*)<\/[a-z]+>|([^<]*))/g)]
    .map((m) => (m[1] !== undefined
      ? { tag: m[1], text: (m[2] || '').trim() }
      : { tag: '', text: (m[3] || '').trim() }))
    .filter((b) => b.text);
}

/** The sentence: the first block in NORMAL type (no tag at all). */
const summaryOf = (blocks) => (blocksOf(blocks).find((b) => !b.tag)?.text || '');

/** The keywords: the first `<sub>` block that is not the `docs:` one. */
const keywordsOf = (blocks) =>
  (blocksOf(blocks).find((b) => b.tag === 'sub' && !b.text.startsWith('docs:'))?.text || '');

/*
 * The cookbook pages a sample is the worked example of, out of the row's
 * `docs:` block:
 *
 *   <sub>docs: [cookbook/model/binding](https://abap2ui5.github.io/docs/...)</sub>
 *
 * The generators put them there deliberately - somebody decided which chapter
 * each app illustrates - and this parser used to be the place they stopped: it
 * knew the block existed only well enough to SKIP it while looking for the
 * keywords. So an agent got the class to read and no way to reach the prose
 * explaining what it demonstrates, which is the half a human reviewer would
 * have opened first.
 *
 * Returned as `{ topic, url }` rather than as the raw markdown, because the
 * topic path IS the answer to "which chapter is this" and a caller should not
 * have to parse a link out of a string to get at it.
 */
const DOC_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;
const docsOf = (blocks) => {
  const block = blocksOf(blocks).find((b) => b.tag === 'sub' && b.text.startsWith('docs:'));
  if (!block) return [];
  return [...block.text.matchAll(DOC_LINK)].map((m) => ({ topic: m[1].trim(), url: m[2].trim() }));
};

/** src/01 is the supported set; src/00 is experimental (97) or a test app (98). */
const areaOf = (repo, p) => {
  if (repo !== 'samples') return repo;
  return p.startsWith('src/01') ? 'samples' : 'experimental-or-test';
};

export function parseExamples(rawText = null, repo = 'samples') {
  const sources = rawText !== null
    ? [{ repo, text: rawText }]
    : catalogueFiles().found.map((c) => ({ repo: c.repo, text: fs.readFileSync(c.file, 'utf8') }));

  const entries = [];
  for (const source of sources) {
    let section = '';
    for (const line of source.text.split('\n')) {
      const head = /^#{2,3}\s+(.+?)\s*$/.exec(line);
      if (head) { section = head[1].replace(/[*`]/g, '').replace(/\s+—\s+.*$/, '').trim(); continue; }
      const m = ROW.exec(line);
      if (!m) continue;
      const g = m.groups;
      entries.push({
        repo: source.repo,
        section,
        // a row without its own header is titled by the section it sits under
        title: (g.title || section).trim(),
        sub: (g.sub || '').trim(),
        summary: summaryOf(g.blocks),
        keywords: keywordsOf(g.blocks),
        docs: docsOf(g.blocks),
        /* What to call it in one line, so a caller does not reassemble it.
         * Deliberately reads the RAW header rather than `title`: a row whose
         * header would repeat its section does not carry one, and `title` falls
         * back to the section there - announcing the F4 value-help sample as
         * "Popup" rather than as what it does. */
        label: [g.title?.trim(), (g.sub || '').trim()].filter(Boolean).join(' — ')
          || section,
        cls: g.cls,
        path: g.path,
        area: areaOf(source.repo, g.path),
      });
    }
  }
  return entries;
}

/** Every term has to appear somewhere in the entry - the same AND semantics
 *  `searchCapabilities` uses, so a two-word query narrows rather than widens. */
export function searchExamples({ query, area, repo, limit = 20, rawText = null } = {}) {
  let entries = parseExamples(rawText, repo || 'samples');
  if (repo) entries = entries.filter((e) => e.repo === repo);
  if (area) entries = entries.filter((e) => e.area === area);
  if (query) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    /* The docs links are deliberately NOT in the haystack. Almost every row in
     * `samples` carries one and almost every one of them starts `cookbook/`,
     * so a query for "cookbook" would match the entire catalogue - a search
     * term nobody chose, drowning the ones somebody did. They travel as an
     * ANSWER (the `docs` field), not as a way to be found. */
    const hay = (e) => `${e.section} ${e.title} ${e.sub} ${e.summary} ${e.keywords} ${e.cls}`.toLowerCase();
    entries = entries.filter((e) => terms.every((t) => hay(e).includes(t)));
    /* A hit in the KEYWORDS is a hit on a word somebody chose to be found by;
     * a hit in the title, the summary or the section may be incidental.
     * Ranked, not filtered - the weaker matches are still the answer when
     * there are no others. */
    const score = (e) => {
      const k = e.keywords.toLowerCase();
      return terms.filter((t) => k.includes(t)).length;
    };
    entries = [...entries].sort((a, b) => score(b) - score(a));
  }
  return limit > 0 ? entries.slice(0, limit) : entries;
}

export function exampleSummary(rawText = null) {
  const entries = parseExamples(rawText);
  const byRepo = {};
  const bySection = {};
  for (const e of entries) {
    byRepo[e.repo] = (byRepo[e.repo] || 0) + 1;
    bySection[`${e.repo}|${e.section}`] = 1;
  }
  const { missing } = rawText === null ? catalogueFiles() : { missing: [] };
  return {
    total: entries.length,
    byRepo,
    sections: Object.keys(bySection).length,
    ...(missing.length
      ? { notSearched: missing.map((m) => `${m.repo}: ${m.why}`) }
      : {}),
  };
}
