import type { Class } from '@generated/proto/common';
import { classTalentsConfig } from '@sim/talents/factory';

/** A talent tree as the talent calculator shows it: its name and its place among the class's trees. */
export interface TalentTree {
	name: string;
	index: number;
}

/**
 * The tree of an entry's talent: by the talent spell id the sim links the entry to, else by the
 * entry's name. A link to a talent the class does not have falls back to the name. A unit with no
 * class has no trees.
 */
export const talentTrees = (unitClass: Class) => {
	const talents = classTalentsConfig[unitClass].flatMap((tree, index) => tree.talents.map(talent => ({ talent, tree: { name: tree.name, index } })));
	const byId = new Map(talents.map(({ talent, tree }) => [talent.spellId, tree]));
	const byName = new Map(talents.map(({ talent, tree }) => [talent.fancyName, tree]));
	return (name: string, talentId: number): TalentTree | undefined => byId.get(talentId) ?? byName.get(name);
};
