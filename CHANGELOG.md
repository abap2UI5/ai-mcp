# Changelog

## Unreleased

Nothing published yet — `@abap2ui5/mcp-server` has never been on npm. Everything
below is what the first version will carry, and what changed since the server
was only installable as `npx --yes github:abap2UI5/mcp-server`.

- **Renamed: the repository is `mcp-server`, the package is `@abap2ui5/mcp-server`.**
  `mcp` names a protocol; `mcp-server` names the thing, which is what somebody
  scanning the organisation's repository list needs to read without clicking.
  The rename happened before the first publish on purpose: a package name is
  the one thing a release cannot take back, and a repository whose name differs
  from its only package is a discrepancy nobody has to inherit.

  `lib/repo-dirs.json` — the ecosystem's rename history — now carries an entry
  for this server itself, listing `mcp-server` and `ai-mcp`. It resolves
  nothing for its own sake, but a consumer that looks for a local checkout by
  directory name (abap2UI5/vscode-extension does, before falling back to npx)
  would otherwise miss one carrying the previous name.

- **`scaffold_app`: the files a new project starts from.** The server could
  tell an agent how to write a class (`app_guide`) and where to put one so it
  could be run (`deploy_app`, into the corpus' scratch package) — but not how
  to start a REPOSITORY, which is what somebody building an app of their own
  actually needs. Everything around the class is the part an agent cannot
  invent: the abaplint config with the framework pinned at a release under the
  `branch` key, the `abap2ui5lint.jsonc` the render gate needs to run rather
  than skip, the CI workflow, the `.abapgit.xml`, and the `.clas.xml` sidecar
  whose `CLSNAME` must match the class or the object does not activate at all.
  Served live from abap2UI5/app-template, the repository this ecosystem
  already points people at, rather than embedded — a copy here would be a
  second answer to "what does a new project look like".

  `class` renames it throughout: the ABAP, the sidecar's `CLSNAME` (upper case
  there, lower in the source — that asymmetry is why the template ships a
  rename script rather than an instruction) and the file names. The name is
  validated before it is substituted, since it reaches file paths. Proven end
  to end: a scaffolded project installs and passes `npm run check` — abaplint
  0 issues, linter 0 findings with the render gate on.

- **`screenshot_view`: an agent can SEE the view in seconds.** The linter
  gained `--screenshot` — it reconstructs the view from the builder calls,
  seeds it from the class's own `TYPES`/`DATA` and photographs it in the same
  headless harness its render gate already runs — and this server had no way
  to reach it. The only way to look at anything was `run_app`, which boots the
  REAL app and therefore needs the whole framework transpiled first: tens of
  minutes for the first build, minutes for every rebuild after an edit. So the
  loop was "write ABAP, get a verdict in seconds, then pay a build to look at
  it, or never look at it". A dedicated tool rather than a flag on
  `validate_view`, because it is a different question (is this legal / what
  does it look like), it takes different arguments (viewports, theme, preview
  data) and it needs the render runtime and a browser, which the property gate
  does not. Several viewports come back from ONE browser session, each as an
  MCP `image` block — the way `run_app` has always returned its screenshot.

- **`app_guide`: the rulebook for the job this server is for.** The one
  rulebook on offer, `generation_rules`, serves samples-controls'
  `generation-prompt.txt`, whose first line is *"You are porting one official
  UI5 demo kit sample to abap2UI5"* — while the tool described itself as "the
  canonical rulebook for writing an abap2UI5 app". An agent building a user's
  app was being handed the porting brief: an input sample it does not have, a
  `z2ui5_cl_smpc_app_<n>` convention that is not its app's, and 1:1 fidelity
  to something that does not exist. abap2UI5 maintains the right document
  beside its sources (`docs/agents/building-apps.md`, deliberately
  self-contained so no web access is needed); it is served live and sliced by
  chapter, the way `pitfalls` slices the skills. The porting brief stays where
  it was, and both descriptions now say which job they are for.

- **An agent can deploy the app it actually wrote.** `deploy_app` enforced
  `^z2ui5_cl_[a-z0-9_]+$` — the naming convention of the demo-kit PORTS — and
  the ecosystem's own starting point, `abap2UI5/app-template`, ships
  `zcl_app_001`. So an agent that followed the recommended path could not
  deploy, build or look at the thing it had just been told to write. Any
  customer-namespace class name is accepted now (`^[zy][a-z0-9_]*$`, <= 30
  chars), and the dev lint config was widened the same way — it forced
  `^Z2UI5_CL_` one layer down, which would have failed the very name this
  server had just accepted. The safety property is unchanged and tested: the
  name becomes a PATH under `src/zz_dev`, so it is still a whitelist admitting
  no separator, dot or space, and no name can reach outside the sandbox.

- **A finding arrives explained.** `validate_view` returned a rule id and a
  one-line message; the paragraph saying why the defect matters and what the
  fix looks like existed only on the published rules page — a web fetch
  mid-task, and one an agent may not be able to make at all. The linter now
  exports that prose (`./rule-docs`), and each rule that fired comes back
  under `rules`, keyed by id so twelve findings of one type cost one
  explanation. The one-line summary always, the full paragraph on
  `explain: true` — a first run on an unfamiliar class can hit a dozen
  distinct rules, and a dozen paragraphs would crowd out the findings they are
  about. An older linter checkout without that export costs the explanations
  and nothing else.

- **The catalogue rows are read whole.** Two things the parser dropped on the
  floor: the per-sample `docs:` links — the cookbook chapters somebody decided
  each app is the worked example of, which it knew about only well enough to
  SKIP while looking for the keywords — and, worse, the TITLE of every port in
  samples-controls. Its rows carry the whole header in bold with no dash after
  it (`| **sap.m.Bar**<br>…`) and the row pattern required the dash, so 430 of
  the 614 apps parsed as rows with no header at all: the title fell back to
  the section, and every port announced itself as the LIBRARY it belongs to
  while the control an agent asked for survived only inside the keyword blob.
  The docs links are searchable by nobody on purpose — almost every row in
  `samples` carries one starting `cookbook/`, so a query for "cookbook" would
  match the whole catalogue.

- **`examples` searches all three sample repositories, not one.** The tool
  read `abap2UI5/samples` and nothing else, so two thirds of the answer was
  invisible to it: `samples-controls` (430 ports of the UI5 demo kit — the
  answer to "how do I express sap.m.Wizard") and `samples-stack` (32 apps that
  need an OData service, RAP, APC or the launchpad, which is exactly what an
  agent must know before proposing one). 152 apps searchable, 614 now. Each
  entry names its `repo`, and a new `repo` filter narrows to one. A repository
  that is not checked out is REPORTED rather than fatal — a thinner answer to
  "has somebody built this" beats a refusal — and only all three missing is an
  error. This became possible because the three catalogues now render the
  identical row from the same two lines on the class (`" @summary`,
  `" @keywords`), so one parser reads all of them.

- **The row parser reads the summary sentence, and could not have.** The
  catalogues grew a second kind of block under the row title — the sentence, in
  normal type rather than in `<sub>` — and the old pattern matched `<br><sub>`
  blocks only. It would have matched no rows at all, and that failure looks
  like "there are no samples for that" rather than like a parse error. The
  blocks are matched as a group and classified afterwards, which is the same
  fix the `@docs` links needed, and the tests now cover both kinds.

- **`validate_view` judges a source by its own project's config.** It read
  samples-controls' `abap2ui5lint.jsonc` unconditionally, which is right when
  porting demo-kit samples and wrong for everyone else: an app in another
  repository was measured against that corpus' rule overrides, allow list and
  UI5 floor, with no argument to say otherwise — while the tool's own
  description promised the opposite. New `project_dir` argument; without it,
  the working directory, then the corpus. A named project is taken at its
  word: its config or none, never a silent fallback onto someone else's.

- **`stripJsonc` deleted the wrong character.** Trailing-comma offsets were
  collected in UTF-16 code units and dropped by code point, so one astral
  character — an emoji in a description is enough — shifted every later index
  and left unparseable JSON behind. It reads `abaplint.jsonc` out of a
  repository this server does not own, so the input was never ours to
  constrain.

- **The dev lint config is removed again.** `devLintConfig( )` writes
  `.abaplint-mcp-dev.jsonc` into the ROOT of the samples-controls checkout on
  every lint (it has to — the config's `files` glob resolves from there) and
  left it behind. That it never showed up in a commit rested on one line in
  another repository's `.gitignore`.

- **Two live reads say what is missing.** A checkout can be present and a file
  absent — an older revision, a half-finished pull, a rename upstream — and
  `generation_rules` and `capabilities` answered that with a raw `ENOENT`
  stack trace. They now name the file and say `git pull`, as `pitfalls`
  already did.

- **Setup is documented in three levels**, because the tools do not all cost
  the same: validating views needs one 3 MB checkout, the catalogues need two
  more, and the screenshot loop needs a browser and a first build that takes
  tens of minutes. Registering the server was documented for `claude mcp add`
  alone while the first paragraph promised Cursor, VS Code and any MCP client;
  there is a plain `mcp.json` block for those now.

- **CI clones `samples-controls`,** not `ai-demokit` — that repository was
  renamed, and the clone worked only through GitHub's redirect.

- **The release proves the tarball, not just the working tree.** `npm test`
  runs where every file exists whether or not `files` lists it, so the one
  defect this package can ship — a `lib/` module left out of the allowlist —
  was invisible to the entire suite, and the release job only printed the
  tarball contents. It now installs the tarball into a scratch project and
  drives the installed `bin` over stdio: initialize, `tools/list`, and one
  tool call with every checkout absent, which has to come back as the
  actionable message rather than a crash.
