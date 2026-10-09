//go:build with_db

package feralcat

import (
	"testing"
	"time"
)

func TestFaerieFireFormCooldown(t *testing.T) {
	sim, cat := newCat(t, furorTalents, nil)
	fillResource(sim, cat)
	if cat.FaerieFire.CD.Duration != 6*time.Second {
		t.Fatalf("cat cooldown = %v, want 6s", cat.FaerieFire.CD.Duration)
	}
	if !cat.FaerieFire.Cast(sim, cat.CurrentTarget) {
		t.Fatal("first Faerie Fire cast failed")
	}
	sim.CurrentTime += time.Second
	if cat.FaerieFire.CanCast(sim, cat.CurrentTarget) {
		t.Fatal("Faerie Fire available after 1s in Cat")
	}
	sim.CurrentTime += 5 * time.Second
	if !cat.FaerieFire.CanCast(sim, cat.CurrentTarget) {
		t.Fatal("Faerie Fire unavailable after 6s in Cat")
	}
	cat.CatFormAura.Deactivate(sim)
	if cat.FaerieFire.CD.Duration != 0 {
		t.Fatalf("caster cooldown = %v, want 0", cat.FaerieFire.CD.Duration)
	}
	fillResource(sim, cat)
	if !cat.BearForm.Cast(sim, cat.CurrentTarget) {
		t.Fatal("Bear Form cast failed")
	}
	if cat.FaerieFire.CD.Duration != 6*time.Second {
		t.Fatalf("bear cooldown = %v, want 6s", cat.FaerieFire.CD.Duration)
	}
	sim.CurrentTime += 1500 * time.Millisecond
	if !cat.FaerieFire.Cast(sim, cat.CurrentTarget) {
		t.Fatal("first Bear Faerie Fire cast failed")
	}
	sim.CurrentTime += 1500 * time.Millisecond
	if cat.FaerieFire.CanCast(sim, cat.CurrentTarget) {
		t.Fatal("Faerie Fire available before 6s in Bear")
	}
}
