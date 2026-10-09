import { useEffect, useState, type ReactNode } from 'react';

import type { AplFieldSpec } from '@features/apl/model/field_specs';

import { useEditor } from './editor_context';
import {
	type Family,
	type Json,
	type JsonObject,
	type JsonPath,
	fieldInfo,
	humanize,
	isObject,
	kindMessage,
	kindModel,
	kindOf,
	newKindJson,
	resolve,
} from './model';
import { ActionIdPicker, EnumSelect, KindPicker, UnitPicker } from './pickers';
import { ActionText, ValueText } from './summary';
import { Icon } from './icons';

// A text box that writes on Enter or when it loses focus, not on every key, so one change is one edit.
export function CommitInput({
	value,
	onCommit,
	placeholder,
	list,
	className,
	type = 'text',
}: {
	value: string;
	onCommit: (value: string) => void;
	placeholder?: string;
	list?: string;
	className?: string;
	type?: string;
}) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	const commit = () => draft !== value && onCommit(draft);
	return (
		<input
			type={type}
			className={className}
			value={draft}
			list={list}
			placeholder={placeholder}
			onChange={e => setDraft(e.target.value)}
			onBlur={commit}
			onKeyDown={e => {
				if (e.key === 'Enter') commit();
				if (e.key === 'Escape') setDraft(value);
			}}
		/>
	);
}

// The JSON itself, for a field or kind the forms do not cover.
function RawJson({ json, onCommit }: { json: Json | undefined; onCommit: (value: Json | undefined) => void }) {
	const text = json === undefined ? '' : JSON.stringify(json);
	const [draft, setDraft] = useState(text);
	const [bad, setBad] = useState(false);
	useEffect(() => setDraft(text), [text]);
	return (
		<textarea
			className={`raw${bad ? ' bad' : ''}`}
			value={draft}
			rows={Math.min(6, Math.ceil(draft.length / 60) || 1)}
			onChange={e => setDraft(e.target.value)}
			onBlur={() => {
				if (draft === text) return;
				try {
					onCommit(draft.trim() ? JSON.parse(draft) : undefined);
					setBad(false);
				} catch {
					setBad(true);
				}
			}}
		/>
	);
}

function Row({ label, tooltip, children, wide }: { label: string; tooltip?: string; children: ReactNode; wide?: boolean }) {
	return (
		<div className={`field${wide ? ' wide' : ''}`}>
			<label title={tooltip}>{label}</label>
			<div className="field-input">{children}</div>
		</div>
	);
}

// Proto JSON leaves a field at its zero value out, so setting one removes it.
const orUnset = (value: Json | undefined): Json | undefined => (value === 0 || value === false || value === '' ? undefined : value);

function FieldEditor({
	spec,
	family,
	kind,
	body,
	path,
	ctx,
}: {
	spec: AplFieldSpec;
	family: Family;
	kind: string;
	body: JsonObject;
	path: JsonPath;
	ctx: ListContext;
}) {
	const { edit, groupNames, variableNames, groupVariables } = useEditor();
	const json = body[spec.field];
	const at = [...path, spec.field];
	const set = (value: Json | undefined) => edit({ op: 'set', path: at, value });
	const label = spec.label ?? humanize(spec.field);
	const info = fieldInfo(kindMessage(family, kind), spec.field);

	switch (spec.kind) {
		case 'actionId':
			return (
				<Row label={spec.label ?? (spec.field === 'auraId' ? 'Aura' : spec.field === 'spellId' ? 'Spell' : label)} tooltip={spec.labelTooltip}>
					<ActionIdPicker
						json={json}
						onPick={set}
						set={spec.actionIdSet}
						unit={spec.unitRefField ? body[spec.unitRefField] : undefined}
						defaultUnitRef={spec.defaultUnitRef}
						isPrepull={ctx.isPrepull}
					/>
				</Row>
			);
		case 'unit':
			return (
				<Row label={spec.label ?? (spec.field === 'target' ? 'Target' : label)} tooltip={spec.labelTooltip}>
					<UnitPicker json={json} onPick={set} />
				</Row>
			);
		case 'boolean':
			return (
				<Row label={label} tooltip={spec.labelTooltip}>
					<input type="checkbox" checked={json === true} onChange={e => set(orUnset(e.target.checked))} />
				</Row>
			);
		case 'number':
			return (
				<Row label={label} tooltip={spec.labelTooltip}>
					<CommitInput
						type="number"
						className="narrow"
						value={json === undefined ? '' : String(json)}
						onCommit={v => set(orUnset(v === '' ? undefined : spec.float ? Number(v) : Math.trunc(Number(v))))}
					/>
				</Row>
			);
		case 'string':
		case 'placeholderName':
			return (
				<Row label={label} tooltip={spec.labelTooltip} wide={spec.wide}>
					<CommitInput value={typeof json === 'string' ? json : ''} onCommit={v => set(orUnset(v))} />
				</Row>
			);
		case 'rotationName': {
			const listId = spec.source === 'groups' ? 'apl-group-names' : 'apl-variable-names';
			return (
				<Row label={spec.label ?? (spec.source === 'groups' ? 'Group' : 'Variable')} tooltip={spec.labelTooltip}>
					<CommitInput
						value={typeof json === 'string' ? json : ''}
						list={listId}
						placeholder={(spec.source === 'groups' ? groupNames : variableNames)[0]}
						onCommit={v => set(orUnset(v))}
					/>
				</Row>
			);
		}
		case 'enum':
			return (
				<Row label={label} tooltip={spec.labelTooltip}>
					<EnumSelect info={info} json={json} table={spec.table} onPick={set} />
				</Row>
			);
		case 'value':
			return (
				<Row label={label} tooltip={spec.labelTooltip} wide>
					<ValueEditor json={json} path={at} ctx={ctx} />
				</Row>
			);
		case 'valueList': {
			const list = Array.isArray(json) ? json : [];
			return (
				<Row label={label} wide>
					<div className="list">
						{list.map((value, i) => (
							<div className="list-item" key={i}>
								<ValueEditor json={value} path={[...at, i]} ctx={ctx} />
								<button
									type="button"
									className="icon-btn"
									title="Remove"
									onClick={() => edit({ op: 'set', path: [...at, i], value: undefined })}>
									<Icon name="close" />
								</button>
							</div>
						))}
						<KindPicker
							family="value"
							isPrepull={ctx.isPrepull}
							isGroup={ctx.isGroup}
							trigger={<span className="add">+ value</span>}
							onPick={k => edit({ op: 'insert', path: at, index: list.length, value: { [k]: newKindJson('value', k) } })}
						/>
					</div>
				</Row>
			);
		}
		case 'action':
			return (
				<Row label={label} wide>
					<ActionEditor json={json} path={at} ctx={ctx} />
				</Row>
			);
		case 'actionList': {
			const list = Array.isArray(json) ? json : [];
			return (
				<Row label={label} wide>
					<div className="list">
						{list.map((action, i) => (
							<div className="list-item" key={i}>
								<span className="step">{i + 1}</span>
								<ActionEditor json={action} path={[...at, i]} ctx={ctx} />
								<span className="item-buttons">
									<button
										type="button"
										className="icon-btn"
										title="Move up"
										disabled={i === 0}
										onClick={() => edit({ op: 'move', path: at, from: i, to: i - 1 })}>
										<Icon name="up" />
									</button>
									<button
										type="button"
										className="icon-btn"
										title="Remove"
										onClick={() => edit({ op: 'set', path: [...at, i], value: undefined })}>
										<Icon name="close" />
									</button>
								</span>
							</div>
						))}
						<KindPicker
							family="action"
							isPrepull={ctx.isPrepull}
							isGroup={ctx.isGroup}
							trigger={<span className="add">+ action</span>}
							onPick={k => edit({ op: 'insert', path: at, index: list.length, value: { [k]: newKindJson('action', k) } })}
						/>
					</div>
				</Row>
			);
		}
		case 'groupVariables': {
			const list = Array.isArray(json) ? json : [];
			const declared = groupVariables[String(body[spec.groupNameField] ?? '')] ?? [];
			const listId = `apl-group-vars-${at.join('-')}`;
			const unset = declared.filter(name => !list.some(v => isObject(v) && v.name === name));
			return (
				<Row label={spec.label ?? 'Variables'} tooltip="Values this reference gives the group's variables" wide>
					<datalist id={listId}>
						{declared.map(name => (
							<option key={name} value={name} />
						))}
					</datalist>
					<div className="list">
						{list.map((variable, i) => {
							const v = isObject(variable) ? variable : {};
							return (
								<div className="variable list-item" key={i}>
									<span className="var-name">
										$
										<CommitInput
											value={String(v.name ?? '')}
											list={listId}
											onCommit={name => edit({ op: 'set', path: [...at, i, 'name'], value: name })}
										/>
									</span>
									<span className="op">=</span>
									<ValueEditor json={v.value} path={[...at, i, 'value']} ctx={ctx} />
									<button
										type="button"
										className="icon-btn"
										title="Remove"
										onClick={() => edit({ op: 'set', path: [...at, i], value: undefined })}>
										<Icon name="close" />
									</button>
								</div>
							);
						})}
						<button
							type="button"
							className="add"
							onClick={() =>
								edit({ op: 'insert', path: at, index: list.length, value: { name: unset[0] ?? '', value: { const: { val: '0' } } } })
							}>
							+ {unset[0] ? `$${unset[0]}` : 'variable'}
						</button>
					</div>
				</Row>
			);
		}
	}
}

export interface ListContext {
	isPrepull: boolean;
	isGroup: boolean;
}

// The kind's fields as the site lays them out, then any field the JSON carries that the site has no picker for.
function KindFields({ family, kind, json, path, ctx }: { family: Family; kind: string; json: JsonObject; path: JsonPath; ctx: ListContext }) {
	const { edit } = useEditor();
	const model = kindModel(family, kind);
	const body = isObject(json[kind]) ? (json[kind] as JsonObject) : {};
	const at = [...path, kind];
	if (!model) {
		return (
			<Row label="JSON" wide>
				<RawJson json={json[kind]} onCommit={value => edit({ op: 'set', path: at, value: value ?? {} })} />
			</Row>
		);
	}
	const specs = model.fields.map(resolve);
	const covered = new Set(specs.map(spec => spec.field));
	const extra = Object.keys(body).filter(field => !covered.has(field));
	return (
		<>
			{specs.map(spec => (
				<FieldEditor key={spec.field} spec={spec} family={family} kind={kind} body={body} path={at} ctx={ctx} />
			))}
			{extra.map(field => (
				<Row key={field} label={humanize(field)} wide>
					<RawJson json={body[field]} onCommit={value => edit({ op: 'set', path: [...at, field], value })} />
				</Row>
			))}
		</>
	);
}

export function ValueEditor({ json, path, ctx, optional = false }: { json: Json | undefined; path: JsonPath; ctx: ListContext; optional?: boolean }) {
	const { edit, reveal } = useEditor();
	const kind = kindOf('value', json);
	const [open, setOpen] = useState(false);
	const replace = (k: string) => edit({ op: 'set', path, value: { [k]: newKindJson('value', k) } });
	const simple = kind === 'const' || kind === 'variableRef';
	const body = kind && isObject(json) && isObject(json[kind]) ? (json[kind] as JsonObject) : {};

	return (
		<div className="value-editor">
			<div className="value-head">
				<KindPicker
					family="value"
					current={kind}
					isPrepull={ctx.isPrepull}
					isGroup={ctx.isGroup}
					onPick={replace}
					trigger={<span className="kind-name">{kind ? (kindModel('value', kind)?.label ?? kind) : 'none'}</span>}
				/>
				{kind === 'const' ? (
					<CommitInput
						className="const"
						value={String(body.val ?? '')}
						onCommit={v => edit({ op: 'set', path: [...path, 'const', 'val'], value: v })}
					/>
				) : kind === 'variableRef' ? (
					<CommitInput
						value={String(body.name ?? '')}
						list="apl-variable-names"
						onCommit={v => edit({ op: 'set', path: [...path, 'variableRef', 'name'], value: v })}
					/>
				) : kind ? (
					<button type="button" className="value-preview" onClick={() => setOpen(!open)} onDoubleClick={() => reveal(path)} title="Show the fields">
						<Icon name={open ? 'down' : 'right'} />
						<ValueText json={json} />
					</button>
				) : null}
				{optional && kind ? (
					<button type="button" className="icon-btn" title="Remove" onClick={() => edit({ op: 'set', path, value: undefined })}>
						<Icon name="close" />
					</button>
				) : null}
			</div>
			{kind && !simple && open ? (
				<div className="nested">
					<KindFields family="value" kind={kind} json={json as JsonObject} path={path} ctx={ctx} />
				</div>
			) : null}
		</div>
	);
}

export function ActionEditor({ json, path, ctx }: { json: Json | undefined; path: JsonPath; ctx: ListContext }) {
	const { edit } = useEditor();
	const kind = kindOf('action', json);
	const condition = isObject(json) ? json.condition : undefined;
	// Swapping the kind keeps the condition.
	const replace = (k: string) => edit({ op: 'set', path, value: { ...(condition !== undefined ? { condition } : {}), [k]: newKindJson('action', k) } });

	return (
		<div className="action-editor">
			<div className="action-head">
				<KindPicker
					family="action"
					current={kind}
					isPrepull={ctx.isPrepull}
					isGroup={ctx.isGroup}
					onPick={replace}
					trigger={kind ? <ActionText json={json} /> : <span className="kind-name">pick an action</span>}
				/>
			</div>
			{kind ? (
				<div className="nested">
					<KindFields family="action" kind={kind} json={json as JsonObject} path={path} ctx={ctx} />
					<Row label="Condition" wide>
						{condition === undefined ? (
							<KindPicker
								family="value"
								isPrepull={ctx.isPrepull}
								isGroup={ctx.isGroup}
								trigger={<span className="add">+ condition</span>}
								onPick={k => edit({ op: 'set', path: [...path, 'condition'], value: { [k]: newKindJson('value', k) } })}
							/>
						) : (
							<ValueEditor json={condition} path={[...path, 'condition']} ctx={ctx} optional />
						)}
					</Row>
				</div>
			) : null}
		</div>
	);
}
