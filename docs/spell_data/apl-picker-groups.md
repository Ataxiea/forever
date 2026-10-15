# Groups in the APL picker

The APL cast-spell and aura pickers file each entry under one submenu. They try, in order:

1. the top level, for a shift spell of the unit (one listed in its forms) and the aura with its id;
2. a manual group the sim names (`MenuGroup`);
3. its category (`Cooldowns`, `Consumables`, `Items`, `Racials`, `Professions`, `External Buffs`, ...),
   except `Talents`;
4. its talent tree (`Holy`, `Arms`, ...);
5. the `Talents` category, for a talent aura with no tree;
6. its form bucket;
7. `Spell` (cast-spell picker) or the top level (aura picker).

An entry with a category or a tree is never form-bucketed, so the buckets only sort the entries left over
after the groups, categories and trees.

The cast-spell picker lists the shift spells first, then the form buckets, the talent trees, the manual
groups, `Spell`, the categories and the placeholders. The aura picker lists the shift auras, the form
buckets, the talent trees, the manual groups and the categories, then the remaining auras at the top level.
The trees follow the talent calculator's order. The ranks of a spell sit behind its highest rank wherever
it is filed.

## Talent trees

A spell a talent grants is registered with `SourceTalent` (`Character.WithSource`), and the metadata marks
it `from_talent`; its category leaves the talent source out, so `from_talent` is the only sign of it. A
talent's aura carries the `Talents` category. Every entry so marked is looked up by its name, without the
rank, among the talents of the unit's class (`fancyName` in `ui/sim/talents/trees/<class>.json`), and files
under the `name` of the tree that talent sits in, as the JSON writes it. The metadata states the class
(`UnitMetadata.class`) for a player character only, so a pet's or a target's entries find no tree.

A talent spell with no matching talent stays where it would file without one: its form bucket or `Spell`.
A talent aura with no matching talent stays under `Talents`. A talent entry with another category, such as
a talent's major cooldown under `Cooldowns`, keeps that category.

When an entry's name differs from its talent's, set `Talent` on the `core.SpellConfig` (or `*core.Spell`)
or `core.Aura` to the spell id of the talent row, the talent JSON's `spellId`. The pickers look the link up
before the name, and an aura with no link of its own takes its casting spell's. A link to a talent the
class's JSON does not list falls back to the name. Twist of Light's Echo auras link the talent this way:

```go
talent := spellData.TwistOfLight.Rank(1)
paladin.RegisterAura(core.Aura{ActionID: core.ActionID{SpellID: id}, Talent: talent.ID})
```

## Form buckets

A unit's forms are the forms its spells with `SpellFlagAPL` shift it into; a shift spell the APL cannot cast
adds no form. A spell config built by `spelldata.SpellConfig` carries the row's `ShapeshiftForm()` as
`ShiftsTo`, and the metadata lists each form once, in id order. A unit that sets `Unit.AlwaysInForm` (the
warrior) never has the no-form state; any other unit with forms has it as `Caster`. The unit's states are its
forms plus the no-form state, unless it has `AlwaysInForm`. A hand-built `core.SpellConfig` sets `ShiftsTo`
itself.

An entry's forms are the states in which its `CastRequirement` allows the cast without leaving the form,
by the rule in [Building an ability](building-an-ability.md#where-a-spell-can-be-cast). An aura takes the
requirement of the spell that casts it (its `RelatedSelfBuff`, or the spell with its id) when that
requirement names forms (`Forms`, `ExcludedForms`, `CasterForm` or `NotShapeshifted`), else
`Aura.FormRequirement`, which `spelldata.AuraConfig` fills with the form fields of the
row's `CastRequirement()`: on a passive the mask reads "active in" (Leader of the Pack 0x91: Cat, Bear, Dire
Bear). An external buff, cooldown or debuff gets no forms, since its mask names its caster's forms.

Labels: `Battle only` for one state (`rotation_tab.apl.forms.only`, "{{form}} only"), `Battle + Defensive`
for several, `Any stance` (`rotation_tab.apl.forms.any_stance`) when the entry works in every state of a
unit whose forms are all stances and which is never without one, else `Any form`
(`rotation_tab.apl.forms.any_form`). The short names are `rotation_tab.apl.forms.names.<form id>`; a form
without one, or whose short name another of the unit's forms shares, shows its spell's name, so each set of
states has a label of its own. The no-form state is `rotation_tab.apl.forms.no_form`. Entries that work in
the same states share a bucket. The buckets are ordered `Any` first, then by the number of states they name,
then by the first state's place in the state list, with ties going by the next state's place.

`Spell` stays when the unit has no forms, for an entry that works in none of the unit's states, and when
every entry left over that works in some state falls in the same bucket, which would only rename `Spell`.
In the aura picker an aura that works in every state stays at the top level. All ranks of a spell file under
the highest rank, in the highest rank's bucket.

## Manual groups

Set `MenuGroup` on a `core.SpellConfig` (or the `*core.Spell` it returns) or on a `core.Aura` to a
lowercase_underscore key, and add the label under `rotation_tab.apl.submenus.<key>`. The group wins over
the category, the talent tree and the form bucket; a shift spell and its aura stay at the top level
whatever their group. An aura with no group of its own takes its spell's.

`spelldata.SpellConfig` sets no group. Class code that wants one sets `MenuGroup` on the returned config,
and the spell's aura follows:

```go
config := spelldata.SpellConfig(&warrior.Unit, rank, spelldata.Flags(core.SpellFlagAPL))
config.MenuGroup = "my_group"
```

A hand-built `core.SpellConfig` or `core.Aura` sets `MenuGroup` itself.
