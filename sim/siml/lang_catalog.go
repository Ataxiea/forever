package siml

import (
	"os"
	"path/filepath"
	"slices"
	"sync"

	"github.com/wowsims/forever/sim/core/proto"
	"google.golang.org/protobuf/encoding/protojson"
)

// The item database as the editor reads it (assets/database/db.json, then leftover_db.json): names and icons, which
// slots an item goes in, which enchants fit it and which random suffixes it rolls, and the kind of each consumable.

// What a Catalog may also give, which the analysis asks for by a type assertion and goes without where a catalog
// lacks it: the names of consumables and item icons, suffix names and stats, enchant rows by effect, and the
// consumables a consumables: field and item.<name> offer. DatabaseCatalog gives it.
type CatalogDetails interface {
	ItemName(id int32) (string, bool)            // Any item's name: gear, a consumable or an item icon.
	Consumables() []CatalogConsumable            // In database order.
	Suffix(id int32) (CatalogSuffix, bool)       // A random suffix's name and stats.
	EnchantRows(effectID int32) []CatalogEnchant // The rows of an enchant effect, in database order.
}

type CatalogConsumable struct {
	ID    int32
	Name  string
	Type  proto.ConsumableType
	OnUse bool
}

type CatalogSuffix struct {
	ID    int32
	Name  string
	Stats []float64 // Indexed by Stat.
}

// The database files, from the repository root, in the order they are read: the first holds an id both hold.
var CatalogFiles = []string{filepath.Join("assets", "database", "db.json"), filepath.Join("assets", "database", "leftover_db.json")}

// A Catalog read from the database files.
type DatabaseCatalog struct {
	items       map[int32]CatalogItem
	itemList    []CatalogItem
	consumables []CatalogConsumable
	names       map[int32]string // Item names: gear, then consumables, then item icons.
	spells      map[int32]string
	enchants    []CatalogEnchant
	rows        map[int32][]CatalogEnchant
	suffixes    map[int32]CatalogSuffix
	itemSuffix  map[int32][]int32
}

// Reads the database files of the repository at root. A file that is missing or does not read is left out.
func ReadCatalog(root string) *DatabaseCatalog {
	c := &DatabaseCatalog{
		items: map[int32]CatalogItem{}, names: map[int32]string{}, spells: map[int32]string{},
		rows: map[int32][]CatalogEnchant{}, suffixes: map[int32]CatalogSuffix{}, itemSuffix: map[int32][]int32{},
	}
	consumables := map[int32]bool{}
	var iconNames []*proto.IconData
	for _, file := range CatalogFiles {
		text, err := os.ReadFile(filepath.Join(root, file))
		if err != nil {
			continue
		}
		db := &proto.UIDatabase{}
		if (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(text, db) != nil {
			continue
		}
		for _, item := range db.Items {
			if _, ok := c.items[item.Id]; ok {
				continue
			}
			ci := CatalogItem{
				ID: item.Id, Name: item.Name, Icon: item.Icon, Type: item.Type, RangedType: item.RangedWeaponType,
				HandType: item.HandType, WeaponType: item.WeaponType, Quality: item.Quality, Ilvl: item.ScalingOptions[0].GetIlvl(),
				Phase: item.Phase, SetName: item.SetName, OnUse: onUse(item.ItemEffects),
			}
			for _, e := range item.ItemEffects {
				if e.BuffName != "" {
					ci.Effects = append(ci.Effects, e.BuffName)
				}
			}
			c.items[item.Id] = ci
			c.itemList = append(c.itemList, ci)
			c.itemSuffix[item.Id] = item.RandomSuffixOptions
		}
		for _, x := range db.Consumables {
			if !consumables[x.Id] {
				consumables[x.Id] = true
				c.consumables = append(c.consumables, CatalogConsumable{ID: x.Id, Name: x.Name, Type: x.Type, OnUse: onUse(x.ItemEffects)})
			}
		}
		iconNames = append(iconNames, db.ItemIcons...)
		for _, icon := range db.SpellIcons {
			if _, ok := c.spells[icon.Id]; !ok && icon.Name != "" {
				c.spells[icon.Id] = icon.Name
			}
		}
		for _, e := range db.Enchants {
			row := CatalogEnchant{
				EffectID: e.EffectId, Name: e.Name, Type: e.Type, EnchantType: e.EnchantType, ExtraTypes: e.ExtraTypes,
				SpellID: e.SpellId, ItemID: e.ItemId,
			}
			c.enchants = append(c.enchants, row)
			c.rows[e.EffectId] = append(c.rows[e.EffectId], row)
		}
		for _, s := range db.RandomSuffixes {
			if _, ok := c.suffixes[s.Id]; !ok {
				c.suffixes[s.Id] = CatalogSuffix{ID: s.Id, Name: s.Name, Stats: s.Stats}
			}
		}
	}
	for _, item := range c.itemList {
		if item.Name != "" {
			c.names[item.ID] = item.Name
		}
	}
	for _, x := range c.consumables {
		if _, ok := c.names[x.ID]; !ok && x.Name != "" {
			c.names[x.ID] = x.Name
		}
	}
	for _, icon := range iconNames {
		if _, ok := c.names[icon.Id]; !ok && icon.Name != "" {
			c.names[icon.Id] = icon.Name
		}
	}
	return c
}

func onUse(effects []*proto.ItemEffect) bool {
	return slices.ContainsFunc(effects, func(e *proto.ItemEffect) bool { return e.GetOnUse() != nil })
}

func (c *DatabaseCatalog) Item(id int32) (CatalogItem, bool) {
	item, ok := c.items[id]
	return item, ok
}

func (c *DatabaseCatalog) Items() []CatalogItem { return c.itemList }

func (c *DatabaseCatalog) Enchants() []CatalogEnchant { return c.enchants }

func (c *DatabaseCatalog) Suffixes(itemID int32) []int32 { return c.itemSuffix[itemID] }

func (c *DatabaseCatalog) SpellName(spellID int32) (string, bool) {
	name, ok := c.spells[spellID]
	return name, ok
}

func (c *DatabaseCatalog) ItemName(id int32) (string, bool) {
	name, ok := c.names[id]
	return name, ok
}

func (c *DatabaseCatalog) Consumables() []CatalogConsumable { return c.consumables }

func (c *DatabaseCatalog) Suffix(id int32) (CatalogSuffix, bool) {
	s, ok := c.suffixes[id]
	return s, ok
}

func (c *DatabaseCatalog) EnchantRows(effectID int32) []CatalogEnchant { return c.rows[effectID] }

// The catalog of the repository at root, read again whenever a database file changes on disk.
func CatalogAt(root string) *DatabaseCatalog {
	catalogs.Lock()
	defer catalogs.Unlock()
	stamp := ""
	for _, file := range CatalogFiles {
		if info, err := os.Stat(filepath.Join(root, file)); err == nil {
			stamp += info.ModTime().String() + "|"
		} else {
			stamp += "missing|"
		}
	}
	if held, ok := catalogs.byRoot[root]; ok && held.stamp == stamp {
		return held.catalog
	}
	c := ReadCatalog(root)
	catalogs.byRoot[root] = heldCatalog{stamp: stamp, catalog: c}
	return c
}

type heldCatalog struct {
	stamp   string
	catalog *DatabaseCatalog
}

var catalogs = struct {
	sync.Mutex
	byRoot map[string]heldCatalog
}{byRoot: map[string]heldCatalog{}}

// --- What goes together, by the rules core.EligibleSlotsForItem and core.EnchantAppliesToItem check a gear set with.

// The slots of each ItemType but the weapon, whose slots its hand type gives.
var typeSlots = map[proto.ItemType][]proto.ItemSlot{
	proto.ItemType_ItemTypeHead:     {proto.ItemSlot_ItemSlotHead},
	proto.ItemType_ItemTypeNeck:     {proto.ItemSlot_ItemSlotNeck},
	proto.ItemType_ItemTypeShoulder: {proto.ItemSlot_ItemSlotShoulder},
	proto.ItemType_ItemTypeBack:     {proto.ItemSlot_ItemSlotBack},
	proto.ItemType_ItemTypeChest:    {proto.ItemSlot_ItemSlotChest},
	proto.ItemType_ItemTypeWrist:    {proto.ItemSlot_ItemSlotWrist},
	proto.ItemType_ItemTypeHands:    {proto.ItemSlot_ItemSlotHands},
	proto.ItemType_ItemTypeWaist:    {proto.ItemSlot_ItemSlotWaist},
	proto.ItemType_ItemTypeLegs:     {proto.ItemSlot_ItemSlotLegs},
	proto.ItemType_ItemTypeFeet:     {proto.ItemSlot_ItemSlotFeet},
	proto.ItemType_ItemTypeFinger:   {proto.ItemSlot_ItemSlotFinger1, proto.ItemSlot_ItemSlotFinger2},
	proto.ItemType_ItemTypeTrinket:  {proto.ItemSlot_ItemSlotTrinket1, proto.ItemSlot_ItemSlotTrinket2},
	proto.ItemType_ItemTypeRanged:   {proto.ItemSlot_ItemSlotRanged},
}

// The slots an item goes in.
func ItemSlots(item CatalogItem) []proto.ItemSlot {
	if item.Type == proto.ItemType_ItemTypeWeapon {
		switch item.HandType {
		case proto.HandType_HandTypeMainHand, proto.HandType_HandTypeTwoHand:
			return []proto.ItemSlot{proto.ItemSlot_ItemSlotMainHand}
		case proto.HandType_HandTypeOffHand:
			return []proto.ItemSlot{proto.ItemSlot_ItemSlotOffHand}
		case proto.HandType_HandTypeOneHand:
			return []proto.ItemSlot{proto.ItemSlot_ItemSlotMainHand, proto.ItemSlot_ItemSlotOffHand}
		}
		return nil
	}
	return typeSlots[item.Type]
}

// The slots an enchant row's item types go in.
func enchantSlots(row CatalogEnchant) []proto.ItemSlot {
	var out []proto.ItemSlot
	for _, t := range slices.Concat([]proto.ItemType{row.Type}, row.ExtraTypes) {
		if t == proto.ItemType_ItemTypeWeapon {
			out = append(out, proto.ItemSlot_ItemSlotMainHand, proto.ItemSlot_ItemSlotOffHand)
		} else {
			out = append(out, typeSlots[t]...)
		}
	}
	return out
}

// Whether an enchant row fits an item.
func EnchantFits(row CatalogEnchant, item CatalogItem) bool {
	switch {
	case row.EnchantType == proto.EnchantType_EnchantTypeTwoHand && item.HandType != proto.HandType_HandTypeTwoHand,
		row.EnchantType == proto.EnchantType_EnchantTypeStaff && item.WeaponType != proto.WeaponType_WeaponTypeStaff,
		(row.EnchantType == proto.EnchantType_EnchantTypeShield) != (item.WeaponType == proto.WeaponType_WeaponTypeShield),
		(row.EnchantType == proto.EnchantType_EnchantTypeOffHand) != (item.WeaponType == proto.WeaponType_WeaponTypeOffHand):
		return false
	}
	ranged := item.RangedType
	if row.Type == proto.ItemType_ItemTypeRanged {
		// Bows, crossbows and guns: the ranged weapons a ranged enchant fits.
		if ranged != proto.RangedWeaponType_RangedWeaponTypeBow && ranged != proto.RangedWeaponType_RangedWeaponTypeCrossbow &&
			ranged != proto.RangedWeaponType_RangedWeaponTypeGun {
			return false
		}
	} else if ranged != proto.RangedWeaponType_RangedWeaponTypeUnknown && ranged != proto.RangedWeaponType_RangedWeaponTypeWand {
		return false
	}
	slots := ItemSlots(item)
	return slices.ContainsFunc(enchantSlots(row), func(s proto.ItemSlot) bool { return slices.Contains(slots, s) })
}

// The rows of an enchant effect in c.
func enchantRows(c Catalog, effectID int32) []CatalogEnchant {
	if d, ok := c.(CatalogDetails); ok {
		return d.EnchantRows(effectID)
	}
	var out []CatalogEnchant
	for _, row := range c.Enchants() {
		if row.EffectID == effectID {
			out = append(out, row)
		}
	}
	return out
}

// Whether a row of the enchant effect fits the item.
func enchantEffectFits(c Catalog, effectID int32, item CatalogItem) bool {
	return slices.ContainsFunc(enchantRows(c, effectID), func(row CatalogEnchant) bool { return EnchantFits(row, item) })
}

// An item's name in c: the gear's, a consumable's or an item icon's.
func catalogItemName(c Catalog, id int32) (string, bool) {
	if d, ok := c.(CatalogDetails); ok {
		return d.ItemName(id)
	}
	if item, ok := c.Item(id); ok && item.Name != "" {
		return item.Name, true
	}
	return "", false
}
