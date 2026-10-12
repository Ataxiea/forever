package core

import (
	"testing"

	"github.com/wowsims/forever/sim/core/proto"
)

func TestNewEncounterClampsExecuteProportions(t *testing.T) {
	enc := NewEncounter(&proto.Encounter{
		Duration:             100,
		ExecuteProportion_20: 0.25,
	})

	if enc.ExecuteProportion_25 != 0.25 {
		t.Errorf("expected ExecuteProportion_25 to be 0.25, got %f", enc.ExecuteProportion_25)
	}
	if enc.ExecuteProportion_35 != 0.25 {
		t.Errorf("expected ExecuteProportion_35 to be 0.25, got %f", enc.ExecuteProportion_35)
	}
	if enc.ExecuteProportion_45 != 0.25 {
		t.Errorf("expected ExecuteProportion_45 to be 0.25, got %f", enc.ExecuteProportion_45)
	}
	if enc.ExecuteProportion_90 != 0.25 {
		t.Errorf("expected ExecuteProportion_90 to be 0.25, got %f", enc.ExecuteProportion_90)
	}
}

func TestNewEncounterClampsBounds(t *testing.T) {
	enc := NewEncounter(&proto.Encounter{
		Duration:             100,
		ExecuteProportion_20: -0.1,
		ExecuteProportion_90: 2.5,
	})

	if enc.ExecuteProportion_20 != 0 {
		t.Errorf("expected ExecuteProportion_20 to be 0, got %f", enc.ExecuteProportion_20)
	}
	if enc.ExecuteProportion_90 != 1.0 {
		t.Errorf("expected ExecuteProportion_90 to be 1.0, got %f", enc.ExecuteProportion_90)
	}
}

func TestNewEncounterEnforcesMonotonicOrdering(t *testing.T) {
	enc := NewEncounter(&proto.Encounter{
		Duration:             100,
		ExecuteProportion_20: 0.10,
		ExecuteProportion_25: 0.20,
		ExecuteProportion_35: 0.15,
		ExecuteProportion_45: 0.40,
		ExecuteProportion_90: 0.30,
	})

	if enc.ExecuteProportion_20 != 0.10 {
		t.Errorf("expected ExecuteProportion_20 to be 0.10, got %f", enc.ExecuteProportion_20)
	}
	if enc.ExecuteProportion_25 != 0.20 {
		t.Errorf("expected ExecuteProportion_25 to be 0.20, got %f", enc.ExecuteProportion_25)
	}
	if enc.ExecuteProportion_35 != 0.20 {
		t.Errorf("expected ExecuteProportion_35 to be 0.20, got %f", enc.ExecuteProportion_35)
	}
	if enc.ExecuteProportion_45 != 0.40 {
		t.Errorf("expected ExecuteProportion_45 to be 0.40, got %f", enc.ExecuteProportion_45)
	}
	if enc.ExecuteProportion_90 != 0.40 {
		t.Errorf("expected ExecuteProportion_90 to be 0.40, got %f", enc.ExecuteProportion_90)
	}
}
