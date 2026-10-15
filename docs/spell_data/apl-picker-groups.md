# Groups in the APL picker

The APL cast-spell and aura pickers file each entry under one submenu. They try, in order:

1. a manual group the sim names (`MenuGroup`);
2. its category (`Cooldowns`, `Talents`, `External Buffs`, ...);
3. its form bucket;
4. `Spell` (cast-spell picker) or the top level (aura picker).

An entry with a category is never form-bucketed, so the buckets only sort the entries left over after the
groups and categories.

The cast-spell picker lists the form buckets first, then the manual groups, then `Spell`, then the
categories, then the placeholders. The aura picker lists the form buckets, the manual groups and the
categories, then the remaining auras at the top level.

## Form buckets

A unit's forms are the forms its spells with `SpellFlagAPL` shift it into; a shift spell the APL cannot cast
adds no form. A spell config built by `spelldata.SpellConfig` carries the row's `ShapeshiftForm()` as
`ShiftsTo`, and the metadata lists each form once, in id order. A unit that sets `Unit.AlwaysInForm` (the
warrior) never has the no-form state; any other unit with forms has it as `Caster`. The unit's states are its
forms plus the no-form state, unless it has `AlwaysInForm`. A hand-built `core.SpellConfig` sets `ShiftsTo`
itself.

An entry's forms are the states in which its `CastRequirement` allows the cast without leaving the form,
by the rule in [Building an ability](building-an-ability.md#where-a-spell-can-be-cast). An aura takes the
requirement of the spell that casts it (its `RelatedSelfBuff`, or the spell with its id) when that spell
states one, else `Aura.FormRequirement`, which `spelldata.AuraConfig` fills with the form fields of the
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
the category and the form bucket. An aura with no group of its own takes its spell's.

`spelldata.SpellConfig` and `spelldata.AuraConfig` set `MenuGroup` to `forms` on a row that shifts its
caster (`ShapeshiftForm()` is not 0), so the warrior stances and Shadowform sit in `forms` with their auras.
By their masks they would land in "Any stance" or "Any form". Class code that wants another group sets
`MenuGroup` on the returned config:

```go
config := spelldata.SpellConfig(&warrior.Unit, rank, spelldata.Flags(core.SpellFlagAPL))
config.MenuGroup = "my_group"
```

A hand-built `core.SpellConfig` or `core.Aura` sets `MenuGroup` itself.
