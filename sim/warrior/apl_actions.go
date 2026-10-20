package warrior

import (
	"slices"
	"time"

	"github.com/wowsims/forever/sim/core"
	"github.com/wowsims/forever/sim/core/proto"
)

func (warrior *Warrior) NewAPLAction(rot *core.APLRotation, config *proto.APLAction) core.APLActionImpl {
	switch config.Action.(type) {
	case *proto.APLAction_WarriorAlignOnUseItems:
		return warrior.newActionAlignOnUseItems()
	default:
		return nil
	}
}

type alignedItem struct {
	spell       *core.Spell
	value       float64         // What the buff is worth per second it is up.
	starts      []time.Duration // Planned starts not yet cast, for an item in a group.
	wasSwapped  bool            // Whether the item was swapped out when its group was planned.
	readyToCast bool
}

func (item *alignedItem) isSwapped() bool {
	return item.spell.Flags.Matches(core.SpellFlagSwapped)
}

func (item *alignedItem) buff() time.Duration {
	if item.spell.RelatedSelfBuff == nil {
		return 0
	}
	return item.spell.RelatedSelfBuff.Duration
}

// Items that share one cooldown category lockout and are planned together.
type alignedGroup struct {
	items []*alignedItem
	stale bool
}

type APLActionWarriorAlignOnUseItems struct {
	warrior *Warrior
	items   []*alignedItem
	groups  []*alignedGroup
	loose   []*alignedItem // Items with no shared lockout to plan around.
}

func (warrior *Warrior) newActionAlignOnUseItems() core.APLActionImpl {
	action := &APLActionWarriorAlignOnUseItems{warrior: warrior}

	// After the rotation's own casts have taken their items out of the major cooldowns.
	warrior.Env.RegisterPostFinalizeEffect(func() {
		action.collectItems()

		// Later, so that other actions in the rotation can collect theirs before these are removed.
		warrior.Env.RegisterPostFinalizeEffect(func() {
			for _, item := range action.items {
				warrior.RemoveInitialMajorCooldown(item.spell.ActionID)
			}
		})
	})

	return action
}

// On-use DPS items, without potions, conjured items and explosives.
func (action *APLActionWarriorAlignOnUseItems) collectItems() {
	for _, mcd := range action.warrior.GetInitialMajorCooldowns() {
		if mcd.ItemID == 0 || !mcd.Type.Matches(core.CooldownTypeDPS) || mcd.Type.Matches(core.CooldownTypeExplosive) ||
			mcd.Spell.Flags.Matches(core.SpellFlagPotion|core.SpellFlagConjured) {
			continue
		}
		value := 0.0
		for stat, weight := range action.warrior.EPWeights {
			value += weight * mcd.AverageStats[stat]
		}
		action.items = append(action.items, &alignedItem{spell: mcd.Spell, value: value})
	}

	groupOf := map[*core.Timer]*alignedGroup{}
	for _, item := range action.items {
		timer := item.spell.SharedCD.Timer
		// The planner never finishes for an item that locks out nothing and has no cooldown.
		if timer == nil || (item.spell.CD.Duration == 0 && item.spell.SharedCD.Duration == 0) {
			action.loose = append(action.loose, item)
			continue
		}
		if groupOf[timer] == nil {
			groupOf[timer] = &alignedGroup{}
			action.groups = append(action.groups, groupOf[timer])
		}
		groupOf[timer].items = append(groupOf[timer].items, item)
	}

	// With no EP value for any item in the group, the item listed first is the strongest.
	for _, group := range action.groups {
		if slices.ContainsFunc(group.items, func(item *alignedItem) bool { return item.value != 0 }) {
			continue
		}
		for _, item := range group.items {
			item.value = float64(len(action.items) - slices.Index(action.items, item))
		}
	}
}

func (action *APLActionWarriorAlignOnUseItems) plan(sim *core.Simulation, group *alignedGroup) {
	var planned []core.PlannedCooldown
	var plannedItems []*alignedItem
	for _, item := range group.items {
		item.starts = nil
		item.wasSwapped = item.isSwapped()
		if item.wasSwapped {
			continue
		}
		planned = append(planned, core.PlannedCooldown{
			Cooldown:       item.spell.CD.Duration,
			Lockout:        item.spell.SharedCD.Duration,
			Buff:           item.buff(),
			ValuePerSecond: item.value,
			ReadyAt:        max(item.spell.ReadyAt(), sim.CurrentTime),
		})
		plannedItems = append(plannedItems, item)
	}
	for i, starts := range core.PlanSharedCooldownUses(planned, sim.CurrentTime, sim.Duration) {
		plannedItems[i].starts = starts
	}
	group.stale = false
}

// A group is planned again once a planned start has passed with its item still on cooldown or locked
// out, or once an item was swapped in or out.
func (group *alignedGroup) slipped(sim *core.Simulation) bool {
	for _, item := range group.items {
		if item.isSwapped() != item.wasSwapped {
			return true
		}
		if len(item.starts) > 0 && item.starts[0] <= sim.CurrentTime && item.spell.ReadyAt() > item.starts[0] {
			return true
		}
	}
	return false
}

// The same timing a cast of the spell from the rotation has: a major cooldown goes right before the next
// global cooldown ability.
func (action *APLActionWarriorAlignOnUseItems) canCast(sim *core.Simulation, item *alignedItem) bool {
	return !item.isSwapped() && item.spell.CanCastOrQueue(sim, action.warrior.CurrentTarget) &&
		(item.spell.Flags.Matches(core.SpellFlagReactive) || action.warrior.GCD.IsReady(sim))
}

func (action *APLActionWarriorAlignOnUseItems) GetInnerActions() []*core.APLAction { return nil }
func (action *APLActionWarriorAlignOnUseItems) GetAPLValues() []core.APLValue      { return nil }
func (action *APLActionWarriorAlignOnUseItems) Finalize(*core.APLRotation)         {}
func (action *APLActionWarriorAlignOnUseItems) PostFinalize(rot *core.APLRotation) {
	if len(action.items) == 0 {
		rot.ValidationMessage(proto.LogLevel_Warning, "%s will not cast any items! There are either no on-use DPS items equipped, or all of them are cast elsewhere in the APL.", action)
		return
	}
	actionIDs := core.MapSlice(action.items, func(item *alignedItem) core.ActionID { return item.spell.ActionID })
	rot.ValidationMessage(proto.LogLevel_Information, "%s will cast the following items: %s", action, core.StringFromActionIDs(actionIDs))
}
func (action *APLActionWarriorAlignOnUseItems) GetNextAction(*core.Simulation) *core.APLAction {
	return nil
}
func (action *APLActionWarriorAlignOnUseItems) ReResolveVariableRefs(*core.APLRotation, map[string]*proto.APLValue) {
}

func (action *APLActionWarriorAlignOnUseItems) Reset(*core.Simulation) {
	for _, group := range action.groups {
		group.stale = true
	}
	for _, item := range action.items {
		item.readyToCast = false
	}
}

func (action *APLActionWarriorAlignOnUseItems) IsReady(sim *core.Simulation) bool {
	ready := false
	for _, group := range action.groups {
		if group.stale || group.slipped(sim) {
			action.plan(sim, group)
		}
		for _, item := range group.items {
			item.readyToCast = len(item.starts) > 0 && item.starts[0] <= sim.CurrentTime && action.canCast(sim, item)
			ready = ready || item.readyToCast
		}
	}
	for _, item := range action.loose {
		buff := item.buff()
		item.readyToCast = (buff == 0 || core.ShouldCastForEncounterEnd(sim.Duration-sim.CurrentTime, item.spell.CD.Duration, buff)) &&
			action.canCast(sim, item)
		ready = ready || item.readyToCast
	}
	return ready
}

func (action *APLActionWarriorAlignOnUseItems) Execute(sim *core.Simulation) {
	for _, group := range action.groups {
		for _, item := range group.items {
			if item.readyToCast {
				item.spell.CastOrQueue(sim, action.warrior.CurrentTarget)
				group.stale = true
			}
		}
	}
	for _, item := range action.loose {
		if item.readyToCast {
			item.spell.CastOrQueue(sim, action.warrior.CurrentTarget)
		}
	}
}

func (action *APLActionWarriorAlignOnUseItems) String() string {
	return "Align On-Use Items"
}
