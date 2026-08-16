# Releasing

One tag publishes one package: **`@abap2ui5/mcp`** on the public npm
registry. Everything mechanical lives in
[`.github/workflows/release.yml`](.github/workflows/release.yml); its header
comment is the reference. This file is the human checklist.

## What a release is for

Merging to `main` is the release for everyone reading the repository. npm is
the one channel that needs a deliberate, immutable version, and this server
needs it more than most: its **tool names and result shapes are a contract**
with every agent configuration that registers it. `npx --yes
github:abap2UI5/ai-mcp` resolves to whatever `main` holds that day, so an
agent setup that worked on Monday can behave differently on Tuesday without
anyone having decided that.

## How reversible is it?

A published version cannot be changed or replaced. `npm unpublish` is limited
to the first 72 hours and, for a package others depend on, is worse than the
bug it would remove.

The everyday correction is a new version. What genuinely cannot be taken back
is the **package name** — `@abap2ui5/mcp` — so that is the one thing worth
getting right the first time.

## One-time setup

The npm organisation `abap2ui5` already owns the scope (`@abap2ui5/linter`
and `@abap2ui5/render-runtime` are published under it).

Trusted publishing can only be configured for a package that **already
exists**, so the first publish is manual:

```sh
npm login
npm publish --access public
```

Then, on npmjs.com → `@abap2ui5/mcp` → **Settings → Trusted Publisher**, point
it at this repository and `release.yml`. From the second release on the
workflow publishes with no token at all.

## Cutting a release

1. `CHANGELOG.md` — move the `Unreleased` entries under the new version.
2. Bump and tag:

   ```sh
   npm version patch|minor|major
   git push --follow-tags
   ```

   `npm version` commits and creates an **annotated** tag here — there is no
   workspace to keep in step, unlike in `abap2UI5/linter`.
3. Watch the run. It refuses to publish if the tag and `package.json`
   disagree, runs the sibling-free test suite on the exact commit, and prints
   the tarball contents before the publish step.

To rehearse everything except the publish, dispatch the workflow by hand from
the Actions tab — same gates, same tarball, no registry write.

## What is NOT covered by the release gate

`npm test` on a bare checkout is the sibling-free half: the parsers, the
config resolution, the process-tree timeouts, the degradation contract. It
does **not** cover `run_app`, `build_backend` or the render half of
`validate_view`, because those need the samples-controls checkout, its own
`npm ci` and a Chromium — minutes of setup for a check that then takes tens
of minutes to transpile.

So a release is verified for everything that can run without a corpus, and
verified by hand for the screenshot loop. If that loop breaks, it breaks
after the tag. Worth remembering before cutting one.

## After a release

- The [VS Code extension](https://github.com/abap2UI5/vscode-extension)
  registers this server via `npx --yes github:abap2UI5/ai-mcp` today. Once a
  version is on npm it should point at `@abap2ui5/mcp` instead, which is a
  change in that repository.
- The README's setup section names checkouts. A published package makes
  `npx @abap2ui5/mcp` possible for the tools that need no corpus — worth
  updating there when the first version lands.
