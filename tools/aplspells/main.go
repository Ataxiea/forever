// Prints, for every spec, the spells and auras the sim registers for it: the list the APL panel offers
// in its spell and aura pickers. A spec's list is everything any build of it can register, so each
// playable race is built with every talent at each of its ranks and every raid buff, party buff and debuff
// on. Gear is left empty: what an item registers depends on the item, not the spec.
//
//	go run --tags=with_db ./tools/aplspells > specs.json
//
// A spec the sim cannot build in any race, such as one with code still to port, is `{"error": ...}`.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/reflect/protoreflect"

	"github.com/wowsims/forever/sim"
	"github.com/wowsims/forever/sim/core"
	"github.com/wowsims/forever/sim/core/proto"
	"github.com/wowsims/forever/sim/core/spelldata"
)

type talentTree struct {
	Talents []struct {
		MaxPoints int `json:"maxPoints"`
	} `json:"talents"`
}

// The talents strings with every talent at rank 1, then 2, up to the highest any talent has, each talent
// capped at its own highest: what a spell registers can depend on the rank (Improved Berserker Rage tags its
// aura with it), so each rank is built.
func talentRanks(class string) ([]string, error) {
	data, err := os.ReadFile(filepath.Join("ui", "sim", "talents", "trees", class+".json"))
	if err != nil {
		return nil, err
	}
	var trees []talentTree
	if err := json.Unmarshal(data, &trees); err != nil {
		return nil, err
	}
	highest := 0
	for _, tree := range trees {
		for _, talent := range tree.Talents {
			highest = max(highest, talent.MaxPoints)
		}
	}
	strs := make([]string, 0, highest)
	for rank := 1; rank <= highest; rank++ {
		parts := make([]string, len(trees))
		for i, tree := range trees {
			var b strings.Builder
			for _, talent := range tree.Talents {
				b.WriteString(fmt.Sprint(min(rank, talent.MaxPoints)))
			}
			parts[i] = b.String()
		}
		strs = append(strs, strings.Join(parts, "-"))
	}
	return strs, nil
}

// The class a spec belongs to: every spec name ends in its class's name (SpecDpsWarrior, SpecHunter).
func specClass(spec proto.Spec) proto.Class {
	for value, name := range proto.Class_name {
		class := strings.TrimPrefix(name, "Class")
		if value != 0 && strings.HasSuffix(spec.String(), class) {
			return proto.Class(value)
		}
	}
	return proto.Class_ClassUnknown
}

// The spec folder under ui/specs: SpecRetributionPaladin is paladin/retribution, SpecHunter hunter/dps.
func specFolder(spec proto.Spec, class proto.Class) (string, string) {
	className := strings.ToLower(strings.TrimPrefix(class.String(), "Class"))
	name := strings.TrimSuffix(strings.TrimPrefix(spec.String(), "Spec"), strings.TrimPrefix(class.String(), "Class"))
	if name == "" {
		name = "dps"
	}
	return className, className + "/" + strings.ToLower(name)
}

// Sets every message field down from `m`, so a spec's options and class options exist with their defaults.
func fillMessages(m protoreflect.Message, depth int) {
	if depth == 0 {
		return
	}
	fields := m.Descriptor().Fields()
	for i := 0; i < fields.Len(); i++ {
		fd := fields.Get(i)
		if fd.Kind() != protoreflect.MessageKind || fd.IsList() || fd.IsMap() || fd.ContainingOneof() != nil {
			continue
		}
		child := m.Mutable(fd).Message()
		fillMessages(child, depth-1)
	}
}

// Turns on everything in a buffs message: every flag, the strongest value of every enum, one of every count.
// The auras external buffs and debuffs register then show, which an APL can check for.
func enableAll(m protoreflect.Message) {
	fields := m.Descriptor().Fields()
	for i := 0; i < fields.Len(); i++ {
		fd := fields.Get(i)
		if fd.IsList() || fd.IsMap() {
			continue
		}
		switch fd.Kind() {
		case protoreflect.BoolKind:
			m.Set(fd, protoreflect.ValueOfBool(true))
		case protoreflect.EnumKind:
			values := fd.Enum().Values()
			m.Set(fd, protoreflect.ValueOfEnum(values.Get(values.Len()-1).Number()))
		case protoreflect.Int32Kind:
			m.Set(fd, protoreflect.ValueOfInt32(1))
		case protoreflect.MessageKind:
			enableAll(m.Mutable(fd).Message())
		}
	}
}

func actionKey(id *proto.ActionID) string {
	return protojson.Format(id)
}

type collected struct {
	spells      map[string]*proto.SpellStats
	auras       map[string]*proto.AuraStats
	petAuras    map[string]*proto.AuraStats
	targetAuras map[string]*proto.AuraStats
}

func (c *collected) add(result *proto.ComputeStatsResult) {
	stats := result.RaidStats.Parties[0].Players[0]
	player := stats.Metadata
	for _, pet := range stats.Pets {
		for _, aura := range pet.Metadata.Auras {
			if _, ok := c.petAuras[actionKey(aura.Id)]; !ok {
				c.petAuras[actionKey(aura.Id)] = aura
			}
		}
	}
	for _, spell := range player.Spells {
		if _, ok := c.spells[actionKey(spell.Id)]; !ok {
			c.spells[actionKey(spell.Id)] = spell
		}
	}
	for _, aura := range player.Auras {
		if _, ok := c.auras[actionKey(aura.Id)]; !ok {
			c.auras[actionKey(aura.Id)] = aura
		}
	}
	for _, target := range result.EncounterStats.Targets {
		for _, aura := range target.Metadata.Auras {
			if _, ok := c.targetAuras[actionKey(aura.Id)]; !ok {
				c.targetAuras[actionKey(aura.Id)] = aura
			}
		}
	}
}

func sorted[T any](entries map[string]T) []T {
	keys := make([]string, 0, len(entries))
	for key := range entries {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	list := make([]T, len(keys))
	for i, key := range keys {
		list[i] = entries[key]
	}
	return list
}

func marshalList[T interface{ ProtoReflect() protoreflect.Message }](list []T) []json.RawMessage {
	raw := make([]json.RawMessage, len(list))
	for i, entry := range list {
		raw[i] = json.RawMessage(protojson.MarshalOptions{UseProtoNames: false}.Format(entry))
	}
	return raw
}

func computeStats(fd protoreflect.FieldDescriptor, class proto.Class, race proto.Race, talents string, buffs bool) (result *proto.ComputeStatsResult, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("%v", r)
		}
	}()
	player := &proto.Player{Class: class, Race: race, TalentsString: talents, Equipment: &proto.EquipmentSpec{}}
	specMessage := player.ProtoReflect().NewField(fd)
	fillMessages(specMessage.Message(), 3)
	player.ProtoReflect().Set(fd, specMessage)

	partyBuffs, raidBuffs, debuffs := &proto.PartyBuffs{}, &proto.RaidBuffs{}, &proto.Debuffs{}
	if buffs {
		enableAll(partyBuffs.ProtoReflect())
		enableAll(raidBuffs.ProtoReflect())
		enableAll(debuffs.ProtoReflect())
	}
	result = core.ComputeStats(&proto.ComputeStatsRequest{
		Raid:      core.SinglePlayerRaidProto(player, partyBuffs, raidBuffs, debuffs),
		Encounter: core.MakeSingleTargetEncounter(0),
	})
	if result.ErrorResult != "" {
		return nil, fmt.Errorf("%s", result.ErrorResult)
	}
	return result, nil
}

// The game files' name of every spell id in the lists, for the ones the UI database has no entry for.
func names(c *collected) map[string]string {
	named := map[string]string{}
	add := func(id *proto.ActionID) {
		if spellID := id.GetSpellId(); spellID != 0 {
			if spell := spelldata.Find(spellID); spell != nil && spell.Name != "" {
				named[fmt.Sprint(spellID)] = spell.Name
			}
		}
	}
	for _, spell := range c.spells {
		add(spell.Id)
	}
	for _, auras := range []map[string]*proto.AuraStats{c.auras, c.petAuras, c.targetAuras} {
		for _, aura := range auras {
			add(aura.Id)
		}
	}
	return named
}

func main() {
	sim.RegisterAll()

	out := map[string]any{}
	specOneof := (&proto.Player{}).ProtoReflect().Descriptor().Oneofs().ByName("spec")
	for i := 0; i < specOneof.Fields().Len(); i++ {
		fd := specOneof.Fields().Get(i)
		probe := &proto.Player{}
		probe.ProtoReflect().Set(fd, probe.ProtoReflect().NewField(fd))
		spec, err := core.PlayerProtoToSpecSafe(probe)
		if err != nil {
			continue
		}
		class := specClass(spec)
		className, folder := specFolder(spec, class)
		talentSets, err := talentRanks(className)
		if err != nil {
			fmt.Fprintf(os.Stderr, "%s: %v\n", folder, err)
			os.Exit(1)
		}

		found := &collected{map[string]*proto.SpellStats{}, map[string]*proto.AuraStats{}, map[string]*proto.AuraStats{}, map[string]*proto.AuraStats{}}
		var failure error
		for _, race := range core.ClassRaceCapabilities[class] {
			for _, talents := range talentSets {
				// A spec not yet ported can panic on a buff or talent it has no code for; it then lists
				// what it registers without them.
				result, err := computeStats(fd, class, race, talents, true)
				if err != nil {
					fmt.Fprintf(os.Stderr, "%s %s with talents %s and every buff: %v\n", folder, race, talents, err)
					result, err = computeStats(fd, class, race, talents, false)
				}
				if err != nil {
					fmt.Fprintf(os.Stderr, "%s %s with talents %s: %v\n", folder, race, talents, err)
					result, err = computeStats(fd, class, race, "", false)
				}
				if err != nil {
					fmt.Fprintf(os.Stderr, "%s %s with no talents: %v\n", folder, race, err)
					failure = err
					continue
				}
				found.add(result)
			}
		}
		// A spec the sim cannot build yet says why, so the panel can tell it apart from one that registers nothing.
		if len(found.spells) == 0 && failure != nil {
			out[folder] = map[string]string{"error": failure.Error()}
			continue
		}
		out[folder] = map[string]any{
			"names":       names(found),
			"spells":      marshalList(sorted(found.spells)),
			"auras":       marshalList(sorted(found.auras)),
			"petAuras":    marshalList(sorted(found.petAuras)),
			"targetAuras": marshalList(sorted(found.targetAuras)),
		}
	}

	encoder := json.NewEncoder(os.Stdout)
	if err := encoder.Encode(out); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
