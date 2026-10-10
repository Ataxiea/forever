import { type CodeAction, CodeActionKind, type Diagnostic, type Range as LspRange, type TextEdit } from 'vscode-languageserver-types';

import { SOURCE } from './diagnostics.ts';
import { lspRange, offsetAt, type Parsed } from './document.ts';
import type { Expr } from './siml.ts';
import { type TreeNode, walk } from './tree.ts';

const WORD = /^[A-Za-z_][A-Za-z0-9_]*$/;
// The end of a parser message that names the closest candidates to a word it does not know.
const DID_YOU_MEAN = /; did you mean ([^?]+)\?/;

// The code actions at a range. A word the parser does not know changes to one of the candidates its diagnostic names.
// The rewrites of a rotation's conditions each change the proto, so none is made without asking (SPEC.md §16.2): an
// `and` or `or` of one operand is that operand, and an `and` inside an `and`, or an `or` inside an `or`, is one list.
export function codeActions(p: Parsed, uri: string, range: LspRange, diagnostics: Diagnostic[]): CodeAction[] {
	const from = offsetAt(p, range.start);
	const to = offsetAt(p, range.end);
	const out: CodeAction[] = [];
	for (const d of diagnostics) {
		const candidates = d.source === SOURCE && typeof d.message === 'string' ? DID_YOU_MEAN.exec(d.message)?.[1].split(', ') : undefined;
		if (!candidates || !WORD.test(p.text.slice(offsetAt(p, d.range.start), offsetAt(p, d.range.end)))) continue;
		candidates.forEach((candidate, i) =>
			out.push({
				title: `Change to ${candidate}`,
				kind: CodeActionKind.QuickFix,
				diagnostics: [d],
				isPreferred: i === 0,
				edit: { changes: { [uri]: [{ range: d.range, newText: candidate }] } },
			}),
		);
	}
	const text = (node: { range: { start: { offset: number }; end: { offset: number } } }) => p.text.slice(node.range.start.offset, node.range.end.offset);
	const action = (title: string, node: TreeNode, newText: string) =>
		out.push({ title, kind: CodeActionKind.RefactorRewrite, edit: { changes: { [uri]: [{ range: lspRange(node.range), newText } satisfies TextEdit] } } });

	walk(p.parse.tree.statements, (node, parent) => {
		if (node.range.end.offset < from || node.range.start.offset > to) return;
		const e = node as unknown as Expr;
		if (e.type === 'call' && (e.name.text === 'and' || e.name.text === 'or') && e.args) {
			const operands = e.args.items;
			if (operands.some(a => a.name)) return;
			if (operands.length === 1) {
				const operand = operands[0].value as Expr;
				action(
					`Write ${e.name.text}(…) of one operand as the operand`,
					node,
					parenthesized(operand.type, parent?.type) ? `(${text(operand)})` : text(operand),
				);
			} else if (operands.length > 1 && parent?.type === e.name.text) {
				const joined = operands.map(a => ((a.value as Expr).type === 'or' ? `(${text(a.value)})` : text(a.value))).join(` ${e.name.text} `);
				action(`Join this ${e.name.text}(…) into the ${e.name.text} around it`, node, joined);
			}
		}
		if (e.type === 'paren' && (e.expr.type === 'and' || e.expr.type === 'or') && parent?.type === e.expr.type) {
			action(`Join this ${e.expr.type} into the ${e.expr.type} around it`, node, text(e.expr));
		}
	});
	return out;
}

// Whether an expression of type `inner` needs parentheses to stand where a call stood inside one of type `outer`
// (SPEC.md §6.5): to keep an `and` in an `and` (or an `or` in an `or`) apart, and where it binds looser.
function parenthesized(inner: string, outer: string | undefined): boolean {
	const looseness: Record<string, number> = { or: 4, and: 3, not: 2, compare: 1, math: 0 };
	if (!(inner in looseness) || outer === undefined || !(outer in looseness)) return false;
	if (outer === 'math' || inner === outer) return true;
	return looseness[inner] > looseness[outer] || (outer === 'compare' && inner === 'compare');
}
