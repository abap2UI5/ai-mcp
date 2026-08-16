# Changelog

## Unreleased

Nothing published yet — `@abap2ui5/mcp` has never been on npm. Everything
below is what the first version will carry, and what changed since the server
was only installable as `npx --yes github:abap2UI5/ai-mcp`.

- **`examples` searches all three sample repositories, not one.** The tool
  read `abap2UI5/samples` and nothing else, so two thirds of the answer was
  invisible to it: `samples-controls` (431 ports of the UI5 demo kit — the
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
