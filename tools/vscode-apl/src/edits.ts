import { findNodeAtLocation, getLocation, parseTree, type JSONPath, type Node } from 'jsonc-parser';

// An edit the panel asks for, addressed by the JSON path of what it changes.
export type AplEdit =
	| { op: 'set'; path: JSONPath; value: unknown } // `undefined` removes the property or element.
	| { op: 'insert'; path: JSONPath; index: number; value: unknown } // `path` names the array.
	| { op: 'move'; path: JSONPath; from: number; to: number }; // Within one array; `to` is the index the element ends at.

// The one-line spelling oxfmt keeps: spaces inside braces and after colons and commas. oxfmt wraps it
// where it runs past the line width.
export function compactJson(value: unknown): string {
	if (Array.isArray(value)) {
		return value.length === 0 ? '[]' : `[${value.map(compactJson).join(', ')}]`;
	}
	if (value !== null && typeof value === 'object') {
		const entries = Object.entries(value).filter(([, v]) => v !== undefined);
		return entries.length === 0 ? '{}' : `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${compactJson(v)}`).join(', ')} }`;
	}
	return JSON.stringify(value);
}

function splice(text: string, start: number, end: number, insert: string): string {
	return text.slice(0, start) + insert + text.slice(end);
}

function nodeAt(text: string, path: JSONPath): Node | undefined {
	const root = parseTree(text);
	return root && findNodeAtLocation(root, path);
}

// An object's members are its property nodes, an array's its element nodes.
function members(container: Node): Node[] {
	return container.children ?? [];
}

// What separates this container's members after the comma, so an inserted member is laid out like its
// neighbours: a line break and indent in an expanded list, one space in a compact one.
function separator(text: string, container: Node): string {
	const items = members(container);
	if (items.length >= 2) {
		return text.slice(text.indexOf(',', items[0].offset + items[0].length) + 1, items[1].offset);
	}
	if (items.length === 1) {
		return text.slice(container.offset + 1, items[0].offset) || ' ';
	}
	return ' ';
}

function insertMember(text: string, container: Node, index: number, raw: string): string {
	const items = members(container);
	if (items.length === 0) {
		const open = container.offset + 1;
		const close = container.offset + container.length - 1;
		return splice(text, open, close, container.type === 'object' ? ` ${raw} ` : raw);
	}
	const sep = separator(text, container);
	if (index < items.length) {
		return splice(text, items[index].offset, items[index].offset, `${raw},${sep}`);
	}
	const last = items[items.length - 1];
	return splice(text, last.offset + last.length, last.offset + last.length, `,${sep}${raw}`);
}

function removeMember(text: string, container: Node, member: Node): string {
	const items = members(container);
	const i = items.indexOf(member);
	if (items.length === 1) {
		return splice(text, container.offset + 1, container.offset + container.length - 1, '');
	}
	if (i > 0) {
		const before = items[i - 1];
		return splice(text, before.offset + before.length, member.offset + member.length, '');
	}
	return splice(text, member.offset, items[i + 1].offset, '');
}

// The member node that holds what `path` names: the property node for an object key, the element itself for an index.
function memberAt(text: string, path: JSONPath): { container: Node; member: Node } | undefined {
	const node = nodeAt(text, path);
	if (!node?.parent) {
		return undefined;
	}
	const member = node.parent.type === 'property' ? node.parent : node;
	return member.parent && { container: member.parent, member };
}

function set(text: string, path: JSONPath, value: unknown): string {
	if (value === undefined) {
		const found = memberAt(text, path);
		return found ? removeMember(text, found.container, found.member) : text;
	}
	const node = nodeAt(text, path);
	if (node) {
		return splice(text, node.offset, node.offset + node.length, compactJson(value));
	}
	// The deepest object on the path that exists takes the rest of the path as nested objects.
	for (let depth = path.length - 1; depth >= 0; depth--) {
		const container = nodeAt(text, path.slice(0, depth));
		if (container?.type !== 'object') {
			continue;
		}
		const nested = path.slice(depth + 1).reduceRight<unknown>((inner, key) => ({ [key]: inner }), value);
		return insertMember(text, container, members(container).length, `${JSON.stringify(path[depth])}: ${compactJson(nested)}`);
	}
	return text;
}

function applyOne(text: string, edit: AplEdit): string {
	switch (edit.op) {
		case 'set':
			return set(text, edit.path, edit.value);
		case 'insert': {
			const array = nodeAt(text, edit.path);
			if (!array) {
				return set(text, edit.path, [edit.value]);
			}
			return array.type === 'array' ? insertMember(text, array, edit.index, compactJson(edit.value)) : text;
		}
		case 'move': {
			const array = nodeAt(text, edit.path);
			const member = array?.type === 'array' ? members(array)[edit.from] : undefined;
			if (!array || !member || edit.from === edit.to) {
				return text;
			}
			// The element keeps its own text, line breaks and all, since it stays in the same array.
			const raw = text.slice(member.offset, member.offset + member.length);
			const removed = removeMember(text, array, member);
			return insertMember(removed, nodeAt(removed, edit.path)!, edit.to, raw);
		}
	}
}

export function applyAplEdits(text: string, edits: ReadonlyArray<AplEdit>): string {
	return edits.reduce(applyOne, text);
}

// The smallest single replacement that turns `before` into `after`, so the editor keeps the cursor and
// folding outside it and undo restores it in one step.
export function minimalReplace(before: string, after: string): { start: number; end: number; text: string } | undefined {
	if (before === after) {
		return undefined;
	}
	let start = 0;
	while (start < before.length && start < after.length && before[start] === after[start]) {
		start++;
	}
	let tail = 0;
	while (tail < before.length - start && tail < after.length - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) {
		tail++;
	}
	return { start, end: before.length - tail, text: after.slice(start, after.length - tail) };
}

export function rangeOf(text: string, path: JSONPath): { start: number; end: number } | undefined {
	const node = nodeAt(text, path);
	return node && { start: node.offset, end: node.offset + node.length };
}

export function pathAt(text: string, offset: number): JSONPath {
	return getLocation(text, offset).path;
}
