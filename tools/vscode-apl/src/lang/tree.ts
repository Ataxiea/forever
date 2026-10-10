import type { Range, Section, Statement, SyntaxTree } from './siml.ts';

// A node of the syntax tree as the walk sees it: any object with a range. Statements, expressions, steps and
// actions carry a `type`; names, arguments and flags do not.
export interface TreeNode {
	type?: string;
	range: Range;
	[key: string]: unknown;
}

// The keys that hold no child node: the trivia around a statement.
const TRIVIA = new Set(['leading', 'inner', 'notes']);

function isNode(value: unknown): value is TreeNode {
	return typeof value === 'object' && value !== null && !Array.isArray(value) && 'range' in value;
}

// Visits every node under `root`, parents before children, with the node that holds it.
export function walk(root: unknown, visit: (node: TreeNode, parent: TreeNode | undefined) => void, parent?: TreeNode): void {
	if (Array.isArray(root)) {
		for (const item of root) walk(item, visit, parent);
		return;
	}
	if (!isNode(root)) return;
	visit(root, parent);
	for (const [key, value] of Object.entries(root)) {
		if (key === 'range' || TRIVIA.has(key)) continue;
		if (typeof value === 'object' && value !== null) walk(value, visit, root);
	}
}

// The section each statement belongs to; a header belongs to its own section.
export function sectionsByStatement(tree: SyntaxTree): Map<Statement, Section> {
	const out = new Map<Statement, Section>();
	for (const section of tree.sections) {
		if (section.header) out.set(section.header, section);
		for (const statement of section.body) out.set(statement, section);
	}
	return out;
}
