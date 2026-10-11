package core

import (
	"github.com/wowsims/forever/sim/core/proto"
	googleProto "google.golang.org/protobuf/proto"
)

// The request the site's individual sim sends for settings, with options: the player alone in the first of the raid's
// five parties, with the party buffs, the raid buffs, debuffs, tanks and target dummies, against the encounter. A ring enchant needs
// Enchanting, so a player without it is simmed without its ring enchants. Settings with no encounter, or one with no
// target, are simmed against one default target, which the warnings say. s is not changed.
func IndividualSimRequest(s *proto.IndividualSimSettings, options *proto.SimOptions) (*proto.RaidSimRequest, []string) {
	var warnings []string
	player := googleProto.Clone(orEmpty(s.GetPlayer())).(*proto.Player)
	if player.Profession1 != proto.Profession_Enchanting && player.Profession2 != proto.Profession_Enchanting {
		for _, slot := range []proto.ItemSlot{proto.ItemSlot_ItemSlotFinger1, proto.ItemSlot_ItemSlotFinger2} {
			if items := player.GetEquipment().GetItems(); int(slot) < len(items) && items[slot] != nil {
				items[slot].Enchant = 0
			}
		}
	}
	raid := SinglePlayerRaidProto(player, orEmpty(s.PartyBuffs), orEmpty(s.RaidBuffs), orEmpty(s.Debuffs))
	// The target dummies take the free places after the player, up to 24.
	for len(raid.Parties) < 5 {
		raid.Parties = append(raid.Parties, &proto.Party{})
	}
	raid.Tanks = s.Tanks
	raid.TargetDummies = s.TargetDummies

	encounter := s.Encounter
	switch {
	case encounter == nil:
		encounter = MakeSingleTargetEncounter(0)
		warnings = append(warnings, "the settings hold no encounter; simmed against one default target")
	case len(encounter.Targets) == 0:
		encounter = googleProto.Clone(encounter).(*proto.Encounter)
		encounter.Targets = []*proto.Target{NewDefaultTarget()}
		warnings = append(warnings, "the encounter has no target; simmed against one default target")
	}
	return &proto.RaidSimRequest{Raid: raid, Encounter: encounter, SimOptions: options, Type: proto.SimType_SimTypeIndividual}, warnings
}

// m, or an empty message of its type when it is nil.
func orEmpty[M googleProto.Message](m M) M {
	if m.ProtoReflect().IsValid() {
		return m
	}
	return m.ProtoReflect().Type().New().Interface().(M)
}
