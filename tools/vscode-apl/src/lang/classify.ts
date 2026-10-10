import type { Parsed } from './document.ts';
import {
	type ActionNode,
	type Args,
	type Expr,
	type KindForm,
	type Name,
	type Range,
	type RefUse,
	type SchemaField,
	type SectionDef,
	sectionFields,
	type Statement,
	type Step,
	type Term,
	unitReference,
} from './siml.ts';
import { sectionsByStatement } from './tree.ts';

// What a word of the file is, read off the syntax tree with the schema: the base of hover and semantic tokens.
export type Role =
	| { role: 'section'; section: string }
	| { role: 'spec'; spec: string }
	| { role: 'field'; field: SchemaField }
	| { role: 'kind'; kind: KindForm }
	| { role: 'head'; head: string }
	| { role: 'prop'; kind: KindForm }
	| { role: 'unit'; word: string }
	| { role: 'enum'; word: string }
	| { role: 'slot'; word: string }
	| { role: 'name'; ref: RefUse }
	| { role: 'variable'; declaration: boolean }
	| { role: 'placeholder' };

export type Span = Role & { range: Range };

export function classify(p: Parsed): Span[] {
	const { index } = p.ws;
	const out: Span[] = [];
	const refs = new Map(p.parse.refs.map(r => [r.range.start.offset, r]));
	const sections = sectionsByStatement(p.parse.tree);
	const push = (range: Range, role: Role): void => {
		out.push({ ...role, range } as Span);
	};
	const name = (n: Name, role: Role): void => push(n.range, role);

	const kindMessageField = (message: string, written: string) => index.field(message, written);

	const args = (a: Args | undefined, message: string | undefined, kind: KindForm | undefined) => {
		if (!a) return;
		const fields = message ? index.fields(message) : [];
		const list = kind?.listField ? fields.find(f => f.name === kind.listField) : undefined;
		const positional = list ?? (kind?.positional && message ? index.protoField(message, kind.positional) : undefined);
		for (const arg of a.items) {
			const field = arg.name && message ? kindMessageField(message, arg.name.text) : positional;
			if (arg.name && field) name(arg.name, { role: 'field', field });
			term(arg.value, field, message);
		}
	};

	const term = (t: Term, field: SchemaField | undefined, message: string | undefined) => {
		if (t.type === 'action') return action(t);
		if (t.type === 'list') {
			for (const item of t.items) term(item, field, message);
			return;
		}
		// A bare word naming a bool field of the message sets it.
		if (t.type === 'call' && !t.args && message && kindMessageField(message, t.name.text)?.printed === 'bool') {
			return name(t.name, { role: 'field', field: kindMessageField(message, t.name.text)! });
		}
		// A message value is written `field(...)` with the field's own name.
		if (t.type === 'call' && message && field && (field.printed === 'message' || field.printed === 'indexed') && t.args) {
			const own = kindMessageField(message, t.name.text);
			if (own) {
				name(t.name, { role: 'field', field: own });
				if (own.printed === 'indexed') {
					for (const arg of t.args.items) if (arg.name) name(arg.name, { role: 'enum', word: arg.name.text });
				} else {
					args(t.args, own.type, undefined);
				}
				return;
			}
		}
		expr(t);
	};

	const expr = (e: Expr): void => {
		switch (e.type) {
			case 'var':
				return push(e.range, { role: 'variable', declaration: false });
			case 'placeholder':
				return push(e.range, { role: 'placeholder' });
			case 'paren':
				return expr(e.expr);
			case 'not':
				return expr(e.operand);
			case 'and':
			case 'or':
				for (const o of e.operands) expr(o);
				return;
			case 'compare':
			case 'math':
				expr(e.left);
				return expr(e.right);
			case 'member': {
				const ref = refs.get(e.name.range.start.offset);
				if (ref) return name(e.name, { role: 'name', ref });
				if (e.object.text === 'other') return name(e.name, { role: 'enum', word: e.name.text });
				if (unitReference(index, e.object.text)) name(e.object, { role: 'unit', word: e.object.text });
				const kind = index.valueKinds.get(e.name.text);
				if (kind) name(e.name, { role: 'kind', kind });
				return;
			}
			case 'accessor': {
				if (e.unit) name(e.unit, { role: 'unit', word: e.unit.text });
				name(e.head, { role: 'head', head: e.head.text });
				term(e.subject, undefined, undefined);
				const kind = index.accessors.get(`${e.head.text}.${e.prop.text}`);
				if (kind) name(e.prop, { role: 'prop', kind });
				return args(e.args, kind?.message, kind);
			}
			case 'call':
				return call(e, false);
		}
	};

	const call = (e: Extract<Expr, { type: 'call' }>, action: boolean) => {
		const ref = refs.get(e.name.range.start.offset);
		if (ref) return name(e.name, { role: 'name', ref });
		const kind = (action ? index.actionKinds : index.valueKinds).get(e.name.text) ?? index.valueKinds.get(e.name.text);
		if (kind) {
			name(e.name, { role: 'kind', kind });
			return args(e.args, kind.message, kind);
		}
		if (unitReference(index, e.name.text)) return name(e.name, { role: 'unit', word: e.name.text });
		if (!e.args) name(e.name, { role: 'enum', word: e.name.text });
	};

	const step = (s: Step): void => {
		switch (s.type) {
			case 'cast':
			case 'channel':
				expr(s.spell);
				if (s.target) expr(s.target);
				if (s.type === 'channel' && s.until) expr(s.until);
				return;
			case 'wait':
			case 'wait_until':
			case 'move':
			case 'move_for':
				return expr(s.value);
			case 'group':
				for (const bind of s.with) {
					push(bind.placeholder.range, { role: 'placeholder' });
					expr(bind.value);
				}
				return;
			case 'schedule':
				return step(s.step);
			case 'sequence':
				for (const a of s.actions) action(a);
				return;
			case 'call':
				return call(s, true);
		}
	};

	const action = (a: ActionNode) => {
		step(a.step);
		if (a.condition) expr(a.condition);
	};

	const entryField = (def: SectionDef | undefined, written: string) =>
		def && sectionFields(index, def, p.spec).find(pl => pl.field.siml === written || pl.field.aliases.includes(written))?.field;

	const statement = (s: Statement, def: SectionDef | undefined): void => {
		switch (s.type) {
			case 'header':
				if (!s.group) name(s.name, { role: 'section', section: s.name.text });
				if (s.body) statement(s.body, index.sections.get(s.name.text));
				return;
			case 'spec':
				return name(s.spec, { role: 'spec', spec: s.spec.text });
			case 'use':
				for (const bind of s.with) {
					push(bind.variable.range, { role: 'variable', declaration: false });
					expr(bind.value);
				}
				return;
			case 'var':
				push(s.variable.range, { role: 'variable', declaration: true });
				return expr(s.value);
			case 'row':
				if (s.doAt) expr(s.doAt);
				return action(s.action);
			case 'slot_row':
				name(s.slot, { role: 'slot', word: s.slot.text });
				for (const part of [s.item, s.suffix, s.enchant]) {
					const ref = part && 'text' in part ? refs.get(part.range.start.offset) : undefined;
					if (ref) push(ref.range, { role: 'name', ref });
				}
				return;
			case 'field_entry': {
				const field = entryField(def, s.name.text);
				if (field) name(s.name, { role: 'field', field });
				for (const v of s.values) term(v, field, undefined);
				return;
			}
			case 'flag_list':
				for (const flag of s.flags) {
					const field = entryField(def, flag.name.text);
					if (field) name(flag.name, { role: 'field', field });
					if (flag.value) term(flag.value, field, undefined);
				}
				return;
			case 'message_entry': {
				const field = entryField(def, s.name.text);
				if (!field) return;
				name(s.name, { role: 'field', field });
				if (field.printed === 'indexed') {
					for (const arg of s.args.items) if (arg.name) name(arg.name, { role: 'enum', word: arg.name.text });
				} else {
					args(s.args, field.type, undefined);
				}
				return;
			}
		}
	};

	for (const s of p.parse.tree.statements) {
		const section = sections.get(s);
		statement(s, section ? index.sections.get(section.name) : undefined);
	}
	return out.sort((a, b) => a.range.start.offset - b.range.start.offset);
}

// The innermost span at an offset.
export function spanAt(spans: Span[], offset: number): Span | undefined {
	let best: Span | undefined;
	for (const s of spans) {
		if (
			s.range.start.offset <= offset &&
			offset <= s.range.end.offset &&
			(!best || s.range.end.offset - s.range.start.offset < best.range.end.offset - best.range.start.offset)
		)
			best = s;
	}
	return best;
}
