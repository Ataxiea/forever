//go:build with_db

package siml

import (
	"errors"
	"strings"
	"testing"
)

// Omen of Clarity is a trigger the sim finds only by its internal cooldown: icd_is_ready and internal_cooldown read its name, and an aura
// value that looks auras up by their own id does not.
func TestICDTriggerReadsOnlyInTheICDKinds(t *testing.T) {
	names, err := DefaultNames()
	if err != nil {
		t.Fatal(err)
	}
	read := func(row string) error {
		_, err := Parse("x.apl.siml", []byte("siml 1\nspec feral_cat_druid\n\npriority:\n  "+row+"\n"), names, nil)
		return err
	}
	for _, row := range []string{
		"cast shred if aura(omen_of_clarity).icd_is_ready",
		"cast shred if aura(omen_of_clarity).internal_cooldown < 1s",
	} {
		if err := read(row); err != nil {
			t.Errorf("%s: %v", row, err)
		}
	}
	err = read("cast shred if aura(omen_of_clarity).is_active")
	var diags Diagnostics
	if !errors.As(err, &diags) || !strings.Contains(err.Error(), "icd-trigger") {
		t.Errorf("is_active = %v, want icd-trigger", err)
	}
}
