package healing

import (
	"sort"

	"github.com/wowsims/forever/sim/core"
	"github.com/wowsims/forever/sim/core/dbcenums"
	"github.com/wowsims/forever/sim/core/proto"
	"github.com/wowsims/forever/sim/core/spelldata"
)

// Adds spec-specific values to the shared spell results.
type SpellStatsHook func(spell *core.Spell, stats *proto.HealingSpellStats)

// Collects registered healing spells and calculates their non-critical and critical value ranges.
func CalculateSpellStats(sim *core.Simulation, character *core.Character, hook SpellStatsHook) []*proto.HealingSpellStats {
	results := make([]*proto.HealingSpellStats, 0)
	target := &character.Unit
	if dummy := character.Env.Raid.GetFirstTargetDummy(); dummy != nil {
		target = &dummy.Unit
	}
	seen := make(map[struct {
		id   int32
		rank int32
	}]struct{})
	for _, spell := range character.Spellbook {
		if !spell.ProcMask.Matches(core.ProcMaskSpellHealing) {
			continue
		}

		row := spelldata.Find(spell.ActionID.SpellID)
		if row == spelldata.Nil {
			continue
		}
		effect := row.HealEffect()
		periodic := false
		if effect == spelldata.NilEffect {
			periodicEffect := row.PeriodicEffect()
			if periodicEffect != spelldata.NilEffect && periodicEffect.Aura == dbcenums.A_PERIODIC_HEAL {
				effect = periodicEffect
				periodic = true
			} else {
				effect = row.AbsorbEffect()
				if effect == spelldata.NilEffect {
					continue
				}
			}
		}
		absorb := !periodic && row.HealEffect() == spelldata.NilEffect
		key := struct {
			id   int32
			rank int32
		}{id: spell.ActionID.SpellID, rank: spell.Rank}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}

		baseMin, baseMax := effect.Min(), effect.Max()
		if spell.DirectVariance > 0 && !periodic {
			baseMin, baseMax = effect.Average(), effect.Average()
		}
		var normal, crit core.HealingRange
		if absorb {
			strength := (effect.Average() + spell.BonusCoefficient*spell.HealingPower(target)) *
				spell.DamageMultiplier * spell.DamageMultiplierAdditive
			normal = core.HealingRange{Min: strength, Mean: strength, Max: strength}
		} else {
			normal, crit = spell.CalculateHealingRange(sim, target, baseMin, effect.Mean(), baseMax, periodic)
		}
		critChance := spell.HealingCritChance(target)
		id := spell.ActionID.ToProto()
		id.Rank = spell.Rank
		spellStats := &proto.HealingSpellStats{
			Id:         id,
			Name:       row.Name,
			Rank:       spell.Rank,
			Min:        normal.Min,
			Max:        normal.Max,
			Mean:       normal.Mean,
			CritMin:    crit.Min,
			CritMax:    crit.Max,
			CritMean:   crit.Mean,
			CritChance: critChance,
			Periodic:   periodic,
			Absorb:     absorb,
		}
		if absorb {
			spellStats.AbsorbMin = normal.Min
			spellStats.AbsorbMean = normal.Mean
			spellStats.AbsorbMax = normal.Max
		}
		if hook != nil {
			hook(spell, spellStats)
		}
		if periodic {
			if dot := spell.Hot(target); dot != nil {
				ticks := float64(dot.ExpectedTickCount())
				if ticks > 0 {
					expectedTick := normal.Mean*(1-spellStats.CritChance) + crit.Mean*spellStats.CritChance
					spellStats.AdditionalMetrics = append(spellStats.AdditionalMetrics,
						&proto.HealingSpellStatsMetric{GroupKey: "periodic_total", LabelKey: "normal_total", Value: normal.Mean * ticks},
						&proto.HealingSpellStatsMetric{GroupKey: "periodic_total", LabelKey: "expected_total", Value: expectedTick * ticks},
						&proto.HealingSpellStatsMetric{GroupKey: "periodic_total", LabelKey: "all_crit_total", Value: crit.Max * ticks},
					)
				}
			}
		}
		results = append(results, spellStats)
	}

	sort.SliceStable(results, func(i, j int) bool {
		if results[i].Name != results[j].Name {
			return results[i].Name < results[j].Name
		}
		return results[i].Rank < results[j].Rank
	})
	return results
}
