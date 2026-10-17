//go:build with_db

package core

import (
	"bytes"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wowsims/forever/sim/core/proto"
	"github.com/wowsims/forever/sim/siml"
)

// Writes each name → text into a new temporary folder, and returns the folder.
func presetDir(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, text := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// What read panics with, and whether it panicked.
func panicOf(read func()) (message string, panicked bool) {
	defer func() {
		if r := recover(); r != nil {
			message, panicked = fmt.Sprint(r), true
		}
	}()
	read()
	return "", false
}

func TestPresetsReadAsSIML(t *testing.T) {
	names, err := siml.DefaultNames()
	if err != nil {
		t.Fatal(err)
	}
	huntersMark, _ := names.Spell(proto.Class_ClassHunter, siml.NamespaceSpell, "hunters_mark")
	bow, _ := names.Item("fahrads_reloading_repeater")
	gear := "siml 1\n\nranged  fahrads_reloading_repeater\n"
	dir := presetDir(t, map[string]string{
		"x.apl.siml":  "siml 1\nspec hunter\n\npriority:\n  cast hunters_mark\n",
		"x.gear.siml": gear,
		"x.siml":      "siml 1\nspec hunter\ntalents \"-00530501114-550200030050220151\"\n\nsettings: race orc\n\ngear:\n  " + strings.TrimPrefix(gear, "siml 1\n\n"),
	})

	rotation := GetAplRotation(dir, "x")
	if rotation.Label != "x" || rotation.Rotation.GetPriorityList()[0].GetAction().GetCastSpell().GetSpellId().GetSpellId() != huntersMark.GetSpellId() {
		t.Errorf("GetAplRotation gave %v, want the label x and a cast of Hunter's Mark", rotation)
	}
	if items := GetGearSet(dir, "x").GearSet.GetItems(); len(items) != 17 || items[proto.ItemSlot_ItemSlotRanged].GetId() != bow {
		t.Errorf("GetGearSet gave the items %v, want 17 with Fahrad's Reloading Repeater in the ranged slot", items)
	}
	if items := GetItemSwapGearSet(dir, "x").ItemSwap.GetItems(); len(items) != 17 || items[proto.ItemSlot_ItemSlotRanged].GetId() != bow {
		t.Errorf("GetItemSwapGearSet gave the items %v, want 17 with Fahrad's Reloading Repeater in the ranged slot", items)
	}
	swapDir := presetDir(t, map[string]string{
		"x.gear.siml": gear,
		"x.siml":      "siml 1\nspec hunter\n\nitem_swap:\n  ranged  fahrads_reloading_repeater\n  prepull_bonus_stats(stats(agility=5))\n",
	})
	if swap := GetItemSwapGearSet(swapDir, "x").ItemSwap; swap.GetItems()[proto.ItemSlot_ItemSlotRanged].GetId() != bow || swap.GetPrepullBonusStats().GetStats()[proto.Stat_StatAgility] != 5 {
		t.Errorf("GetItemSwapGearSet gave %v, want the item_swap: of x.siml with Fahrad's Reloading Repeater and 5 prepull agility", swap)
	}
	build := GetTestBuild(proto.Class_ClassHunter, dir, "x", ItemFilter{}, nil, nil)
	if build.Race != proto.Race_RaceOrc || build.Talents != "-00530501114-550200030050220151" || build.GearSet.GearSet.GetItems()[proto.ItemSlot_ItemSlotRanged].GetId() != bow {
		t.Errorf("GetTestBuild gave the race %v, the talents %q and the gear %v", build.Race, build.Talents, build.GearSet.GearSet)
	}
	if _, ok := build.SpecOptions.SpecOptions.(*proto.Player_Hunter); !ok {
		t.Errorf("GetTestBuild gave the spec options %T, want the hunter's", build.SpecOptions.SpecOptions)
	}
}

// A JSON preset with no .siml of the same name panics, naming it and the command that prints it as SIML, whatever
// else is missing.
func TestAJSONPresetPanics(t *testing.T) {
	dir := presetDir(t, map[string]string{"x.apl.json": "{}", "x.gear.json": "{}", "x.build.json": "{}"})
	for name, c := range map[string]struct {
		read          func()
		command, json string
	}{
		"GetAplRotation":     {func() { GetAplRotation(dir, "x") }, "siml print -kind apl -spec <the spec's field, such as hunter or dps_warrior> %[1]s/x.apl.json > %[1]s/x.apl.siml", "x.apl.json"},
		"GetGearSet":         {func() { GetGearSet(dir, "x") }, "siml print -kind gear %[1]s/x.gear.json > %[1]s/x.gear.siml", "x.gear.json"},
		"GetItemSwapGearSet": {func() { GetItemSwapGearSet(dir, "x") }, "siml print -kind gear %[1]s/x.gear.json > %[1]s/x.gear.siml", "x.gear.json"},
		"GetTestBuild": {func() { GetTestBuild(proto.Class_ClassHunter, dir, "x", ItemFilter{}, nil, nil) },
			"siml print -kind siml %[1]s/x.build.json > %[1]s/x.siml", "x.build.json"},
	} {
		message, panicked := panicOf(c.read)
		if !panicked || !strings.HasPrefix(message, dir+"/"+c.json+" is JSON") || !strings.HasSuffix(message, fmt.Sprintf(c.command, dir)) {
			t.Errorf("%s gave the panic %q (panicked: %v), want one naming the JSON file and ending in the command", name, message, panicked)
		}
	}
}

func TestAPresetThatDoesNotReadPanicsWithItsDiagnostics(t *testing.T) {
	dir := presetDir(t, map[string]string{"x.apl.siml": "siml 1\nspec hunter\n\npriority:\n  cast hunters_mrak\n"})
	message, panicked := panicOf(func() { GetAplRotation(dir, "x") })
	if !panicked || !strings.Contains(message, "x.apl.siml:5:8 unknown-name no spell is named hunters_mrak; did you mean hunters_mark?") {
		t.Errorf("GetAplRotation gave the panic %q (panicked: %v), want the unknown-name diagnostic", message, panicked)
	}
}

// A preset missing in both forms is logged and left empty, so a suite runs on what a spec ships.
func TestAMissingPresetIsSkipped(t *testing.T) {
	var logged bytes.Buffer
	log.SetOutput(&logged)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	dir := t.TempDir()

	if rotation := GetAplRotation(dir, "x"); rotation.Label != "x" || rotation.Rotation != nil {
		t.Errorf("GetAplRotation gave %v, want the label x and no rotation", rotation)
	}
	if gear := GetGearSet(dir, "x"); gear.Label != "x" || len(gear.GearSet.GetItems()) != 0 {
		t.Errorf("GetGearSet gave %v, want the label x and no items", gear)
	}
	for _, want := range []string{
		"no apl siml file, skipping rotation: " + dir + "/x.apl.siml",
		"no gear siml file, skipping gear set: " + dir + "/x.gear.siml",
	} {
		if !strings.Contains(logged.String(), want) {
			t.Errorf("the log %q does not say %q", logged.String(), want)
		}
	}
}
