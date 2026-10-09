# WoWSims APL editor

Open an `.apl.json` rotation and click the tree icon in the editor's title bar (or _WoWSims: Open APL
Editor to the Side_, `Ctrl+K A`): a panel opens beside the JSON, the way the Markdown preview does, and
shows the rotation as it reads: the prepull list with its times, the priority list, the groups and the
variables, each action with its condition written out (`if not Aura Active(target, Hunter's Mark)`) and
every spell and item with its name and icon from `assets/database/db.json`.

The panel edits as well as shows:

- drag a row by its grip to reorder it, or Alt+↑/↓ on a focused row;
- the eye hides a row (the sim skips it), and the row buttons duplicate or delete it;
- the chevron opens a row's form: the action kind, its fields and its condition, each value a kind with
  its own fields, nested as deep as the condition goes;
- a spell or aura field offers only what the sim registers for the file's spec (see below), filed under
  the site's categories, with the ids the rotation already names first;
- `+ Add action`, `+ condition`, `+ value`, `+ group` and `+ variable` pick from the kinds the site
  offers in that list, with the site's labels and descriptions.

Clicking a row selects its JSON; moving the cursor in the JSON highlights its row.

## Registered spells

A spell field offers the spells the sim registers for the spec the file sits in (`ui/specs/hunter/dps`
is the hunter's), filtered the way the site filters them for that field: castable spells for Cast, spells
with a DoT for the DoT values, channels for Channel, and so on. An aura field offers the auras of the unit
it points at: the target's debuffs for the target, the pet's auras for the pet, the player's otherwise.
Fields that take items also list the database's items, since what an item registers depends on the gear.

The lists come from `go run --tags=with_db ./tools/aplspells`, which the extension runs once per session
(the first run compiles the sim). It builds every playable race of the spec at each talent rank (every
talent at rank 1, then 2, and so on, capped at its own highest) with every raid buff, party buff and debuff
on, and keeps every spell and aura `ComputeStats` reports. That is everything any build of the spec can
register: talent-granted spells, rank-tagged auras, racials and external buffs. _WoWSims: Reload
Registered APL Spells_ runs it again after a change to the sim.

An id already in the file that the spec does not register has a `!` on its chip. That is either a mistake
or something gear registers: a trinket's use spell, a weapon's proc. Until the sim answers, for a file
outside `ui/specs`, and for a spec the sim cannot build yet (one with code still to port), the picker lists
the whole database and says why, with an id box for a raw spell id (`i<id>` an item).

## How it edits

The JSON file is the only state. Every change in the panel is a small text edit the extension makes to
the document, at the JSON path it changes: a new value goes in on one line, a moved row keeps its own
text, a removed one takes its comma with it. The document then changes as if typed, so undo, the dirty
marker and git work as they do for a hand edit, and the panel redraws from the new text. JSON files do
not format on save in this repository; `npx oxfmt <file>` wraps an inserted line that runs long. While the JSON does not parse, the panel shows the last version that did and holds edits.

The forms are the site's own: the panel bundles `ui/features/apl/model` (`actionKinds`, `valueKinds`,
`resolveField`) and the generated protos, so a kind added to the site appears here on the next build,
with its label, fields and defaults. The site reads only the class off the player for these, which the
panel takes from the spec folder (`ui/specs/hunter/...`). Units, which the site lists from the raid and
the encounter, are a type and an index here. A field the site has no picker for shows as JSON.

## Schema

The build also writes `schemas/apl_rotation.schema.json` from the generated protos, which
`.vscode/settings.json` gives every `*.apl.json`: the JSON editor completes field, kind and enum names
and marks a name the proto does not have.

## Settings

|                        |                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `wowsims-apl.goBinary` | the `go` binary that runs `tools/aplspells`; `go` looks on the PATH, then GOROOT and the usual install dirs |

## Build and install

The source is `tools/vscode-apl`; `.vscode/extensions/wowsims-apl` is its build output and is not
edited by hand. From the repository root:

```
make vscode-apl                                    # npm ci, typecheck, bundle, write the manifest and schema
cd tools/vscode-apl && npm run check && npm test   # the committed output and schema match a fresh build
```

The build needs the root `node_modules` and the generated protos (`make` builds both). VS Code (1.91 or
later) treats `.vscode/extensions/wowsims-apl` as a workspace extension: opening the repository shows an
_Install Workspace Extension_ prompt once. A panel reads the database when it opens, so the names and
icons from a fresh `make db` show in the next panel without a rebuild.
