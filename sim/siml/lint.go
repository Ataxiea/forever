package siml

import (
	"fmt"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/wowsims/forever/sim/core/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// Static checks on a rotation: what the sim would skip, warn about or never reach, found without running it. Every
// finding points at the most specific JSON node it is about.
//
// | Code                    | Severity | Catches                                                                                           |
// | ----------------------- | -------- | ------------------------------------------------------------------------------------------------- |
// | `empty-action`          | error    | An action with no kind set (`{}`); the sim skips the row. Toggle groups are exempt (below).       |
// | `empty-value`           | warning  | A value with no kind set; the sim drops it, so a condition made of it is no condition. An empty   |
// |                         |          | item of an `and`, `or`, `max` or `min`, an empty overlap or offset (0s) and an empty channel      |
// |                         |          | interrupt (a plain cast) are `info`. A move's range or duration, empty or missing, and a          |
// |                         |          | reference's value for a placeholder are errors: the sim fails to run.                             |
// | `undefined-group`       | error    | A group reference to a group no `groups` entry names, or with no name.                            |
// | `group-never-used`      | warning  | `actionGroupUsed` of a group that no row references, hidden or not: it is always false.           |
// | `undefined-sequence`    | warning  | A sequence name no live sequence in the priority list or a group carries (prepull ones don't).    |
// | `undefined-variable`    | error    | A `variableRef` to a name no value variable has. A group's variables and those a reference sets   |
// |                         |          | only replace a value variable of the same name, so a name only they set is dropped too.           |
// | `placeholder-unset`     | error    | A group reference that leaves one of the group's `variablePlaceholder`s unfilled.                 |
// | `placeholder-outside`   | warning  | A `variablePlaceholder` outside a group, which nothing replaces.                                  |
// | `duplicate-variable`    | warning  | A value variable whose name an earlier one already takes; references read the first.              |
// | `unused-variable`       | info     | A value variable nothing references.                                                              |
// | `unused-group`          | info     | A group nothing references, by group reference or `actionGroupUsed`.                              |
// | `prepull-no-time`       | warning  | A prepull row with no Do At time; the sim skips it.                                               |
// | `prepull-positive-time` | warning  | A prepull Do At time after the pull; the sim ignores the row.                                     |
// | `prepull-not-time`      | warning  | A Do At value read from the fight; the sim reads it once, before the fight, and can fail on it.   |
// |                         |          | Constant times and spell and aura durations, which need no fight, are fine.                       |
// | `prepull-order`         | info     | A prepull row listed after one with a later time; prepull rows run in time order, not list order. |
// | `prepull-condition`     | warning  | A condition on a prepull row; the sim runs the action at its Do At time without reading it.       |
// | `never-runs`            | warning  | A condition that is always false (the sim drops the row). A literal `false` is `info`: it keeps   |
// |                         |          | the spell out of automatic cooldown use, a deliberate way to turn a cooldown off.                 |
// | `always-true`           | info     | A condition, or a comparison, `not`, `and` or `or` inside one, that is always true or false.      |
// | `shadowed-row`          | warning  | A row whose action an earlier row in the same list takes with no condition or the same one: the   |
// |                         |          | later row is only reached when that action cannot run, so it never runs.                          |
//
// Hidden rows: the sim parses none of them, so every check skips them except the references. A hidden row's references
// are still checked and still count as uses, since unhiding the row brings them back (a hidden group reference is how
// a toggle group is switched off). A sequence that only a hidden row carries is reported, as the sim does not find it.
//
// Toggle groups: a group whose rows all have empty actions is a switch ("Stance Dance ON/OFF"): hiding or unhiding the
// row that references it turns actionGroupUsed of it off or on. Its empty actions are not reported; unused-group still
// reports one nothing references.
//
// Not followed: value variables. A condition that reads a variable holding a constant is a setting the reader flips,
// not a mistake, so constant checks stop at a variableRef.
//
// The checks read the rotation as its protojson: JSON names, fields left out where protojson leaves them out.

// A finding of Lint, at the JSON path within the rotation of what it is about.
type Finding struct {
	Path     []any  `json:"path"`     // JSON names and list indices.
	Severity string `json:"severity"` // error, warning or info.
	Code     string `json:"code"`
	Message  string `json:"message"`
}

// A JSON object with its keys in the order protojson writes them.
type lintObject struct {
	keys   []string
	values map[string]any
}

func (o *lintObject) get(key string) (any, bool) {
	if o == nil {
		return nil, false
	}
	v, ok := o.values[key]
	return v, ok
}

func (o *lintObject) value(key string) any {
	v, _ := o.get(key)
	return v
}

// m as protojson reads it: fields in declaration order, enums by name, 64-bit integers as strings, every other number
// as a float64.
func lintJSON(m protoreflect.Message) *lintObject {
	o := &lintObject{values: map[string]any{}}
	fields := m.Descriptor().Fields()
	for i := range fields.Len() {
		fd := fields.Get(i)
		v, ok := fieldValue(m, fd)
		if !ok {
			continue
		}
		var x any
		switch {
		case fd.IsList():
			items := make([]any, v.List().Len())
			for k := range items {
				items[k] = lintScalar(fd, v.List().Get(k))
			}
			x = items
		case fd.IsMap():
			entries := &lintObject{values: map[string]any{}}
			v.Map().Range(func(k protoreflect.MapKey, e protoreflect.Value) bool {
				entries.keys = append(entries.keys, k.String())
				entries.values[k.String()] = lintScalar(fd.MapValue(), e)
				return true
			})
			slices.SortFunc(entries.keys, compareObjectKeys)
			x = entries
		default:
			x = lintScalar(fd, v)
		}
		o.keys = append(o.keys, fd.JSONName())
		o.values[fd.JSONName()] = x
	}
	return o
}

func lintScalar(fd protoreflect.FieldDescriptor, v protoreflect.Value) any {
	switch fd.Kind() {
	case protoreflect.MessageKind, protoreflect.GroupKind:
		return lintJSON(v.Message())
	case protoreflect.EnumKind:
		if e := fd.Enum().Values().ByNumber(v.Enum()); e != nil {
			return string(e.Name())
		}
		return float64(v.Enum())
	case protoreflect.BoolKind:
		return v.Bool()
	case protoreflect.StringKind:
		return v.String()
	case protoreflect.BytesKind:
		return string(v.Bytes())
	case protoreflect.FloatKind, protoreflect.DoubleKind:
		return v.Float()
	case protoreflect.Int64Kind, protoreflect.Sint64Kind, protoreflect.Sfixed64Kind:
		return strconv.FormatInt(v.Int(), 10)
	case protoreflect.Uint64Kind, protoreflect.Fixed64Kind:
		return strconv.FormatUint(v.Uint(), 10)
	case protoreflect.Uint32Kind, protoreflect.Fixed32Kind:
		return float64(v.Uint())
	}
	return float64(v.Int())
}

func asObject(v any) (*lintObject, bool) {
	o, ok := v.(*lintObject)
	return o, ok
}

func asArray(v any) []any {
	items, _ := v.([]any)
	return items
}

// The JSON text of v with object keys sorted and uuids left out: equal for two values sameJSON finds equal.
func canonicalJSON(v any) string {
	var b strings.Builder
	var write func(v any)
	write = func(v any) {
		switch x := v.(type) {
		case *lintObject:
			keys := slices.DeleteFunc(slices.Clone(x.keys), func(k string) bool { return k == "uuid" })
			slices.Sort(keys)
			b.WriteByte('{')
			for i, k := range keys {
				if i > 0 {
					b.WriteByte(',')
				}
				b.WriteString(jsonString(k) + ":")
				write(x.values[k])
			}
			b.WriteByte('}')
		case []any:
			b.WriteByte('[')
			for i, item := range x {
				if i > 0 {
					b.WriteByte(',')
				}
				write(item)
			}
			b.WriteByte(']')
		case string:
			b.WriteString(jsonString(x))
		default:
			fmt.Fprint(&b, x)
		}
	}
	write(v)
	return b.String()
}

// Equal as the sim reads them: a uuid only tags a value for the editor.
func sameJSON(a, b any) bool { return canonicalJSON(a) == canonicalJSON(b) }

// The kind an action or value is: its one key other than ignore and the editor's uuid.
func lintKind(v any, ignore string) string {
	o, ok := asObject(v)
	if !ok {
		return ""
	}
	for _, k := range o.keys {
		if k != ignore && k != "uuid" {
			return k
		}
	}
	return ""
}

func actionKindOf(action any) string { return lintKind(action, "condition") }

func valueKindOf(value any) string { return lintKind(value, "") }

// Where a row sits: the list it belongs to, for the checks that compare rows of one list.
type lintScope struct {
	hidden bool
	list   string // prepullActions, priorityList or groupActions.
	group  int    // The groups index a group row belongs to, -1 for none.
}

type actionSite struct {
	path   []any
	action *lintObject
	scope  *lintScope
	nested bool // Inside a sequence or a schedule rather than a row's own action.
}

type valueSite struct {
	path      []any
	value     *lintObject
	scope     *lintScope // Nil for a value variable's value.
	condition bool       // The condition of an action, as opposed to an operand or an action's setting.
}

type nameSite struct {
	path  []any // The name string itself.
	name  string
	scope *lintScope
}

// The values a group reference sets, by name, in the order it sets them.
type setValues struct {
	names []string
	paths map[string][]any
}

type groupRefSite struct {
	nameSite
	variables setValues
}

type missingSite struct {
	path  []any
	what  string
	scope *lintScope
}

type collected struct {
	actions         []actionSite
	values          []valueSite
	groupReferences []groupRefSite
	groupUsed       []nameSite
	sequences       []nameSite
	sequenceRefs    []nameSite
	variableRefs    []nameSite
	placeholders    []nameSite
	missing         []missingSite // An action body without the value it needs.
}

var (
	// The fields of an action body that hold values.
	actionValueFields = map[string]bool{"interruptIf": true, "maxOverlap": true, "duration": true, "condition": true, "rangeFromTarget": true}
	// The fields of a value body that hold values.
	valueValueFields = map[string]bool{"val": true, "lhs": true, "rhs": true, "targetEnergy": true, "maxOverlap": true, "offset": true}
	valueListFields  = map[string]bool{"vals": true}
	sequenceValues   = map[string]bool{"sequenceIsComplete": true, "sequenceIsReady": true, "sequenceTimeToReady": true}
	// The action kinds whose value the sim reads with no check, and fails without: the move's range and duration.
	requiredValues = map[string]struct{ field, what string }{
		"move":         {"rangeFromTarget", "range"},
		"moveDuration": {"duration", "duration"},
	}
	// How the sim reads an empty value in a field it has a fallback for, by kind.field.
	emptyFallback = map[string]string{
		"multidot.maxOverlap":          "reads as 0s",
		"strictMultidot.maxOverlap":    "reads as 0s",
		"multishield.maxOverlap":       "reads as 0s",
		"auraShouldRefresh.maxOverlap": "reads as 0s",
		"multipleCdUsages.offset":      "reads as 0s",
		"channelSpell.interruptIf":     "casts the channel with no interrupt condition",
	}
	// The kinds whose state lasts between evaluations: two of them are two separate states, never a copy.
	statefulKinds = map[string]bool{"sequence": true, "strictSequence": true, "groupReference": true, "schedule": true}
	// The value kinds whose duration needs no fight: the sim reads them before the pull with no harm.
	staticDurations = map[string]bool{"spellCastTime": true, "spellGcdHastedDuration": true, "inputDelay": true, "channelClipDelay": true, "dotBaseDuration": true, "auraDuration": true}
)

// A name as the sim reads it: a missing one is "".
func nameOf(v any) string {
	s, _ := v.(string)
	return s
}

func at(path []any, keys ...any) []any { return slices.Concat(path, keys) }

func collect(apl *lintObject) *collected {
	out := &collected{}
	var visitValue func(value any, path []any, scope *lintScope, condition bool)
	visitValue = func(value any, path []any, scope *lintScope, condition bool) {
		o, ok := asObject(value)
		if !ok {
			return
		}
		out.values = append(out.values, valueSite{path, o, scope, condition})
		kind := valueKindOf(o)
		if kind == "" {
			return
		}
		body, ok := asObject(o.value(kind))
		if !ok {
			return
		}
		here := at(path, kind)
		// A reference with no name set reads as one to the name "", which nothing has.
		switch kind {
		case "variableRef":
			out.variableRefs = append(out.variableRefs, nameSite{at(here, "name"), nameOf(body.value("name")), scope})
		case "actionGroupUsed":
			out.groupUsed = append(out.groupUsed, nameSite{at(here, "name"), nameOf(body.value("name")), scope})
		}
		if name, ok := body.value("name").(string); kind == "variablePlaceholder" && ok {
			out.placeholders = append(out.placeholders, nameSite{at(here, "name"), name, scope})
		}
		if sequenceValues[kind] {
			out.sequenceRefs = append(out.sequenceRefs, nameSite{at(here, "sequenceName"), nameOf(body.value("sequenceName")), scope})
		}
		for _, field := range body.keys {
			child := body.values[field]
			if valueValueFields[field] {
				visitValue(child, at(here, field), scope, false)
			} else if valueListFields[field] {
				for i, item := range asArray(child) {
					visitValue(item, at(here, field, i), scope, false)
				}
			}
		}
	}

	var visitAction func(action any, path []any, scope *lintScope, nested bool)
	visitAction = func(action any, path []any, scope *lintScope, nested bool) {
		site, ok := asObject(action)
		if !ok {
			site = &lintObject{values: map[string]any{}}
		}
		out.actions = append(out.actions, actionSite{path, site, scope, nested})
		if condition, ok := site.get("condition"); ok {
			visitValue(condition, at(path, "condition"), scope, true)
		}
		kind := actionKindOf(site)
		if kind == "" {
			return
		}
		body, ok := asObject(site.value(kind))
		if !ok {
			if r, ok := requiredValues[kind]; ok {
				out.missing = append(out.missing, missingSite{at(path, kind), r.what, scope})
			}
			return
		}
		here := at(path, kind)
		if kind == "groupReference" {
			variables := setValues{paths: map[string][]any{}}
			for i, variable := range asArray(body.value("variables")) {
				v, ok := asObject(variable)
				if !ok {
					continue
				}
				path := at(here, "variables", i, "value")
				if name, ok := v.value("name").(string); ok {
					if _, set := variables.paths[name]; !set {
						variables.names = append(variables.names, name)
					}
					variables.paths[name] = path
				}
				visitValue(v.value("value"), path, scope, false)
			}
			out.groupReferences = append(out.groupReferences, groupRefSite{nameSite{at(here, "groupName"), nameOf(body.value("groupName")), scope}, variables})
			return
		}
		if name, ok := body.value("name").(string); kind == "sequence" && ok {
			out.sequences = append(out.sequences, nameSite{at(here, "name"), name, scope})
		}
		if kind == "resetSequence" {
			out.sequenceRefs = append(out.sequenceRefs, nameSite{at(here, "sequenceName"), nameOf(body.value("sequenceName")), scope})
		}
		if r, ok := requiredValues[kind]; ok {
			if _, set := body.get(r.field); !set {
				out.missing = append(out.missing, missingSite{here, r.what, scope})
			}
		}
		for _, field := range body.keys {
			child := body.values[field]
			switch {
			case actionValueFields[field]:
				visitValue(child, at(here, field), scope, false)
			case field == "innerAction":
				visitAction(child, at(here, field), scope, true)
			case field == "actions":
				for i, item := range asArray(child) {
					visitAction(item, at(here, field, i), scope, true)
				}
			}
		}
	}

	for i, row := range asArray(apl.value("prepullActions")) {
		r, ok := asObject(row)
		if !ok {
			continue
		}
		scope := &lintScope{hidden: r.value("hide") == true, list: "prepullActions", group: -1}
		visitAction(r.value("action"), []any{"prepullActions", i, "action"}, scope, false)
		visitValue(r.value("doAtValue"), []any{"prepullActions", i, "doAtValue"}, scope, false)
	}
	for i, row := range asArray(apl.value("priorityList")) {
		if r, ok := asObject(row); ok {
			visitAction(r.value("action"), []any{"priorityList", i, "action"}, &lintScope{hidden: r.value("hide") == true, list: "priorityList", group: -1}, false)
		}
	}
	for g, group := range asArray(apl.value("groups")) {
		o, ok := asObject(group)
		if !ok {
			continue
		}
		for v, variable := range asArray(o.value("variables")) {
			if x, ok := asObject(variable); ok {
				visitValue(x.value("value"), []any{"groups", g, "variables", v, "value"}, &lintScope{list: "groupActions", group: g}, false)
			}
		}
		for i, row := range asArray(o.value("actions")) {
			if r, ok := asObject(row); ok {
				visitAction(r.value("action"), []any{"groups", g, "actions", i, "action"}, &lintScope{hidden: r.value("hide") == true, list: "groupActions", group: g}, false)
			}
		}
	}
	for i, variable := range asArray(apl.value("valueVariables")) {
		if x, ok := asObject(variable); ok {
			visitValue(x.value("value"), []any{"valueVariables", i, "value"}, nil, false)
		}
	}
	return out
}

func live(scope *lintScope) bool { return scope == nil || !scope.hidden }

func inGroup(scope *lintScope) (int, bool) {
	if scope == nil || scope.group < 0 {
		return 0, false
	}
	return scope.group, true
}

// Whether a live row of group g reads the placeholder name.
func groupReadsPlaceholder(c *collected, g int, name string) bool {
	return slices.ContainsFunc(c.placeholders, func(p nameSite) bool {
		group, ok := inGroup(p.scope)
		return live(p.scope) && ok && group == g && p.name == name
	})
}

// --- Constants

var (
	// A Go duration: an optional sign, then one or more number-unit pairs.
	goDuration   = regexp.MustCompile(`^[-+]?(?:(?:\d+\.?\d*|\.\d+)(?:ns|us|µs|μs|ms|s|m|h))+$`)
	durationPart = regexp.MustCompile(`(\d+\.?\d*|\.\d+)(ns|us|µs|μs|ms|s|m|h)`)
	unitSeconds  = map[string]float64{"ns": 1e-9, "us": 1e-6, "µs": 1e-6, "μs": 1e-6, "ms": 1e-3, "s": 1, "m": 60, "h": 3600}
	signedInt    = regexp.MustCompile(`^[-+]?\d+$`)
	jsDecimal    = regexp.MustCompile(`^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$`)
	jsRadix      = regexp.MustCompile(`^0([xX][0-9a-fA-F]+|[oO][0-7]+|[bB][01]+)$`)
)

// A string as ECMAScript's Number reads it; false where that is NaN.
func jsNumberOf(s string) (float64, bool) {
	s = strings.TrimFunc(s, isJSSpace)
	switch {
	case s == "":
		return 0, true
	case s == "Infinity" || s == "+Infinity":
		return math.Inf(1), true
	case s == "-Infinity":
		return math.Inf(-1), true
	case jsRadix.MatchString(s):
		n, err := strconv.ParseUint(s[2:], map[byte]int{'x': 16, 'X': 16, 'o': 8, 'O': 8, 'b': 2, 'B': 2}[s[1]], 64)
		return float64(n), err == nil
	case jsDecimal.MatchString(s):
		n, err := strconv.ParseFloat(s, 64)
		return n, err == nil || math.IsInf(n, 0)
	}
	return 0, false
}

func isFinite(n float64) bool { return !math.IsInf(n, 0) && !math.IsNaN(n) }

// A constant's number as the sim parses const: a duration in seconds, an integer, a percent as a fraction, or a float.
// Every number type reads as the same value in seconds when compared with a duration. False when it is no number.
func constNumber(val string) (float64, bool) {
	if val == "0" {
		return 0, true
	}
	if goDuration.MatchString(val) {
		sign := 1.0
		if strings.HasPrefix(val, "-") {
			sign = -1
		}
		seconds := 0.0
		for _, m := range durationPart.FindAllStringSubmatch(val, -1) {
			amount, _ := jsNumberOf(m[1])
			seconds += amount * unitSeconds[m[2]]
		}
		return sign * seconds, true
	}
	if signedInt.MatchString(val) {
		n, _ := jsNumberOf(val)
		return n, true
	}
	if number, ok := strings.CutSuffix(val, "%"); ok && len(val) > 1 {
		if n, ok := jsNumberOf(number); ok && strings.TrimFunc(number, isJSSpace) != "" && isFinite(n) {
			return n / 100, true
		}
	}
	n, ok := jsNumberOf(val)
	return n, ok && strings.TrimFunc(val, isJSSpace) != "" && isFinite(n)
}

// A const value's text; false when value is no const. A const with no val is "".
func constOf(value any) (string, bool) {
	if valueKindOf(value) != "const" {
		return "", false
	}
	body, ok := asObject(value.(*lintObject).value("const"))
	if !ok {
		return "", false
	}
	val, _ := body.value("val").(string)
	return val, true
}

// What a constant reads as for a condition: true or false in any case, otherwise true unless empty (a const of "0"
// read as a condition is true).
func constBool(val string) bool {
	lower := strings.ToLower(val)
	if lower == "false" {
		return false
	}
	return lower == "true" || val != ""
}

var compareConstants = map[string]func(a, b float64) bool{
	"OpEq": func(a, b float64) bool { return a == b },
	"OpNe": func(a, b float64) bool { return a != b },
	"OpLt": func(a, b float64) bool { return a < b },
	"OpLe": func(a, b float64) bool { return a <= b },
	"OpGt": func(a, b float64) bool { return a > b },
	"OpGe": func(a, b float64) bool { return a >= b },
}

// Whether a value present in the file is one the sim builds: an empty value, or an operator whose operands are all
// empty, comes out as nothing.
func absent(value any) bool {
	kind := valueKindOf(value)
	if kind == "" {
		return true
	}
	body, ok := asObject(value.(*lintObject).value(kind))
	switch kind {
	case "and", "or":
		return !ok || !slices.ContainsFunc(asArray(body.value("vals")), func(v any) bool { return !absent(v) })
	case "not":
		return !ok || absent(body.value("val"))
	case "cmp":
		return !ok || absent(body.value("lhs")) || absent(body.value("rhs"))
	}
	return false
}

// The value's truth if it is the same whatever happens in the fight, read as a condition; false when it is not.
func constantTruth(value any) (truth, known bool) {
	kind := valueKindOf(value)
	if kind == "" {
		return false, false
	}
	if kind == "const" {
		val, _ := constOf(value)
		return constBool(val), true
	}
	body, ok := asObject(value.(*lintObject).value(kind))
	if !ok {
		return false, false
	}
	switch kind {
	case "not":
		if absent(body.value("val")) {
			return false, false
		}
		truth, known := constantTruth(body.value("val"))
		return !truth, known
	case "and", "or":
		vals := slices.DeleteFunc(slices.Clone(asArray(body.value("vals"))), absent)
		if len(vals) == 0 {
			return false, false
		}
		decisive := kind == "or"
		all := true
		for _, val := range vals {
			truth, known := constantTruth(val)
			if known && truth == decisive {
				return decisive, true
			}
			all = all && known && truth == !decisive
		}
		return !decisive, all
	case "cmp":
		lhs, lok := constOf(body.value("lhs"))
		rhs, rok := constOf(body.value("rhs"))
		op, _ := body.value("op").(string)
		compare := compareConstants[op]
		if !lok || !rok || compare == nil {
			return false, false
		}
		a, aok := constNumber(lhs)
		b, bok := constNumber(rhs)
		if !aok || !bok {
			return false, false
		}
		return compare(a, b), true
	}
	return false, false
}

type constantPart struct {
	path  []any
	truth bool
	kind  string
}

// The most specific operators inside a condition that read the same whatever happens, when the condition as a whole
// does not.
func constantParts(value any, path []any, found []constantPart) []constantPart {
	kind := valueKindOf(value)
	if kind == "" || kind == "const" {
		return found
	}
	body, ok := asObject(value.(*lintObject).value(kind))
	if !ok {
		return found
	}
	switch kind {
	case "cmp", "not", "and", "or":
		if !absent(value) {
			if truth, known := constantTruth(value); known {
				return append(found, constantPart{path, truth, kind})
			}
		}
	}
	for _, field := range []string{"val", "lhs", "rhs"} {
		if v, ok := body.get(field); ok {
			found = constantParts(v, at(path, kind, field), found)
		}
	}
	for i, val := range asArray(body.value("vals")) {
		found = constantParts(val, at(path, kind, "vals", i), found)
	}
	return found
}

func rowLabel(path []any) string {
	if path[0] == "groups" {
		return fmt.Sprintf("row %d of the group", path[3].(int)+1)
	}
	return fmt.Sprintf("row %d", path[1].(int)+1)
}

// --- Checks

type lintReport func(path []any, severity, code, message string)

// The findings on r, in the order the checks find them.
func Lint(r *proto.APLRotation) []Finding {
	if r == nil {
		return nil
	}
	apl := lintJSON(r.ProtoReflect())
	var findings []Finding
	report := func(path []any, severity, code, message string) {
		findings = append(findings, Finding{Path: path, Severity: severity, Code: code, Message: message})
	}
	c := collect(apl)

	var groups []*lintObject
	for _, group := range asArray(apl.value("groups")) {
		o, ok := asObject(group)
		if !ok {
			o = &lintObject{values: map[string]any{}}
		}
		groups = append(groups, o)
	}
	groupNames := map[string]bool{}
	for _, g := range groups {
		if name, ok := g.value("name").(string); ok {
			groupNames[name] = true
		}
	}
	referencedGroups := map[string]bool{}
	for _, ref := range c.groupReferences {
		referencedGroups[ref.name] = true
	}
	usedGroups := map[string]bool{}
	for _, ref := range c.groupUsed {
		usedGroups[ref.name] = true
	}
	groupIndex := func(name string) int {
		return slices.IndexFunc(groups, func(g *lintObject) bool { n, ok := g.value("name").(string); return ok && n == name })
	}

	// Toggle groups: every row's action empty.
	toggles := map[int]bool{}
	for g, group := range groups {
		rows := asArray(group.value("actions"))
		toggles[g] = len(rows) > 0 && !slices.ContainsFunc(rows, func(row any) bool {
			o, _ := asObject(row)
			return actionKindOf(o.value("action")) != ""
		})
	}

	for _, site := range c.actions {
		if !live(site.scope) || actionKindOf(site.action) != "" {
			continue
		}
		if g, ok := inGroup(site.scope); !site.nested && ok && toggles[g] {
			continue
		}
		report(site.path, "error", "empty-action", "No action set; the sim skips this.")
	}

	// The reference values that fill a placeholder: the sim fails on an empty one.
	filling := map[string]bool{}
	for _, ref := range c.groupReferences {
		g := groupIndex(ref.name)
		if g < 0 {
			continue
		}
		for _, name := range ref.variables.names {
			if groupReadsPlaceholder(c, g, name) {
				filling[fmt.Sprint(ref.variables.paths[name])] = true
			}
		}
	}
	for _, site := range c.values {
		if !live(site.scope) || valueKindOf(site.value) != "" {
			continue
		}
		n := len(site.path)
		last, second := site.path[n-1], site.path[n-2]
		fallback := emptyFallback[fmt.Sprintf("%v.%v", second, last)]
		required, isRequired := requiredValues[fmt.Sprint(second)]
		crashes := isRequired && required.field == last || filling[fmt.Sprint(site.path)]
		switch {
		case site.condition:
			report(site.path, "warning", "empty-value", "No value set; the sim reads it as no condition, so the row always runs.")
		case second == "vals":
			report(site.path, "info", "empty-value", "No value set; the sim leaves it out of the list.")
		case fallback != "":
			report(site.path, "info", "empty-value", "No value set; the sim "+fallback+".")
		case crashes:
			report(site.path, "error", "empty-value", "No value set; the sim fails to run.")
		default:
			report(site.path, "warning", "empty-value", "No value set; the sim drops it and what holds it.")
		}
	}
	for _, site := range c.missing {
		if live(site.scope) {
			report(site.path, "error", "empty-value", "No "+site.what+" set; the sim fails to run.")
		}
	}

	for _, ref := range c.groupReferences {
		if groupNames[ref.name] {
			continue
		}
		if ref.name != "" {
			report(ref.path, "error", "undefined-group", fmt.Sprintf("No group is named \"%s\".", ref.name))
		} else {
			report(ref.path, "error", "undefined-group", "No group name set; the sim skips this.")
		}
	}
	for _, ref := range c.groupUsed {
		switch {
		case !live(ref.scope):
		case !groupNames[ref.name] && ref.name != "":
			report(ref.path, "warning", "group-never-used", fmt.Sprintf("No group is named \"%s\", so this is always false.", ref.name))
		case !groupNames[ref.name]:
			report(ref.path, "warning", "group-never-used", "No group name set, so this is always false.")
		case !referencedGroups[ref.name]:
			report(ref.path, "warning", "group-never-used", fmt.Sprintf("No row references group \"%s\", so this is always false.", ref.name))
		}
	}
	for g, group := range groups {
		if name, ok := group.value("name").(string); ok && !referencedGroups[name] && !usedGroups[name] {
			report([]any{"groups", g, "name"}, "info", "unused-group", fmt.Sprintf("Nothing references group \"%s\".", name))
		}
	}

	// Sequences: the sim finds them among the live priority list and group rows.
	liveSequences, anySequences := map[string]bool{}, map[string]bool{}
	for _, seq := range c.sequences {
		if live(seq.scope) && (seq.scope == nil || seq.scope.list != "prepullActions") {
			liveSequences[seq.name] = true
		}
		anySequences[seq.name] = true
	}
	for _, ref := range c.sequenceRefs {
		switch {
		case liveSequences[ref.name]:
		case ref.name == "":
			report(ref.path, "warning", "undefined-sequence", "No sequence name set.")
		case anySequences[ref.name]:
			report(ref.path, "warning", "undefined-sequence", fmt.Sprintf("Only a hidden or prepull row carries sequence \"%s\"; the sim does not find it.", ref.name))
		default:
			report(ref.path, "warning", "undefined-sequence", fmt.Sprintf("No sequence is named \"%s\".", ref.name))
		}
	}

	// Variables.
	var variables []*lintObject
	for _, variable := range asArray(apl.value("valueVariables")) {
		o, ok := asObject(variable)
		if !ok {
			o = &lintObject{values: map[string]any{}}
		}
		variables = append(variables, o)
	}
	variableNames := map[string]bool{}
	for i, variable := range variables {
		name, ok := variable.value("name").(string)
		if !ok {
			continue
		}
		if variableNames[name] {
			report([]any{"valueVariables", i, "name"}, "warning", "duplicate-variable", fmt.Sprintf("An earlier variable is also named \"%s\"; references read that one.", name))
		}
		variableNames[name] = true
	}
	// What a group's variables and its references set. The sim reads a group row's references as the value variables'
	// and lets these replace one only where a value variable of the name exists.
	groupVariables := make([]map[string]bool, len(groups))
	for g, group := range groups {
		names := map[string]bool{}
		for _, variable := range asArray(group.value("variables")) {
			if o, ok := asObject(variable); ok {
				if name, ok := o.value("name").(string); ok {
					names[name] = true
				}
			}
		}
		groupName, hasName := group.value("name").(string)
		for _, ref := range c.groupReferences {
			if hasName && ref.name == groupName {
				for _, name := range ref.variables.names {
					names[name] = true
				}
			}
		}
		groupVariables[g] = names
	}
	referencedVariables := map[string]bool{}
	for _, ref := range c.variableRefs {
		referencedVariables[ref.name] = true
	}
	for _, ref := range c.variableRefs {
		if variableNames[ref.name] {
			continue
		}
		g, ok := inGroup(ref.scope)
		message := fmt.Sprintf("No variable is named \"%s\".", ref.name)
		switch {
		case ref.name == "":
			message = "No variable name set; the sim drops this."
		case ok && groupVariables[g][ref.name]:
			message = fmt.Sprintf("Only the group's variables or a reference to it set \"%s\"; they replace a value variable of that name, and there is none, so the sim drops this.", ref.name)
		}
		report(ref.path, "error", "undefined-variable", message)
	}
	for i, variable := range variables {
		if name, ok := variable.value("name").(string); ok && !referencedVariables[name] {
			report([]any{"valueVariables", i, "name"}, "info", "unused-variable", fmt.Sprintf("Nothing references variable \"%s\".", name))
		}
	}

	// Placeholders: each live reference to a group must fill every placeholder the group's live rows read.
	groupPlaceholders := make([][]string, len(groups))
	for _, p := range c.placeholders {
		if !live(p.scope) {
			continue
		}
		if g, ok := inGroup(p.scope); ok {
			if !slices.Contains(groupPlaceholders[g], p.name) {
				groupPlaceholders[g] = append(groupPlaceholders[g], p.name)
			}
		} else {
			report(p.path, "warning", "placeholder-outside", fmt.Sprintf("Placeholder \"%s\" is outside a group; nothing fills it, so it reads as 0 or false.", p.name))
		}
	}
	for _, ref := range c.groupReferences {
		g := groupIndex(ref.name)
		if g < 0 {
			continue
		}
		var missing []string
		for _, name := range groupPlaceholders[g] {
			if _, set := ref.variables.paths[name]; !set {
				missing = append(missing, fmt.Sprintf("\"%s\"", name))
			}
		}
		if len(missing) > 0 {
			report(ref.path, "error", "placeholder-unset", fmt.Sprintf("Group \"%s\" needs %s set on this reference.", ref.name, strings.Join(missing, ", ")))
		}
	}

	lintPrepull(apl, variables, report)
	lintConditions(c, report)
	lintShadowed(apl, report)
	return findings
}

// The seconds a Do At value reads as before the fight: a constant, a variable holding one, or arithmetic on those.
// False when it reads something only the fight knows; NaN for a constant that is no number.
func constantSeconds(value any, variables []*lintObject, seen []string) (float64, bool) {
	kind := valueKindOf(value)
	if kind == "" {
		return 0, false
	}
	if kind == "const" {
		val, _ := constOf(value)
		if n, ok := constNumber(val); ok {
			return n, true
		}
		return math.NaN(), true
	}
	body, ok := asObject(value.(*lintObject).value(kind))
	if !ok {
		return 0, false
	}
	switch kind {
	case "variableRef":
		name, ok := body.value("name").(string)
		if !ok || slices.Contains(seen, name) {
			return 0, false
		}
		k := slices.IndexFunc(variables, func(v *lintObject) bool { n, ok := v.value("name").(string); return ok && n == name })
		if k < 0 {
			return 0, false
		}
		return constantSeconds(variables[k].value("value"), variables, append(slices.Clone(seen), name))
	case "math":
		a, aok := constantSeconds(body.value("lhs"), variables, seen)
		b, bok := constantSeconds(body.value("rhs"), variables, seen)
		if !aok || !bok {
			return 0, false
		}
		switch body.value("op") {
		case "OpAdd":
			return a + b, true
		case "OpSub":
			return a - b, true
		case "OpMul":
			return a * b, true
		case "OpDiv":
			return a / b, true
		}
		return 0, false
	case "max", "min":
		vals := asArray(body.value("vals"))
		if len(vals) == 0 {
			return 0, false
		}
		var all []float64
		for _, val := range vals {
			n, ok := constantSeconds(val, variables, seen)
			if !ok {
				return 0, false
			}
			all = append(all, n)
		}
		// Math.max and Math.min give NaN when any value is NaN.
		if slices.ContainsFunc(all, math.IsNaN) {
			return math.NaN(), true
		}
		if kind == "max" {
			return slices.Max(all), true
		}
		return slices.Min(all), true
	}
	return 0, false
}

// Whether a Do At value reads nothing of the fight: constants, those durations, and variables and arithmetic on them.
func isStatic(value any, variables []*lintObject, seen []string) bool {
	kind := valueKindOf(value)
	if kind == "" {
		return false
	}
	if kind == "const" || staticDurations[kind] {
		return true
	}
	body, ok := asObject(value.(*lintObject).value(kind))
	if !ok {
		return false
	}
	switch kind {
	case "variableRef":
		name, ok := body.value("name").(string)
		if !ok || slices.Contains(seen, name) {
			return false
		}
		k := slices.IndexFunc(variables, func(v *lintObject) bool { n, ok := v.value("name").(string); return ok && n == name })
		return k >= 0 && isStatic(variables[k].value("value"), variables, append(slices.Clone(seen), name))
	case "math":
		return isStatic(body.value("lhs"), variables, seen) && isStatic(body.value("rhs"), variables, seen)
	case "max", "min":
		vals := asArray(body.value("vals"))
		return len(vals) > 0 && !slices.ContainsFunc(vals, func(v any) bool { return !isStatic(v, variables, seen) })
	}
	return false
}

// Seconds rounded to milliseconds, as a time: -1.5s.
func formatSeconds(seconds float64) string {
	rounded, _ := strconv.ParseFloat(strconv.FormatFloat(seconds, 'f', 3, 64), 64)
	return jsNumber(rounded, 64) + "s"
}

func lintPrepull(apl *lintObject, variables []*lintObject, report lintReport) {
	var latest *struct {
		seconds float64
		row     int
	}
	for i, row := range asArray(apl.value("prepullActions")) {
		r, ok := asObject(row)
		if !ok || r.value("hide") == true {
			continue
		}
		var condition any
		hasCondition := false
		if action, ok := asObject(r.value("action")); ok {
			condition, hasCondition = action.get("condition")
		}
		if _, isConst := constOf(condition); hasCondition && !absent(condition) && !isConst {
			report([]any{"prepullActions", i, "action", "condition"}, "warning", "prepull-condition", "The sim does not read a prepull row's condition; the action runs at its Do At time.")
		}
		path := []any{"prepullActions", i, "doAtValue"}
		doAt, hasDoAt := r.get("doAtValue")
		if !hasDoAt || absent(doAt) {
			if !hasDoAt {
				path = []any{"prepullActions", i}
			}
			report(path, "warning", "prepull-no-time", "No Do At time; the sim skips this prepull row.")
			continue
		}
		seconds, ok := constantSeconds(doAt, variables, nil)
		switch {
		case !ok:
			if !isStatic(doAt, variables, nil) {
				report(path, "warning", "prepull-not-time", `Do At is read once, before the fight, where a value of the fight is not there to read and can fail the sim: write a time such as "-1.5s".`)
			}
			continue
		case math.IsNaN(seconds):
			report(path, "warning", "prepull-not-time", "Do At is not a time; the sim reads it as 0s.")
			continue
		case seconds > 0:
			report(path, "warning", "prepull-positive-time", fmt.Sprintf("Do At %s is after the pull; the sim ignores this prepull row. Prepull times are 0s or earlier.", formatSeconds(seconds)))
			continue
		}
		if latest != nil && seconds < latest.seconds {
			report(path, "info", "prepull-order", fmt.Sprintf("Runs at %s, before row %d above it at %s: prepull rows run in time order, not list order.", formatSeconds(seconds), latest.row+1, formatSeconds(latest.seconds)))
		}
		if latest == nil || seconds >= latest.seconds {
			latest = &struct {
				seconds float64
				row     int
			}{seconds, i}
		}
	}
}

func lintConditions(c *collected, report lintReport) {
	for _, site := range c.values {
		if !site.condition || !live(site.scope) || absent(site.value) {
			continue
		}
		truth, known := constantTruth(site.value)
		switch {
		case known && !truth:
			if _, literal := constOf(site.value); literal {
				report(site.path, "info", "never-runs", "Always false: this never runs. The sim still keeps its spell out of automatic cooldown use.")
			} else {
				report(site.path, "warning", "never-runs", "Always false: this never runs.")
			}
			continue
		case known:
			report(site.path, "info", "always-true", "Always true: the same as no condition.")
			continue
		}
		for _, part := range constantParts(site.value, site.path, nil) {
			what := "comparison"
			if part.kind != "cmp" {
				what = fmt.Sprintf("\"%s\"", part.kind)
			}
			report(part.path, "info", "always-true", fmt.Sprintf("This %s is always %t.", what, part.truth))
		}
	}
}

// A row is shadowed when an earlier live row of the same list takes the same action, with no condition or the same
// one: the later row is only reached when that action cannot run, and then it cannot either. Prepull rows each run at
// their own time, and stateful actions keep a state per row, so neither is compared. Earlier rows are kept by their
// kind and action, so each row is compared only with those that take the same action.
func lintShadowed(apl *lintObject, report lintReport) {
	type list struct {
		rows []any
		path []any
	}
	lists := []list{{asArray(apl.value("priorityList")), []any{"priorityList"}}}
	for g, group := range asArray(apl.value("groups")) {
		if o, ok := asObject(group); ok {
			lists = append(lists, list{asArray(o.value("actions")), []any{"groups", g, "actions"}})
		}
	}
	// A row's condition, when it has one the sim builds.
	conditionOf := func(action *lintObject) (any, bool) {
		condition, ok := action.get("condition")
		if !ok || absent(condition) {
			return nil, false
		}
		return condition, true
	}
	type earlier struct {
		action *lintObject
		index  int
	}
	for _, l := range lists {
		taken := map[string][]earlier{}
		for i, row := range l.rows {
			r, ok := asObject(row)
			if !ok || r.value("hide") == true {
				continue
			}
			action, ok := asObject(r.value("action"))
			if !ok {
				continue
			}
			kind := actionKindOf(action)
			if kind == "" || statefulKinds[kind] {
				continue
			}
			condition, hasCondition := conditionOf(action)
			if truth, known := constantTruth(condition); hasCondition && known && !truth {
				continue
			}
			key := kind + " " + canonicalJSON(action.value(kind))
			k := slices.IndexFunc(taken[key], func(e earlier) bool {
				before, has := conditionOf(e.action)
				truth, known := constantTruth(before)
				return !has || known && truth || hasCondition && sameJSON(before, condition)
			})
			if k >= 0 {
				by := taken[key][k]
				how := "the same condition"
				if _, has := conditionOf(by.action); !has {
					how = "no condition"
				}
				report(at(l.path, i), "warning", "shadowed-row", fmt.Sprintf("%s above takes this action with %s, so this row never runs.", rowLabel(at(l.path, by.index)), how))
			}
			taken[key] = append(taken[key], earlier{action, i})
		}
	}
}
