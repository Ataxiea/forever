package core

import (
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wowsims/forever/sim/core/proto"
	"github.com/wowsims/forever/sim/core/stats"
	"github.com/wowsims/forever/sim/siml"
)

var DefaultSimTestOptions = &proto.SimOptions{
	Iterations: 20,
	IsTest:     true,
	Debug:      false,
	RandomSeed: 101,
}
var StatWeightsDefaultSimTestOptions = &proto.SimOptions{
	Iterations: 300,
	IsTest:     true,
	Debug:      false,
	RandomSeed: 101,
}
var AverageDefaultSimTestOptions = &proto.SimOptions{
	Iterations: 2000,
	IsTest:     true,
	Debug:      false,
	RandomSeed: 101,
}

const ShortDuration = 60
const LongDuration = 180

func FreshDefaultTargetConfig() *proto.Target {
	return &proto.Target{
		Level: CharacterLevel + 3,
		Stats: stats.Stats{
			stats.Armor:       3731,
			stats.AttackPower: 320,
		}.ToProtoArray(),
		MobType: proto.MobType_MobTypeMechanical,

		SwingSpeed:    2,
		MinBaseDamage: 2601,
		ParryHaste:    true,
		CanCrush:      true,
		DamageSpread:  0.5,
	}
}

var DefaultTargetProto = FreshDefaultTargetConfig()

var FullRaidBuffs = &proto.RaidBuffs{
	ArcaneBrilliance:         true,
	PrayerOfFortitude:        true,
	PrayerOfSpirit:           true,
	GiftOfTheWild:            true,
	PrayerOfShadowProtection: true,
}

var FullPartyBuffs = &proto.PartyBuffs{
	BloodPact:         true,
	MoonkinAura:       true,
	LeaderOfThePack:   true,
	DevotionAura:      true,
	RetributionAura:   true,
	ConcentrationAura: true,
	TrueshotAura:      true,
	AtieshDruid:       1,
	AtieshMage:        1,
	AtieshPriest:      1,
	AtieshWarlock:     1,

	ManaSpringTotem:      proto.TristateEffect_TristateEffectImproved,
	ManaTideTotems:       1,
	GraceOfAirTotem:      true,
	StrengthOfEarthTotem: true,
	WindfuryTotem:        true,

	BattleShout: proto.TristateEffect_TristateEffectRegular,
}

var FullIndividualBuffs = &proto.IndividualBuffs{
	GreaterBlessingOfKings:     true,
	GreaterBlessingOfSalvation: true,
	GreaterBlessingOfWisdom:    true,
	GreaterBlessingOfMight:     true,
	GreaterBlessingOfLight:     true,
	Thorns:                     true,
}

var FullTankIndividualBuffs = &proto.IndividualBuffs{
	GreaterBlessingOfKings:  true,
	GreaterBlessingOfWisdom: true,
	GreaterBlessingOfMight:  true,
	GreaterBlessingOfLight:  true,
	Thorns:                  true,
}

var FullDebuffs = &proto.Debuffs{
	JudgementOfWisdom:      true,
	JudgementOfLight:       true,
	JudgementOfTheCrusader: true,
	CurseOfElements:        true,
	GiftOfArthas:           true,
	ExposeArmor:            true,
	FaerieFire:             true,
	SunderArmor:            true,
	CurseOfRecklessness:    true,
	HuntersMark:            true,
	DemoralizingRoar:       true,
	// DemoralizingShout:         true,
	ThunderClap:  true,
	InsectSwarm:  true,
	ScorpidSting: true,
}

func NewDefaultTarget() *proto.Target {
	return DefaultTargetProto // seems to be read-only
}

func MakeDefaultEncounterCombos() []EncounterCombo {
	var DefaultTarget = NewDefaultTarget()

	multipleTargets := make([]*proto.Target, 21)
	for i := range multipleTargets {
		if i != 10 {
			multipleTargets[i] = DefaultTarget
		} else {
			disabledTarget := FreshDefaultTargetConfig()
			disabledTarget.DisabledAtStart = true
			multipleTargets[i] = disabledTarget
		}
	}

	return []EncounterCombo{
		{
			Label: "ShortSingleTarget",
			Encounter: &proto.Encounter{
				Duration:             ShortDuration,
				ExecuteProportion_20: 0.2,
				ExecuteProportion_25: 0.25,
				ExecuteProportion_35: 0.35,
				ExecuteProportion_45: 0.45,
				ExecuteProportion_90: 0.90,
				Targets: []*proto.Target{
					DefaultTarget,
				},
			},
		},
		{
			Label: "LongSingleTarget",
			Encounter: &proto.Encounter{
				Duration:             LongDuration,
				ExecuteProportion_20: 0.2,
				ExecuteProportion_25: 0.25,
				ExecuteProportion_35: 0.35,
				ExecuteProportion_45: 0.45,
				ExecuteProportion_90: 0.90,
				Targets: []*proto.Target{
					DefaultTarget,
				},
			},
		},
		{
			Label: "LongMultiTarget",
			Encounter: &proto.Encounter{
				Duration:             LongDuration,
				ExecuteProportion_20: 0.2,
				ExecuteProportion_25: 0.25,
				ExecuteProportion_35: 0.35,
				ExecuteProportion_45: 0.45,
				ExecuteProportion_90: 0.90,
				Targets:              multipleTargets,
			},
		},
	}
}

func MakeSingleTargetEncounter(variation float64) *proto.Encounter {
	return &proto.Encounter{
		Duration:             LongDuration,
		DurationVariation:    variation,
		ExecuteProportion_20: 0.2,
		ExecuteProportion_25: 0.25,
		ExecuteProportion_35: 0.35,
		ExecuteProportion_45: 0.45,
		ExecuteProportion_90: 0.90,
		Targets: []*proto.Target{
			NewDefaultTarget(),
		},
	}
}

func RaidSimTest(label string, t *testing.T, rsr *proto.RaidSimRequest, expectedDps float64) {
	result := RunRaidSim(rsr)
	if result.Error != nil {
		t.Fatalf("Sim failed with error: %s", result.Error.Message)
	}
	tolerance := 0.5
	if result.RaidMetrics.Dps.Avg < expectedDps-tolerance || result.RaidMetrics.Dps.Avg > expectedDps+tolerance {
		// Automatically print output if we had debugging enabled.
		if rsr.SimOptions.Debug {
			log.Printf("LOGS:\n%s\n", result.Logs)
		}
		t.Fatalf("%s failed: expected %0f dps from sim but was %0f", label, expectedDps, result.RaidMetrics.Dps.Avg)
	}
}

func RaidBenchmark(b *testing.B, rsr *proto.RaidSimRequest) {
	rsr.Encounter.Duration = LongDuration
	rsr.SimOptions.Iterations = 1

	// Set to false because IsTest adds a lot of computation.
	rsr.SimOptions.IsTest = false

	for i := 0; i < b.N; i++ {
		result := RunRaidSim(rsr)
		if result.Error != nil {
			b.Fatalf("RaidBenchmark() at iteration %d failed: %v", i, result.Error.Message)
		}
	}
}

// CharacterBenchmark sims a suite config's default setup against one target. The seed is fixed,
// so the reported dps only moves when a change alters results.
func CharacterBenchmark(b *testing.B, config CharacterSuiteConfig) {
	_, raid := config.defaultPlayerAndRaid()
	rsr := &proto.RaidSimRequest{
		Raid:       raid,
		Encounter:  Ternary(config.Encounter.Encounter != nil, config.Encounter.Encounter, MakeSingleTargetEncounter(0)),
		SimOptions: &proto.SimOptions{Iterations: 1000, RandomSeed: 101},
	}

	b.ReportAllocs()
	var dps float64
	for b.Loop() {
		result := RunRaidSim(rsr)
		if result.Error != nil {
			b.Fatalf("CharacterBenchmark() failed: %v", result.Error.Message)
		}
		dps = result.RaidMetrics.Dps.Avg
	}
	b.ReportMetric(dps, "dps")
}

// Reads a preset under ui/specs, a .siml file, with the files its use lines name. A preset the spec
// does not ship gives nil, so a suite still runs and the test that needs it fails on its own. A preset
// that does not read panics with its diagnostics, and so does a missing one with a JSON file of the
// same name beside it, since the sim reads presets only as SIML; printFlags are the flags of the
// wowsimcli siml print command that writes it.
func readPreset(path string, jsonPath string, printFlags string) *siml.File {
	f, err := siml.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		if _, jsonErr := os.Stat(jsonPath); jsonErr == nil {
			placeholder := ""
			if strings.Contains(printFlags, "SPEC_FIELD") {
				placeholder = ", putting the field its spec line writes (hunter, dps_warrior) for SPEC_FIELD,"
			}
			panic(fmt.Sprintf("%s is JSON, and the sim reads presets as SIML: write it as %s%s with go run --tags=with_db ./cmd/wowsimcli siml print %s %s > %s",
				jsonPath, path, placeholder, printFlags, jsonPath, path))
		}
		return nil
	}
	if err != nil {
		panic(err)
	}
	return f
}

// The spec field the rotations under dir, ui/specs/<class>/<spec folder>/apls, are for: the class's one spec, or the
// spec whose field without underscores is the folder and the class (feralcat → feral_cat_druid). SPEC_FIELD when none
// fits, which the command that writes the file must replace.
func presetSpec(dir string) string {
	folder := filepath.Dir(filepath.Clean(dir))
	class, spec := filepath.Base(filepath.Dir(folder)), filepath.Base(folder)
	for _, info := range siml.Specs() {
		if field := string(info.Field.Name()); field == class || strings.ReplaceAll(field, "_", "") == spec+class {
			return field
		}
	}
	return "SPEC_FIELD"
}

func GetAplRotation(dir string, file string) RotationCombo {
	filePath := dir + "/" + file + ".apl.siml"
	f := readPreset(filePath, dir+"/"+file+".apl.json", "-kind apl -spec "+presetSpec(dir))
	if f == nil {
		log.Printf("no apl siml file, skipping rotation: %s", filePath)
		return RotationCombo{Label: file}
	}

	return RotationCombo{Label: file, Rotation: f.Rotation()}
}

func GetGearSet(dir string, file string) GearSetCombo {
	filePath := dir + "/" + file + ".gear.siml"
	f := readPreset(filePath, dir+"/"+file+".gear.json", "-kind gear")
	if f == nil {
		log.Printf("no gear siml file, skipping gear set: %s", filePath)
		return GearSetCombo{Label: file, GearSet: &proto.EquipmentSpec{}}
	}

	return GearSetCombo{Label: file, GearSet: f.Equipment()}
}

// The item_swap: section of x.siml, with its prepull bonus stats, when that file holds one; otherwise the items of
// x.gear.siml.
func GetItemSwapGearSet(dir string, file string) ItemSwapSetCombo {
	if full := readPreset(dir+"/"+file+".siml", "", ""); full != nil && full.Settings.GetPlayer().GetItemSwap() != nil {
		return ItemSwapSetCombo{Label: file, ItemSwap: full.Settings.GetPlayer().GetItemSwap()}
	}

	filePath := dir + "/" + file + ".gear.siml"
	f := readPreset(filePath, dir+"/"+file+".gear.json", "-kind gear")
	if f == nil {
		log.Fatalf("no gear siml file for the item swap set: %s", filePath)
	}

	return ItemSwapSetCombo{Label: file, ItemSwap: &proto.ItemSwap{Items: f.Equipment().Items}}
}

func GenerateTalentVariations(baseTalents string) []TalentsCombo {
	return GenerateTalentVariationsForRows(baseTalents, []int{0, 1, 2, 3, 4, 5})
}

func GenerateTalentVariationsForRows(baseTalents string, rowsToVary []int) []TalentsCombo {
	if len(baseTalents) != 6 {
		log.Fatalf("Expected 6-digit talent string, got: %s", baseTalents)
	}

	var combinations []TalentsCombo

	baseRunes := []rune(baseTalents)
	for _, row := range rowsToVary {
		if row < 0 || row >= 6 {
			log.Fatalf("Invalid row index: %d, must be between 0 and 5", row)
		}

		for choice := 1; choice <= 3; choice++ {
			if int(baseRunes[row]-'0') == choice {
				continue
			}

			variation := make([]rune, 6)
			copy(variation, baseRunes)
			variation[row] = rune('0' + choice)

			combinations = append(combinations, TalentsCombo{
				Label:   fmt.Sprintf("Row%d_Talent%d", row+1, choice),
				Talents: string(variation),
			})
		}
	}

	return combinations
}

func GetTestBuild(class proto.Class, dir string, file string, itemFilter ItemFilter, epReferenceStat *proto.Stat, statsToWeigh *[]proto.Stat) CharacterSuiteConfig {
	filePath := dir + "/" + file + ".siml"
	f := readPreset(filePath, dir+"/"+file+".build.json", "-kind siml")
	if f == nil {
		log.Fatalf("no siml file for the test build: %s", filePath)
	}
	simSettings := f.Settings

	config := CharacterSuiteConfig{
		Class:       class,
		Race:        simSettings.Player.Race,
		Profession1: simSettings.Player.Profession1,
		Profession2: simSettings.Player.Profession2,
		GearSet: GearSetCombo{
			Label:   file,
			GearSet: simSettings.Player.Equipment,
		},
		SpecOptions: SpecOptionsCombo{
			Label:       file,
			SpecOptions: getPlayerSpecOptions(simSettings.Player),
		},
		Talents: simSettings.Player.TalentsString,
		Rotation: RotationCombo{
			Label:    file,
			Rotation: simSettings.Player.Rotation,
		},
		Encounter: EncounterCombo{
			Label:     file,
			Encounter: simSettings.Encounter,
		},
		ItemSwapSet: ItemSwapSetCombo{
			Label:    file,
			ItemSwap: simSettings.Player.ItemSwap,
		},
		StartingDistance:   simSettings.Player.DistanceFromTarget,
		ReactionTimeMs:     simSettings.Player.ReactionTimeMs,
		ChannelClipDelayMs: simSettings.Player.ChannelClipDelayMs,

		Consumables:     simSettings.Player.Consumables,
		IndividualBuffs: simSettings.Player.Buffs,
		PartyBuffs:      simSettings.PartyBuffs,
		RaidBuffs:       simSettings.RaidBuffs,
		Debuffs:         simSettings.Debuffs,
		Cooldowns:       simSettings.Player.Cooldowns,

		InFrontOfTarget: simSettings.Player.InFrontOfTarget,
		TargetDummies:   simSettings.TargetDummies,
		HealingModel:    simSettings.Player.HealingModel,

		ItemFilter: itemFilter,
	}

	if simSettings.Tanks != nil {
		config.Tanks = simSettings.Tanks

		// Check if any of the tanks is the player.
		for _, tank := range simSettings.Tanks {
			if tank.Type == proto.UnitReference_Player {
				config.IsTank = true
				break
			}
		}
	}

	if epReferenceStat != nil {
		config.EPReferenceStat = *epReferenceStat
	}
	if statsToWeigh != nil {
		config.StatsToWeigh = *statsToWeigh
	}

	return config
}

func getPlayerSpecOptions(player *proto.Player) interface{} {
	if playerSpec, ok := player.Spec.(*proto.Player_BalanceDruid); ok {
		return playerSpec
	}
	if playerSpec, ok := player.Spec.(*proto.Player_FeralCatDruid); ok {
		return playerSpec
	}
	if playerSpec, ok := player.Spec.(*proto.Player_FeralBearDruid); ok {
		return playerSpec
	}
	if playerSpec, ok := player.Spec.(*proto.Player_RestorationDruid); ok {
		return playerSpec
	}
	if playerSpec, ok := player.Spec.(*proto.Player_Hunter); ok {
		return playerSpec
	}
	if playerSpec, ok := player.Spec.(*proto.Player_Mage); ok {
		return playerSpec
	}
	if playerSpec, ok := player.Spec.(*proto.Player_HolyPaladin); ok {
		return playerSpec
	}
	if playerSpec, ok := player.Spec.(*proto.Player_ProtectionPaladin); ok {
		return playerSpec
	}
	if playerSpec, ok := player.Spec.(*proto.Player_RetributionPaladin); ok {
		return playerSpec
	}
	if playerSpec, ok := player.Spec.(*proto.Player_DpsPriest); ok {
		return playerSpec
	}
	if playerSpec, ok := player.Spec.(*proto.Player_HealerPriest); ok {
		return playerSpec
	}
	if playerSpec, ok := player.Spec.(*proto.Player_Rogue); ok {
		return playerSpec
	}
	if playerSpec, ok := player.Spec.(*proto.Player_ElementalShaman); ok {
		return playerSpec
	}
	if playerSpec, ok := player.Spec.(*proto.Player_EnhancementShaman); ok {
		return playerSpec
	}
	if playerSpec, ok := player.Spec.(*proto.Player_RestorationShaman); ok {
		return playerSpec
	}
	if playerSpec, ok := player.Spec.(*proto.Player_Warlock); ok {
		return playerSpec
	}
	if playerSpec, ok := player.Spec.(*proto.Player_DpsWarrior); ok {
		return playerSpec
	}
	if playerSpec, ok := player.Spec.(*proto.Player_ProtectionWarrior); ok {
		return playerSpec
	}

	panic("Unsupported spec provided to getPlayerSpecOptions. Please add a case for the spec.")
}
