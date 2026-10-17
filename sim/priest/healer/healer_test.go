package healer

import (
	"testing"

	"github.com/wowsims/forever/sim/common"
	"github.com/wowsims/forever/sim/core"
	"github.com/wowsims/forever/sim/core/proto"
	"github.com/wowsims/forever/sim/core/stats"
)

func init() {
	RegisterHealerPriest()
	common.RegisterAllEffects()
}

// Stats-only suite: this spec is a gear planner, it has no healing rotation.
// Pins the final character stats for each gear preset so the passives stay covered. The empty APL
// rotation and the fake prepull (no SkipRotation) make it exercise a full environment reset, the
// path the UI's stats request takes.
func TestHealerPriest(t *testing.T) {
	var generators []core.TestGenerator
	for _, gearSet := range []string{"preraid"} {
		player := core.WithSpec(
			&proto.Player{
				Class:         proto.Class_ClassPriest,
				Race:          proto.Race_RaceDwarf,
				Equipment:     core.GetGearSet("../../../ui/specs/priest/healer/gear_sets", gearSet).GearSet,
				Consumables:   FullConsumes,
				Buffs:         core.FullIndividualBuffs,
				TalentsString: StandardTalents,
				Profession1:   proto.Profession_Tailoring,
				Profession2:   proto.Profession_Enchanting,
				Rotation:      &proto.APLRotation{Type: proto.APLRotation_TypeAPL},
			},
			PlayerOptions,
		)
		generators = append(generators, &core.SingleCharacterStatsTestGenerator{
			Name: gearSet,
			Request: &proto.ComputeStatsRequest{
				Raid: core.SinglePlayerRaidProto(player, core.FullPartyBuffs, core.FullRaidBuffs, core.FullDebuffs),
			},
		})
	}
	core.RunTestSuite(t, t.Name(), generators)
}

func TestHealingSpellStatsIncludeBuildPhaseCritBonuses(t *testing.T) {
	base := computeRenewSpellStats(t, nil, nil, nil, 0)
	partyBuff := computeRenewSpellStats(t, &proto.PartyBuffs{MoonkinAura: true}, nil, nil, 0)
	individualBuff := computeRenewSpellStats(t, nil, &proto.IndividualBuffs{GreaterBlessingOfKings: true}, nil, 0)

	if partyBuff.CritChance <= base.CritChance {
		t.Errorf("Renew crit chance with the party buff is %v, want greater than %v", partyBuff.CritChance, base.CritChance)
	}
	if individualBuff.CritChance <= base.CritChance {
		t.Errorf("Renew crit chance with the individual buff is %v, want greater than %v", individualBuff.CritChance, base.CritChance)
	}
}

func TestHealingSpellStatsCapCritChanceAndCalculatePeriodicTotals(t *testing.T) {
	spellStats := computeRenewSpellStats(t, nil, nil, nil, 200)
	if spellStats.CritChance != 1 {
		t.Fatalf("Renew crit chance is %v, want 1", spellStats.CritChance)
	}

	metrics := make(map[string]float64)
	for _, metric := range spellStats.AdditionalMetrics {
		if metric.GroupKey == "periodic_total" {
			metrics[metric.LabelKey] = metric.Value
		}
	}
	for _, key := range []string{"normal_total", "expected_total", "all_crit_total"} {
		if _, ok := metrics[key]; !ok {
			t.Fatalf("Renew is missing periodic total metric %q", key)
		}
	}
	if metrics["expected_total"] != metrics["all_crit_total"] {
		t.Errorf("Renew expected total is %v with 100%% crit, want all-crits total %v", metrics["expected_total"], metrics["all_crit_total"])
	}
}

func computeRenewSpellStats(t *testing.T, partyBuffs *proto.PartyBuffs, individualBuffs *proto.IndividualBuffs, consumables *proto.ConsumesSpec, bonusCrit float64) *proto.HealingSpellStats {
	t.Helper()
	player := core.WithSpec(&proto.Player{
		Class:         proto.Class_ClassPriest,
		Race:          proto.Race_RaceDwarf,
		Equipment:     &proto.EquipmentSpec{},
		Buffs:         individualBuffs,
		Consumables:   consumables,
		TalentsString: StandardTalents,
		BonusStats: &proto.UnitStats{
			Stats:       make([]float64, stats.ProtoStatsLen),
			PseudoStats: make([]float64, stats.PseudoStatsLen),
		},
	}, PlayerOptions)
	stats.UnitStatFromPseudoStat(proto.PseudoStat_PseudoStatSpellCritPercent).AddToStatsProto(player.BonusStats, bonusCrit)
	result := core.ComputeStats(&proto.ComputeStatsRequest{
		Raid:         core.SinglePlayerRaidProto(player, partyBuffs, &proto.RaidBuffs{}, &proto.Debuffs{}),
		Encounter:    core.MakeSingleTargetEncounter(0),
		SkipRotation: true,
	})
	for _, spell := range result.RaidStats.Parties[0].Players[0].HealingSpells {
		if spell.Name == "Renew" && spell.Rank == 1 {
			return spell
		}
	}
	t.Fatal("Renew healing spell stats are missing")
	return nil
}

// The Holy preset from ui/specs/priest/healer/presets.ts.
var StandardTalents = "00520101133-33505003030121531"

var FullConsumes = &proto.ConsumesSpec{
	FoodId:        250066, // Soaring Pamplona
	ResourcePotId: 13444,  // Major Mana Potion
}

var PlayerOptions = &proto.Player_HealerPriest{
	HealerPriest: &proto.HealerPriest{
		Options: &proto.HealerPriest_Options{
			ClassOptions: &proto.PriestOptions{},
		},
	},
}
