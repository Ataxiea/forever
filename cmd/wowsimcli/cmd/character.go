package cmd

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"google.golang.org/protobuf/encoding/protojson"
	googleProto "google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"

	"github.com/wowsims/forever/sim/core"
	"github.com/wowsims/forever/sim/core/proto"
	"github.com/wowsims/forever/sim/siml"
)

// What is simmed besides the APL: one player's settings, as the site sims them.
type character struct {
	settings *proto.IndividualSimSettings
	info     characterInfo
}

type characterInfo struct {
	Source   string   `json:"source"` // The files the settings come from.
	Race     string   `json:"race"`
	Talents  string   `json:"talents"`
	Gear     string   `json:"gear,omitempty"` // The spec's gear set the gear is, if it is one.
	Warnings []string `json:"warnings,omitempty"`
}

// The field of the spec oneof a player sets, or nil.
func specField(p *proto.Player) protoreflect.FieldDescriptor {
	m := p.ProtoReflect()
	return m.WhichOneof(m.Descriptor().Oneofs().ByName("spec"))
}

// The spec's folder under ui/specs, such as hunter/dps, and its defaults: the folder of the spec's class whose
// defaults.siml is for the spec. A defaults.siml that does not read is skipped, so another spec's broken file does not
// stop this one; the error names it when no folder is the spec's.
func specDefaults(root string, spec proto.Spec) (string, *siml.File, error) {
	var skipped []error
	if info, ok := siml.SpecOf(spec); ok {
		class := siml.ClassName(info.Class)
		paths, err := filepath.Glob(filepath.Join(root, "ui/specs", class, "*", "defaults.siml"))
		if err != nil {
			return "", nil, err
		}
		for _, path := range paths {
			f, err := siml.ReadFile(path)
			if err != nil {
				skipped = append(skipped, err)
				continue
			}
			if f.Spec == spec {
				return class + "/" + filepath.Base(filepath.Dir(path)), f, nil
			}
		}
	}
	return "", nil, errors.Join(append([]error{fmt.Errorf("ui/specs holds no defaults.siml for %s", spec)}, skipped...)...)
}

// The character the site sims a rotation with: the spec's defaults, with the build loaded over them whose rotation
// is the rotation of the file at path, when exactly one of the spec's builds has it. A rotation several builds share,
// or none, is simmed on the defaults.
func characterFromRepo(root, folder string, defaults *siml.File, path string) (*character, error) {
	c := &character{
		settings: googleProto.Clone(defaults.Settings).(*proto.IndividualSimSettings),
		info:     characterInfo{Source: defaults.Path},
	}
	build, err := buildOf(root, folder, path)
	if err != nil {
		return nil, err
	}
	if build != nil {
		loadBuild(c.settings, build.Settings)
		c.info.Source = build.Path + " over " + c.info.Source
	}
	if c.settings.Encounter == nil {
		c.settings.Encounter = core.MakeSingleTargetEncounter(0)
	}
	c.info.Gear = gearSetOf(root, folder, c.settings.GetPlayer().GetEquipment())
	return c, nil
}

// The build of the spec in folder whose rotation is the rotation of the file at path, or nil when no build or several
// have it. The file is read as saved, so a build's character stays while the file's text is being edited; a file not
// saved yet, or saved with an error, is no build's.
func buildOf(root, folder, path string) (*siml.File, error) {
	file, err := siml.ReadFile(path)
	if err != nil {
		return nil, nil
	}
	paths, err := filepath.Glob(filepath.Join(root, "ui/specs", folder, "builds", "*.siml"))
	if err != nil {
		return nil, err
	}
	var found []*siml.File
	for _, p := range paths {
		build, err := siml.ReadFile(p)
		if err != nil {
			return nil, err
		}
		if googleProto.Equal(build.Rotation(), file.Rotation()) {
			found = append(found, build)
		}
	}
	if len(found) != 1 {
		return nil, nil
	}
	return found[0], nil
}

// Loads the settings of a build b over s, as the site loads a preset build (makePresetBuildFromJSON and applyBuild in
// the UI): each message b holds replaces s's own, except an Auto rotation, which keeps s's, and without an item swap set b turns item swap off. b's settings: section, which sets the spec's options, sets the options, the distance
// and whether the player stands in front of the target, and the race, professions and timings it does not leave at 0.
func loadBuild(s, b *proto.IndividualSimSettings) {
	p, bp := s.Player, b.GetPlayer()
	if bp.Rotation != nil && bp.Rotation.Type != proto.APLRotation_TypeAuto {
		p.Rotation = bp.Rotation
	}
	if bp.Equipment != nil {
		p.Equipment = bp.Equipment
	}
	p.EnableItemSwap = bp.ItemSwap != nil && bp.EnableItemSwap
	if bp.ItemSwap != nil {
		p.ItemSwap = bp.ItemSwap
	}
	if bp.TalentsString != "" {
		p.TalentsString = bp.TalentsString
	}
	if bp.Consumables != nil {
		p.Consumables = bp.Consumables
	}
	if bp.Buffs != nil {
		p.Buffs = bp.Buffs
	}
	if b.PartyBuffs != nil {
		s.PartyBuffs = b.PartyBuffs
	}
	if b.RaidBuffs != nil {
		s.RaidBuffs = b.RaidBuffs
	}
	if b.Debuffs != nil {
		s.Debuffs = b.Debuffs
	}
	if b.Encounter != nil {
		s.Encounter, p.HealingModel, s.Tanks, s.TargetDummies = b.Encounter, bp.HealingModel, b.Tanks, b.TargetDummies
	}

	if fd := specField(bp); fd == nil || !bp.ProtoReflect().Get(fd).Message().Has(fd.Message().Fields().ByName("options")) {
		return
	}
	p.Spec = bp.Spec
	p.DistanceFromTarget, p.InFrontOfTarget = bp.DistanceFromTarget, bp.InFrontOfTarget
	if bp.Race != proto.Race_RaceUnknown {
		p.Race = bp.Race
	}
	if bp.Profession1 != proto.Profession_ProfessionUnknown {
		p.Profession1 = bp.Profession1
	}
	if bp.Profession2 != proto.Profession_ProfessionUnknown {
		p.Profession2 = bp.Profession2
	}
	if bp.ReactionTimeMs != 0 {
		p.ReactionTimeMs = bp.ReactionTimeMs
	}
	if bp.ChannelClipDelayMs != 0 {
		p.ChannelClipDelayMs = bp.ChannelClipDelayMs
	}
}

// The name of the spec's gear set e is, or "".
func gearSetOf(root, folder string, e *proto.EquipmentSpec) string {
	paths, _ := filepath.Glob(filepath.Join(root, "ui/specs", folder, "gear_sets", "*.gear.siml"))
	for _, path := range paths {
		if f, err := siml.ReadFile(path); err == nil && googleProto.Equal(f.Equipment(), e) {
			return strings.TrimSuffix(filepath.Base(path), ".gear.siml")
		}
	}
	return ""
}

// The character a settings file describes: an IndividualSimSettings the site exports, in protojson or as an x.siml.
func characterFromSettings(root, path string, spec proto.Spec, folder string) (*character, error) {
	c := &character{settings: &proto.IndividualSimSettings{}, info: characterInfo{Source: path}}
	if strings.HasSuffix(path, ".siml") {
		var err error
		if c, err = readSetup(root, path); err != nil {
			return nil, err
		}
	} else if data, err := os.ReadFile(path); err != nil {
		return nil, err
	} else if err := (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(data, c.settings); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if info, ok := siml.SpecOf(spec); !ok || specField(c.settings.GetPlayer()) != info.Field {
		return nil, fmt.Errorf("%s is not a %s character", path, folder)
	}
	return c, nil
}

// The character of the x.siml at path: a full setup as it is, or a preset build, which names no race, loaded over its
// spec's defaults.siml under root. The warnings are the file's, and for a build the defaults it is loaded over.
func readSetup(root, path string) (*character, error) {
	f, err := siml.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if f.Kind.Section != "" {
		return nil, fmt.Errorf("%s holds only its %s section, and a setup is an x.siml: a full setup or a preset build", path, f.Kind.Section)
	}
	c := &character{settings: f.Settings, info: characterInfo{Source: path}}
	for _, w := range f.Warnings {
		c.info.Warnings = append(c.info.Warnings, diagnosticLine(w))
	}
	if f.Settings.GetPlayer().GetRace() != proto.Race_RaceUnknown {
		return c, nil
	}
	_, defaults, err := specDefaults(root, f.Spec)
	if err != nil {
		return nil, fmt.Errorf("%s names no race, so it is a preset build, and %w", path, err)
	}
	c.settings = googleProto.Clone(defaults.Settings).(*proto.IndividualSimSettings)
	loadBuild(c.settings, f.Settings)
	c.info.Source = path + " over " + defaults.Path
	c.info.Warnings = append(c.info.Warnings, fmt.Sprintf("%s names no race, so it is a preset build: simmed over %s", path, defaults.Path))
	return c, nil
}
