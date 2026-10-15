# Groups in the APL picker

The APL cast-spell and aura pickers file each entry under one submenu. They try, in order:

1. the top level, for a shift spell of the unit and the aura with its id;
2. a manual group the sim names (`MenuGroup`);
3. its category (`Cooldowns`, `Consumables`, `Items`, `Racials`, `Professions`, `External Buffs`, ...),
   except `Talents`;
4. its talent tree (`Holy`, `Arms`, ...);
5. the `Talents` category, for a talent aura with no tree;
6. `Spell` (cast-spell picker) or the top level (aura picker).

The cast-spell picker lists the shift spells first, then the talent trees, the manual groups, `Spell`, the
categories and the placeholders. The aura picker lists the shift auras, the talent trees, the manual groups
and the categories, then the remaining auras at the top level. The shift entries follow the sim's form
order and the trees the talent calculator's. The ranks of a spell sit behind its highest rank wherever it
is filed.

## Shift spells

The metadata's `shift_spells` are the unit's spells with `SpellFlagAPL` that shift it into a form, one per
form, in form id order: Battle, Defensive, Berserker for a warrior, the order of the stance bar in game. A
shift spell the APL cannot cast is left out. A spell config built by `spelldata.SpellConfig` carries the
row's `ShapeshiftForm()` as `ShiftsTo`, and a hand-built `core.SpellConfig` sets `ShiftsTo` itself.

The pickers list those spells at the top level ahead of every other entry, in that order, whatever their
group or category. An entry matches a shift spell by its name without the rank and its tag, so every rank
of a ranked shift spell sits there behind its highest rank, and so does the aura of the same name.

## Talent trees

An entry that is a talent's files under the tree of its talent, found by its talent link, else by its
name. A spell is a talent's when it is registered with `SourceTalent` (`Character.WithSource`): the
metadata marks it `from_talent`, and since its category leaves the talent source out, `from_talent` is the
only sign of it. An aura is a talent's when it carries the `Talents` category. The pickers look the talent
up among the talents of the unit's class in `ui/sim/talents/trees/<class>.json`: by the link against
`spellId`, else by the entry's name without the rank against `fancyName`. The entry files under the `name`
of the tree that talent sits in, as the JSON writes it. The metadata states the class (`UnitMetadata.class`)
for a player character only, so a pet's or a target's entries find no tree.

A talent spell with no matching talent stays under `Spell`. A talent aura with no matching talent stays
under `Talents`. A talent entry with another category, such as a talent's major cooldown under `Cooldowns`,
keeps that category.

When an entry's name differs from its talent's, set `Talent` on the `core.SpellConfig` (or `*core.Spell`)
or `core.Aura` to the spell id of the talent row. An aura with no link of its own takes its casting spell's.
The link only picks the tree of an entry that is already a talent's; on any other entry it files nothing. A
link to a talent the class's JSON does not list falls back to the name. Twist of Light's Echo auras link the
talent this way:

```go
talent := spellData.TwistOfLight.Rank(1)
echo.aura = paladin.RegisterAura(core.Aura{
	Label:    fmt.Sprintf("Echo (%d)%s", id, paladin.Label),
	ActionID: core.ActionID{SpellID: id},
	Duration: core.NeverExpires,
	Talent:   talent.ID,
})
```

## Manual groups

Set `MenuGroup` on a `core.SpellConfig` (or the `*core.Spell` it returns) or on a `core.Aura` to a
lowercase_underscore key, and add the label under `rotation_tab.apl.submenus.<key>`. The group wins over
the category and the talent tree; a shift spell and its aura stay at the top level whatever their group. An
aura with no group of its own takes the group of the spell that casts it (its `RelatedSelfBuff`, or the
spell with its id).

`spelldata.SpellConfig` sets no group. Class code that wants one sets `MenuGroup` on the returned config,
and the spell's aura follows:

```go
config := spelldata.SpellConfig(&warrior.Unit, rank, spelldata.Flags(core.SpellFlagAPL))
config.MenuGroup = "my_group"
```

A hand-built `core.SpellConfig` or `core.Aura` sets `MenuGroup` itself.
