package lsp

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"github.com/wowsims/forever/sim/siml"
)

// The names and icons the rotation panel shows for spell and item ids, from the database files siml.CatalogAt reads
// (which keeps no icons): the first file wins for an id both hold.

func databaseStamp(root string) [2]stamp {
	return [2]stamp{stampOf(filepath.Join(root, siml.CatalogFiles[0])), stampOf(filepath.Join(root, siml.CatalogFiles[1]))}
}

// A repository's icons, read on first use.
type database struct {
	root  string
	stamp [2]stamp
	once  sync.Once
	out   panelDatabase
}

// The spell and item names and icons, by id, for the rotation panel: [name, icon].
type panelDatabase struct {
	Spells map[int32][2]string `json:"spells"`
	Items  map[int32][2]string `json:"items"`
}

type iconEntry struct {
	ID   int32  `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon"`
}

func (db *database) panel() panelDatabase {
	db.once.Do(func() {
		db.out = panelDatabase{Spells: map[int32][2]string{}, Items: map[int32][2]string{}}
		items := map[int32][2]string{}
		for _, file := range siml.CatalogFiles {
			data, err := os.ReadFile(filepath.Join(db.root, file))
			if err != nil {
				continue
			}
			var raw struct {
				Items      []iconEntry `json:"items"`
				ItemIcons  []iconEntry `json:"itemIcons"`
				SpellIcons []iconEntry `json:"spellIcons"`
			}
			if json.Unmarshal(data, &raw) != nil {
				continue
			}
			add := func(into map[int32][2]string, entries []iconEntry) {
				for _, e := range entries {
					if _, ok := into[e.ID]; !ok && e.Name != "" {
						into[e.ID] = [2]string{e.Name, e.Icon}
					}
				}
			}
			add(db.out.Spells, raw.SpellIcons)
			add(db.out.Items, raw.ItemIcons)
			add(items, raw.Items)
		}
		// A gear item's own name and icon stand over its item icon's.
		for id, item := range items {
			db.out.Items[id] = item
		}
	})
	return db.out
}

// The items with a use, gear and then consumables: what a rotation can cast as item.<name>.
func usableItems(c *siml.DatabaseCatalog) []int32 {
	var out []int32
	for _, item := range c.Items() {
		if item.OnUse {
			out = append(out, item.ID)
		}
	}
	for _, x := range c.Consumables() {
		if x.OnUse {
			out = append(out, x.ID)
		}
	}
	return out
}
