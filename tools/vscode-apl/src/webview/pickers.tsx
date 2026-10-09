import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { ActionID, UnitReference } from '@generated/proto/common';

import type { ACTION_ID_SET } from '@features/apl/model/action_id_sets';

import type { AplDatabase } from '../db';
import { iconUrl, IdChip, useDb } from './db';
import { useEditor } from './editor_context';
import { categoryLabel, idKey, ITEM_SETS, offeredFor, useRegistered, writtenId } from './registered';
import { type Family, type Json, type JsonObject, enumChoices, enumJsonName, enumNumber, fieldInfo, isObject, kindsFor, submenuLabel } from './model';
import { unitText } from './summary';

export interface PickerOption {
	key: string;
	label: string;
	group?: string;
	hint?: string;
	icon?: string;
	value: Json;
}

const MAX_SHOWN = 80;

// A text box that filters a long option list: arrows move, Enter picks, Escape closes.
export function SearchPicker({
	trigger,
	options,
	onPick,
	placeholder,
	note,
}: {
	trigger: ReactNode;
	options: () => PickerOption[];
	onPick: (value: Json) => void;
	placeholder: string;
	note?: string;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [active, setActive] = useState(0);
	const input = useRef<HTMLInputElement>(null);
	const box = useRef<HTMLDivElement>(null);

	const all = useMemo(() => (open ? options() : []), [open, options]);
	const shown = useMemo(() => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		const hits = words.length === 0 ? all : all.filter(o => words.every(w => `${o.label} ${o.hint ?? ''} ${o.group ?? ''}`.toLowerCase().includes(w)));
		return hits.slice(0, MAX_SHOWN);
	}, [all, query]);

	useEffect(() => {
		if (!open) return;
		input.current?.focus();
		const close = (event: MouseEvent) => {
			if (!box.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener('mousedown', close);
		return () => document.removeEventListener('mousedown', close);
	}, [open]);

	useEffect(() => setActive(0), [query]);

	const pick = (option: PickerOption | undefined) => {
		if (!option) return;
		setOpen(false);
		setQuery('');
		onPick(option.value);
	};

	const onKey = (event: KeyboardEvent) => {
		if (event.key === 'ArrowDown') setActive(i => Math.min(i + 1, shown.length - 1));
		else if (event.key === 'ArrowUp') setActive(i => Math.max(i - 1, 0));
		else if (event.key === 'Enter') pick(shown[active]);
		else if (event.key === 'Escape') setOpen(false);
		else return;
		event.preventDefault();
		event.stopPropagation();
	};

	return (
		<div className="picker" ref={box}>
			<button type="button" className="picker-trigger" onClick={() => setOpen(!open)}>
				{trigger}
				<span className="caret">▾</span>
			</button>
			{open ? (
				<div className="picker-pop">
					<input ref={input} value={query} placeholder={placeholder} onChange={e => setQuery(e.target.value)} onKeyDown={onKey} />
					{note ? <div className="picker-note">{note}</div> : null}
					<ul>
						{shown.map((option, i) => (
							<li
								key={option.key}
								className={i === active ? 'active' : undefined}
								onMouseEnter={() => setActive(i)}
								onMouseDown={e => {
									e.preventDefault();
									pick(option);
								}}
								title={option.hint}>
								{option.icon ? <img src={iconUrl(option.icon)} alt="" /> : null}
								<span className="opt-label">{option.label}</span>
								{option.group ? <span className="opt-group">{option.group}</span> : null}
							</li>
						))}
						{shown.length === 0 ? <li className="empty">No match</li> : null}
					</ul>
				</div>
			) : null}
		</div>
	);
}

const OTHER_IDS = enumChoices(fieldInfo(ActionID, 'otherId')).filter(choice => choice.value !== 0);

function dbOption(db: AplDatabase, id: JsonObject, group: string, hint?: string): PickerOption {
	const kind = typeof id.itemId === 'number' ? 'item' : typeof id.otherId === 'string' ? 'other' : 'spell';
	const number = kind === 'item' ? id.itemId : id.spellId;
	const [name, icon] =
		kind === 'other'
			? [String(id.otherId).replace(/^OtherAction/, ''), undefined]
			: ((kind === 'item' ? db.items : db.spells)[number as number] ?? [`${kind} ${number}`, undefined]);
	const tag = typeof id.tag === 'number' && id.tag ? ` · tag ${id.tag}` : '';
	return { key: `${idKey(id)}`, label: name, hint: hint ?? `${kind} ${kind === 'other' ? id.otherId : number}${tag}`, icon, group, value: id };
}

// Names that more than one option shares, which then carry their rank, or their id where they have none.
function withRanks(options: PickerOption[], ranks: Map<string, number>): PickerOption[] {
	const counts = new Map<string, number>();
	options.forEach(option => counts.set(option.label, (counts.get(option.label) ?? 0) + 1));
	return options.map(option => {
		const rank = ranks.get(option.key);
		if ((counts.get(option.label) ?? 0) < 2) return option;
		return { ...option, label: rank ? `${option.label} (Rank ${rank})` : `${option.label} · ${option.hint}` };
	});
}

// What the field may hold: the spells or auras the sim registers for the spec that the field's set lets
// through, and for the sets that take one, an item from the database. Until the sim answers, or for a
// spec it cannot build, the whole database, with the reason above the list.
export function ActionIdPicker({
	json,
	onPick,
	set,
	unit,
	defaultUnitRef,
	isPrepull,
}: {
	json: Json | undefined;
	onPick: (value: Json) => void;
	set: ACTION_ID_SET;
	unit: Json | undefined;
	defaultUnitRef: 'self' | 'currentTarget';
	isPrepull: boolean;
}) {
	const db = useDb();
	const registered = useRegistered();
	const { usedIds } = useEditor();
	const options = useMemo(
		() => () => {
			const used = new Set(usedIds);
			const first = (list: PickerOption[]) => [...list.filter(o => used.has(o.key)), ...list.filter(o => !used.has(o.key))];
			const items = ITEM_SETS.has(set) ? Object.keys(db.items).map(id => dbOption(db, { itemId: Number(id) }, 'item')) : [];
			if (registered.status !== 'ready') {
				const spells = Object.keys(db.spells).map(id => dbOption(db, { spellId: Number(id) }, 'spell'));
				const others = OTHER_IDS.map(choice => dbOption(db, { otherId: choice.label }, 'other'));
				return first([...spells, ...items, ...others]);
			}
			const scope = isPrepull ? 'priority' : 'prepull';
			const offered = offeredFor(registered, set, unit, defaultUnitRef).filter(entry => entry.listScope !== scope);
			const ranks = new Map(offered.map(entry => [`${idKey(entry.id)}`, typeof entry.id.rank === 'number' ? entry.id.rank : 0]));
			const spells = withRanks(
				offered.map(entry =>
					dbOption(db, writtenId(entry.id), categoryLabel(entry.stats) ?? (typeof entry.id.otherId === 'string' ? 'other' : registered.spec)),
				),
				ranks,
			);
			const placeholders =
				set === 'castable_spells' ? [dbOption(db, { otherId: 'OtherActionPotion' }, 'placeholder', 'whichever potion the player has')] : [];
			return first([...spells, ...placeholders, ...items]);
		},
		[db, usedIds, registered, set, unit, defaultUnitRef, isPrepull],
	);
	const note =
		registered.status === 'loading'
			? 'Loading the spells the sim registers for this spec; listing the database meanwhile.'
			: registered.status === 'unavailable'
				? `Listing the whole database: ${registered.reason}.`
				: undefined;
	const [raw, setRaw] = useState('');
	const tag = isObject(json) && typeof json.tag === 'number' ? json.tag : undefined;
	return (
		<span className="id-picker">
			<SearchPicker
				trigger={<IdChip json={json} />}
				options={options}
				note={note}
				onPick={value => onPick(tag && !(isObject(value) && 'tag' in value) ? { ...(value as object), tag } : value)}
				placeholder={registered.status === 'ready' ? `Search what ${registered.spec} registers` : 'Search spells and items'}
			/>
			{registered.status === 'ready' ? null : (
				<input
					className="raw-id"
					placeholder="id"
					value={raw}
					title="A spell id, or i<id> for an item"
					onChange={e => setRaw(e.target.value)}
					onKeyDown={e => {
						if (e.key !== 'Enter') return;
						const match = /^(i?)(\d+)$/.exec(raw.trim());
						if (match) {
							onPick(match[1] ? { itemId: Number(match[2]) } : { spellId: Number(match[2]) });
							setRaw('');
						}
					}}
				/>
			)}
		</span>
	);
}

// The kind list of an action or value, filed under the site's submenus and searchable by name and description.
export function KindPicker({
	family,
	current,
	onPick,
	isPrepull,
	isGroup,
	trigger,
}: {
	family: Family;
	current?: string;
	onPick: (kind: string) => void;
	isPrepull: boolean;
	isGroup: boolean;
	trigger: ReactNode;
}) {
	const options = useMemo(
		() => () =>
			kindsFor(family, isPrepull, isGroup).map((model): PickerOption => ({
				key: model.kind,
				label: model.label,
				group: model.submenu?.map(submenuLabel).join(' › '),
				hint: model.shortDescription,
				value: model.kind,
			})),
		[family, isPrepull, isGroup],
	);
	return (
		<SearchPicker trigger={trigger} options={options} onPick={kind => kind !== current && onPick(kind as string)} placeholder={`Search ${family} kinds`} />
	);
}

const UNIT_TYPE = fieldInfo(UnitReference, 'type');
const INDEXED = new Set(['Target', 'Pet', 'Player']);

// A unit reference: the kind's default (no reference), or a type and, for the indexed types, which one.
export function UnitPicker({ json, onPick }: { json: Json | undefined; onPick: (value: Json | undefined) => void }) {
	const type = isObject(json) && typeof json.type === 'string' ? json.type : '';
	const index = isObject(json) && typeof json.index === 'number' ? json.index : 0;
	return (
		<span className="unit-picker">
			<select
				value={type}
				onChange={e => onPick(e.target.value ? { type: e.target.value, ...(INDEXED.has(e.target.value) && index ? { index } : {}) } : undefined)}>
				<option value="">default</option>
				{enumChoices(UNIT_TYPE)
					.filter(choice => choice.value !== 0)
					.map(choice => (
						<option key={choice.label} value={choice.label}>
							{unitText({ type: choice.label }) ?? choice.label}
						</option>
					))}
			</select>
			{INDEXED.has(type) ? (
				<input
					type="number"
					min={1}
					className="narrow"
					value={index + 1}
					title="Which one, counting from 1"
					onChange={e => {
						const n = Math.max(0, Number(e.target.value) - 1);
						onPick({ ...(json as object), index: n || undefined } as Json);
					}}
				/>
			) : null}
		</span>
	);
}

export function EnumSelect({
	info,
	json,
	table,
	onPick,
}: {
	info: ReturnType<typeof fieldInfo>;
	json: Json | undefined;
	table?: { options: Array<{ value: number; label: string; tooltip?: string }> };
	onPick: (value: Json | undefined) => void;
}) {
	const current = enumNumber(info, json) ?? 0;
	const options: Array<{ value: number; label: string; tooltip?: string }> = table?.options ?? enumChoices(info);
	return (
		<select
			value={current}
			onChange={e => {
				const value = Number(e.target.value);
				// Proto JSON leaves a zero enum out.
				onPick(value === 0 ? undefined : (enumJsonName(info, value) as Json));
			}}>
			{options.some(o => o.value === current) ? null : <option value={current}>{String(json ?? current)}</option>}
			{options.map(option => (
				<option key={option.value} value={option.value} title={option.tooltip}>
					{option.label}
				</option>
			))}
		</select>
	);
}
