import { basename } from 'node:path';

import type { Hover, Position } from 'vscode-languageserver-types';

import { classify, type Span, spanAt } from './classify.ts';
import { type Database, itemSlots, loadDatabase } from './database.ts';
import { lspRange, offsetAt, type Parsed } from './document.ts';
import { isSpellLike, type KindForm, type RefUse, SLOT_ENUM, STAT_ENUM, THINGS, unitReference } from './siml.ts';
import { declarationOf, occurrences } from './symbols.ts';

// The game files' row of a spell, as `go run ./tools/spelldata <id>` prints it; undefined when it cannot be had.
export type SpellCard = (spellId: number) => Promise<string | undefined>;

export async function hover(p: Parsed, position: Position, card?: SpellCard): Promise<Hover | undefined> {
	const offset = offsetAt(p, position);
	const span = spanAt(classify(p), offset);
	const occurrence = occurrences(p).find(o => o.range.start.offset <= offset && offset <= o.range.end.offset);
	if (occurrence && (!span || span.role === 'variable' || span.role === 'placeholder')) {
		const found = declarationOf(p, occurrence);
		const line = found && lineText(found.p, found.declaration.range.start.line);
		const value = [`${occurrence.kind} **${occurrence.name}**${occurrence.scope === undefined ? '' : ` of group "${occurrence.scope}"`}`];
		if (line) value.push(fence(line, 'siml'));
		else value.push(`Not declared in ${occurrence.file === undefined ? 'this file' : basename(occurrence.file)}.`);
		return { contents: { kind: 'markdown', value: value.join('\n\n') }, range: lspRange(occurrence.range) };
	}
	if (!span) return undefined;
	const value = await describe(p, span, card);
	return value ? { contents: { kind: 'markdown', value }, range: lspRange(span.range) } : undefined;
}

function lineText(p: Parsed, line: number): string {
	const end = p.lines.starts[line + 1] ?? p.text.length + 1;
	return p.text.slice(p.lines.starts[line], end - 1).trim();
}

const fence = (text: string, language = 'text') => `\`\`\`${language}\n${text}\n\`\`\``;

async function describe(p: Parsed, span: Span, card: SpellCard | undefined): Promise<string | undefined> {
	const { index } = p.ws;
	switch (span.role) {
		case 'name':
			return name(p, span.ref, card);
		case 'kind':
			return kindText(p, span.kind);
		case 'prop':
			return kindText(p, span.kind);
		case 'head': {
			const props = [...index.accessors.values()].filter(k => k.accessor!.head === span.head).map(k => k.accessor!.prop);
			return `accessor head **${span.head}**\n\n\`${span.head}(…).${props.join('` · `')}\``;
		}
		case 'field': {
			const f = span.field;
			const type = f.printed === 'ref' ? f.ref : f.type ? f.type.replace(/^proto\./, '') : f.printed;
			return `field **${f.siml}**: ${type}${f.repeated && f.printed !== 'indexed' ? ' list' : ''}\n\n\`${f.json}\` in the JSON`;
		}
		case 'unit': {
			const json = unitReference(index, span.word);
			return json ? `unit **${span.word}**\n\n${fence(JSON.stringify(json), 'json')}` : undefined;
		}
		case 'slot':
			return `slot **${span.word}**: ${index.enumValue(SLOT_ENUM, span.word)?.name ?? ''}`;
		case 'section': {
			const def = index.sections.get(span.section);
			return def ? `section **${def.name}**${def.category ? `, category ${def.category}` : ''}\n\n${def.body.join(', ')}` : undefined;
		}
		case 'spec': {
			const spec = index.specs.get(span.spec);
			return spec ? `spec **${spec.field}**: ${spec.spec}, ${spec.class}` : undefined;
		}
		default:
			return undefined;
	}
}

function kindText(p: Parsed, kind: KindForm): string {
	const fields = p.ws.index.fields(kind.message).map(f => `- \`${f.siml}\`: ${f.printed}${f.repeated && f.printed !== 'indexed' ? ' list' : ''}`);
	return [`kind **${kind.kind}** (${kind.form})`, ...(fields.length ? [fields.join('\n')] : [])].join('\n\n');
}

async function name(p: Parsed, ref: RefUse, card: SpellCard | undefined): Promise<string> {
	const { names, table } = p.ws;
	const db = loadDatabase(p.ws.root);
	if (isSpellLike(ref.namespace)) {
		const entry = names.spell(p.cls, ref.namespace, ref.name);
		if (!entry) return `no ${THINGS[ref.namespace].replace(/^an? /, '')} is named **${ref.name}** for this file`;
		const game = db.spells.get(entry.spellId)?.name;
		const parts = [`spell ${entry.spellId}`, ...(entry.tag ? [`tag ${entry.tag}`] : []), ...(entry.rank ? [`rank ${entry.rank}`] : [])];
		const registered = entry.registeredBy.length ? `registered by ${entry.registeredBy.join(', ')}` : 'registered by no build';
		const lines = [`**${game ?? ref.name}** · ${THINGS[ref.namespace]} · ${parts.join(', ')}`, registered];
		const row = card && (await card(entry.spellId));
		if (row) lines.push(fence(row));
		return lines.join('\n\n');
	}
	switch (ref.namespace) {
		case 'item': {
			const id = names.item(ref.name);
			return id === undefined ? `no item is named **${ref.name}**` : itemText(p, db, id);
		}
		case 'enchant': {
			const entry = table.enchants?.[ref.name];
			if (!entry) return `no enchant is named **${ref.name}**`;
			const rows = db.enchants.get(entry.effectId) ?? [];
			return [
				`**${rows[0]?.name ?? ref.name}** · enchant effect ${entry.effectId}`,
				`fits ${entry.slots.join(', ')}`,
				...new Set(rows.slice(1).map(r => r.name)),
			].join('\n\n');
		}
		case 'suffix': {
			const id = names.suffix(ref.name);
			const suffix = id === undefined ? undefined : db.suffixes.get(id);
			if (id === undefined) return `no random suffix is named **${ref.name}**`;
			const stats = (suffix?.stats ?? [])
				.map((v, i) => (v ? `${p.ws.index.enumNumber(STAT_ENUM, i)?.short ?? i} ${v}` : ''))
				.filter(Boolean)
				.join(', ');
			return [`**${suffix?.name ?? ref.name}** · random suffix ${id}`, ...(stats ? [stats] : [])].join('\n\n');
		}
	}
	return ref.name;
}

function itemText(p: Parsed, db: Database, id: number): string {
	const item = db.items.get(id);
	const name = item?.name || db.consumables.get(id)?.name || db.itemIcons.get(id)?.name;
	const lines = [`**${name ?? id}** · item ${id}`];
	if (item) {
		const slots = itemSlots(item).map(n => p.ws.index.enumNumber(SLOT_ENUM, n)?.short ?? String(n));
		const facts = [
			...(item.ilvl ? [`ilvl ${item.ilvl}`] : []),
			...(slots.length ? [slots.join(' or ')] : []),
			...(item.phase ? [`phase ${item.phase}`] : []),
		];
		if (facts.length) lines.push(facts.join(' · '));
		if (item.setName) lines.push(`set: ${item.setName}`);
		if (item.effects.length) lines.push(item.effects.join(', '));
		if (item.randomSuffixOptions?.length) lines.push(`${item.randomSuffixOptions.length} random suffixes`);
	}
	return lines.join('\n\n');
}
