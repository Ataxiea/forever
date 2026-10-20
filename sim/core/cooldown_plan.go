package core

import (
	"encoding/binary"
	"math"
	"sort"
	"time"
)

// Whether a lone cooldown cast now loses nothing to the encounter end: its buff runs to the end, or a later
// cast still fits after the cooldown with at least half its buff.
func ShouldCastForEncounterEnd(remaining, cooldown, buff time.Duration) bool {
	return remaining > cooldown+buff/2 || remaining <= buff
}

// An item in a group of on-use items that share one cooldown category.
type PlannedCooldown struct {
	Cooldown       time.Duration // The item's own cooldown.
	Lockout        time.Duration // How long one use of this item locks the other items of the category.
	Buff           time.Duration // The buff's duration; 0 for an item that deals damage.
	ValuePerSecond float64       // What the buff is worth per second it is up.
	ReadyAt        time.Duration // When the item can be used, with the category's own lockout folded in.
}

type plannedUse struct {
	item  int
	start time.Duration
}

// The best uses from one search state on, as a list that shares its tail with the state it leads to.
type planSuffix struct {
	value      float64
	damageUses int
	lastStarts []time.Duration // Per item, the start of its last use in the suffix; -1 for none.
	first      plannedUse
	rest       *planSuffix
}

type cooldownPlanner struct {
	items    []PlannedCooldown
	end      time.Duration
	strength []int // Item indexes, highest ValuePerSecond first.
	memo     map[string]*planSuffix
	key      []byte
}

// Planned start times per item, ascending and before end, for items that share one category lockout.
//
// A depth-first search over use sequences, each use cast as soon as the category and the item are free, picks
// the sequence with the most buff value, then the most damage-item uses, then the latest last use of the
// strongest item, then of the next strongest, and so on. The best rest of a sequence depends only on when the
// category and each item are next free, since any use in the rest starts after every earlier use of its item,
// so it is memoised on those times.
//
// With alignToEnd, the chosen sequence is then pushed as late as it goes, walking backward from the end: a
// buffed use starts as late as keeps its buff inside the encounter (or as clipped as its earliest start
// allows), its lockout clear of the next use and its cooldown clear of its item's next use. A damage item's use
// stays on cooldown. Without it, every use starts as soon as the category and its item are free.
func PlanSharedCooldownUses(items []PlannedCooldown, now, end time.Duration, alignToEnd bool) [][]time.Duration {
	planner := &cooldownPlanner{
		items:    items,
		end:      end,
		strength: make([]int, len(items)),
		memo:     make(map[string]*planSuffix),
	}
	for i := range items {
		planner.strength[i] = i
	}
	sort.SliceStable(planner.strength, func(a, b int) bool {
		return items[planner.strength[a]].ValuePerSecond > items[planner.strength[b]].ValuePerSecond
	})

	ready := make([]time.Duration, len(items))
	for i, item := range items {
		ready[i] = item.ReadyAt
	}

	var uses []plannedUse
	for suffix := planner.search(now, ready); suffix.rest != nil; suffix = suffix.rest {
		uses = append(uses, suffix.first)
	}

	aligned := make([]time.Duration, len(uses))
	for j, use := range uses {
		aligned[j] = use.start
	}
	if alignToEnd {
		nextSameItem := make([]time.Duration, len(items))
		for i := range nextSameItem {
			nextSameItem[i] = -1
		}
		for j := len(uses) - 1; j >= 0; j-- {
			use := uses[j]
			item := items[use.item]
			if item.Buff > 0 {
				latest := end - min(item.Buff, end-use.start)
				if j+1 < len(uses) {
					latest = min(latest, aligned[j+1]-item.Lockout)
				}
				if nextSameItem[use.item] >= 0 {
					latest = min(latest, nextSameItem[use.item]-item.Cooldown)
				}
				aligned[j] = max(use.start, latest)
			}
			nextSameItem[use.item] = aligned[j]
		}
	}

	plan := make([][]time.Duration, len(items))
	for j, use := range uses {
		plan[use.item] = append(plan[use.item], aligned[j])
	}
	return plan
}

func (planner *cooldownPlanner) search(categoryFreeAt time.Duration, ready []time.Duration) *planSuffix {
	if best, ok := planner.memo[string(planner.stateKey(categoryFreeAt, ready))]; ok {
		return best
	}

	best := &planSuffix{lastStarts: make([]time.Duration, len(ready))}
	for i := range best.lastStarts {
		best.lastStarts[i] = -1
	}
	for i, item := range planner.items {
		start := max(categoryFreeAt, ready[i])
		if start >= planner.end {
			continue
		}

		readyAt := ready[i]
		ready[i] = start + item.Cooldown
		rest := planner.search(start+item.Lockout, ready)
		ready[i] = readyAt

		candidate := planSuffix{
			value:      rest.value,
			damageUses: rest.damageUses,
			lastStarts: rest.lastStarts,
			first:      plannedUse{item: i, start: start},
			rest:       rest,
		}
		if item.Buff > 0 {
			candidate.value += item.ValuePerSecond * min(item.Buff, planner.end-start).Seconds()
		} else {
			candidate.damageUses++
		}
		if planner.better(&candidate, best) {
			if rest.lastStarts[i] < 0 {
				candidate.lastStarts = append([]time.Duration(nil), rest.lastStarts...)
				candidate.lastStarts[i] = start
			}
			best = &candidate
		}
	}

	planner.memo[string(planner.stateKey(categoryFreeAt, ready))] = best
	return best
}

func (planner *cooldownPlanner) stateKey(categoryFreeAt time.Duration, ready []time.Duration) []byte {
	planner.key = binary.AppendVarint(planner.key[:0], int64(categoryFreeAt))
	for _, readyAt := range ready {
		planner.key = binary.AppendVarint(planner.key, int64(min(max(readyAt, categoryFreeAt), planner.end)))
	}
	return planner.key
}

// A candidate shares lastStarts with its rest until it wins, so its own first use counts when the rest leaves
// that item unused.
func (suffix *planSuffix) lastStart(item int) time.Duration {
	if suffix.lastStarts[item] < 0 && suffix.rest != nil && suffix.first.item == item {
		return suffix.first.start
	}
	return suffix.lastStarts[item]
}

func (planner *cooldownPlanner) better(a, b *planSuffix) bool {
	if math.Abs(a.value-b.value) > 1e-9*math.Max(1, math.Abs(b.value)) {
		return a.value > b.value
	}
	if a.damageUses != b.damageUses {
		return a.damageUses > b.damageUses
	}
	for _, i := range planner.strength {
		if lastA, lastB := a.lastStart(i), b.lastStart(i); lastA != lastB {
			return lastA > lastB
		}
	}
	return false
}
