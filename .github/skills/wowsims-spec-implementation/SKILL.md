---
name: wowsims-spec-implementation
description: 'Use when picking up a [Spec] tracking issue for Forever: turning the datamined talent and ability checklist into a working spec, generating the class spell data, deciding what game files content is actually live, writing its SIML rotations and gear sets, and verifying work the expected results cannot see.'
argument-hint: 'Name the spec and the issue number to work from.'
---

# Implementing a spec for Forever

Comments, docs, commit messages and PR text follow `wowsims-conventions`: "game files", not "client", no history in comments, no "golden".

## Scope

- Executing a `[Spec] Implement ...` issue, one checkbox per talent and per ability family.
- Producing the checklist for a spec that does not have an issue yet.

Not in scope: the spell data pipeline itself, which `wowsims-spells` covers, and item or enchant data.

## Where the numbers come from

The checklists are datamined, not hand-written. The extract lives outside this repo - it is working
tooling, not something the sim reads - so ask for its location rather than assuming a path. It
produces one JSON per class holding `abilities`, `families`, `talents` and a `meta` block naming the
game build and trait tree.

A `family` is an ability and all its ranks, keyed by its lowest rank's spell id. A checklist is one
box per family, not per rank: Heroic Strike has nine ranks and one box.

## Deciding what is actually live

**The Forever build carries Season of Discovery content that is not live.** This is the single
biggest source of wrong entries, and it is not obvious from the extract alone - the spells are in the
game files database, correctly extracted, and simply not part of the game being simulated.

The comparison against the SoD build is what settles it, per class: spell ids in both builds, ids in
SoD only, and ids in Forever only. Exclude the SoD-only ones. For warrior that removed an entire
Runes tree of `S03 - Tuning and Overrides Passive` entries, Dual Wield Specialization ranks 2-5,
eight stray Bloodthirst rows and Intervene - 13 of 54 families.

Anything the extract lists with no name and no description is the shape to check first; on warrior
every one of them was SoD-only.

## Traps

- **A new low rank shifts every rank above it.** Forever's Slam gains a rank 1 (`1240193`), so every
  older Slam id is one rank lower than it was while keeping its id. Match on spell id, never on rank.
- **Descriptions carry in-game colour codes.** Strip `|CFFFFFFFF` and `|R` and collapse whitespace, or
  the issue body renders as noise.
- **Comparing by name and comparing by id answer different questions.** A talent absent from another
  build's spell ids may still exist there under a different id. If the claim is "this is new", check
  the other build's data directly rather than inferring it from what the sim happens to register.
- **Counts in an issue body go stale.** They are a starting point to verify against the game files. Say
  what was filtered and why, so a re-run producing different numbers is explainable rather than
  alarming.

## Implementing

Read the class's generated spell data first - `sim/<class>/spell_data_auto_gen.go` - and take every
number the game files state from it rather than writing a literal. `docs/spell_data/` has the shapes,
the readers and the worked examples; `wowsims-spells` has the pipeline.

Where the sim and the game files disagree, decide rather than assume, and record the decision at the call
site. A literal that survives needs the reason on its line.

### Hit, crit and haste, and the weapon they need

Gear and auras give one `stats.HitRating`, `stats.CritRating` and `stats.HasteRating`, each reaching
physical and spell alike; there is no melee- or spell-only rating to write. "Weapon requirements and the
one rating" in `docs/spell_data/weapon-requirements.md` has the rule for a talent naming a weapon, the APIs and the
weapon-bound talents already audited for the classes still to port: rogue Precision, Hack and Slash and
Fist Weapon Specialization, Lethal Shots, shaman Thundering Strikes and the shaman Dual Wield
Specialization rune.

### Rotations, gear sets and builds

A spec's presets are SIML files under `ui/specs/<class>/<spec>/`. `sim/siml/SPEC.md` is the language.

- `apls/<name>.apl.siml` holds a rotation. It opens with `siml 1` and `spec <field>`, the spec's field in the `spec`
  oneof of `Player` in `proto/api.proto`: `hunter`, `dps_warrior`, `enhancement_shaman`.
- `gear_sets/<name>.gear.siml` holds one slot row per item: `main_hand arcanite_reaper + weapon_crusader`.
- `builds/<name>.siml` holds a Go suite's test build (`core.GetTestBuild`), a whole setup, or a preset build the
  site offers, which states only what it changes over `defaults.siml`. A `use` line takes a gear set or a rotation
  from its own file, by a path from the build's folder: `use "../gear_sets/p1.gear.siml"`.
- `defaults.siml` holds the setup the spec's page starts with, a whole setup in the same form, with what the page
  sets on top of it stated: the race, `reaction_time_ms 100`, the rotation type (`apl: type auto` when the spec has
  no default rotation), for a tank `in_front_of_target` and `tanks player1`, and for a healer `target_dummies 9`.
  `spec.ts` reads it through `PresetUtils.specDefaultsFromSettings`, and `tools/aplsim` sims a rotation on it, with
  the preset build that uses the rotation loaded over it.

Every spell, aura, item and enchant is written by its name in the name table, `sim/siml/names.json`:
`cast mortal_strike`, `target.aura(sunder_armor).num_stacks`, `cast item.goblin_sapper_charge`. A spell or aura has
a name once the sim registers it, so register the spells first and then run `make sim/siml/names.json`. It adds
their names, and the table goes into the same commit as the spells. A `qualified:` line in its report means a shared
entry (a gear or encounter spell) holds the plain name of one of the class's spells, so `cast fireball` would mean the
shared spell: run the generator with the `-repin` that line names on the committed table
(`git checkout sim/siml/names.json` first) to give the class the plain name. The site's Rotation tab writes a rotation with
**Export SIML**. `make vscode-apl` builds the editor extension, which completes the names the file's spec registers
(`tools/vscode-apl/README.md`). A name the table does not hold fails, with the names close to it:

```
$ go run --tags=with_db ./cmd/wowsimcli siml parse x.apl.siml
x.apl.siml:5:8 unknown-name no spell is named mortal_strik; did you mean mortal_strike?
x.apl.siml does not load
```

`presets.ts` imports each file through `tools/vite/siml.mts` as the JSON of its message: an `APLRotation`, an
`EquipmentSpec`, or an `IndividualSimSettings` for a build.

```ts
import DefaultApl from './apls/default.apl.siml';
import TestingBuildJson from './builds/testing.siml';
import PreBiSGearJson from './gear_sets/prebis.gear.siml';

export const ROTATION_PRESET_DEFAULT = PresetUtils.makePresetAPLRotation('Default', DefaultApl);
export const PreBiSGear = PresetUtils.makePresetGear('Pre-BiS', PreBiSGearJson);
export const TestingBuild = PresetUtils.makePresetBuildFromJSON('Testing', Spec.SpecEnhancementShaman, TestingBuildJson);
```

The Go suite reads the same files, for example `core.GetAplRotation("../../../ui/specs/warrior/dps/apls", "arms")`
and `core.GetGearSet("../../../ui/specs/warrior/dps/gear_sets", "p1_arms")`.

## Verifying

```
go test --tags=with_db ./sim/...          # the tag is required
git status --porcelain -- '*.results'      # empty unless a number was meant to move
go run ./tools/database/gen_spelldata      # regenerate; the diff must be empty
go run --tags=with_db ./cmd/wowsimcli siml fmt -check ui/specs/<class>   # each file reads and is in canonical form; -w writes it
```

`siml fmt -check` fails on a `.siml` file under `ui/specs` that does not read cleanly, is not in canonical form, sits
outside its class folder, or names a spell or aura its spec does not register; `go test --tags=with_db
./cmd/wowsimcli/...` runs it over every file under `ui/specs`. `./sim/...` includes `sim/siml`, whose tests fail on a
name table that was not regenerated.

**A .results file that cannot move proves nothing.** Check that the suite actually exercises what was
changed before reading a pass as evidence - grep the .results for the spell id. The TBC paladin .results
carry no seal spell id at all, so every seal change "passed" while testing nothing; that port was
verified instead by dumping each constructed row against the literal it replaced, field by field,
which is what found the bugs.

**Before committing, run the `wowsims-review` pass over the diff**, ideally from a fresh agent: every number
and hand-built config against its row and tooltip, the rules the rows cannot show, and every finding
verified before it is fixed. The PR body carries its "checked, not findings" and "hand numbers that stay"
lists.

Read the summary lines rather than the exit code: `rtk`-wrapped `go test` has reported success for a
failing run. `.results.tmp` files are written on every run, so their presence means nothing either.
