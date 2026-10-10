import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { aplDatabase } from '../src/db.ts';
import { enchantFits, itemSlots, loadDatabase } from '../src/lang/database.ts';
import { repositoryRoot } from '../src/lang/workspace.ts';

const repository = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '');

test('the database gives names and icons, and is found above any rotation file', () => {
	assert.equal(repositoryRoot(fileURLToPath(new URL('fixtures/default.apl.siml', import.meta.url))), repository);
	const db = aplDatabase(repository);
	assert.equal(db.spells[71]?.[0], 'Defensive Stance');
	assert.ok(Object.keys(db.items).length > 0);
	assert.equal(loadDatabase(repository), loadDatabase(repository), 'read once until the file changes');
});

// The generated proto enums and slot table, bundled: their TypeScript enums do not run with types only stripped.
async function generated() {
	const { outputFiles } = await build({
		stdin: {
			contents: [
				"export { EnchantType, HandType, ItemSlot, ItemType, RangedWeaponType, WeaponType } from '@generated/proto/common';",
				"export { ITEM_TYPE_TO_SLOTS } from '@sim/proto/sim_tables_auto_gen';",
			].join('\n'),
			resolveDir: repository,
			loader: 'ts',
		},
		tsconfig: join(repository, 'tsconfig.json'),
		bundle: true,
		write: false,
		format: 'esm',
		platform: 'node',
		logLevel: 'silent',
	});
	return import(`data:text/javascript,${encodeURIComponent(outputFiles[0].text)}`);
}

test("an item's slots and an enchant's fit follow the sim's rules, by the generated protos' enum numbers", async () => {
	const { EnchantType, HandType, ItemSlot, ItemType, RangedWeaponType, WeaponType, ITEM_TYPE_TO_SLOTS } = await generated();
	const item = fields => ({ id: 1, name: '', effects: [], onUse: false, ...fields });

	for (const type of Object.values(ItemType).filter(value => typeof value === 'number' && value !== ItemType.ItemTypeWeapon)) {
		assert.deepEqual(itemSlots(item({ type })), ITEM_TYPE_TO_SLOTS[type] ?? [], `ItemType ${ItemType[type]}`);
	}
	const weapon = (handType, more) => item({ type: ItemType.ItemTypeWeapon, handType, ...more });
	const { ItemSlotMainHand: main, ItemSlotOffHand: off } = ItemSlot;
	assert.deepEqual(itemSlots(weapon(HandType.HandTypeMainHand)), [main]);
	assert.deepEqual(itemSlots(weapon(HandType.HandTypeTwoHand)), [main]);
	assert.deepEqual(itemSlots(weapon(HandType.HandTypeOffHand)), [off]);
	assert.deepEqual(itemSlots(weapon(HandType.HandTypeOneHand)), [main, off]);
	assert.deepEqual(itemSlots(weapon(HandType.HandTypeUnknown)), []);

	const fits = (row, it) => enchantFits({ enchants: new Map([[1, [{ effectId: 1, name: '', ...row }]]]) }, 1, it);
	const sword = weapon(HandType.HandTypeOneHand, { weaponType: WeaponType.WeaponTypeSword, rangedWeaponType: RangedWeaponType.RangedWeaponTypeUnknown });
	const greatsword = weapon(HandType.HandTypeTwoHand, { weaponType: WeaponType.WeaponTypeSword });
	const staff = weapon(HandType.HandTypeTwoHand, { weaponType: WeaponType.WeaponTypeStaff });
	const shield = weapon(HandType.HandTypeOffHand, { weaponType: WeaponType.WeaponTypeShield });
	const held = weapon(HandType.HandTypeOffHand, { weaponType: WeaponType.WeaponTypeOffHand });
	const ranged = rangedWeaponType => item({ type: ItemType.ItemTypeRanged, rangedWeaponType });
	const onWeapon = { type: ItemType.ItemTypeWeapon };
	const twoHand = { ...onWeapon, enchantType: EnchantType.EnchantTypeTwoHand };
	const onStaff = { ...onWeapon, enchantType: EnchantType.EnchantTypeStaff };
	const onShield = { ...onWeapon, enchantType: EnchantType.EnchantTypeShield };
	const onOffHand = { ...onWeapon, enchantType: EnchantType.EnchantTypeOffHand };
	const scope = { type: ItemType.ItemTypeRanged };
	const cases = [
		[onWeapon, sword, true],
		[onWeapon, shield, false],
		[twoHand, greatsword, true],
		[twoHand, sword, false],
		[onStaff, staff, true],
		[onStaff, greatsword, false],
		[onShield, shield, true],
		[onShield, sword, false],
		[onOffHand, held, true],
		[onOffHand, shield, false],
		[scope, ranged(RangedWeaponType.RangedWeaponTypeBow), true],
		[scope, ranged(RangedWeaponType.RangedWeaponTypeCrossbow), true],
		[scope, ranged(RangedWeaponType.RangedWeaponTypeGun), true],
		[scope, ranged(RangedWeaponType.RangedWeaponTypeThrown), false],
		[{ type: ItemType.ItemTypeHead, extraTypes: [ItemType.ItemTypeRanged] }, ranged(RangedWeaponType.RangedWeaponTypeWand), true],
		[{ type: ItemType.ItemTypeHead, extraTypes: [ItemType.ItemTypeRanged] }, ranged(RangedWeaponType.RangedWeaponTypeBow), false],
		[{ type: ItemType.ItemTypeFinger }, item({ type: ItemType.ItemTypeFinger }), true],
		[{ type: ItemType.ItemTypeFinger }, item({ type: ItemType.ItemTypeTrinket }), false],
	];
	for (const [row, it, expected] of cases) {
		assert.equal(fits(row, it), expected, `${JSON.stringify(row)} on ${JSON.stringify(it)}`);
	}
});
