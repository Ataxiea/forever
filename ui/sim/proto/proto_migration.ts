// Bringing older stored protos up to the current shape.
import { CURRENT_API_VERSION } from '../constants/other';

// Utilities for migrating protos between versions

// Each key is an API version, each value is a function that up-converts a proto
// to that version from the previous one. If there are missing keys between
// successive entries, then it is assumed that no intermediate conversions are
// required (i.e. the intermediate version changes did not affect this
// particular proto).
export type ProtoConversionMap<Type> = Map<number, (arg: Type) => Type>;

export function migrateOldProto<Type>(oldProto: Type, oldApiVersion: number, conversionMap: ProtoConversionMap<Type>, targetApiVersion?: number): Type {
	let migratedProto = oldProto;
	const finalVersion = targetApiVersion || CURRENT_API_VERSION;
	for (let nextVersion = oldApiVersion + 1; nextVersion <= finalVersion; nextVersion++) {
		if (conversionMap.has(nextVersion)) {
			migratedProto = conversionMap.get(nextVersion)!(migratedProto);
		}
	}

	return migratedProto;
}
