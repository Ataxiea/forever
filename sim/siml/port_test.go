package siml

import (
	"strings"
	"testing"

	"google.golang.org/protobuf/encoding/protojson"
	googleProto "google.golang.org/protobuf/proto"

	"github.com/wowsims/forever/sim/core/proto"
)

var portText = textLines(
	"siml 1",
	"spec hunter",
	"",
	"var $weave = true",
	"// Whether a shot fits before the next swing.",
	"def fits(x) = spell(x).cast_time < 2s or not $weave",
	"",
	"priority:",
	"  cast hunters_mark if not target.aura(hunters_mark).is_active",
	"  // Bite whenever it is up.",
	"  cast mongoose_bite",
	"  when $weave:",
	"    cast multi_shot if fits(multi_shot)",
	"    cast aimed_shot if fits(aimed_shot)",
	"  cast arcane_shot",
)

// The rotation portText reads as, changed by edit, as master's JSON for it would hold it.
func portedRotation(t *testing.T, d *Doc, edit func(r *proto.APLRotation)) *proto.APLRotation {
	t.Helper()
	r := &proto.APLRotation{}
	if err := protojson.Unmarshal(d.RotationJSON(), r); err != nil {
		t.Fatal(err)
	}
	edit(r)
	return r
}

func TestPort(t *testing.T) {
	names := corpusNames(t)
	d := Analyze(splicePath, []byte(portText), names, nil)
	if edits, err := d.Port(portedRotation(t, d, func(*proto.APLRotation) {})); err != nil || len(edits) != 0 {
		t.Fatalf("the same rotation ports as %v, %v; want no edit", edits, err)
	}

	// Mongoose Bite goes, Rapid Fire comes in before Arcane Shot, and Arcane Shot takes a condition.
	want := portedRotation(t, d, func(r *proto.APLRotation) {
		rapid := &proto.APLListItem{Action: &proto.APLAction{Action: &proto.APLAction_CastSpell{CastSpell: &proto.APLActionCastSpell{
			SpellId: &proto.ActionID{RawId: &proto.ActionID_SpellId{SpellId: 3045}}}}}}
		arcane := r.PriorityList[4]
		arcane.Action.Condition = &proto.APLValue{Value: &proto.APLValue_CurrentTime{CurrentTime: &proto.APLValueCurrentTime{}}}
		r.PriorityList = append(r.PriorityList[:1], r.PriorityList[2], r.PriorityList[3], rapid, arcane)
	})
	edits, err := d.Port(want)
	if err != nil {
		t.Fatal(err)
	}
	got := applied(d, edits)
	for _, line := range []string{
		"def fits(x) = spell(x).cast_time < 2s or not $weave",
		"  cast hunters_mark if not target.aura(hunters_mark).is_active",
		"  when $weave:\n    cast multi_shot if fits(multi_shot)\n    cast aimed_shot if fits(aimed_shot)\n",
		"  cast rapid_fire\n  cast arcane_shot if current_time\n",
	} {
		if !strings.Contains(got, line) {
			t.Errorf("the ported text lacks %q:\n%s", line, got)
		}
	}
	if strings.Contains(got, "mongoose_bite") || strings.Contains(got, "Bite whenever") {
		t.Errorf("the ported text keeps the row it takes out:\n%s", got)
	}
	back := Analyze(splicePath, []byte(got), names, nil)
	if a, b := d.ix.comparedJSON(Normalize(want, names, proto.Class_ClassHunter).ProtoReflect()), back.ix.comparedJSON(Normalize(back.file.Rotation(), names, proto.Class_ClassHunter).ProtoReflect()); a != b {
		t.Errorf("the ported text reads as\n%s\nwant\n%s", b, a)
	}
}

func TestPortSetup(t *testing.T) {
	names := corpusNames(t)
	text := textLines(
		"siml 1",
		"spec hunter",
		`talents "1"`,
		"",
		"// The race to sim.",
		"settings: race orc",
		"",
		"priority:",
		"  // Mark first.",
		"  cast hunters_mark",
	)
	d := Analyze("x.siml", []byte(text), names, nil)
	want := googleProto.Clone(d.file.Settings).(*proto.IndividualSimSettings)
	want.Player.Race = proto.Race_RaceTroll
	want.Player.TalentsString = "2"
	edits, left, err := d.PortSetup(want)
	if err != nil || len(left) != 0 {
		t.Fatalf("PortSetup: %v, left %v", err, left)
	}
	got := applied(d, edits)
	if want := strings.Replace(strings.Replace(text, `"1"`, `"2"`, 1), "race orc", "race troll", 1); got != want {
		t.Errorf("the ported setup is\n%s\nwant\n%s", got, want)
	}
	if edits, left, err := Analyze("x.siml", []byte(got), names, nil).PortSetup(want); err != nil || len(edits)+len(left) != 0 {
		t.Errorf("the ported setup ports again as %v, left %v, %v", edits, left, err)
	}
}
