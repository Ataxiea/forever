import { dirname, relative } from 'node:path';

import { type Command, type CompletionItem, CompletionItemKind, type Position } from 'vscode-languageserver-types';

import { type CursorContext, cursorContext, type Want } from './context.ts';
import { type Database, type DbItem, enchantFits, itemName, itemSlots, loadDatabase, usableItems } from './database.ts';
import { nearbyFiles, offsetAt, type Parsed, parseText, rangeOf } from './document.ts';
import { fileSections, type KindForm, OTHER_ENUM, type SchemaField, sectionFields, SLOT_ENUM, type SpellNamespace } from './siml.ts';
import { type Occurrence, occurrences, settableVariables } from './symbols.ts';
import { registeredNames } from './workspace.ts';

// Completion re-opens after an item that ends where the next part starts: `cast `, `aura(`, `target.`, `item.`.
const RETRIGGER: Command = { title: 'Suggest', command: 'editor.action.triggerSuggest' };

const ACTION_WORDS: Array<[label: string, insert: string, detail: string]> = [
	['cast', 'cast ', 'cast <spell> [on <unit>]'],
	['channel', 'channel ', 'channel <spell> [on <unit>] [until <value>] [recast]'],
	['wait', 'wait ', 'wait <time>'],
	['wait until', 'wait until ', 'wait until <condition>'],
	['move', 'move ', 'move <range from the target>'],
	['move for', 'move for ', 'move for <time>'],
	['group', 'group "', 'group "Name" [with %placeholder = <value>, …]'],
	['schedule', 'schedule "', 'schedule "0s, 60s" <action>'],
	['sequence', 'sequence "', 'sequence "Name" [<action>, …]'],
	['none', 'none', 'no action'],
];
// The indexed unit words, offered at their first index.
const INDEXED_UNITS = ['target1', 'player1', 'pet1'];
const TOP_LINES: Array<[label: string, insert: string, detail: string]> = [
	['siml 1', 'siml 1', 'the format version, the first line'],
	['spec', 'spec ', "the spec, whose class reads the file's spell names"],
	['talents', 'talents "', 'the talents string'],
	['use', 'use "', 'take the sections of another file'],
	['var', 'var $', 'a rotation value variable'],
];
// The item fields of ConsumesSpec, by proto name, and the ConsumableType numbers each offers; a field not listed
// offers every consumable.
const CONSUMABLE_TYPES: Record<string, number[]> = {
	pot_id: [1],
	potions: [1],
	flask_id: [2],
	food_id: [3],
	explosive_id: [5],
	mhImbue_id: [6],
	ohImbue_id: [6],
	elixir_ids: [11],
	conjured_id: [12],
	conjured_items: [12],
	mh_weapon_imbue_id: [13],
	oh_weapon_imbue_id: [13],
};

interface Builder {
	p: Parsed;
	ctx: CursorContext;
	db: () => Database;
	defined: () => Occurrence[];
	items: CompletionItem[];
	seen: Set<string>;
}

export function complete(p: Parsed, position: Position): CompletionItem[] {
	const ctx = cursorContext(p, offsetAt(p, position));
	if (!ctx) return [];
	let db: Database | undefined;
	let defined: Occurrence[] | undefined;
	const b: Builder = { p, ctx, db: () => (db ??= loadDatabase(p.ws.root)), defined: () => (defined ??= definedIn(p)), items: [], seen: new Set() };
	for (const want of ctx.wants) offer(b, want);
	return b.items;
}

// The file's variables, groups, sequences and placeholders. A bracket left open, as one is while its call is typed,
// joins every line below it into its statement; the file is then read without the lines that open one, as often as
// a continuation line left behind opens another.
function definedIn(p: Parsed): Occurrence[] {
	let read = p;
	for (let open = unclosed(read); open.size > 0; open = unclosed(read)) {
		const text = read.text
			.split('\n')
			.map((line, i) => (open.has(i) ? '' : line))
			.join('\n');
		read = parseText(read.ws, read.path, text, read.open);
	}
	return occurrences(read);
}

const unclosed = (p: Parsed) => new Set(p.parse.diagnostics.filter(d => d.code === 'unclosed-bracket').map(d => d.range.start.line));

function add(b: Builder, label: string, kind: CompletionItemKind, extra: Partial<CompletionItem> & { insert?: string; rank?: number } = {}): void {
	const { insert, rank, ...rest } = extra;
	const key = `${kind}\u0000${label}`;
	if (b.seen.has(key)) return;
	b.seen.add(key);
	const text = insert ?? label;
	const item: CompletionItem = {
		label,
		kind,
		textEdit: { range: rangeOf(b.p.lines, b.ctx.start, b.ctx.end), newText: text },
		sortText: `${rank ?? 5}${label}`,
		...rest,
	};
	if (b.ctx.string && !text.startsWith('"')) return;
	if (/[ (.="]$/.test(text) && !item.command) item.command = RETRIGGER;
	b.items.push(item);
}

function offer(b: Builder, want: Want): void {
	const { index } = b.p.ws;
	switch (want.t) {
		case 'line':
			return line(b, want.column0);
		case 'step':
			return steps(b);
		case 'time':
			add(b, '-1s', CompletionItemKind.Value, { insert: '-1s ', detail: 'a time before the pull', rank: 1 });
			return variables(b);
		case 'value':
			return values(b);
		case 'words':
			for (const word of want.words) add(b, word, CompletionItemKind.Keyword, { insert: word === '1' || word === '+' ? word : `${word} `, rank: 1 });
			return;
		case 'ref':
			return refs(b, want.ns);
		case 'usable':
			return usable(b);
		case 'other':
			for (const v of index.schema.enums[OTHER_ENUM]?.values ?? [])
				if (v.number !== 0) add(b, v.short, CompletionItemKind.EnumMember, { detail: v.name });
			return;
		case 'unit':
			return units(b, false);
		case 'member':
			return members(b);
		case 'enum':
			for (const v of index.schema.enums[want.name]?.values ?? []) add(b, v.short, CompletionItemKind.EnumMember, { detail: v.name });
			return;
		case 'bool':
			add(b, 'true', CompletionItemKind.Keyword);
			add(b, 'false', CompletionItemKind.Keyword);
			return;
		case 'args':
			return args(b, want.message, want.kind, want.used, want.skip);
		case 'props':
			for (const kind of index.accessors.values()) {
				if (kind.accessor!.head !== want.head) continue;
				add(b, kind.accessor!.prop, CompletionItemKind.Method, {
					detail: kind.kind,
					documentation: fieldsText(b, kind.message, [kind.accessor!.subject]),
				});
			}
			return;
		case 'strings':
			for (const o of b.defined()) if (o.kind === want.of && o.definition) add(b, JSON.stringify(o.name), CompletionItemKind.Module, { detail: want.of });
			return;
		case 'placeholders':
			for (const o of b.defined()) {
				if (o.kind === 'placeholder' && o.definition && o.scope === want.group) add(b, placeholderText(o.name), CompletionItemKind.TypeParameter);
			}
			return;
		case 'variables':
			return variables(b);
		case 'entries':
			return entries(b, want.def.name, false);
		case 'flags':
			return entries(b, want.def.name, true);
		case 'field':
			return fieldValues(b, want.field);
		case 'slot-item':
			return slotItems(b, want.slot);
		case 'slot-rest':
			return slotRest(b, want.slot, want.item);
		case 'enchants':
			return enchants(b, want.slot, want.item);
		case 'specs':
			for (const spec of index.specs.values()) add(b, spec.field, CompletionItemKind.Class, { detail: spec.spec });
			return;
		case 'use-path':
			return pathsForUse(b);
		case 'use-variables':
			return usedVariables(b, want.path);
	}
}

// --- Lines.

function line(b: Builder, column0: boolean): void {
	const { index } = b.p.ws;
	const kind = b.p.parse.kind;
	if (column0) {
		for (const name of fileSections(index, kind)) {
			if (name === 'group')
				add(b, 'group "Name":', CompletionItemKind.Module, { insert: 'group "', filterText: 'group', detail: 'a rotation group', rank: 2 });
			else if (name !== kind.section) add(b, `${name}:`, CompletionItemKind.Module, { detail: 'section', rank: 2 });
		}
	}
	if (b.ctx.headers === 0 && (column0 || kind.section !== undefined)) {
		const written = new Set(b.p.parse.tree.top.map(s => s.type));
		for (const [label, insert, detail] of TOP_LINES) {
			const type = label === 'siml 1' ? 'version' : label;
			if (type !== 'use' && type !== 'var' && written.has(type as never)) continue;
			if (type === 'var' && kind.section !== undefined && kind.section !== 'apl') continue;
			add(b, label, CompletionItemKind.Keyword, { insert, detail, rank: 3 });
		}
	}
}

function steps(b: Builder): void {
	for (const [label, insert, detail] of ACTION_WORDS) add(b, label, CompletionItemKind.Keyword, { insert, detail, rank: 1 });
	for (const kind of b.p.ws.schema.kinds.action) if (kind.form !== 'short') kindItem(b, kind);
}

function kindItem(b: Builder, kind: KindForm): void {
	const fields = b.p.ws.index.fields(kind.message);
	const insert = kind.form === 'bare' || kind.form === 'unit_prefix' || fields.length === 0 ? kind.kind : `${kind.kind}(`;
	add(b, kind.kind, CompletionItemKind.Function, { insert, detail: formText(kind), documentation: fieldsText(b, kind.message, []), rank: 3 });
}

function formText(kind: KindForm): string {
	switch (kind.form) {
		case 'bare':
			return 'a value with no fields';
		case 'unit_prefix':
			return '[unit.]kind';
		case 'list_args':
			return 'kind(a, b, …)';
		default:
			return kind.positional ? `kind(${kind.positional}, field=value, …)` : 'kind(field=value, …)';
	}
}

function fieldsText(b: Builder, message: string, leave: string[]): string | undefined {
	const fields = b.p.ws.index.fields(message).filter(f => !leave.includes(f.name));
	return fields.length ? fields.map(f => `${f.siml}: ${f.printed}${f.repeated ? ' list' : ''}`).join('\n') : undefined;
}

function values(b: Builder): void {
	const { index, schema } = b.p.ws;
	variables(b);
	if (b.ctx.group !== undefined)
		for (const o of b.defined()) if (o.kind === 'placeholder' && o.scope === b.ctx.group) add(b, placeholderText(o.name), CompletionItemKind.TypeParameter);
	for (const word of ['true', 'false', 'not']) add(b, word, CompletionItemKind.Keyword, { insert: word === 'not' ? 'not ' : word, rank: 4 });
	for (const head of index.heads) add(b, head, CompletionItemKind.Function, { insert: `${head}(`, detail: `${head}(…).<property>`, rank: 2 });
	for (const kind of schema.kinds.value) if (kind.form !== 'short' && kind.form !== 'accessor') kindItem(b, kind);
	units(b, true);
}

function variables(b: Builder): void {
	for (const o of b.defined()) {
		if (o.kind !== 'variable' || !o.definition || (o.scope !== undefined && o.scope !== b.ctx.group)) continue;
		add(b, variableText(o.name), CompletionItemKind.Variable, { detail: o.scope === undefined ? 'variable' : `variable of group "${o.scope}"`, rank: 0 });
	}
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const variableText = (name: string) => (IDENT.test(name) ? `$${name}` : `\${${name}}`);
const placeholderText = (name: string) => (IDENT.test(name) ? `%${name}` : `%{${name}}`);

// The unit words; as prefixes, each followed by its dot.
function units(b: Builder, prefixes: boolean): void {
	const { index } = b.p.ws;
	for (const word of [...index.unitWords.keys(), ...INDEXED_UNITS]) {
		if (prefixes) add(b, `${word}.`, CompletionItemKind.Reference, { detail: 'unit', rank: 4 });
		else add(b, word, CompletionItemKind.Reference, { detail: 'unit' });
	}
	if (!prefixes) add(b, 'none', CompletionItemKind.Keyword);
}

// After `unit.`: the heads whose kinds take a unit, and the kinds a unit prefixes.
function members(b: Builder): void {
	const { index, schema } = b.p.ws;
	const heads = new Set([...index.accessors.values()].filter(k => k.accessor!.unit).map(k => k.accessor!.head));
	for (const head of heads) add(b, head, CompletionItemKind.Function, { insert: `${head}(`, detail: `${head}(…).<property>` });
	for (const kind of schema.kinds.value) if (kind.form === 'unit_prefix') kindItem(b, kind);
}

// --- Names.

// The names of a spell-like namespace the file's spec registers: the class's first, then the shared ones.
function refs(b: Builder, ns: SpellNamespace): void {
	const { p } = b;
	for (const { name, entry, shared } of registeredNames(p.ws.table, p.cls, p.parse.spec, ns)) {
		const game = b.db().spells.get(entry.spellId)?.name;
		const tag = entry.tag ? ` tag ${entry.tag}` : '';
		const from = shared ? ', from gear, consumables or encounters' : '';
		add(b, name, CompletionItemKind.Constant, { detail: `${game ? `${game} ` : ''}(${entry.spellId}${tag})${from}`, rank: shared ? 2 : 1 });
	}
	add(b, 'item.', CompletionItemKind.Keyword, { detail: 'an item', rank: 6 });
	add(b, 'other.', CompletionItemKind.Keyword, { detail: 'another action, such as other.potion', rank: 6 });
	add(b, 'none', CompletionItemKind.Keyword, { rank: 7 });
}

// Items with a use, which `cast item.<name>` and the other ActionID positions take.
function usable(b: Builder): void {
	const { names } = b.p.ws;
	const db = b.db();
	for (const id of usableItems(db)) {
		const name = names.itemName(id);
		if (name) add(b, name, CompletionItemKind.Value, { detail: `${itemName(db, id) ?? ''} (${id})` });
	}
}

function itemItem(b: Builder, id: number, extra: Partial<CompletionItem> = {}): void {
	const name = b.p.ws.names.itemName(id);
	if (!name) return;
	const item = b.db().items.get(id);
	const ilvl = item?.ilvl ? `, ilvl ${item.ilvl}` : '';
	add(b, name, CompletionItemKind.Value, { detail: `${itemName(b.db(), id) ?? ''} (${id}${ilvl})`, ...extra });
}

// --- Entries and fields.

function entries(b: Builder, sectionName: string, flagsOnly: boolean): void {
	const { index } = b.p.ws;
	const def = index.sections.get(sectionName);
	if (!def) return;
	const written = writtenFields(b, sectionName);
	const slots = def.body.includes('slot_rows');
	if (slots && !flagsOnly) {
		for (const v of index.schema.enums[SLOT_ENUM]?.values ?? [])
			if (!written.has(v.short)) add(b, v.short, CompletionItemKind.Field, { insert: `${v.short} `, detail: 'slot', rank: 1 });
		if (b.p.parse.kind.section === 'gear') return;
	}
	if (def.body.includes('var') && !flagsOnly) add(b, 'var', CompletionItemKind.Keyword, { insert: 'var $', detail: 'a rotation value variable' });
	for (const { field } of sectionFields(index, def, b.p.spec)) {
		// A section of slot rows writes its items as rows.
		if (slots && field.repeated && field.type === index.vocabulary.itemSpec.message) continue;
		if (written.has(field.siml) && !(field.repeated && field.printed === 'message')) continue;
		const flag = field.printed === 'bool' || field.printed === 'flag_enum';
		if (flagsOnly && !flag) continue;
		const insert = flag ? field.siml : field.printed === 'message' || field.printed === 'indexed' ? `${field.siml}(` : `${field.siml} `;
		add(b, field.siml, CompletionItemKind.Field, { insert, detail: fieldType(field), rank: 2 });
	}
}

// The fields and slots the section's other lines already write.
function writtenFields(b: Builder, sectionName: string): Set<string> {
	const out = new Set<string>();
	const section = b.p.parse.tree.sections.find(s => s.name === sectionName && s.body.some(st => st.range.start.offset <= b.ctx.start));
	for (const s of section?.body ?? []) {
		if (s.range.start.offset <= b.ctx.start && b.ctx.start <= s.range.end.offset) continue;
		if (s.type === 'field_entry' || s.type === 'message_entry') out.add(s.name.text);
		else if (s.type === 'flag_list') for (const f of s.flags) out.add(f.name.text);
		else if (s.type === 'slot_row') out.add(s.slot.text);
	}
	return out;
}

function fieldType(field: SchemaField): string {
	const what =
		field.printed === 'ref'
			? (field.ref ?? 'ref')
			: field.printed === 'enum' || field.printed === 'message'
				? field.type!.replace(/^proto\./, '')
				: field.printed;
	return field.repeated && field.printed !== 'indexed' ? `${what} list` : what;
}

function fieldValues(b: Builder, field: SchemaField): void {
	if (field.printed !== 'ref') return;
	const { names } = b.p.ws;
	const db = b.db();
	switch (field.ref) {
		case 'item': {
			const types = CONSUMABLE_TYPES[field.name];
			const ids = [...db.consumables.values()].filter(c => !types || (c.type !== undefined && types.includes(c.type))).map(c => c.id);
			for (const id of ids) itemItem(b, id);
			return;
		}
		case 'enchant':
			for (const name of names.visible(undefined, 'enchant')) add(b, name, CompletionItemKind.Value, { detail: enchantDetail(b, name) });
			return;
		case 'suffix':
			for (const name of names.visible(undefined, 'suffix'))
				add(b, name, CompletionItemKind.Value, { detail: db.suffixes.get(names.suffix(name)!)?.name });
			return;
	}
}

function enchantDetail(b: Builder, name: string): string {
	const entry = b.p.ws.table.enchants?.[name];
	const rows = entry ? (b.db().enchants.get(entry.effectId) ?? []) : [];
	return `${[...new Set(rows.map(r => r.name))].join(' / ')} (effect ${entry?.effectId}; ${entry?.slots.join(', ')})`;
}

// --- Slot rows.

function slotNumber(b: Builder, slot: string): number | undefined {
	return b.p.ws.index.enumValue(SLOT_ENUM, slot)?.number;
}

function slotItems(b: Builder, slot: string): void {
	const number = slotNumber(b, slot);
	for (const item of b.db().items.values()) if (number !== undefined && itemSlots(item).includes(number)) itemItem(b, item.id);
}

function dbItem(b: Builder, name: string): DbItem | undefined {
	const id = b.p.ws.names.item(name);
	return id === undefined ? undefined : b.db().items.get(id);
}

function slotRest(b: Builder, slot: string, item: string): void {
	const { names } = b.p.ws;
	const found = dbItem(b, item);
	for (const id of found?.randomSuffixOptions ?? []) {
		const name = names.suffixName(id);
		if (name) add(b, name, CompletionItemKind.Value, { detail: `random suffix: ${b.db().suffixes.get(id)?.name ?? id}`, rank: 1 });
	}
	add(b, '+', CompletionItemKind.Keyword, { insert: '+ ', detail: 'an enchant', rank: 2 });
	if (!found?.randomSuffixOptions?.length) enchants(b, slot, item, '+ ');
}

function enchants(b: Builder, slot: string, item: string | undefined, before = ''): void {
	const { table } = b.p.ws;
	const found = item === undefined ? undefined : dbItem(b, item);
	for (const [name, entry] of Object.entries(table.enchants ?? {})) {
		if (!entry.slots.includes(slot)) continue;
		if (found && !enchantFits(b.db(), entry.effectId, found)) continue;
		add(b, before ? `+ ${name}` : name, CompletionItemKind.Value, {
			insert: `${before}${name}`,
			filterText: before ? `+ ${name}` : name,
			detail: enchantDetail(b, name),
			rank: 3,
		});
	}
}

// --- Composition.

// The .siml files near the file, by their path from its folder.
function pathsForUse(b: Builder): void {
	if (!b.p.path) return;
	for (const file of nearbyFiles(b.p.path)) {
		const path = relative(dirname(b.p.path), file).split(/[\\/]/).join('/');
		add(b, JSON.stringify(path), CompletionItemKind.File, { detail: 'file' });
	}
}

// The variables a `with` list of a `use` line naming `path` sets.
function usedVariables(b: Builder, path: string): void {
	if (!b.p.path || !path) return;
	for (const { name } of settableVariables(b.p, path)) add(b, variableText(name), CompletionItemKind.Variable, { insert: `${variableText(name)} = ` });
}

// --- Arguments.

function args(b: Builder, message: string, kind: KindForm | undefined, used: Set<string>, skip: Set<string>): void {
	for (const field of b.p.ws.index.fields(message)) {
		if (used.has(field.name) || skip.has(field.name)) continue;
		if (field.name === kind?.listField) continue;
		if (field.printed === 'bool') add(b, field.siml, CompletionItemKind.Property, { detail: 'bool', rank: 2 });
		const written = field.printed === 'message' || field.printed === 'indexed' ? `${field.siml}(` : `${field.siml}=`;
		add(b, written, CompletionItemKind.Property, { filterText: field.siml, detail: fieldType(field), rank: 2 });
	}
}
