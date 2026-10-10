import { loadDatabase } from './lang/database.ts';

// What the panel shows for an id: the name and the icon file name from the database.
export type Named = [name: string, icon: string];

export interface AplDatabase {
	spells: Record<number, Named>;
	items: Record<number, Named>;
}

// The spell and item names and icons of the repository's database, for the panel.
export function aplDatabase(root: string): AplDatabase {
	const db = loadDatabase(root);
	const named = (entries: Map<number, { name: string; icon?: string }>): Record<number, Named> =>
		Object.fromEntries([...entries].filter(([, entry]) => entry.name).map(([id, entry]) => [id, [entry.name, entry.icon ?? '']]));
	return { spells: named(db.spells), items: { ...named(db.itemIcons), ...named(db.items) } };
}
