//go:build with_db

package siml

import (
	"errors"
	"strings"
	"testing"
)

// Omen of Clarity is a trigger the sim finds only by its internal cooldown: icd_is_ready reads its name, and an aura
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
	if err := read("cast shred if aura(omen_of_clarity).icd_is_ready"); err != nil {
		t.Errorf("icd_is_ready: %v", err)
	}
	err = read("cast shred if aura(omen_of_clarity).is_active")
	var diags Diagnostics
	if !errors.As(err, &diags) || !strings.Contains(err.Error(), "icd-trigger") {
		t.Errorf("is_active = %v, want icd-trigger", err)
	}
}
