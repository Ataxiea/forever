import { loadDatabase, usableItems } from './lang/database.ts';
import type { Parsed } from './lang/document.ts';
import type { SpellName, SpellNamespace } from './lang/siml.ts';
import { registeredNames } from './lang/workspace.ts';
import type { ActionIdJson, Registered, RegisteredName } from './protocol';

// The ActionID a spell-like name of the table writes, as the parser reads it.
function actionId(entry: SpellName): ActionIdJson {
	return { spellId: entry.spellId, ...(entry.tag ? { tag: entry.tag } : {}), ...(entry.rank ? { rank: entry.rank } : {}) };
}

// What the panel's pickers offer a file: the names of sim/siml/names.json its spec line's builds register, and the
// items with a use the table names. Every one prints as its name.
export function registeredFor(p: Parsed): Registered {
	const spec = p.parse.spec;
	if (spec === undefined) return { status: 'unavailable', reason: 'the file has no spec line' };
	const list = (ns: SpellNamespace): RegisteredName[] =>
		registeredNames(p.ws.table, p.cls, spec, ns).map(({ name, entry }) => ({ name, id: actionId(entry) }));
	const items = usableItems(loadDatabase(p.ws.root)).flatMap(itemId => {
		const name = p.ws.names.itemName(itemId);
		return name ? [{ name: `item.${name}`, id: { itemId } }] : [];
	});
	return {
		status: 'ready',
		spec,
		registered: {
			spells: list('spell'),
			auras: list('aura'),
			targetAuras: list('target_aura'),
			petAuras: list('pet_aura'),
			targetSpells: list('target_spell'),
			items,
		},
	};
}
