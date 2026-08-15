# Changelog

## Unreleased

Nothing published yet — `@abap2ui5/mcp` has never been on npm. Everything
below is what the first version will carry, and what changed since the server
was only installable as `npx --yes github:abap2UI5/ai-mcp`.

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
