// Protojson read against the schema. Typing checks raw JSON with it (bad-raw), the printer reads its input
// through it, and the exactness contract (SPEC.md §12.4) compares through it.

import type { SchemaField, SchemaIndex } from './schema.ts';
import type { JsonObject, JsonPath, JsonValue } from './types.ts';

export const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

const RANGES: Record<string, { min: bigint; max: bigint }> = {
	int32: { min: -(2n ** 31n), max: 2n ** 31n - 1n },
	uint32: { min: 0n, max: 2n ** 32n - 1n },
	int64: { min: -(2n ** 63n), max: 2n ** 63n - 1n },
	uint64: { min: 0n, max: 2n ** 64n - 1n },
};
const JSON_NUMBER = /^(-?)(?:0|([1-9][0-9]*))(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/;
// Map keys as Go's strconv reads them: a sign only on a signed integer, and leading zeros allowed.
const SIGNED_KEY = /^[+-]?[0-9]+$/;
const UNSIGNED_KEY = /^[0-9]+$/;
export const LONE_SURROGATE = /\p{Cs}/u;
// The strings protojson writes for a float that is no number.
const FLOAT_WORDS = new Set(['NaN', 'Infinity', '-Infinity']);

// The integer a JSON number's text writes, as protojson reads it: undefined when the text writes a fraction or
// more than 20 digits.
function integerOf(text: string): bigint | undefined {
	const m = JSON_NUMBER.exec(text);
	if (!m) return undefined;
	const [, sign, int = '', fraction = '', exponent = '0'] = m;
	const frac = fraction.replace(/0+$/, '');
	if (!int && !frac) return 0n;
	const exp = Number(exponent);
	if (exp < -(2 ** 31) || exp > 2 ** 31 - 1) return undefined;
	if (exp >= 0) return frac.length > exp || int.length + exp > 20 ? undefined : BigInt(sign + int + frac + '0'.repeat(exp - frac.length));
	const point = int.length + exp;
	return frac || point < 0 || /[^0]/.test(int.slice(point)) ? undefined : BigInt(sign + int.slice(0, point));
}

// The float32 nearest the double n, as the double nearest the float32's shortest decimal, so that String writes that
// decimal as Go writes the float32: 0.1, not 0.10000000149011612. Of two shortest decimals that read back to the
// float32 it is the nearer, and of two as near the one whose last digit is even. Infinite when n is past the range
// of a float32.
export function float32(n: number): number {
	const f = Math.abs(Math.fround(n));
	if (f === 0 || f === Infinity) return Math.sign(n) * f;
	const reads = (c: bigint, k: number) => Math.fround(Number(`${c}e${k}`)) === f;
	for (let digits = 1; ; digits++) {
		const [d, x] = f.toExponential(digits - 1).split('e');
		const near = BigInt(d.replace('.', ''));
		const k = Number(x) - digits + 1;
		let best = [near, near - 1n, near + 1n].find(c => reads(c, k));
		// toExponential rounds half up, so the decimal below an odd one may be as near.
		if (best === near && near % 2n === 1n && reads(near - 1n, k) && halfway(f, 2n * near - 1n, k)) best = near - 1n;
		if (best !== undefined) return Math.sign(n) * Number(`${best}e${k}`);
	}
}

// Whether the double x is exactly h × 10^k / 2, halfway between two decimals of the power k.
function halfway(x: number, h: bigint, k: number): boolean {
	const view = new DataView(new ArrayBuffer(8));
	view.setFloat64(0, x);
	const bits = view.getBigUint64(0);
	const biased = Number(bits >> 52n);
	const fraction = bits & ((1n << 52n) - 1n);
	// x = m × 2^e.
	const [m, e] = biased === 0 ? [fraction, -1074] : [fraction | (1n << 52n), biased - 1075];
	const scaled = (v: bigint, twos: number, tens: number) => v * 2n ** BigInt(Math.max(twos, 0)) * 10n ** BigInt(Math.max(tens, 0));
	return scaled(2n * m, e, -k) === scaled(h, -e, k);
}

// `value` as the protojson of `message`, in the one form both implementations write: JSON field names in
// declaration order, default values left out (a oneof member keeps its zero, as protojson writes it),
// enum values by name, 32-bit numbers as numbers and 64-bit integers as strings. A key that names no field
// is left out: the schema holds every field but the skipped ones (SPEC.md §5.1). A value that does not fit
// its field is kept as written. Both are described in `problems`, or a key that names no field in `unknown` when
// it is given.
export function normalize(index: SchemaIndex, message: string, value: JsonValue, problems: string[] = [], unknown = problems): JsonValue {
	return readMessage(index, message, value, { problems, unknown }, short(message));
}

// The value at `path`, or undefined when the path leads through something it cannot.
export function valueAt(json: JsonValue | undefined, path: JsonPath): JsonValue | undefined {
	let v = json;
	for (const k of path) {
		if (typeof k === 'number' ? !Array.isArray(v) : !isObject(v)) return undefined;
		v = (v as Record<string | number, JsonValue>)[k];
	}
	return v;
}

// The object at `path` of objects under `root`, made where missing.
export function objectAt(root: JsonObject, path: ReadonlyArray<string>): JsonObject {
	let o = root;
	for (const k of path) {
		if (!isObject(o[k])) o[k] = {};
		o = o[k] as JsonObject;
	}
	return o;
}

// A map key as protojson reads it, written as JSON writes it; undefined when it is no key of the map.
function mapKey(f: SchemaField, k: string): string | undefined {
	switch (f.key) {
		case 'string':
			return k;
		case 'bool':
			return k === 'true' || k === 'false' ? k : undefined;
	}
	const range = RANGES[f.key!];
	if (!(range.min < 0n ? SIGNED_KEY : UNSIGNED_KEY).test(k)) return undefined;
	const n = BigInt(k);
	return n >= range.min && n <= range.max ? n.toString() : undefined;
}

// A value of `field` as protojson: the whole list or map of a repeated or map field when `whole`, otherwise
// one value, which keeps its zero.
export function normalizeField(index: SchemaIndex, field: SchemaField, value: JsonValue, whole: boolean, problems: string[]): JsonValue {
	const r = { problems, unknown: problems };
	if (whole) return readField(index, field, value, r, field.siml) ?? (field.printed === 'map' ? {} : []);
	return readSingle(index, field, value, r, field.siml, true)!;
}

// Whether two JSON values are equal, whatever the order of their keys.
export function equalJson(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
	if (a === b) return true;
	if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => equalJson(x, b[i]));
	if (!isObject(a) || !isObject(b)) return false;
	const keys = Object.keys(a);
	return keys.length === Object.keys(b).length && keys.every(k => k in b && equalJson(a[k], b[k]));
}

const short = (message: string) => message.slice(message.lastIndexOf('.') + 1);

// Where reading puts what does not fit: a key that names no field in `unknown`, everything else in `problems`.
interface Report {
	problems: string[];
	unknown: string[];
}

function readMessage(index: SchemaIndex, message: string, value: JsonValue, r: Report, at: string): JsonValue {
	if (!isObject(value)) {
		r.problems.push(`${at} is a ${short(message)} object`);
		return value;
	}
	const fields = index.fields(message);
	const byKey = new Map<string, SchemaField>();
	for (const f of fields) {
		byKey.set(f.name, f);
		byKey.set(f.json, f);
	}
	const set = new Map<SchemaField, JsonValue>();
	const seen = new Set<SchemaField>();
	const oneofs = new Map<string, string>();
	for (const [key, v] of Object.entries(value)) {
		const f = byKey.get(key);
		if (!f) {
			r.unknown.push(`${short(message)} has no field ${key}`);
			continue;
		}
		if (seen.has(f)) {
			r.problems.push(`${short(message)}.${f.json} is set twice`);
			continue;
		}
		seen.add(f);
		if (v === null) continue;
		if (f.oneof) {
			const other = oneofs.get(f.oneof);
			if (other) r.problems.push(`${short(message)} sets both ${other} and ${f.json}, which are one oneof`);
			oneofs.set(f.oneof, f.json);
		}
		const read = readField(index, f, v, r, `${at}.${f.json}`);
		if (read !== undefined) set.set(f, read);
	}
	const out: JsonObject = {};
	for (const f of fields) if (set.has(f)) out[f.json] = set.get(f)!;
	return out;
}

function readField(index: SchemaIndex, f: SchemaField, v: JsonValue, r: Report, at: string): JsonValue | undefined {
	if (f.printed === 'map') {
		if (!isObject(v)) {
			r.problems.push(`${at} is an object`);
			return v;
		}
		const entries = new Map<string, JsonValue>();
		for (const [k, x] of Object.entries(v)) {
			const key = mapKey(f, k);
			if (key === undefined) r.problems.push(`${at}: ${JSON.stringify(k)} is no ${f.key} key`);
			else if (entries.has(key)) r.problems.push(`${at} has the key ${key} twice`);
			else entries.set(key, readSingle(index, f, x, r, `${at}.${k}`, true)!);
		}
		// JSON.stringify writes array index keys first, by number, and then the others in the order given.
		return entries.size ? Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : undefined;
	}
	if (f.repeated) {
		if (!Array.isArray(v)) {
			r.problems.push(`${at} is a list`);
			return v;
		}
		const items = v.map((x, i) => readSingle(index, f, x, r, `${at}[${i}]`, true)!);
		return items.length ? items : undefined;
	}
	return readSingle(index, f, v, r, at, f.oneof !== undefined);
}

// One value of a field; undefined for the field's default unless `keepZero`.
function readSingle(index: SchemaIndex, f: SchemaField, v: JsonValue, r: Report, at: string, keepZero: boolean): JsonValue | undefined {
	const { schema } = index;
	if (f.type && schema.messages[f.type]) return readMessage(index, f.type, v, r, at);
	if (f.type && schema.enums[f.type]) {
		const value = typeof v === 'string' ? index.enumValue(f.type, v) : typeof v === 'number' ? index.enumNumber(f.type, v) : undefined;
		// An int32 that names no value is kept, as protojson keeps it.
		if (!value && typeof v === 'number' && Number.isInteger(v) && BigInt(v) >= RANGES.int32.min && BigInt(v) <= RANGES.int32.max) return v;
		if (!value || (typeof v === 'string' && value.name !== v)) {
			r.problems.push(`${at}: ${JSON.stringify(v)} is no ${short(f.type)} value`);
			return v;
		}
		return value.number === 0 && !keepZero ? undefined : value.name;
	}
	switch (f.scalar) {
		case 'bool':
			if (typeof v !== 'boolean') break;
			return v || keepZero ? v : undefined;
		case 'string':
		case 'bytes':
			if (typeof v !== 'string') break;
			if (LONE_SURROGATE.test(v)) {
				r.problems.push(`${at}: ${JSON.stringify(v)} holds a lone surrogate, which names no character`);
				return v;
			}
			return v !== '' || keepZero ? v : undefined;
		case 'int32':
		case 'uint32':
		case 'int64':
		case 'uint64': {
			const n = typeof v === 'number' ? (Number.isInteger(v) ? BigInt(v) : undefined) : typeof v === 'string' ? integerOf(v) : undefined;
			const range = RANGES[f.scalar];
			if (n === undefined || n < range.min || n > range.max) break;
			if (n === 0n && !keepZero) return undefined;
			return f.scalar === 'int64' || f.scalar === 'uint64' ? n.toString() : Number(n);
		}
		case 'double':
		case 'float': {
			if (typeof v === 'string' && FLOAT_WORDS.has(v)) return v;
			const d = typeof v === 'string' && JSON_NUMBER.test(v) ? Number(v) : v;
			const n = typeof d === 'number' && f.scalar === 'float' ? float32(d) : d;
			if (typeof n !== 'number' || !Number.isFinite(n)) break;
			return n !== 0 || keepZero ? n : undefined;
		}
	}
	r.problems.push(`${at}: ${JSON.stringify(v)} is no ${f.scalar ?? f.type}`);
	return v;
}
