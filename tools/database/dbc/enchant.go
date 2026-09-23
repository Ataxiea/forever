package dbc

import (
	"slices"
	"sort"

	"github.com/wowsims/forever/sim/core/proto"
	"github.com/wowsims/forever/sim/core/stats"
)

type Enchant struct {
	EffectId           int
	Name               string
	SpellId            int
	ItemId             int
	ProfessionId       int
	Effects            []int
	EffectPoints       []int
	SpellEffectPoints  []int
	EffectArgs         []int
	IsWeaponEnchant    bool
	InventoryType      InventoryTypeFlag
	SubClassMask       int
	ClassMask          int
	FDID               int
	Quality            ItemQuality
	RequiredProfession int
	EffectName         string
}

// Reports whether spellID is cast by this enchant as a combat spell (Effect 1), which the game
// rolls off every eligible weapon hit, rather than as an equip aura (Effect 3). Checked per slot:
// Deathfrost carries one of each, and only the combat slot's spell is a weapon proc.
func (enchant *Enchant) IsCombatSpell(spellID int) bool {
	for idx, effect := range enchant.Effects {
		if effect == ITEM_ENCHANTMENT_COMBAT_SPELL && idx < len(enchant.EffectArgs) && enchant.EffectArgs[idx] == spellID {
			return true
		}
	}

	return false
}

func (enchant *Enchant) HasEnchantEffect() bool {
	for idx, effect := range enchant.Effects {
		if effect == ITEM_ENCHANTMENT_COMBAT_SPELL {
			return true
		}

		// We apply a buff here, check if it's a trigger
		if effect == ITEM_ENCHANTMENT_EQUIP_SPELL {
			spellId := enchant.EffectArgs[idx]
			spellEffects := dbcInstance.SpellEffects[spellId]
			for _, spellEffect := range spellEffects {
				if spellEffect.IsProcTrigger() {
					return true
				}
			}
		}
	}

	return false
}

// SpellItemEnchantment 8203 is "Spirit +$k1", applied by Enchant Bracer/Boots - Lesser Spirit, but
// its EffectArg is 124, the all-resistances index. The label and the enchant are right and the
// argument is not, so it is corrected here rather than read as five resistances.
var enchantEffectArgFixes = map[int]map[int]int{
	8203: {0: ITEM_MOD_SPIRIT},
}

// The effect a proc-carrying enchant applies, when it resolves any stats. The database does not
// carry it: the generator writes it into the sim's effects table.
func (enchant *Enchant) ItemEffects() []*proto.ItemEffect {
	if !enchant.HasEnchantEffect() {
		return nil
	}

	eff := ItemEffect{TriggerType: 2, SpellID: enchant.SpellId}
	if parsedEffect, hasStats := eff.ToProto(0); hasStats {
		return []*proto.ItemEffect{parsedEffect}
	}

	return nil
}

func (enchant *Enchant) ToProto() *proto.UIEnchant {
	uiEnchant := &proto.UIEnchant{
		Name:               enchant.Name,
		ItemId:             int32(enchant.ItemId),
		SpellId:            int32(enchant.SpellId),
		EffectId:           int32(enchant.EffectId),
		ClassAllowlist:     GetClassesFromClassMask(enchant.ClassMask),
		ExtraTypes:         []proto.ItemType{},
		Stats:              stats.Stats{}.ToProtoArray(),
		Quality:            enchant.Quality.ToProto(),
		RequiredProfession: GetProfession(enchant.RequiredProfession),
	}

	if enchant.FDID == 0 {
		uiEnchant.Icon = "trade_engraving"
	}

	if enchant.IsWeaponEnchant {
		// Process weapon enchants.
		uiEnchant.Type = proto.ItemType_ItemTypeWeapon
		if enchant.SubClassMask == ITEM_SUBCLASS_BIT_WEAPON_STAFF {
			// Staff only.
			uiEnchant.EnchantType = proto.EnchantType_EnchantTypeStaff
		}
		if enchant.SubClassMask == rangedMask {
			uiEnchant.Type = proto.ItemType_ItemTypeRanged
		}
		if enchant.SubClassMask == allTwoHandMask || enchant.SubClassMask == twoHandNoSpearMask {
			// Two-handed weapon.
			uiEnchant.EnchantType = proto.EnchantType_EnchantTypeTwoHand
		}
	} else {
		// Process non-weapon enchants.
		if enchant.SubClassMask == OffHandValue {
			uiEnchant.EnchantType = proto.EnchantType_EnchantTypeOffHand
			uiEnchant.Type = proto.ItemType_ItemTypeWeapon
		}
		// Shield enchants target the shield subclass alone; shield spikes also set the obsolete buckler bit (mask 96).
		if enchant.SubClassMask&ITEM_SUBCLASS_BIT_ARMOR_SHIELD != 0 {
			uiEnchant.EnchantType = proto.EnchantType_EnchantTypeShield
			uiEnchant.Type = proto.ItemType_ItemTypeWeapon
		}
		// Sort flags for consistent generation
		var flags []int
		for flag := range MapInventoryTypeToEnchantMetaType {
			flags = append(flags, int(flag))
		}

		sort.Ints(flags)

		for _, f := range flags {
			flag := InventoryTypeFlag(f)
			m := MapInventoryTypeToEnchantMetaType[flag]
			if enchant.InventoryType.Has(flag) {
				if uiEnchant.Type != proto.ItemType_ItemTypeUnknown {
					uiEnchant.ExtraTypes = append(uiEnchant.ExtraTypes, m.ItemType)
				} else {
					uiEnchant.Type = m.ItemType
				}
			}
		}
		slices.Sort(uiEnchant.ExtraTypes)
	}
	effectArgs := enchant.EffectArgs
	if fixes, ok := enchantEffectArgFixes[enchant.EffectId]; ok {
		effectArgs = slices.Clone(effectArgs)
		for index, arg := range fixes {
			effectArgs[index] = arg
		}
	}
	stats := stats.Stats{}
	processEnchantmentEffects(enchant.Effects, effectArgs, enchant.EffectPoints, enchant.SpellEffectPoints, &stats, true)
	uiEnchant.Stats = stats.ToProtoArray()
	return uiEnchant
}
