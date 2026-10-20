package core

import (
	"reflect"
	"testing"
	"time"
)

func TestShouldCastForEncounterEnd(t *testing.T) {
	cases := []struct {
		remaining, cooldown, buff time.Duration
		expected                  bool
	}{
		{66 * time.Second, 60 * time.Second, 10 * time.Second, true},
		{65 * time.Second, 60 * time.Second, 10 * time.Second, false},
		{10 * time.Second, 60 * time.Second, 10 * time.Second, true},
		{30 * time.Second, 60 * time.Second, 10 * time.Second, false},
	}
	for _, c := range cases {
		if got := ShouldCastForEncounterEnd(c.remaining, c.cooldown, c.buff); got != c.expected {
			t.Errorf("remaining %v, cooldown %v, buff %v: expected %v, got %v", c.remaining, c.cooldown, c.buff, c.expected, got)
		}
	}
}

func slayerLike(readyAt time.Duration) PlannedCooldown {
	return PlannedCooldown{Cooldown: 120 * time.Second, Lockout: 20 * time.Second, Buff: 20 * time.Second, ValuePerSecond: 2, ReadyAt: readyAt}
}

func kissLike(readyAt time.Duration) PlannedCooldown {
	return PlannedCooldown{Cooldown: 120 * time.Second, Lockout: 15 * time.Second, Buff: 15 * time.Second, ValuePerSecond: 1, ReadyAt: readyAt}
}

func checkPlan(t *testing.T, items []PlannedCooldown, now, end time.Duration, expected [][]time.Duration) {
	t.Helper()
	checkPlanAligned(t, items, now, end, true, expected)
}

func checkPlanAligned(t *testing.T, items []PlannedCooldown, now, end time.Duration, alignToEnd bool, expected [][]time.Duration) {
	t.Helper()
	if got := PlanSharedCooldownUses(items, now, end, alignToEnd); !reflect.DeepEqual(got, expected) {
		t.Errorf("expected plan %v, got %v", expected, got)
	}
}

func TestPlanStrongestLast(t *testing.T) {
	checkPlan(t, []PlannedCooldown{slayerLike(0), kissLike(0)}, 0, 160*time.Second,
		[][]time.Duration{seconds(20, 140), seconds(5, 125)})
}

func TestPlanLongerFightKeepsUses(t *testing.T) {
	checkPlan(t, []PlannedCooldown{slayerLike(0), kissLike(0)}, 0, 250*time.Second,
		[][]time.Duration{seconds(0, 120, 240), seconds(105, 225)})
}

func TestPlanSharedLockoutLosesNoUse(t *testing.T) {
	checkPlan(t, []PlannedCooldown{slayerLike(120 * time.Second), kissLike(140 * time.Second)}, 120*time.Second, 160*time.Second,
		[][]time.Duration{seconds(125), seconds(145)})
}

func TestPlanDamageItemYields(t *testing.T) {
	pathcarver := PlannedCooldown{Cooldown: 300 * time.Second, Lockout: 15 * time.Second}
	checkPlan(t, []PlannedCooldown{pathcarver, slayerLike(0)}, 0, 140*time.Second,
		[][]time.Duration{seconds(20), seconds(0, 120)})
}

func TestPlanRebuildAfterLateCast(t *testing.T) {
	checkPlan(t, []PlannedCooldown{slayerLike(150 * time.Second)}, 30*time.Second, 300*time.Second,
		[][]time.Duration{seconds(160, 280)})
}

// Unaligned, the search's own sequence stands. Both orders fit two whole uses of each item; the tie goes to
// the latest last use of the stronger Slayer, so Kiss leads: Kiss 0 s, Slayer 15 s, Kiss 120 s, Slayer 135 s.
func TestPlanFrontLoaded(t *testing.T) {
	checkPlanAligned(t, []PlannedCooldown{slayerLike(0), kissLike(0)}, 0, 160*time.Second, false,
		[][]time.Duration{seconds(15, 135), seconds(0, 120)})
}
