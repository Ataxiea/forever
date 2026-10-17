package healer

import (
	"github.com/wowsims/forever/sim/common/healing"
	"github.com/wowsims/forever/sim/core"
	"github.com/wowsims/forever/sim/core/proto"
)

func (healer *HealerPriest) HealingSpellStats(sim *core.Simulation) []*proto.HealingSpellStats {
	return healing.CalculateSpellStats(sim, healer.GetCharacter(), healer.ModifyHealingSpellStats)
}

func (healer *HealerPriest) ModifyHealingSpellStats(spell *core.Spell, stats *proto.HealingSpellStats) {
	if stats.Absorb {
		return
	}

	renewedHopeCritChance := min(stats.CritChance+healer.Priest.RenewedHopeCritBonus(spell), 1)
	if renewedHopeCritChance > stats.CritChance {
		stats.AdditionalMetrics = append(stats.AdditionalMetrics, &proto.HealingSpellStatsMetric{
			GroupKey: "critical",
			LabelKey: "renewed_hope_crit_chance",
			Value:    renewedHopeCritChance,
			NoteKey:  "renewed_hope_note",
		})
	}

	if healer.Priest.Talents.DivineAegis > 0 && !stats.Periodic {
		fraction := healer.Priest.DivineAegisShieldFraction()
		stats.AdditionalMetrics = append(stats.AdditionalMetrics,
			&proto.HealingSpellStatsMetric{GroupKey: "divine_aegis", LabelKey: "min", Value: stats.CritMin * fraction},
			&proto.HealingSpellStatsMetric{GroupKey: "divine_aegis", LabelKey: "mean", Value: stats.CritMean * fraction},
			&proto.HealingSpellStatsMetric{GroupKey: "divine_aegis", LabelKey: "max", Value: stats.CritMax * fraction},
		)
	}
}
