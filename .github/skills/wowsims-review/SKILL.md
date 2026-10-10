---
name: wowsims-review
description: 'Use before committing or opening a pull request that registers or changes a spell, talent, aura, dot or proc, and when reviewing such a pull request by someone else. A fixed pass: every number and hand-built config checked against its game files row and tooltip, the rules the rows cannot show checked against core, every finding verified before it is reported, and each fix written to read the spell store. Also covers the SIML name table and rotations such a change moves, and a change to the SIML grammar.'
argument-hint: 'Name the branch, the pull request number or the files to review.'
---

# Reviewing a spell change

Comments, docs, commit messages and PR text follow `wowsims-conventions`: "game files", not "client", no history in comments, no "golden".

The pass is the same on your own branch before a commit and on someone else's pull request. The author of a
change reads it the way they meant it, so a self-review works best handed to a fresh agent with the diff and
this skill; the author then verifies each finding that comes back the way step 7 says, and fixes it.

## Scope

- Class, spec, talent, aura, dot and proc code under `sim/`, and the overrides and class ladders it reads.
- The SIML name table and rotations such a change moves, and a change to the SIML language itself (step 6).
- Not the frontend (`wowsims-ui` has its own verification) and not the generator internals (`wowsims-spells`).

`references/defects.md` is the catalog: each defect class the pass looks for, with a case the review of a
port found and the fix that reads the row.

## 1. Inventory

```
git diff origin/master...HEAD --stat -- sim/ tools/ ui/specs/   # what the change touches
git diff origin/master...HEAD -- sim/<class>/                    # read every hunk, not the stat
```

List every spell id, ladder and talent the diff registers or changes, and every number literal it adds.
Read the PR body and the commit messages as claims to check, not as a summary: "the generator refuses the
placeholders once the game files state them" was written above five Go constants that no generator reads.

## 2. Each spell against its row

```
go run ./tools/spelldata <id>                     # header, effects, the ladder call that reaches it
go run ./tools/spelldata -config 'spelldata.SpellConfig(&<class>.Unit, <rank>, ...)' -package <class>   # what the resolver builds
sqlite3 tools/database/wowsims.db "select Description_lang, AuraDescription_lang from Spell where ID=<id>"   # the tooltip
sqlite3 tools/database/wowsims.db "select Attributes from SpellMisc where SpellID=<id>"   # every attribute word
SPELLDATA_REPORT=1 go test --tags=with_db ./sim/<class>/ -run <Test> -count=1 -v   # the effects the parse skipped; -v, or a passing run prints nothing
```

`go run ./tools/spelldata` prints only the attributes `attributes.go` reads; the `SpellMisc` query shows the
rest, such as "not usable in combat" (word 0, `0x10000000`). The Wowhead Forever tooltip shows the values
scaled to level, which the `$s1`-style tooltip text does not.

Then make three comparisons for each spell:

1. **Every literal against the row.** A number the row states is a finding: the fix reads the accessor. A
   number the row does not state is an override in `tools/database/overrides/spell_overrides.go` where one of
   its kinds fits (an attack power coefficient is `APCoefDirect` or `APCoefPeriodic`), so the generator refuses
   it once the game files catch up; otherwise a literal with its reason and a `// TODO:` on the line.
2. **Every hand-built piece against the resolver.** A `core.SpellConfig`, aura, dot, `OnTick` or proc trigger
   written by hand is compared with what `SpellConfig`, `AuraConfig`, `DotConfig`, `ParseEffects` or
   `ProcTrigger` build from the row. Where they agree, the hand code goes. Where they differ, the tooltip
   decides which is right, and the decision is written at the call site.
3. **Every effect index against the tooltip.** The tooltip's `$s2` and `$m2` name effect 2. Code that reads
   another effect because its number happens to match is a finding even when nothing moves today.

## 3. Rules the rows cannot show

Each of these has a section in `references/defects.md`.

- **Core's order.** `cast.go` runs `applyEffects` before `OnCastComplete`, and a proc trigger's handler runs
  inside `applyEffects` only with `TriggerImmediately`; without it, which is how `spelldata.ProcTrigger`
  builds one, the handler runs a `SpellBatchWindow` later. Which of the two a buff's proc is decides whether
  an `OnCastComplete` handler sees the cast that procced it, so a claim about order is proven at runtime,
  never by reading the call order alone.
- **What a cast spends, and when.** Combo points and extra energy are spent on a landed hit only; a
  one-charge buff is consumed by the cast it modifies; a refund on a miss is the row's (`MissRefund()`).
- **What scales.** A tick that should scale with stacks or combo points; a row's `PointsPerResource`; a flat
  weapon bonus, which is added before the weapon percent multiplies it.
- **How many targets.** An area effect (`Effect.HitsAnArea()`, `Spell.MaxTargets`) hits every enemy, and a
  `SPELLMOD_JUMP_TARGETS` or tooltip "up to $s3 targets" is the total, not the extra.
- **What the row forbids.** A form or stance requirement, the weapon or shield the row needs and the "not
  usable in combat" bit, which `CastRequirement` enforces and `ExtraCastCondition` never restates.
- **Hooks.** Each hook is attached once, on every path that needs it (every attack that breaks stealth, a
  queued swing wired into the auto attacks for every spec that registers it), and not re-attached on each
  iteration's reset.
- **Whose state.** An effect on several targets reads each hit target's auras, not the primary target's; a
  tagged aura counts only this caster's; a map read for a key it may lack does not default to 0.

## 4. Hygiene

- **Orphans the change made.** A function with no caller, a mask naming a spell nothing registers, an
  empty body the change left behind: remove them in the same change.
- **A live talent never becomes a silent no-op.** An unported talent or ability keeps its stub and a
  `// TODO:`; an aura registered with no effect, or a cooldown that does nothing, is a finding.
- **One copy of each rule.** Three channels differing only in their tick effect share one builder; a value
  built each iteration that never changes is built at registration.
- **Comments** follow `wowsims-conventions`: no comparison with TBC or Season of Discovery, no comment that
  opens with or repeats the name of the function, type or field it documents, a `// TODO:` where a number waits
  on verification.
- **Text reads plainly.** When a humanizer skill is available (`humanizer`), run it over every comment,
  doc line, test message, commit message and PR text the change adds or rewrites. Its patterns are the
  findings: a dash used as a connector, an "X, not Y" or "rather than" contrast that only adds weight, an
  inverted or convoluted sentence, stacked qualifiers, a closing line that repeats the point. The rewrite
  changes prose only: code, identifiers, paths, numbers, table data and headings stay, and so does every
  fact. Where it disagrees with `wowsims-conventions`, the conventions win. A contrast that corrects a
  real misreading stays. Without the skill, read the added text for the same patterns by hand.

## 5. Tests

- The suite runs: no `t.Skip`, and a Forever talent string and gear set.
- The .results files carry the spell ids the change touches: `grep <id> sim/<class>/*.results`. A file
  that cannot move proves nothing.
- The cast counts are possible: 18 Prowls, 9 Pounces and 9 Ravages in one 180-second iteration say an
  opener repeats all fight.
- A moved .results file has one isolated cause per move, found by reverting one change at a time.

## 6. SIML

`sim/siml/SPEC.md` is the language. A spell change usually moves two kinds of SIML file.

**The name table, `sim/siml/names.json`.** A regeneration only adds lines to it, apart from an entry's
`registeredBy` list and the comma JSON needs before a new last entry. Any other change to a name is a repin
(`simlnames -w -repin`), the only way a name changes meaning, which adds a `<name>: was …, now …` line to the repin
record, `sim/siml/gen/repinned.txt`; the pull request has to say it intends each one. This fails on every name of the
base's table that means something else, or nothing, now and that the record does not add a line for; CI runs it on
pull requests against the merge commit's first parent:

```
go run ./sim/siml/cmd/simlnames -base "$(git merge-base origin/master HEAD)"   # passes unless a name changed without its record line
git diff "$(git merge-base origin/master HEAD)" -- sim/siml/gen/repinned.txt   # the repins the change makes; read each one
```

A table that differs from what the sim registers fails `TestTableIsUpToDate`, so a spell registered without the
table regenerated shows in CI.

**Rotations and gear sets, `ui/specs/**/*.siml`.** Their diff reads as SIML rows (`cast mortal_strike if …`,
`main_hand arcanite_reaper + weapon_crusader`), so read each changed row for what it does. Check that each name means
the thing intended: the table gives its id (`grep -n '"mortal_strike"' sim/siml/names.json`, one line per class and
namespace), and for a spell `go run ./tools/spelldata <id>` gives its row. The repository check,
`go run --tags=with_db ./cmd/wowsimcli siml fmt -check ui/specs`, fails on a spell or aura the file's spec does not
register, and on an enchant that does not fit its slot.

**The language.** A change to the grammar, the typing or the printer keeps `sim/siml` and `ui/sim/siml` in step,
states the rule in `SPEC.md`, and adds a corpus case under `sim/siml/testdata/` (`parse/`, `print/`, `format/` or
`errors/`). `sim/siml/conformance_test.go` and `ui/sim/siml/conformance.test.ts` both run the case, and
`TestAgreement` checks that the two implementations give the same results over it and over every committed file. A
change to one implementation that leaves the other behind, or one with no case, is a finding. So is a change that gives
existing text another meaning without a new `siml` major version (`SPEC.md` §14).
A grammar change also updates the editor's partial parser, `tools/vscode-apl/src/lang/context.ts`, which reads a
statement up to the cursor for completion; `cd tools/vscode-apl && npm test` runs its cases.

```
go test ./sim/siml/...                     # the corpus and the agreement test; no database needed
npx vitest run ui/sim/siml                 # the TypeScript side
go test --tags=with_db ./sim/siml/...      # also the table's up-to-date test
go test --tags=with_db ./cmd/wowsimcli/... # also the repository check of ui/specs
```

## 7. Verify every finding

A finding is reported only with evidence of at least one of these kinds, named in the finding:

- the row or tooltip line (`go run ./tools/spelldata <id>`, the `Spell` or `SpellMisc` query);
- the core code path, as `file:line`;
- the numbers in a .results file;
- a value printed at runtime from a throwaway test.

A finding with none is dropped, and so is one the evidence contradicts; list it under "checked, not
findings" instead. A finding about when something happens (an order, a consumption, a refund) needs the
runtime print: reading the call order is how a withdrawn finding got posted. A suggested fix is applied in a worktree, passes `go vet --tags=with_db ./sim/<class>/`,
and the number it claims is printed at runtime before it is posted ("Checked: `maxEnergy=110` at rank 2").

## 8. Report

One entry per finding, most severe first: a wrong number, then missing behaviour, then hand code the store
already states, then hygiene.

- `file:line`, and the defect in one bold sentence.
- The failure: concrete input and wrong output, with the numbers ("a 5-point Rupture ticks for 35 instead of
  58.65 before attack power").
- The fix, as code that reads the row through the store's accessors and resolvers: a fenced ` ```go ` block
  that drops in (the whole function or the changed block), not a description of one.
- What was checked, and how.

Every identifier, expression, path and tooltip formula goes in backticks: a bare `weapon*1.55+80, weapon*3.5`
renders as italics and loses both asterisks. A comment posted from the shell takes its body from a file
(`gh api ... -F body=@file`), since backticks inside a quoted argument are command substitution; read the
posted comment back as HTML (`-H "Accept: application/vnd.github.html+json" --jq .body_html`) and check the
fences closed and no `<em>` stands where an asterisk was meant.

After the findings, two lists: **checked, not findings** (what was examined and holds), and **hand numbers
that stay**, each with its reason. On a self-review, fix the findings, rerun the gates, and put both lists in
the PR body.
