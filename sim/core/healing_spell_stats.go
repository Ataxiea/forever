package core

import "github.com/wowsims/forever/sim/core/proto"

// Supplies character-sheet healing spell values.
type HealingSpellStatsProvider interface {
	HealingSpellStats(*Simulation) []*proto.HealingSpellStats
}
