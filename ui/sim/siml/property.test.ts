// SPEC.md §15 item 6, the schema property test: every action and value kind and every section field in the
// schema, with each field set to a typical value (and every kind with none set too), prints in the form §8.3 or
// §12.2 gives it and reads back to itself. A kind or field added to the protos is covered the day it is added.

import { describe, expect, it } from 'vitest';

import { createSiml, type JsonObject, type JsonValue, type KindForm, type SchemaField, type SectionDef, type SpecDef } from './index.ts';
import { normalize, objectAt } from './json.ts';
import { indexSchema, PLAYER_MESSAGE, sectionFields, SETTINGS_MESSAGE, specPath } from './schema.ts';
import { TOP_WORDS } from './syntax.ts';
import { exact } from './test_exact.ts';
import { fixtureNames } from './test_names.ts';
import { testSchema } from './test_schema.ts';

const siml = createSiml(testSchema, fixtureNames);
const index = indexSchema(testSchema);
// The fixture table names 4242 `sample` in every namespace, for every class.
const SPELL = { spellId: 4242 };

// The keyword or operator each short form starts with, or holds (SPEC.md §6.4, §6.5).
const SHORT_ACTIONS: Record<string, RegExp> = {
	cast_spell: /^cast /,
	channel_spell: /^channel /,
	wait: /^wait (?!until)/,
	wait_until: /^wait until /,
	move: /^move (?!for)/,
	move_duration: /^move for /,
	group_reference: /^group "/,
	schedule: /^schedule "/,
	sequence: /^sequence "/,
};
const SHORT_VALUES: Record<string, RegExp> = {
	const: /^1\.5s$/,
	and: / and /,
	or: / or /,
	not: /^not /,
	cmp: / > /,
	math: / \+ /,
	variable_ref: /^\$/,
	variable_placeholder: /^%/,
};
// The short forms' operators take these values to print as written above.
const SHORT_SAMPLES: Record<string, JsonObject> = { const: { val: '1.5s' }, cmp: { op: 'OpGt' }, math: { op: 'OpAdd' } };
// The fields each short form writes (SPEC.md §6.4, §6.5). A kind that sets another prints in its generic form.
const SHORT_FIELDS: Record<string, string[]> = {
	cast_spell: ['spell_id', 'target'],
	channel_spell: ['spell_id', 'target', 'interrupt_if', 'allow_recast'],
	wait: ['duration'],
	wait_until: ['condition'],
	move: ['range_from_target'],
	move_duration: ['duration'],
	group_reference: ['group_name', 'variables'],
	schedule: ['schedule', 'inner_action'],
	sequence: ['name', 'actions'],
	const: ['val'],
	and: ['vals'],
	or: ['vals'],
	not: ['val'],
	cmp: ['op', 'lhs', 'rhs'],
	math: ['op', 'lhs', 'rhs'],
	variable_ref: ['name'],
	variable_placeholder: ['name'],
};

// A typical value of a field: its last enum value, a named ActionID, the current target, a duration, a named item,
// enchant or suffix id, some entries of an indexed array, and a message with each of its fields set.
function sample(field: SchemaField, depth = 0): JsonValue {
	const one = (): JsonValue => {
		switch (field.printed) {
			case 'bool':
				return true;
			case 'number':
				return field.scalar === 'double' || field.scalar === 'float' ? 2.5 : field.scalar === 'int64' || field.scalar === 'uint64' ? '3' : 3;
			case 'string':
				return 'Sample';
			case 'enum':
			case 'flag_enum':
				return testSchema.enums[field.type!].values.at(-1)!.name;
			case 'stat':
				return 14;
			case 'ref':
				return 4242;
			case 'action_id':
				return SPELL;
			case 'unit':
				return { type: 'CurrentTarget' };
			case 'value':
				return { const: { val: '1.5s' } };
			case 'action':
				return { castSpell: { spellId: SPELL } };
			case 'indexed':
				return testSchema.enums[field.index!].values.map((_, i) => (i % 5 === 1 ? i / 2 : 0));
			case 'map':
				return { '6': field.scalar === 'double' ? 2.5 : 50 };
			default:
				return depth > 2 ? {} : Object.fromEntries(index.fields(field.type!).map(f => [f.json, sample(f, depth + 1)]));
		}
	};
	return field.repeated && field.printed !== 'indexed' ? [one(), one()] : one();
}

function body(kind: KindForm): JsonObject {
	return { ...Object.fromEntries(index.fields(kind.message).map(f => [f.json, sample(f)])), ...SHORT_SAMPLES[kind.kind] };
}

// The printed row of a rotation with one priority row, and what that rotation reads back as.
function printRow(row: JsonObject): { line: string; back: JsonValue; want: JsonValue } {
	const rotation = { type: 'TypeAPL', priorityList: [row] };
	const text = siml.print({ kind: { section: 'apl' }, spec: 'hunter', settings: { player: { rotation } } });
	const parsed = siml.parse(text, { path: 'x.apl.siml' });
	expect(parsed.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
	const lines = text.split('\n');
	const start = lines.indexOf('priority:') + 1;
	const end = lines.indexOf('', start);
	const line = lines
		.slice(start, end)
		.map(l => l.trim())
		.join(' ');
	return { line, back: parsed.rotation!, want: normalize(index, 'proto.APLRotation', rotation) };
}

// The pattern of the form §8.3 derives for a kind with every field set: a short kind's own, unless it has a field its
// short form does not write.
function form(kind: KindForm, short: Record<string, RegExp>): RegExp {
	const generic = new RegExp(`^${kind.kind}\\(${kind.positional ? '(?!\\w+=)' : '\\w+='}`);
	switch (kind.form) {
		case 'short':
			return index.fields(kind.message).every(f => SHORT_FIELDS[kind.kind].includes(f.name)) ? short[kind.kind] : generic;
		case 'accessor':
			return new RegExp(`^(target\\.)?${kind.accessor!.head}\\(.+\\)\\.${kind.accessor!.prop}(\\(.+\\))?$`);
		case 'bare':
			return new RegExp(`^${kind.kind}$`);
		case 'unit_prefix':
			return new RegExp(`^target\\.${kind.kind}$`);
		case 'list_args':
			return new RegExp(`^${kind.kind}\\((?!\\w+=).+, .+\\)$`);
		case 'generic':
			return generic;
	}
}

describe('every action kind', () => {
	for (const kind of testSchema.kinds.action) {
		it(`prints ${kind.kind} (${kind.form}) and reads it back`, () => {
			const full = printRow({ action: { [kind.json]: body(kind) } });
			expect(full.back).toEqual(full.want);
			expect(full.line).toMatch(form(kind, SHORT_ACTIONS));
			const empty = printRow({ action: { [kind.json]: {} } });
			expect(empty.back).toEqual(empty.want);
		});
	}
});

describe('every value kind', () => {
	for (const kind of testSchema.kinds.value) {
		it(`prints ${kind.kind} (${kind.form}) and reads it back`, () => {
			const cast = { castSpell: { spellId: SPELL } };
			const full = printRow({ action: { condition: { [kind.json]: body(kind) }, ...cast } });
			expect(full.back).toEqual(full.want);
			expect(full.line.slice(full.line.indexOf(' if ') + 4)).toMatch(form(kind, SHORT_VALUES));
			const empty = printRow({ action: { condition: { [kind.json]: {} }, ...cast } });
			expect(empty.back).toEqual(empty.want);
		});
	}
});

// --- Section fields (SPEC.md §5.2, §5.3, §12.2)

// The entry form §12.2 gives a field set alone in its section, as the line or lines it prints.
function entryForm(field: SchemaField): RegExp {
	const n = field.siml;
	if (field.type === 'proto.ItemSpec') return /^head +\w+ \w+ \+ \w+\nneck +\w+ \w+ \+ \w+$/;
	if (TOP_WORDS.has(n)) return new RegExp(`^${n}=`);
	switch (field.printed) {
		case 'bool':
			return new RegExp(`^${n}$`);
		case 'flag_enum':
			return new RegExp(`^${n}=\\w+$`);
		case 'message':
			return field.repeated ? new RegExp(`^${n}\\(.+\\)\\n${n}\\(.+\\)$`) : new RegExp(`^${n}\\(.+\\)$`);
		case 'indexed':
			return new RegExp(`^${n}\\(\\w+=[0-9.]+(, \\w+=[0-9.]+)*\\)$`);
		case 'map':
			return new RegExp(`^${n} \``);
	}
	return field.repeated ? new RegExp(`^${n} \\S+, \\S+$`) : new RegExp(`^${n} \\S+$`);
}

// The body lines of a section in a printed file, a header line's body included and continuation lines joined.
function bodyOf(text: string, section: string): string {
	const lines = text.split('\n');
	const start = lines.findIndex(l => l === `${section}:` || l.startsWith(`${section}: `));
	const body = lines[start].length > section.length + 1 ? [lines[start].slice(section.length + 2)] : [];
	for (const line of lines.slice(start + 1)) {
		if (!line.startsWith('  ')) break;
		if (line.startsWith('      ')) body[body.length - 1] += ` ${line.trim()}`;
		else body.push(line.trim());
	}
	return body.join('\n');
}

// Settings with `field` set alone in the section, and what reading the section sets beside it: the spec's message
// and class, the section's message, the spec's class options, and the rotation type a rotation section infers.
function sectionSample(def: SectionDef, spec: SpecDef, at: string[], field: SchemaField): JsonObject {
	const settings: JsonObject = {};
	const player = objectAt(settings, ['player']);
	player.class = spec.class;
	objectAt(player, [index.protoField(PLAYER_MESSAGE, spec.field)!.json]);
	if (def.presence) objectAt(settings, specPath(index, def.presence, spec)!);
	if (def.name === 'settings' && spec.classOptions) objectAt(settings, [...specPath(index, def.presence!, spec)!, 'classOptions']);
	if (def.category === 'r') objectAt(settings, ['player', 'rotation']).type = def.name === 'simple' ? 'TypeSimple' : 'TypeAPL';
	const value = sample(field);
	if (at.at(-1) === 'specRotationJson') objectAt(settings, at.slice(0, -1)).specRotationJson = JSON.stringify({ [field.json]: value });
	else objectAt(settings, at)[field.json] = value;
	return settings;
}

describe('every section field', () => {
	const hunter = index.specs.get('hunter')!;
	for (const def of testSchema.sections) {
		if (def.body.some(b => b === 'rows' || b === 'var')) continue;
		const bySpec = def.sources.some(src => src.flatten || src.path.includes('*'));
		for (const spec of bySpec ? [...index.specs.values()] : [hunter]) {
			const placed = sectionFields(index, def, spec);
			it(`prints each field of ${def.name}:${bySpec ? ` for ${spec.field}` : ''} in its form and reads it back`, () => {
				for (const { field, at } of placed) {
					const settings = sectionSample(def, spec, at, field);
					const text = siml.print({ kind: {}, spec: spec.field, settings });
					const parsed = siml.parse(text);
					expect(
						parsed.diagnostics.filter(d => d.severity === 'error'),
						`${field.siml}:\n${text}`,
					).toEqual([]);
					expect(exact(index, SETTINGS_MESSAGE, parsed.settings!), field.siml).toEqual(exact(index, SETTINGS_MESSAGE, settings));
					expect(bodyOf(text, def.name), field.siml).toMatch(entryForm(field));
				}
			});
		}
	}
});
