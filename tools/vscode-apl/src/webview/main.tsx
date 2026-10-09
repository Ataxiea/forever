import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { AplDatabase, Named } from '../db';
import type { AplEdit } from '../edits';
import type { FromPanel, PanelState, Registered, ToPanel } from '../protocol';
import { DbContext } from './db';
import { EditorContext, type EditorApi, useEditor } from './editor_context';
import { ActionEditor, CommitInput, type ListContext, ValueEditor } from './forms';
import { Icon } from './icons';
import { type Json, type JsonObject, type JsonPath, isObject, newKindJson, setClassName } from './model';
import { KindPicker } from './pickers';
import { idKey, RegisteredContext } from './registered';
import { ActionText, ValueText } from './summary';

import './style.css';

declare function acquireVsCodeApi(): { postMessage(message: FromPanel): void; setState(state: PanelState): void };
const vscode = acquireVsCodeApi();

const key = (path: JsonPath) => path.join('/');

function collectIds(json: Json, into: Set<string>): Set<string> {
	if (Array.isArray(json)) {
		json.forEach(item => collectIds(item, into));
	} else if (isObject(json)) {
		const key = idKey(json);
		if (key) into.add(key);
		Object.values(json).forEach(value => collectIds(value, into));
	}
	return into;
}

// The "when" of a prepull action: a constant reads as its time, anything else as the value it is.
function DoAt({ json }: { json: Json | undefined }) {
	const constant = isObject(json) && isObject(json.const) ? json.const.val : undefined;
	return <span className="do-at">{constant !== undefined ? String(constant) : json === undefined ? '—' : <ValueText json={json} />}</span>;
}

interface ListProps {
	title: string;
	path: JsonPath;
	items: Json[];
	ctx: ListContext;
	selected?: string;
	expanded: Set<string>;
	toggle: (rowKey: string) => void;
	remapExpanded: (path: JsonPath, from: number, to: number) => void;
}

function ItemList({ title, path, items, ctx, selected, expanded, toggle, remapExpanded }: ListProps) {
	const { edit, reveal } = useEditor();
	const [dragFrom, setDragFrom] = useState<number>();
	const [dropAt, setDropAt] = useState<number>();

	const move = (from: number, to: number) => {
		if (to < 0 || to >= items.length || from === to) return;
		remapExpanded(path, from, to);
		edit({ op: 'move', path, from, to });
	};

	const add = (kind: string) => {
		const action = { [kind]: newKindJson('action', kind) };
		edit({ op: 'insert', path, index: items.length, value: ctx.isPrepull ? { action, doAtValue: { const: { val: '-1s' } } } : { action } });
		toggle(key([...path, items.length]));
	};

	return (
		<section>
			<h2>
				{title} <span className="count">{items.length}</span>
			</h2>
			<ol className="items" onDragLeave={() => setDropAt(undefined)}>
				{items.map((item, i) => {
					const rowPath = [...path, i];
					const rowKey = key(rowPath);
					const row = isObject(item) ? item : {};
					const hidden = row.hide === true;
					const open = expanded.has(rowKey);
					return (
						<li
							key={i}
							data-row={rowKey}
							className={[
								'row',
								hidden && 'hidden',
								selected === rowKey && 'selected',
								dropAt === i && dragFrom !== undefined && (dragFrom < i ? 'drop-below' : 'drop-above'),
							]
								.filter(Boolean)
								.join(' ')}
							onDragOver={e => {
								if (dragFrom === undefined) return;
								e.preventDefault();
								setDropAt(i);
							}}
							onDrop={e => {
								e.preventDefault();
								if (dragFrom !== undefined) move(dragFrom, i);
								setDragFrom(undefined);
								setDropAt(undefined);
							}}>
							<div className="row-head">
								<span
									className="grip"
									draggable
									title="Drag to reorder"
									onDragStart={e => {
										e.dataTransfer.effectAllowed = 'move';
										e.dataTransfer.setData('text/plain', rowKey);
										setDragFrom(i);
									}}
									onDragEnd={() => {
										setDragFrom(undefined);
										setDropAt(undefined);
									}}>
									<Icon name="grip" />
								</span>
								<button type="button" className="icon-btn chevron" onClick={() => toggle(rowKey)} title={open ? 'Collapse' : 'Edit'}>
									<Icon name={open ? 'down' : 'right'} />
								</button>
								<span className="index">{i + 1}</span>
								<div
									className="summary"
									tabIndex={0}
									onClick={() => reveal(rowPath)}
									onDoubleClick={() => toggle(rowKey)}
									onKeyDown={e => {
										if (e.altKey && e.key === 'ArrowUp') move(i, i - 1);
										else if (e.altKey && e.key === 'ArrowDown') move(i, i + 1);
										else if (e.key === 'Enter' || e.key === ' ') toggle(rowKey);
										else return;
										e.preventDefault();
									}}>
									<div className="summary-main">
										{ctx.isPrepull ? <DoAt json={row.doAtValue} /> : null}
										<ActionText json={row.action} />
									</div>
									{isObject(row.action) && row.action.condition !== undefined ? (
										<div className="summary-cond">
											<span className="op">if</span> <ValueText json={row.action.condition} />
										</div>
									) : null}
									{typeof row.notes === 'string' && row.notes ? <div className="summary-notes">{row.notes}</div> : null}
								</div>
								<span className="row-buttons">
									<button
										type="button"
										className="icon-btn"
										title={hidden ? 'Show (the sim runs it)' : 'Hide (the sim skips it)'}
										onClick={() => edit({ op: 'set', path: [...rowPath, 'hide'], value: hidden ? undefined : true })}>
										<Icon name={hidden ? 'eyeOff' : 'eye'} />
									</button>
									<button
										type="button"
										className="icon-btn"
										title="Duplicate"
										onClick={() => edit({ op: 'insert', path, index: i + 1, value: item })}>
										<Icon name="copy" />
									</button>
									<button
										type="button"
										className="icon-btn"
										title="Delete"
										onClick={() => edit({ op: 'set', path: rowPath, value: undefined })}>
										<Icon name="trash" />
									</button>
								</span>
							</div>
							{open ? (
								<div className="row-body">
									{ctx.isPrepull ? (
										<div className="field wide">
											<label title="When to do it; a negative time before the pull">Do at</label>
											<div className="field-input">
												<ValueEditor json={row.doAtValue} path={[...rowPath, 'doAtValue']} ctx={{ ...ctx, isPrepull: false }} />
											</div>
										</div>
									) : null}
									<ActionEditor json={row.action} path={[...rowPath, 'action']} ctx={ctx} />
									{ctx.isPrepull ? null : (
										<div className="field wide">
											<label>Notes</label>
											<div className="field-input">
												<CommitInput
													value={typeof row.notes === 'string' ? row.notes : ''}
													placeholder="A note for the reader"
													onCommit={v => edit({ op: 'set', path: [...rowPath, 'notes'], value: v || undefined })}
												/>
											</div>
										</div>
									)}
								</div>
							) : null}
						</li>
					);
				})}
			</ol>
			<KindPicker family="action" isPrepull={ctx.isPrepull} isGroup={ctx.isGroup} onPick={add} trigger={<span className="add">+ Add action</span>} />
		</section>
	);
}

function Variables({ path, variables, ctx, title }: { path: JsonPath; variables: Json[]; ctx: ListContext; title: string }) {
	const { edit, reveal } = useEditor();
	return (
		<div className="variables">
			<h3>{title}</h3>
			{variables.map((variable, i) => {
				const v = isObject(variable) ? variable : {};
				return (
					<div className="variable" key={i} data-row={key([...path, i])}>
						<span className="var-name" onClick={() => reveal([...path, i])}>
							$<CommitInput value={String(v.name ?? '')} onCommit={name => edit({ op: 'set', path: [...path, i, 'name'], value: name })} />
						</span>
						<span className="op">=</span>
						<ValueEditor json={v.value} path={[...path, i, 'value']} ctx={ctx} />
						<button type="button" className="icon-btn" title="Delete" onClick={() => edit({ op: 'set', path: [...path, i], value: undefined })}>
							<Icon name="trash" />
						</button>
					</div>
				);
			})}
			<button
				type="button"
				className="add"
				onClick={() =>
					edit({ op: 'insert', path, index: variables.length, value: { name: `var${variables.length + 1}`, value: { const: { val: '0' } } } })
				}>
				+ variable
			</button>
		</div>
	);
}

function RegisteredBadge() {
	const registered = useContext(RegisteredContext);
	if (registered.status === 'loading') return <span className="badge muted">loading the spells the sim registers…</span>;
	if (registered.status === 'unavailable')
		return (
			<span className="badge" title={registered.reason}>
				every spell offered: {registered.reason}
			</span>
		);
	return <span className="badge muted">spells registered for {registered.spec}</span>;
}

function App({ db, fileName, text, version }: { db: AplDatabase; fileName: string; text: string; version: number }) {
	const [cursor, setCursor] = useState<JsonPath>([]);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const lastGood = useRef<JsonObject>({});

	let parsed: JsonObject = lastGood.current;
	let error: string | undefined;
	try {
		const json = JSON.parse(text) as Json;
		parsed = isObject(json) ? json : {};
		lastGood.current = parsed;
	} catch (e) {
		error = (e as Error).message;
	}

	useEffect(() => {
		const onMessage = (event: MessageEvent<ToPanel>) => {
			if (event.data.type === 'cursor') setCursor(event.data.path);
		};
		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	}, []);

	const groups = Array.isArray(parsed.groups) ? parsed.groups.filter(isObject) : [];
	const variables = Array.isArray(parsed.valueVariables) ? parsed.valueVariables : [];

	const api: EditorApi = useMemo(
		() => ({
			edit: (...edits: AplEdit[]) => vscode.postMessage({ type: 'edit', version, edits }),
			reveal: path => vscode.postMessage({ type: 'reveal', path }),
			groupNames: groups.map(g => String(g.name ?? '')),
			variableNames: variables.filter(isObject).map(v => String(v.name ?? '')),
			usedIds: [...collectIds(parsed, new Set())],
			groupVariables: Object.fromEntries(
				groups.map(g => [String(g.name ?? ''), (Array.isArray(g.variables) ? g.variables : []).filter(isObject).map(v => String(v.name ?? ''))]),
			),
		}),
		[version, parsed],
	);

	// The row the text cursor is in: a list item is its list, its index, and for a group's list two more steps.
	const selected = useMemo(() => {
		const rowLength = cursor[0] === 'groups' ? 4 : 2;
		return cursor.length >= rowLength ? key(cursor.slice(0, rowLength)) : undefined;
	}, [cursor]);

	useEffect(() => {
		if (selected) document.querySelector(`[data-row="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	}, [selected]);

	const toggle = useCallback((rowKey: string) => {
		setExpanded(current => {
			const next = new Set(current);
			if (!next.delete(rowKey)) next.add(rowKey);
			return next;
		});
	}, []);

	// After a move, an open row stays open where it lands and its neighbours shift with it.
	const remapExpanded = useCallback((path: JsonPath, from: number, to: number) => {
		const prefix = `${key(path)}/`;
		setExpanded(current => {
			const next = new Set<string>();
			for (const rowKey of current) {
				if (!rowKey.startsWith(prefix)) {
					next.add(rowKey);
					continue;
				}
				const [head, ...rest] = rowKey.slice(prefix.length).split('/');
				const i = Number(head);
				const j = i === from ? to : from < to && i > from && i <= to ? i - 1 : from > to && i >= to && i < from ? i + 1 : i;
				next.add([`${prefix}${j}`, ...rest].join('/'));
			}
			return next;
		});
	}, []);

	const type = typeof parsed.type === 'string' ? parsed.type : 'TypeUnknown';
	const listProps = { selected, expanded, toggle, remapExpanded };

	return (
		<DbContext.Provider value={db}>
			<EditorContext.Provider value={api}>
				<datalist id="apl-group-names">
					{api.groupNames.map(name => (
						<option key={name} value={name} />
					))}
				</datalist>
				<datalist id="apl-variable-names">
					{api.variableNames.map(name => (
						<option key={name} value={name} />
					))}
				</datalist>
				<header>
					<h1>{fileName}</h1>
					<RegisteredBadge />
					{type !== 'TypeAPL' ? <span className="badge">{type}: the sim only runs the lists below for TypeAPL</span> : null}
				</header>
				{error ? <div className="error">The JSON does not parse ({error}); showing it as it last parsed, and edits wait until it does.</div> : null}
				<fieldset disabled={!!error}>
					<ItemList
						title="Prepull"
						path={['prepullActions']}
						items={Array.isArray(parsed.prepullActions) ? parsed.prepullActions : []}
						ctx={{ isPrepull: true, isGroup: false }}
						{...listProps}
					/>
					<ItemList
						title="Priority list"
						path={['priorityList']}
						items={Array.isArray(parsed.priorityList) ? parsed.priorityList : []}
						ctx={{ isPrepull: false, isGroup: false }}
						{...listProps}
					/>
					<section>
						<h2>
							Groups <span className="count">{groups.length}</span>
						</h2>
						{groups.map((group, g) => (
							<div className="group" key={g}>
								<div className="group-head">
									<CommitInput
										className="group-name"
										value={String(group.name ?? '')}
										onCommit={name => api.edit({ op: 'set', path: ['groups', g, 'name'], value: name })}
									/>
									<button type="button" className="icon-btn" title="Jump to the JSON" onClick={() => api.reveal(['groups', g])}>
										<Icon name="jump" />
									</button>
									<button
										type="button"
										className="icon-btn"
										title="Delete the group"
										onClick={() => api.edit({ op: 'set', path: ['groups', g], value: undefined })}>
										<Icon name="trash" />
									</button>
								</div>
								{Array.isArray(group.variables) && group.variables.length > 0 ? (
									<Variables
										title="Placeholders"
										path={['groups', g, 'variables']}
										variables={group.variables}
										ctx={{ isPrepull: false, isGroup: true }}
									/>
								) : null}
								<ItemList
									title="Actions"
									path={['groups', g, 'actions']}
									items={Array.isArray(group.actions) ? group.actions : []}
									ctx={{ isPrepull: false, isGroup: true }}
									{...listProps}
								/>
							</div>
						))}
						<button
							type="button"
							className="add"
							onClick={() =>
								api.edit({ op: 'insert', path: ['groups'], index: groups.length, value: { name: `Group ${groups.length + 1}`, actions: [] } })
							}>
							+ group
						</button>
					</section>
					<section>
						<Variables title="Variables" path={['valueVariables']} variables={variables} ctx={{ isPrepull: false, isGroup: false }} />
					</section>
				</fieldset>
			</EditorContext.Provider>
		</DbContext.Provider>
	);
}

function Root() {
	const [init, setInit] = useState<Extract<ToPanel, { type: 'init' }>>();
	const [doc, setDoc] = useState<{ text: string; version: number }>();
	const [registered, setRegistered] = useState<Registered>({ status: 'loading' });

	useEffect(() => {
		const onMessage = (event: MessageEvent<ToPanel>) => {
			const message = event.data;
			if (message.type === 'init') {
				setClassName(message.className);
				vscode.setState({ uri: message.uri });
				setInit(message);
			} else if (message.type === 'text') {
				setDoc({ text: message.text, version: message.version });
			} else if (message.type === 'registered') {
				setRegistered(message.registered);
			}
		};
		window.addEventListener('message', onMessage);
		vscode.postMessage({ type: 'ready' });
		return () => window.removeEventListener('message', onMessage);
	}, []);

	// The game files' names fill in the spells the UI database has no entry for, with no icon.
	const db = useMemo(() => {
		if (!init || registered.status !== 'ready') return init?.db;
		const named = Object.fromEntries(Object.entries(registered.registered.names).map(([id, name]): [string, Named] => [id, [name, '']]));
		return { ...init.db, spells: { ...named, ...init.db.spells } };
	}, [init, registered]);

	if (!init || !doc || !db) {
		return <div className="loading">Loading…</div>;
	}
	return (
		<RegisteredContext.Provider value={registered}>
			<App db={db} fileName={init.fileName} text={doc.text} version={doc.version} />
		</RegisteredContext.Provider>
	);
}

createRoot(document.getElementById('root')!).render(<Root />);
