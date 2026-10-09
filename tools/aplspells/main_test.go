package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wowsims/forever/sim/core/proto"
)

func TestEverySpecNamesItsFolderAndClass(t *testing.T) {
	for value, name := range proto.Spec_name {
		spec := proto.Spec(value)
		if spec == proto.Spec_SpecUnknown {
			continue
		}
		class := specClass(spec)
		if class == proto.Class_ClassUnknown {
			t.Errorf("%s has no class", name)
			continue
		}
		className, folder := specFolder(spec, class)
		if _, err := os.Stat(filepath.Join("..", "..", "ui", "specs", folder)); err != nil {
			t.Errorf("%s names %s, which is not a folder under ui/specs", name, folder)
		}
		if _, err := os.Stat(filepath.Join("..", "..", "ui", "sim", "talents", "trees", className+".json")); err != nil {
			t.Errorf("%s has no talent trees for %s", name, className)
		}
	}
}

func TestTalentRanksRankEveryTalentAtEachRank(t *testing.T) {
	if err := os.Chdir(filepath.Join("..", "..")); err != nil {
		t.Fatal(err)
	}
	sets, err := talentRanks("hunter")
	if err != nil {
		t.Fatal(err)
	}
	if len(sets) < 2 {
		t.Fatalf("expected a talents string per rank, got %v", sets)
	}
	if strings.Trim(strings.ReplaceAll(sets[0], "-", ""), "1") != "" {
		t.Errorf("rank 1 should put one point in every talent, got %s", sets[0])
	}
	for _, set := range sets {
		if len(strings.Split(set, "-")) != 3 || strings.Contains(set, "0") {
			t.Errorf("expected three trees with every talent ranked, got %s", set)
		}
	}
}
