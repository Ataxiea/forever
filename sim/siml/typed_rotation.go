package siml

import (
	"strings"

	"github.com/wowsims/forever/sim/core/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// The rotation sections (SPEC.md §6): var lines, the type entry, prepull:, priority: and the groups, typed into the
// rotation of the file's settings.

// What the rotation sections declare, for the checks.
type rotationTyping struct {
	explicitType bool // Whether an apl: entry sets the type.
	declarations []*variableDecl
	groups       []nameUse
}

// The rotation of the file's settings, made where missing.
func (f *typedFile) rotation() *proto.APLRotation {
	return mutableAt(f.settings.ProtoReflect(), f.typer.ix.rotationPath).Interface().(*proto.APLRotation)
}

// Types the rotation sections and the top-level var lines, recording what each row, var line and entry writes.
func (f *typedFile) typeRotation() rotationTyping {
	t := f.typer
	sectionOf := map[stmt]string{}
	for _, s := range f.tree.sections {
		for _, b := range s.body {
			sectionOf[b] = s.name
		}
	}
	aplFields := t.ix.sectionFields(t.ix.sections[sectionAPL], f.spec)
	set := map[*field]bool{}
	var out rotationTyping
	var group *proto.APLGroup

	declare := func(s *varStmt, in scope) *proto.APLValueVariable {
		d := &variableDecl{span: s.variable.span, name: s.variable.name, scope: in}
		out.declarations = append(out.declarations, d)
		var v *proto.APLValueVariable
		if s.value == nil {
			v = &proto.APLValueVariable{Name: s.variable.name}
		} else {
			t.decl = d
			value := t.value(s.value)
			t.decl = nil
			if value != nil {
				v = &proto.APLValueVariable{Name: s.variable.name, Value: value}
			}
		}
		f.written[s] = v.ProtoReflect()
		return v
	}

	for _, s := range f.tree.inFileOrder() {
		section, inSection := sectionOf[s]
		switch s := s.(type) {
		case *headerStmt:
			group, t.scope = nil, scope{}
			if s.name.text == sectionGroup && s.group != nil {
				group = &proto.APLGroup{Name: s.group.value}
				r := f.rotation()
				r.Groups = append(r.Groups, group)
				t.scope = scope{group: s.group.value, inGroup: true}
				out.groups = append(out.groups, nameUse{span: s.group.span, name: s.group.value})
			}
		case *varStmt:
			if !inSection || section == sectionAPL {
				r := f.rotation()
				if v := declare(s, scope{}); v != nil {
					r.ValueVariables = append(r.ValueVariables, v)
				}
			} else if section == sectionGroup && group != nil {
				if v := declare(s, t.scope); v != nil {
					group.Variables = append(group.Variables, v)
				}
			}
		case *rowStmt:
			switch {
			case section == sectionPrepull:
				r := f.rotation()
				item := t.prepullAction(s)
				f.written[s] = item.ProtoReflect()
				if item != nil {
					r.PrepullActions = append(r.PrepullActions, item)
				}
			case section == sectionPriority:
				r := f.rotation()
				item := t.listItem(s)
				f.written[s] = item.ProtoReflect()
				if item != nil {
					r.PriorityList = append(r.PriorityList, item)
				}
			case section == sectionGroup && group != nil:
				item := t.listItem(s)
				f.written[s] = item.ProtoReflect()
				if item != nil {
					group.Actions = append(group.Actions, item)
				}
			}
		default:
			if section == sectionAPL && isEntry(s) {
				f.entries[s] = t.entry(s, aplFields, f.holder, set)
			}
		}
	}
	t.scope = scope{}
	out.explicitType = set[t.ix.messages[rotationName].byProto["type"]]
	return out
}

// The row's raw JSON when the row is that alone, which is the whole row's JSON (SPEC.md §6.3).
func rawRow(s *rowStmt) *rawNode {
	r, ok := s.action.step.(*rawNode)
	if !ok || s.action.condition != nil || s.hide || s.doAt != nil || len(s.notes) > 0 {
		return nil
	}
	return r
}

// A priority or group row.
func (t *typer) listItem(s *rowStmt) *proto.APLListItem {
	if r := rawRow(s); r != nil {
		if m := t.raw(listItemMessage, r); m != nil {
			return m.Interface().(*proto.APLListItem)
		}
		return nil
	}
	// A time outside prepull: is unexpected-time, and is not read.
	action := t.action(s.action)
	if action == nil {
		return nil
	}
	notes := make([]string, len(s.notes))
	for i, n := range s.notes {
		notes[i] = n.text
	}
	return &proto.APLListItem{Action: action, Hide: s.hide, Notes: strings.Join(notes, "\n")}
}

// A prepull row.
func (t *typer) prepullAction(s *rowStmt) *proto.APLPrepullAction {
	if r := rawRow(s); r != nil {
		if m := t.raw(prepullMessage, r); m != nil {
			return m.Interface().(*proto.APLPrepullAction)
		}
		return nil
	}
	action := t.action(s.action)
	var doAt *proto.APLValue
	if s.doAt != nil {
		doAt = t.value(s.doAt)
	}
	if action == nil || s.doAt != nil && doAt == nil {
		return nil
	}
	return &proto.APLPrepullAction{Action: action, DoAtValue: doAt, Hide: s.hide}
}

// The message the path of message fields reaches from m, made where missing.
func mutableAt(m protoreflect.Message, path []protoreflect.FieldDescriptor) protoreflect.Message {
	for _, fd := range path {
		m = m.Mutable(fd).Message()
	}
	return m
}
