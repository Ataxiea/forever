# WoWSims SIML

The editor support for SIML, the text form of a rotation (`x.apl.siml`), a gear set (`x.gear.siml`) and a whole sim
setup (`x.siml`). `sim/siml/SPEC.md` is the language. The extension is two parts:

- the client of the **SIML language server**, `wowsimcli siml lsp` (`sim/siml/lsp`, its analysis in
  `sim/siml/lang_*.go`), which serves every `*.siml` file to VS Code and to any editor that speaks the Language Server
  Protocol;
- a **panel** that shows an `.apl.siml` rotation as it reads, edits it through the text, and sims it, each through the
  server's requests.

## The language server

On activation the extension builds the server from the repository each open `*.siml` file is in,
`go build --tags=with_db -o <storage>/<hash of the root>/wowsimcli ./cmd/wowsimcli` in the repository root, under a
_Building the SIML server_ notification; a build that is up to date relinks nothing. It then starts
`wowsimcli siml lsp` in the root for that repository's `file:` and `untitled:` `*.siml` documents. A build that fails
puts the compiler's output in the _WoWSims SIML_ output, and the server stays down until _WoWSims: Restart SIML
Server_, which builds and starts it again; run it after pulling Go changes too. `wowsims-apl.server` names a prebuilt
binary to run instead.

The server reads each file with `sim/siml`, the name table (`sim/siml/names.json`) and the item database
(`assets/database/db.json`), all from the repository the file sits in. A fresh `make sim/siml/names.json` or `make db`
needs no restart: the open files are checked again when the editor reports the change, and the panel reads the
rotation again with them.

- **Diagnostics.** The parser's errors and warnings, each with its did-you-mean; a name the file's spec registers for
  no build; the rotation lints at the text of the node each is about; and a slot row whose item goes in
  another slot, whose suffix the item does not roll, or whose enchant fits neither the slot nor the item. Under
  `ui/specs` warnings are errors and a raw ref is one, as the repository's checks hold them.
- **Completion.** Sections and the top lines; a section's fields, an enum's values and a flag list's flags; the
  action keywords and kinds of a row, and the time a prepull row starts with; values, accessor heads, their
  properties and the properties' arguments; units; variables, groups, sequences and placeholders; and the names of
  the table for the position: the spells and auras the file's spec registers, the class's first, then the shared ones
  that gear, consumables and encounters add; `item.` with the items that have a use, `other.`, the items of a slot, the
  suffixes of an item, the enchants that fit, and the consumables of a field.
- **Hover.** A spell's or aura's game name, ids and the specs that register it, with its row of the game files from
  `go run ./tools/spelldata <id>`; an item, an enchant or a suffix from the database; a kind's fields; a unit's JSON;
  a variable's, group's or sequence's declaration.
- **Navigation.** Go to definition, find references and rename for variables (both `$name` and `${Exact Name}`),
  groups, sequences and placeholders; the outline of sections, variables and sequences; folding. A variable that a
  `use … with` list sets leads to the file that declares it, and its references and renames take in the `with` lists
  of the `.siml` files near that file. A rename to a name that cannot be written, or that another of its kind already
  has, is refused. A `use` path links to the file it names, and go to definition opens it.
- **Semantic tokens**, on top of the grammar: sections, fields, kinds, units, enum values and the table's names.
- **Formatting** with `format`, the printer every committed file is a fixed point of.
- **Code actions.** A word the parser does not know changes to a name its did-you-mean offers. An `and(…)` or `or(…)`
  of one operand becomes the operand; an `and` in parentheses inside an `and` (or an `or` in an `or`) joins it. Each
  changes the rotation's proto, so none is made without asking.

### Another editor

Build the server, `go build --tags=with_db -o wowsimcli ./cmd/wowsimcli`, and start `wowsimcli siml lsp` in the
repository root for files that end in `.siml`, with the language id `siml`; it logs on stderr. The server needs no
settings: it finds the repository above each file it is given, and reads an untitled file in the first workspace
folder's. Hovers run go for a spell's game files row; the initialization option `goBinary` names the binary, and
`workspace/didChangeConfiguration` with `{"settings": {"wowsims-apl": {"goBinary": "..."}}}` changes it.

The server provides: full sync, `publishDiagnostics`, completion, hover, definition, references, rename with prepare,
document symbols, document links, folding ranges, full semantic tokens, formatting and code actions. When the client
registers file watchers dynamically, the server watches the table, the database and the `*.siml` files through
`workspace/didChangeWatchedFiles`. The panel's requests (`siml/rotation`, `siml/splice`, `siml/database`,
`siml/patterns`, `siml/insertPattern`, `siml/sim`) are in `sim/siml/lsp/panel.go`.

For Neovim, for example:

```lua
vim.filetype.add({ extension = { siml = 'siml' } })
vim.lsp.config('siml', { cmd = { '/path/to/wowsimcli', 'siml', 'lsp' }, cmd_cwd = '/path/to/forever', filetypes = { 'siml' } })
vim.lsp.enable('siml')
```

## Commands

|                                      |                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| WoWSims: Open APL Editor to the Side | the panel beside an `.apl.siml` file (`Ctrl+K A`)                                 |
| WoWSims: Sim This APL                | sims the rotation as it is in the editor, unsaved edits included                  |
| WoWSims: Compare APL With Saved      | sims the saved file, or `HEAD` when nothing is unsaved, against the editor's text |
| WoWSims: Insert APL Pattern          | inserts a common shape after the row the cursor is on                             |
| WoWSims: Restart SIML Server         | builds the server again and restarts it                                           |

A rotation kept as JSON prints as SIML with
`go run --tags=with_db ./cmd/wowsimcli siml print -kind apl -spec <spec> <file.apl.json>`.

## Settings

|                               |                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `wowsims-apl.goBinary`        | the `go` binary that builds the server and reads spell hovers; `go` looks on the PATH, then GOROOT and the usual install dirs |
| `wowsims-apl.server`          | a prebuilt `wowsimcli` (built with `--tags=with_db`) to run as the server instead of building one                             |
| `wowsims-apl.simIterations`   | iterations per sim run from the editor (1000)                                                                                 |
| `wowsims-apl.simSettingsFile` | settings exported from the site, as JSON or SIML, the character sims from the editor run with                                 |

## The panel

Open an `.apl.siml` rotation and click the tree icon in the editor's title bar: a panel opens beside the text and
shows the rotation as it reads, the prepull list with its times, the priority list, the groups and the variables, each
action with its condition written out and every spell and item with its name and icon from the database.

The panel edits as well as shows: drag a row by its grip, or Alt+↑/↓ on a focused row; the eye hides a row; a row's
form edits its action kind, fields and condition; `+ Add action`, `+ condition`, `+ value`, `+ group` and
`+ variable` pick from the kinds the site offers. A spell or aura field offers the names of `sim/siml/names.json` that
the spec on the file's `spec` line registers, in the namespace the parser reads the field in: an aura by the unit the
field points at, a boss spell among the target's spells. Fields that take an item offer the items with a use. Each
choice is written as its name.

- **Edits go through the text.** Each change is made with the server's `siml/splice`: only the statements it touches
  are printed again, and every other line, comment and blank line stays as written. Undo, the dirty marker and git
  work as they do for a hand edit. The panel shows its change at once and the text catches up.
- **Read-only.** While the text has an error the panel shows the rotation as it last read, says where the first error
  is, and makes no edits. A rotation put together with another file (`use "default.apl.siml" with …`) is shown with
  the rows it uses and is edited as text.
- **Refused edits.** An edit the server cannot splice, such as one through a row that does not exist or one that leaves
  the rotation with an error, is not made, and a warning says why. An edit the panel made before it saw someone else's
  change to the text is dropped, and the panel shows the text as it is.

The forms are the site's own: the panel bundles `ui/features/apl/model` and the generated protos. The panel's rows
carry the file's diagnostics, the same the Problems panel lists.

**▶ Sim** and **⇄ Compare** run the request of `wowsimcli siml sim` in the server (`siml/sim`), one at a time, with the
editor's text and the file's path; cancelling the notification or stopping the server stops the sim. The `use` lines
are read against the path from disk, so each used file must be saved first, and a sim is refused while one has unsaved
changes. The character is the spec's `defaults.siml`, with the one preset build (`builds/*.siml`) whose
rotation is the saved file's loaded over it (`turret.apl.siml` takes `builds/mm.siml`); a rotation no build has, or
several have, such as `arms.apl.siml`, is simmed on the defaults. A settings file (`wowsims-apl.simSettingsFile`)
supplies the character instead, a preset build loaded over its spec's `defaults.siml` the same way. The panel then
shows the DPS, how often each row ran per fight, the damage by spell and a timeline of one fight; the editor shows
each row's count at the end of its line. A compare sims the saved file, or `HEAD` when nothing is unsaved, as the
base.

_Insert APL Pattern_ (or **+ pattern** in the panel) asks for each value of a common shape, its default filled in, and
inserts it: refresh a DoT, keep a debuff up, an execute block, a toggle group, a prepull sequence and more. A condition
pattern goes onto the priority or group row the cursor is on.

## Build and install

The source is `tools/vscode-apl`; `.vscode/extensions/wowsims-apl` is its build output and is not edited by hand.
From the repository root:

```
make vscode-apl                                    # npm ci, typecheck, bundle, the manifest and the panel; the grammar
cd tools/vscode-apl && npm run check && npm test   # the committed output matches a fresh build; the tests
```

The build needs the root `node_modules` and the generated protos (`make` builds them). The grammar,
`syntaxes/siml.tmLanguage.json`, is written by `go run ./cmd/wowsimcli siml grammar -o <file>`, whose test checks the
committed one. VS Code (1.91 or later) treats `.vscode/extensions/wowsims-apl` as a
workspace extension: opening the repository shows an _Install Workspace Extension_ prompt once.

The panel's page (`out/webview.js` and `out/webview.css`) bundles the generated protos, the site's APL model and its
English strings, so it is not committed: run `make vscode-apl` once, and again after those change. Until then the
panel says to. `npm run check` builds the page too, but compares only the committed output.

The tests bundle the extension from its sources as the build does and run it against the stand-in for VS Code in
`test/vscode.mjs`, whose language client starts the server the extension builds, so they need go:
`test/extension.test.mjs` drives the extension's host, `test/webview.test.mjs` the panel's page bundled from its
sources, and `test/sim.test.mjs` the sims. The server's own cases are Go tests, in `sim/siml/lsp` and
`sim/siml/lang_*_test.go`.
