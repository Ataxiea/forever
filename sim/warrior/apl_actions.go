package warrior

import (
	"slices"
	"time"

	"github.com/wowsims/forever/sim/core"
	"github.com/wowsims/forever/sim/core/proto"
)

func (warrior *Warrior) NewAPLAction(rot *core.APLRotation, config *proto.APLAction) core.APLActionImpl {
	switch config.Action.(type) {
	case *proto.APLAction_WarriorPlanOnUseItems:
		return warrior.newActionPlanOnUseItems(config.GetWarriorPlanOnUseItems())
	default:
		return nil
	}
}

type plannedItem struct {
	spell          *core.Spell
	shouldActivate core.CooldownActivationCondition // The item's own check, e.g. Barbaric Belt's room in the bar for its rage.
	value          float64                          // What the buff is worth per second it is up.
	starts         []time.Duration                  // Planned starts not yet cast, for an item in a group.
	wasSwapped     bool                             // Whether the item was swapped out when its group was planned.
	readyToCast    bool
}

func (item *plannedItem) isSwapped() bool {
	return item.spell.Flags.Matches(core.SpellFlagSwapped)
}

func (item *plannedItem) buff() time.Duration {
	if item.spell.RelatedSelfBuff == nil {
		return 0
	}
	return item.spell.RelatedSelfBuff.Duration
}

// Items that share one cooldown category lockout and are planned together.
type plannedGroup struct {
	items []*plannedItem
	stale bool
}

type APLActionWarriorPlanOnUseItems struct {
	warrior    *Warrior
	alignToEnd bool
	items      []*plannedItem
	groups     []*plannedGroup
	loose      []*plannedItem // Items with no shared lockout to plan around.
}

func (warrior *Warrior) newActionPlanOnUseItems(config *proto.APLActionWarriorPlanOnUseItems) core.APLActionImpl {
	action := &APLActionWarriorPlanOnUseItems{warrior: warrior, alignToEnd: config.AlignCdEnd}

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
func (action *APLActionWarriorPlanOnUseItems) collectItems() {
	for _, mcd := range action.warrior.GetInitialMajorCooldowns() {
		if mcd.ItemID == 0 || !mcd.Type.Matches(core.CooldownTypeDPS) || mcd.Type.Matches(core.CooldownTypeExplosive) ||
			mcd.Spell.Flags.Matches(core.SpellFlagPotion|core.SpellFlagConjured) {
			continue
		}
		value := 0.0
		for stat, weight := range action.warrior.EPWeights {
			value += weight * mcd.AverageStats[stat]
		}
		action.items = append(action.items, &plannedItem{spell: mcd.Spell, shouldActivate: mcd.ShouldActivate, value: value})
	}

	groupOf := map[*core.Timer]*plannedGroup{}
	for _, item := range action.items {
		timer := item.spell.SharedCD.Timer
		// The planner never finishes for an item that locks out nothing and has no cooldown.
		if timer == nil || (item.spell.CD.Duration == 0 && item.spell.SharedCD.Duration == 0) {
			action.loose = append(action.loose, item)
			continue
		}
		if groupOf[timer] == nil {
			groupOf[timer] = &plannedGroup{}
			action.groups = append(action.groups, groupOf[timer])
		}
		groupOf[timer].items = append(groupOf[timer].items, item)
	}

	// With no EP value for any item in the group, the item listed first is the strongest.
	for _, group := range action.groups {
		if slices.ContainsFunc(group.items, func(item *plannedItem) bool { return item.value != 0 }) {
			continue
		}
		for _, item := range group.items {
			item.value = float64(len(action.items) - slices.Index(action.items, item))
		}
	}
}

func (action *APLActionWarriorPlanOnUseItems) plan(sim *core.Simulation, group *plannedGroup) {
	var planned []core.PlannedCooldown
	var plannedItems []*plannedItem
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
	for i, starts := range core.PlanSharedCooldownUses(planned, sim.CurrentTime, sim.Duration, action.alignToEnd) {
		plannedItems[i].starts = starts
	}
	group.stale = false
}

// A group is planned again once a planned start has passed with its item still on cooldown or locked
// out, or once an item was swapped in or out.
func (group *plannedGroup) slipped(sim *core.Simulation) bool {
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
// global cooldown ability. An item its own check holds back stays ready, so its group waits for it as
// for the global cooldown and is not planned again.
func (action *APLActionWarriorPlanOnUseItems) canCast(sim *core.Simulation, item *plannedItem) bool {
	return !item.isSwapped() && item.spell.CanCastOrQueue(sim, action.warrior.CurrentTarget) &&
		(item.spell.Flags.Matches(core.SpellFlagReactive) || action.warrior.GCD.IsReady(sim)) &&
		item.shouldActivate(sim, &action.warrior.Character)
}

func (action *APLActionWarriorPlanOnUseItems) GetInnerActions() []*core.APLAction { return nil }
func (action *APLActionWarriorPlanOnUseItems) GetAPLValues() []core.APLValue      { return nil }
func (action *APLActionWarriorPlanOnUseItems) Finalize(*core.APLRotation)         {}
func (action *APLActionWarriorPlanOnUseItems) PostFinalize(rot *core.APLRotation) {
	if len(action.items) == 0 {
		rot.ValidationMessage(proto.LogLevel_Warning, "%s will not cast any items! There are either no on-use DPS items equipped, or all of them are cast elsewhere in the APL.", action)
		return
	}
	actionIDs := core.MapSlice(action.items, func(item *plannedItem) core.ActionID { return item.spell.ActionID })
	rot.ValidationMessage(proto.LogLevel_Information, "%s will cast the following items: %s", action, core.StringFromActionIDs(actionIDs))
}
func (action *APLActionWarriorPlanOnUseItems) GetNextAction(*core.Simulation) *core.APLAction {
	return nil
}
func (action *APLActionWarriorPlanOnUseItems) ReResolveVariableRefs(*core.APLRotation, map[string]*proto.APLValue) {
}

func (action *APLActionWarriorPlanOnUseItems) Reset(*core.Simulation) {
	for _, group := range action.groups {
		group.stale = true
	}
	for _, item := range action.items {
		item.readyToCast = false
	}
}

func (action *APLActionWarriorPlanOnUseItems) IsReady(sim *core.Simulation) bool {
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
		item.readyToCast = (!action.alignToEnd || buff == 0 ||
			core.ShouldCastForEncounterEnd(sim.Duration-sim.CurrentTime, item.spell.CD.Duration, buff)) &&
			action.canCast(sim, item)
		ready = ready || item.readyToCast
	}
	return ready
}

func (action *APLActionWarriorPlanOnUseItems) Execute(sim *core.Simulation) {
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

func (action *APLActionWarriorPlanOnUseItems) String() string {
	return "Plan On-Use Items"
}
