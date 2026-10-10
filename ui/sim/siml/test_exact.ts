// The normalisation of the exactness contract (SPEC.md §12.4), which the tests compare a parse and its proto
// through: uuid and api_version fields cleared, the items of an EquipmentSpec or ItemSwap padded to 17, every
// array indexed by an enum padded to its enum's length (an absent one too), spec_rotation_json read as JSON, and
// the rank of each ActionID a spell-like name writes taken from the name's entry.

import { isObject, normalize, valueAt } from './json.ts';
import { isSpellLike } from './names.ts';
import { PLAYER_MESSAGE, type SchemaIndex, SETTINGS_MESSAGE, SLOT_ENUM } from './schema.ts';
import type { JsonObject, JsonValue, SimlParse } from './types.ts';

const ITEM_SPEC = 'proto.ItemSpec';
const SIMPLE_ROTATION = 'proto.SimpleRotation';

// `json`, a message of `message`, normalised for comparison.
export function exact(index: SchemaIndex, message: string, json: JsonValue): JsonValue {
	const settings = message === SETTINGS_MESSAGE && isObject(json) ? json : undefined;
	const player = settings?.player;
	const spec = isObject(player) ? [...index.specs.values()].find(s => index.protoField(PLAYER_MESSAGE, s.field)!.json in player) : undefined;
	return pad(index, message, normalize(index, message, json), spec?.rotation);
}

function pad(index: SchemaIndex, message: string, v: JsonValue, rotation: string | undefined): JsonValue {
	if (!isObject(v)) return v;
	const out: JsonObject = { ...v };
	for (const f of index.fields(message)) {
		const x = out[f.json];
		if (f.printed === 'indexed') {
			const values = Array.isArray(x) ? x : [];
			out[f.json] = [...values, ...Array(Math.max(0, index.enumLength(f.index!) - values.length)).fill(0)];
		} else if (f.type === ITEM_SPEC && f.repeated) {
			const items = Array.isArray(x) ? x : [];
			out[f.json] = [...items, ...Array(Math.max(0, index.enumLength(SLOT_ENUM) - items.length)).fill({})];
		} else if (message === SIMPLE_ROTATION && f.name === 'spec_rotation_json') {
			out[f.json] = rotation ? normalize(index, rotation, JSON.parse(typeof x === 'string' && x ? x : '{}') as JsonValue) : (x ?? null);
		} else if (x !== undefined && f.type && index.schema.messages[f.type]) {
			out[f.json] = Array.isArray(x) ? x.map(m => pad(index, f.type!, m, rotation)) : pad(index, f.type, x, rotation);
		}
	}
	return out;
}

// `json`, which `parsed` is the parse of a print of, with the rank of each ActionID the print writes by a spell-like
// name as the parse reads it: the rank of the name's entry. `read` is what the parse gives for `json`'s message.
export function entryRanks(index: SchemaIndex, json: JsonValue, parsed: SimlParse, read: JsonValue | undefined): JsonValue {
	const out = structuredClone(json);
	const rank = index.vocabulary.actionId.f.rank;
	for (const ref of parsed.refs) {
		if (!ref.path) continue;
		const into = valueAt(out, ref.path);
		const from = valueAt(read, ref.path);
		if (!isSpellLike(ref.namespace) || !isObject(into) || !isObject(from)) continue;
		if (from[rank] === undefined) delete into[rank];
		else into[rank] = from[rank];
	}
	return out;
}
