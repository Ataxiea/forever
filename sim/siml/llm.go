package siml

import (
	_ "embed"
	"fmt"
	"slices"
	"strings"
)

// siml.llm.txt at the repository root: a short guide to SIML for a language model or a newcomer, llm_head.txt, then
// every action, value and accessor the protos give, written from the schema, so a change to apl.proto shows up in it
// when it is written again (wowsimcli siml llm, which make siml runs).

//go:embed llm_head.txt
var llmHead string

// The text of siml.llm.txt.
func LLMText() (string, error) {
	ix, err := loadIndex()
	if err != nil {
		return "", err
	}
	var b strings.Builder
	b.WriteString(llmHead)
	b.WriteString("\n## Actions (generated from proto/apl.proto; every kind also takes the generic kind(field=value, …))\n\n")
	for _, k := range ix.actionKindList() {
		b.WriteString(ix.llmLine(k) + "\n")
	}
	b.WriteString("\n## Values (generated)\n\n")
	for _, k := range ix.valueKindList {
		if k.Form != "accessor" {
			b.WriteString(ix.llmLine(k) + "\n")
		}
	}
	b.WriteString("\n## Accessors (generated): [unit.]head(subject).property(arguments)\n\n")
	for _, head := range ix.heads {
		var props []string
		for _, k := range ix.valueKindList {
			if a := k.Accessor; k.Form == "accessor" && a.Head == head {
				props = append(props, a.Prop+ix.llmArgs(k, a.Subject, a.Unit))
			}
		}
		unit := ""
		if slices.ContainsFunc(ix.valueKindList, func(k *aplKind) bool { return k.Accessor != nil && k.Accessor.Head == head && k.Accessor.Unit != "" }) {
			unit = "[unit.]"
		}
		fmt.Fprintf(&b, "%s%s(x): %s\n", unit, head, strings.Join(props, ", "))
	}
	return b.String(), nil
}

// One kind as a file writes it, with its fields.
func (ix *schemaIndex) llmLine(k *aplKind) string {
	switch k.Form {
	case "bare":
		return k.Kind
	case "unit_prefix":
		return "[unit.]" + k.Kind + ix.llmArgs(k, k.UnitField)
	case "list_args":
		return k.Kind + "(a, b, …)"
	}
	line := k.Kind + ix.llmArgs(k)
	if k.Form == "short" {
		line += "  (short form above)"
	}
	return line
}

// A kind's fields, but those in leave, as (name: type, …); "" for none. The positional field comes first, unnamed.
func (ix *schemaIndex) llmArgs(k *aplKind, leave ...string) string {
	var parts []string
	for _, f := range k.message.fields {
		if slices.Contains(leave, f.Name) {
			continue
		}
		part := f.Siml + ": " + ix.llmType(f)
		if f.Name == k.Positional {
			part = ix.llmType(f)
			parts = slices.Insert(parts, 0, part)
			continue
		}
		parts = append(parts, part)
	}
	if len(parts) == 0 {
		return ""
	}
	return "(" + strings.Join(parts, ", ") + ")"
}

// What a field takes, in a word or two.
func (ix *schemaIndex) llmType(f *field) string {
	t := f.Printed
	switch f.Printed {
	case "action_id":
		t = "name"
	case "enum", "flag_enum":
		if e := ix.enums[f.Type]; e != nil {
			var shorts []string
			for _, v := range e.values {
				if v.Short != "" && !strings.Contains(v.Short, "unknown") && !slices.Contains(shorts, v.Short) {
					shorts = append(shorts, v.Short)
				}
			}
			if len(shorts) > 8 {
				shorts = append(shorts[:8], "…")
			}
			t = strings.Join(shorts, "|")
		}
	case "message":
		t = "(…)"
	}
	if f.Ref != "" {
		t = f.Ref + " name"
	}
	if f.Repeated {
		t = "[" + t + ", …]"
	}
	return t
}
