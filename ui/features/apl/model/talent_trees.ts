import type { Class } from '@generated/proto/common';
import { classTalentsConfig } from '@sim/talents/factory';

/** A talent tree as the talent calculator shows it: its name and its place among the class's trees. */
export interface TalentTree {
	name: string;
	index: number;
}

/** The tree of each of the class's talents, by the talent's name. A unit with no class has none. */
export const talentTrees = (unitClass: Class): Map<string, TalentTree> =>
	new Map(classTalentsConfig[unitClass].flatMap((tree, index) => tree.talents.map(talent => [talent.fancyName, { name: tree.name, index }] as const)));
