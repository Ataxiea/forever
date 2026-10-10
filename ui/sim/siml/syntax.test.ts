import { describe, expect, it } from 'vitest';

import { indexSchema } from './schema.ts';
import { kindOf, parseSyntax } from './syntax.ts';
import { specExamples } from './test_examples.ts';
import { testSchema } from './test_schema.ts';
import type { Args, RowStatement, Section, SimlKind, Statement, Step, Term, VarStatement } from './types.ts';

const index = indexSchema(testSchema);
const parse = (text: string, kind: SimlKind = {}) => parseSyntax(text, index, kind);

// Diagnostics as LINE:COL code, the form the corpus's .diag files use.
const diags = (text: string, kind: SimlKind = {}) =>
	parse(text, kind).diagnostics.map(d => `${d.range.start.line + 1}:${d.range.start.character + 1} ${d.code}`);

// A node as a compact S-expression, so a test states a tree's shape in one line.
function show(n: Term | Step): string {
	const args = (a: Args | undefined) => (a ? `(${a.items.map(x => (x.name ? `${x.name.text}=` : '') + show(x.value)).join(', ')})` : '');
	switch (n.type) {
		case 'literal':
			return n.text;
		case 'string':
			return JSON.stringify(n.value);
		case 'bool':
			return String(n.value);
		case 'none':
			return 'none';
		case 'var':
			return n.braced ? `\${${n.name}}` : `$${n.name}`;
		case 'placeholder':
			return n.braced ? `%{${n.name}}` : `%${n.name}`;
		case 'raw':
			return `raw ${JSON.stringify(n.json)}`;
		case 'paren':
			return `(paren ${show(n.expr)})`;
		case 'not':
			return `(not ${show(n.operand)})`;
		case 'and':
		case 'or':
			return `(${n.type} ${n.operands.map(show).join(' ')})`;
		case 'compare':
		case 'math':
			return `(${n.op} ${show(n.left)} ${show(n.right)})`;
		case 'call':
			return n.name.text + args(n.args);
		case 'member':
			return `${n.object.text}.${n.name.text}`;
		case 'accessor':
			return `${n.unit ? `${n.unit.text}.` : ''}${n.head.text}[${show(n.subject)}].${n.prop.text}${args(n.args)}`;
		case 'list':
			return `[${n.items.map(show).join(', ')}]`;
		case 'action':
			return n.condition ? `{${show(n.step)} if ${show(n.condition)}}` : `{${show(n.step)}}`;
		case 'cast':
			return `(cast ${show(n.spell)}${n.target ? ` on ${show(n.target)}` : ''})`;
		case 'channel':
			return `(channel ${show(n.spell)}${n.target ? ` on ${show(n.target)}` : ''}${n.until ? ` until ${show(n.until)}` : ''}${n.recast ? ' recast' : ''})`;
		case 'wait':
		case 'wait_until':
		case 'move':
		case 'move_for':
			return `(${n.type} ${show(n.value)})`;
		case 'group':
			return `(group ${JSON.stringify(n.name.value)}${n.with.map(w => ` ${show(w.placeholder)}=${show(w.value)}`).join('')})`;
		case 'schedule':
			return `(schedule ${JSON.stringify(n.schedule.value)} ${show(n.step)})`;
		case 'sequence':
			return `(sequence ${JSON.stringify(n.name.value)} ${n.actions.map(show).join(' ')})`;
	}
}

// The value of `var $x = <text>` in a full file.
function expr(text: string): string {
	const { tree, diagnostics } = parse(`siml 1\nvar $x = ${text}\n`);
	expect(diagnostics).toEqual([]);
	return show((tree.top[1] as VarStatement).value!);
}

// The first statement under `<section>:` in a full file.
function first(text: string, section = 'priority'): Statement {
	const { tree, diagnostics } = parse(`siml 1\n${section}:\n  ${text}\n`);
	expect(diagnostics).toEqual([]);
	return tree.sections[0].body[0];
}

function row(text: string, section = 'priority'): string {
	const s = first(text, section) as RowStatement;
	expect(s.type).toBe('row');
	return `${s.hide ? '# ' : ''}${s.doAt ? `${show(s.doAt)} ` : ''}${show(s.action)}`;
}

describe('kindOf', () => {
	it('reads the section of a double extension', () => {
		expect(kindOf('ui/specs/hunter/dps/apls/default.apl.siml')).toEqual({ section: 'apl' });
		expect(kindOf('C:\\specs\\p1.gear.siml')).toEqual({ section: 'gear' });
		expect(kindOf('a.b.buffs.siml')).toEqual({ section: 'buffs' });
		expect(kindOf('wowsims.siml')).toEqual({});
		expect(kindOf('')).toEqual({});
		expect(kindOf('rotation.json')).toEqual({});
		expect(kindOf('.apl.siml')).toEqual({});
	});
});

describe('values', () => {
	it('binds or, and, not, comparisons, sums and products loosest first', () => {
		expect(expr('a or b and not c == d + e * f')).toBe('(or a (and b (not (== c (+ d (* e f))))))');
		expect(expr('not a == b')).toBe('(not (== a b))');
		expect(expr('not not a')).toBe('(not (not a))');
	});

	it('keeps and, or, +, -, * and / left-associative, with one node for a run of and or or', () => {
		expect(expr('a - b - c')).toBe('(- (- a b) c)');
		expect(expr('a / b * c')).toBe('(* (/ a b) c)');
		expect(expr('a and b and c or d or e')).toBe('(or (and a b c) d e)');
	});

	it('keeps the parentheses that hold an and inside an and apart', () => {
		expect(expr('(a and b) and c')).toBe('(and (paren (and a b)) c)');
		expect(expr('1s * (($r - $m) / 7)')).toBe('(* 1s (paren (/ (paren (- $r $m)) 7)))');
	});

	it('reads a minus only directly before a number, as part of its literal', () => {
		expect(expr('-1.5s * 2')).toBe('(* -1.5s 2)');
		expect(expr('a - -1')).toBe('(- a -1)');
		expect(expr('a -1')).toBe('(- a 1)');
	});

	it('reads and, or and not directly followed by ( as calls', () => {
		expect(expr('and(x)')).toBe('and(x)');
		expect(expr('or()')).toBe('or()');
		expect(expr('not(a) or b')).toBe('(or not(a) b)');
		expect(expr('not (a)')).toBe('(not (paren a))');
		expect(expr('a and(b)')).toBe('(and a (paren b))');
	});

	it('reads literals, strings, true, false, none, variables, placeholders and raw JSON', () => {
		expect(expr('5.00 + 30% + 1m30s + "text" + true + false + none')).toBe('(+ (+ (+ (+ (+ (+ 5.00 30%) 1m30s) "text") true) false) none)');
		expect(expr('$ranged_range + ${Melee weave} + %p + %{Two words}')).toBe('(+ (+ (+ $ranged_range ${Melee weave}) %p) %{Two words})');
		expect(expr('`{"const": {"val": "1"}}`')).toBe('raw {"const":{"val":"1"}}');
	});

	it('reads accessors, with the unit in front and the arguments on the property', () => {
		expect(expr('target.aura(sunder_armor).num_stacks(include_reaction_time=true) < 5')).toBe(
			'(< target.aura[sunder_armor].num_stacks(include_reaction_time=true) 5)',
		);
		expect(expr('dot(rend).remaining_time')).toBe('dot[rend].remaining_time');
		expect(expr('sequence("HHA").is_complete')).toBe('sequence["HHA"].is_complete');
		expect(expr('boss_spell(`{"spellId": 1}`).is_casting')).toBe('boss_spell[raw {"spellId":1}].is_casting');
	});

	it('reads unit-prefixed kinds and other. as members, and calls with positional and named arguments', () => {
		expect(expr('target.current_health_percent')).toBe('target.current_health_percent');
		expect(expr('selected_potion(other.potion)')).toBe('selected_potion(other.potion)');
		expect(expr('multiple_cd_usages(x, target_spell_id=y, offset=2s)')).toBe('multiple_cd_usages(x, target_spell_id=y, offset=2s)');
		expect(expr('max(input_delay, $t - $m * 2)')).toBe('max(input_delay, (- $t (* $m 2)))');
		expect(expr('current_time')).toBe('current_time');
	});

	it('reads lists and actions as arguments', () => {
		expect(expr('f(timings=[30, 90], [])')).toBe('f(timings=[30, 90], [])');
		expect(expr('strict_sequence(item_swap(swap1), cast shield_wall, wait 1s, f(x) if y)')).toBe(
			'strict_sequence(item_swap(swap1), {(cast shield_wall)}, {(wait 1s)}, {f(x) if y})',
		);
		expect(expr('f(sequence "S" [cast a], schedule("x"))')).toBe('f({(sequence "S" {(cast a)})}, schedule("x"))');
	});
});

describe('rows', () => {
	it('reads every short form of an action', () => {
		expect(row('none')).toBe('{none}');
		expect(row('cast hunters_mark')).toBe('{(cast hunters_mark)}');
		expect(row('cast x on target2')).toBe('{(cast x on target2)}');
		expect(row('cast other.potion')).toBe('{(cast other.potion)}');
		expect(row('cast none on none')).toBe('{(cast none on none)}');
		expect(row('channel x on target until a > 1 recast if b')).toBe('{(channel x on target until (> a 1) recast) if b}');
		expect(row('channel `{"spellId": 5}`')).toBe('{(channel raw {"spellId":5})}');
		expect(row('wait 1s')).toBe('{(wait 1s)}');
		expect(row('wait (1s + 2s) * 2')).toBe('{(wait (* (paren (+ 1s 2s)) 2))}');
		expect(row('wait until a')).toBe('{(wait_until a)}');
		expect(row('move $melee_range')).toBe('{(move $melee_range)}');
		expect(row('move for 2s')).toBe('{(move_for 2s)}');
		expect(row('group "Weave" if $melee_weave')).toBe('{(group "Weave") if $melee_weave}');
		expect(row('group "G" with %p = 1, %{Q r} = $x + 1')).toBe('{(group "G" %p=1 %{Q r}=(+ $x 1))}');
		expect(row('schedule "0s, 60s" cast x on self if y')).toBe('{(schedule "0s, 60s" (cast x on self)) if y}');
		expect(row('sequence "S" [cast a, cast b if c, none]')).toBe('{(sequence "S" {(cast a)} {(cast b) if c} {none})}');
		expect(row('sequence "S" []')).toBe('{(sequence "S" )}');
	});

	it('ends a with list at a comma not followed by %p =', () => {
		expect(row('sequence "S" [group "A" with %p = 1, cast x]')).toBe('{(sequence "S" {(group "A" %p=1)} {(cast x)})}');
	});

	it('reads generic kinds, bare kinds and raw actions', () => {
		expect(row('reset_sequence("HHA") if a')).toBe('{reset_sequence("HHA") if a}');
		expect(row('autocast_other_cooldowns if current_time >= 5s')).toBe('{autocast_other_cooldowns if (>= current_time 5s)}');
		expect(row('cast_all_stat_buff_cooldowns(crit_rating, stat_type2=armor_penetration, stat_type3=-1)')).toBe(
			'{cast_all_stat_buff_cooldowns(crit_rating, stat_type2=armor_penetration, stat_type3=-1)}',
		);
		expect(row('sequence(name="S")')).toBe('{sequence(name="S")}');
		expect(row('`{"castSpell": {}}` if x')).toBe('{raw {"castSpell":{}} if x}');
	});

	it('reads a hidden row, and a prepull row with its time', () => {
		expect(row('# cast x if y')).toBe('# {(cast x) if y}');
		expect(row('-22s cast hunters_mark', 'prepull')).toBe('-22s {(cast hunters_mark)}');
		expect(row('# (1s + $x) group "Move"', 'prepull')).toBe('# (paren (+ 1s $x)) {(group "Move")}');
		expect(row('$t wait 1s', 'prepull')).toBe('$t {(wait 1s)}');
	});
});

describe('statements', () => {
	it('reads the top-level lines', () => {
		const { tree, diagnostics } = parse('siml 1\nspec hunter\ntalents "-0053"\nuse "a.gear.siml"\nuse "default.apl.siml" with $a = true, ${B c} = 1s\n');
		expect(diagnostics).toEqual([]);
		const [version, spec, talents, plain, withVars] = tree.top;
		expect(version.type === 'version' && version.version.text).toBe('1');
		expect(spec.type === 'spec' && spec.spec.text).toBe('hunter');
		expect(talents.type === 'talents' && talents.talents.value).toBe('-0053');
		expect(plain.type === 'use' && [plain.path.value, plain.with]).toEqual(['a.gear.siml', []]);
		expect(withVars.type === 'use' && withVars.with.map(w => `${show(w.variable)}=${show(w.value)}`)).toEqual(['$a=true', '${B c}=1s']);
	});

	it('reads var lines in both forms, and with no value', () => {
		const { tree, diagnostics } = parse('siml 1\nvar $x = 1\nvar ${Melee weave} = `true`\nvar $none\n');
		expect(diagnostics).toEqual([]);
		expect(tree.top.slice(1).map(s => (s.type === 'var' ? `${show(s.variable)}=${s.value && show(s.value)}` : s.type))).toEqual([
			'$x=1',
			'${Melee weave}=raw true',
			'$none=undefined',
		]);
	});

	it('reads the escapes of a braced name', () => {
		const { tree, diagnostics } = parse('siml 1\nvar ${a\\}b\\\\c\\nd} = %{e\\}}\n');
		expect(diagnostics).toEqual([]);
		const v = tree.top[1] as VarStatement;
		expect([v.variable.name, v.value?.type === 'placeholder' && v.value.name]).toEqual(['a}b\\c\nd', 'e}']);
	});

	it('reads headers, with a body line after the colon', () => {
		const { tree, diagnostics } = parse('siml 1\nbuffs: greater_blessing_of_kings\nsim: iterations 25000\ngroup "Weave":\n  none\npriority: none\n');
		expect(diagnostics).toEqual([]);
		expect(tree.sections.map(s => [s.name, s.group, s.body.map(b => b.type)])).toEqual([
			['buffs', undefined, ['flag_list']],
			['sim', undefined, ['field_entry']],
			['group', 'Weave', ['row']],
			['priority', undefined, ['row']],
		]);
		const buffs = tree.sections[0].header!;
		expect(buffs.body).toBe(tree.sections[0].body[0]);
		expect(tree.statements).toHaveLength(6);
	});

	it('reads slot rows in every form', () => {
		const { tree, diagnostics } = parse(
			'siml 1\ngear:\n  head helm + falcons_call\n  finger1 ring of_the_tiger\n  back cloak of_the_tiger + cloak_agility\n  trinket1 `{"id": 1}`\n  ranged bow\n',
		);
		expect(diagnostics).toEqual([]);
		expect(
			tree.sections[0].body.map(s =>
				s.type === 'slot_row' ? [s.slot.text, 'text' in s.item ? s.item.text : show(s.item), s.suffix?.text, s.enchant?.text] : s.type,
			),
		).toEqual([
			['head', 'helm', undefined, 'falcons_call'],
			['finger1', 'ring', 'of_the_tiger', undefined],
			['back', 'cloak', 'of_the_tiger', 'cloak_agility'],
			['trinket1', 'raw {"id":1}', undefined, undefined],
			['ranged', 'bow', undefined, undefined],
		]);
	});

	it('reads entries in a slot-row section when the first word is no slot', () => {
		const s = first('bonus_stats(stats(agility=5))', 'gear');
		expect(s.type === 'message_entry' && show({ type: 'call', name: s.name, args: s.args, range: s.range })).toBe('bonus_stats(stats(agility=5))');
		expect(first('enable_item_swap', 'gear').type).toBe('flag_list');
	});

	it('reads flag lists, field entries, message entries and raw entries', () => {
		const entry = (text: string, section = 'settings') => {
			const s = first(text, section);
			switch (s.type) {
				case 'flag_list':
					return `flags ${s.flags.map(f => f.name.text + (f.value ? `=${show(f.value)}` : '')).join(' ')}`;
				case 'field_entry':
					return `field ${s.name.text} ${s.values.map(show).join(' ')}`;
				case 'message_entry':
					return `message ${show({ type: 'call', name: s.name, args: s.args, range: s.range })}`;
				case 'raw_entry':
					return `raw ${JSON.stringify(s.value.json)}`;
			}
			return s.type;
		};
		expect(entry('cobra_reflexes')).toBe('flags cobra_reflexes');
		expect(entry('use_multi, use_arcane', 'simple')).toBe('flags use_multi use_arcane');
		expect(entry('battle_shout=improved, leader_of_the_pack', 'party_buffs')).toBe('flags battle_shout=improved leader_of_the_pack');
		expect(entry('race orc')).toBe('field race orc');
		expect(entry('distance_from_target 11')).toBe('field distance_from_target 11');
		expect(entry('name "Pre-BiS - Arms"')).toBe('field name "Pre-BiS - Arms"');
		expect(entry('extra goblin_sapper_charge, scroll_of_strength_iv', 'consumables')).toBe('field extra goblin_sapper_charge scroll_of_strength_iv');
		expect(entry('tanks player1')).toBe('field tanks player1');
		expect(entry('targets(id=31146, name="Raid Target", level=63, mob_type=mechanical, stats(armor=3731))', 'encounter')).toBe(
			'message targets(id=31146, name="Raid Target", level=63, mob_type=mechanical, stats(armor=3731))',
		);
		expect(entry('cooldowns(id=death_wish, timings=[30, 90])', 'cooldowns')).toBe('message cooldowns(id=death_wish, timings=[30, 90])');
		expect(entry('`{"race": "RaceOrc"}`')).toBe('raw {"race":"RaceOrc"}');
	});
});

describe('layout', () => {
	const types = (text: string, kind: SimlKind = {}) => parse(text, kind).tree.statements.map(s => s.type);

	it('continues a statement onto lines indented deeper than its first, and not onto others', () => {
		const text = 'siml 1\npriority:\n  cast x\n      if a\n      and b\n  cast y\ncast z\n';
		const { tree, diagnostics } = parse(text);
		expect(diagnostics).toEqual([]);
		expect(tree.sections[0].body.map(s => (s.type === 'row' ? show(s.action) : s.type))).toEqual(['{(cast x) if (and a b)}', '{(cast y)}', '{(cast z)}']);
	});

	it('continues while a bracket is open, whatever the indentation, and past blank lines', () => {
		const { tree, diagnostics } = parse('siml 1\nvar $x = max(\na,\n\n    b\n)\nvar $y = 1\n');
		expect(diagnostics).toEqual([]);
		expect(tree.top.slice(1).map(s => (s.type === 'var' ? show(s.value!) : s.type))).toEqual(['max(a, b)', '1']);
	});

	it('ends an indented continuation at a blank line', () => {
		expect(diags('siml 1\npriority:\n  cast x\n\n      if a\n')).toEqual(['5:7 parse']);
	});

	it('lets comment lines sit inside a continuation without deciding it', () => {
		const { tree, diagnostics } = parse('siml 1\npriority:\n  cast x\n// shallow comment\n      if a\n  cast y\n');
		expect(diagnostics).toEqual([]);
		const [x, y] = tree.sections[0].body;
		expect(x.type === 'row' && show(x.action)).toBe('{(cast x) if a}');
		expect(x.inner.map(t => t.type === 'comment' && t.text)).toEqual([' shallow comment']);
		expect(y.leading).toEqual([]);
	});

	it('never continues a header by indentation', () => {
		expect(types('siml 1\ngroup "Weave":\n    cast x\n')).toEqual(['version', 'header', 'row']);
		expect(types('siml 1\nraid_buffs:\n  arcane_brilliance, gift_of_the_wild\n  prayer_of_fortitude\n')).toEqual([
			'version',
			'header',
			'flag_list',
			'flag_list',
		]);
	});

	it('continues a header while a bracket on its line is open', () => {
		const { tree, diagnostics } = parse('siml 1\nsim: ep_weights_stats(stats(\n  agility=2.1))\n');
		expect(diagnostics).toEqual([]);
		expect(tree.statements.map(s => s.type)).toEqual(['version', 'header']);
		expect(tree.sections[0].body.map(s => s.type)).toEqual(['message_entry']);
	});

	it('starts a statement at a line that starts with a header, however deep', () => {
		expect(types('siml 1\n  priority:\n    cast x\n')).toEqual(['version', 'header', 'row']);
		expect(types('siml 1\npriority:\n  cast x\n    group "G":\n')).toEqual(['version', 'header', 'row', 'header']);
	});

	it('reads an unclosed bracket to the end of the file, as one unclosed-bracket', () => {
		const { tree, diagnostics } = parse('siml 1\npriority:\n  cast x if max(a, (b)\n  cast y\nprepull:\n');
		expect(diagnostics.map(d => `${d.range.start.line + 1}:${d.range.start.character + 1} ${d.code}`)).toEqual(['3:16 unclosed-bracket']);
		expect(tree.statements.map(s => s.type)).toEqual(['version', 'header', 'unparsed']);
	});
});

describe('trivia', () => {
	it('keeps blank, comment and note lines with the statement below, and the rest of the line within its statement', () => {
		const { tree } = parse('// head\nsiml 1\n\n// about x\npriority:\n  cast x // trailing\n\n// end\n');
		const [version, header, x] = tree.statements;
		expect(version.leading.map(t => t.type)).toEqual(['comment']);
		expect(header.leading.map(t => (t.type === 'comment' ? t.text : t.type))).toEqual(['blank', ' about x']);
		expect(x.inner.map(t => (t.type === 'comment' ? t.text : t.type))).toEqual([' trailing']);
		expect(tree.trailing.map(t => (t.type === 'comment' ? t.text : t.type))).toEqual(['blank', ' end']);
	});

	it('makes /// lines directly above a priority or group row its notes', () => {
		const { tree, diagnostics } = parse(
			'siml 1\npriority:\n  /// first line\n  // a comment between\n  ///second\n  cast x\ngroup "G":\n  /// in a group\n  none\n',
		);
		expect(diagnostics).toEqual([]);
		const x = tree.sections[0].body[0] as RowStatement;
		expect(x.notes.map(n => n.text)).toEqual(['first line', 'second']);
		expect(x.leading.map(t => t.type)).toEqual(['comment']);
		expect((tree.sections[1].body[0] as RowStatement).notes.map(n => n.text)).toEqual(['in a group']);
	});

	it('gives every other /// misplaced-note', () => {
		expect(
			diags(
				'siml 1\n/// above a header\npriority:\n  /// apart\n\n  cast x /// trailing\n  cast y\n    /// inside\n    if a\nprepull:\n  /// prepull\n  -1s cast x\napl:\n  /// var\n  var $v = 1\n/// end\n',
			),
		).toEqual([
			'2:1 misplaced-note',
			'4:3 misplaced-note',
			'6:10 misplaced-note',
			'8:5 misplaced-note',
			'11:3 misplaced-note',
			'14:3 misplaced-note',
			'16:1 misplaced-note',
		]);
	});
});

describe('sections', () => {
	it('puts a section file body in its implied section, and its top-level lines in top', () => {
		const { tree, diagnostics } = parse('siml 1\nspec hunter\n\nvar $a = 1\ntype auto\n\npriority:\n  cast x\n', { section: 'apl' });
		expect(diagnostics).toEqual([]);
		expect(tree.top.map(s => s.type)).toEqual(['version', 'spec']);
		expect(tree.sections.map((s: Section) => [s.name, s.header?.name.text, s.body.map(b => b.type)])).toEqual([
			['apl', undefined, ['var', 'field_entry']],
			['priority', 'priority', ['row']],
		]);
	});

	it('merges a written header of the implied section into it', () => {
		const { tree, diagnostics } = parse('siml 1\ngear:\n  head helm\n', { section: 'gear' });
		expect(diagnostics).toEqual([]);
		expect(tree.sections).toHaveLength(1);
		expect(tree.sections[0].header?.name.text).toBe('gear');
		expect(tree.sections[0].body.map(b => b.type)).toEqual(['slot_row']);
	});

	it('reads every line of an x.gear.siml as a slot row', () => {
		const { tree } = parse('siml 1\nhed helm + enchant\n', { section: 'gear' });
		expect(tree.sections[0].body.map(b => b.type)).toEqual(['slot_row']);
	});

	it('puts the var lines of a full file before any header in top', () => {
		const { tree } = parse('siml 1\nspec hunter\nvar $a = 1\napl:\n  var $b = 2\n');
		expect(tree.top.map(s => s.type)).toEqual(['version', 'spec', 'var']);
		expect(tree.sections[0].body.map(s => s.type)).toEqual(['var']);
	});

	it('gives each section the range from its header to its last statement', () => {
		const { tree } = parse('siml 1\npriority:\n  cast x\n\n  cast y\nprepull:\n');
		const [priority, prepull] = tree.sections;
		expect([priority.range.start.line, priority.range.end.line, priority.range.end.character]).toEqual([1, 4, 8]);
		expect([prepull.range.start.line, prepull.range.end.line]).toEqual([5, 5]);
	});

	it('leaves the statements under a header that names no section unread, and says so once', () => {
		const { tree, diagnostics } = parse('siml 1\nprioirty:\n  /// note\n  cast x if !a\n  var $x = 1\npriority:\n  cast y\n');
		expect(diagnostics.map(d => `${d.range.start.line + 1}:${d.range.start.character + 1} ${d.code}`)).toEqual(['2:1 unknown-section', '4:13 write-not']);
		expect(tree.sections.map(s => s.body.map(b => b.type))).toEqual([['unparsed', 'unparsed'], ['row']]);
	});
});

describe('diagnostics', () => {
	it('reports the lexer diagnostics at their tokens, and reads the statement only up to the first', () => {
		expect(diags('siml 1\npriority:\n  cast x if !a && b\n  cast y if a || b | c\n  cast @z\n  cast x if a == "b\n  cast `{\n')).toEqual([
			'3:13 write-not',
			'3:16 write-and',
			'4:15 write-or',
			'4:20 write-or',
			'5:8 bad-character',
			'6:18 unclosed-string',
			'7:8 unclosed-raw',
		]);
		expect(diags('siml 1\nvar $ = 1\nvar ${x = 1\nvar $y = %\nvar $z = 5min\n')).toEqual([
			'2:5 expected-name',
			'3:5 expected-name',
			'4:10 expected-name',
			'5:10 bad-literal',
		]);
	});

	it('leaves a statement with a lexer error unread, even when its readable tokens read', () => {
		const { tree, diagnostics } = parse('@x\nsiml 1\npriority:\n  cast x !\n  @cast y\n  cast z\n');
		expect(diagnostics.map(d => `${d.range.start.line + 1}:${d.range.start.character + 1} ${d.code}`)).toEqual([
			'1:1 bad-character',
			'1:1 missing-version',
			'2:1 misplaced-statement',
			'4:10 write-not',
			'5:3 bad-character',
		]);
		expect(tree.statements.map(s => s.type)).toEqual(['unparsed', 'version', 'header', 'unparsed', 'unparsed', 'row']);
	});

	it('reports a parse error in front of a lexer error, and none at the end of the readable tokens', () => {
		expect(diags('siml 1\npriority:\n  cast x foo !\n  cast x if (a) + !b\n')).toEqual(['3:10 expected-if', '3:14 write-not', '4:19 write-not']);
	});

	it('reports the targeted errors of values and actions', () => {
		const text = [
			'siml 1',
			'priority:',
			'  cast x if a = b',
			'  cast x if a < b < c',
			'  cast x on target foo',
			'  wait 1s 2s',
			'  cast x if aura(y, include_reaction_time=true).is_active',
			'  cast x if target.aura(y)',
			'  cast x if aura().is_active',
			'  sequence "S" [cast a cast b]',
		].join('\n');
		expect(diags(text)).toEqual([
			'3:15 write-eq',
			'4:19 chained-comparison',
			'5:20 expected-if',
			'6:11 expected-if',
			'7:21 args-on-head',
			'8:27 parse',
			'9:17 parse',
			'10:24 expected-if',
		]);
	});

	it('reports parse errors at the token, or at the end of the statement', () => {
		expect(diags('siml 1\npriority:\n  cast x if\n  cast if\n  cast x if -$y\n  cast x if (a\n    b)\n  group x\n  f(a,)\n  cast x if a == b c\n')).toEqual(
			['3:12 parse', '4:8 parse', '5:14 parse', '7:5 parse', '8:9 parse', '9:7 parse', '10:20 parse'],
		);
	});

	it('reports raw JSON that does not read', () => {
		expect(diags('siml 1\npriority:\n  `{nope}`\n')).toEqual(['3:3 bad-raw']);
	});

	it('reports a missing or unsupported version, and misplaced top-level lines', () => {
		expect(diags('// only a comment\n')).toEqual(['1:1 missing-version']);
		expect(diags('spec hunter\nsiml 1\n')).toEqual(['1:1 missing-version', '2:1 misplaced-statement']);
		expect(diags('siml 2\n')).toEqual(['1:6 unsupported-version']);
		expect(diags('siml 1.0\n')).toEqual(['1:6 parse']);
		expect(diags('siml 1\nspec hunter\nspec mage\ntalents "a"\npriority:\n  none\ntalents "b"\nuse "x.siml"\n')).toEqual([
			'3:1 misplaced-statement',
			'7:1 misplaced-statement',
			'8:1 misplaced-statement',
		]);
	});

	it('reports header errors', () => {
		expect(diags('siml 1\n  priority:\n    none\nfoo:\npriority:\ngroup "A":\ngroup "A":\ngroup:\n')).toEqual([
			'2:3 indented-header',
			'4:1 unknown-section',
			'5:1 duplicate-section',
			'7:7 duplicate-group',
			'8:1 parse',
		]);
		expect(diags('siml 1\ncooldowns:\nsettings:\n', { section: 'apl' })).toEqual(['2:1 section-not-allowed', '3:1 section-not-allowed']);
		expect(diags('siml 1\npriority:\n', { section: 'gear' })).toEqual(['2:1 section-not-allowed']);
		expect(diags('siml 1\n', { section: 'build' })).toEqual(['1:1 unknown-section']);
		expect(diags('siml 1\ngear:\ngear:\n', { section: 'gear' })).toEqual(['3:1 duplicate-section']);
	});

	it('allows the rotation sections in an x.apl.siml', () => {
		expect(diags('siml 1\napl:\nsimple:\nprepull:\npriority:\ngroup "A":\n', { section: 'apl' })).toEqual([]);
	});

	it('reports misplaced var lines, and rows outside a section', () => {
		expect(diags('siml 1\npriority:\n  var $x = 1\nbuffs:\n  var $y = 2\n')).toEqual(['3:3 misplaced-var', '5:3 misplaced-var']);
		expect(diags('siml 1\nvar $x = 1\n', { section: 'gear' })).toEqual(['2:1 misplaced-var']);
		expect(diags('siml 1\ncast x\n')).toEqual(['2:1 parse']);
	});

	it('reports a # line that hides no row as bad-hidden-row alone', () => {
		expect(diags("siml 1\npriority:\n  # this is a comment\n  # don't (do this)\n  #\n  # cast x\n")).toEqual([
			'3:3 bad-hidden-row',
			'4:3 bad-hidden-row',
			'5:3 bad-hidden-row',
		]);
	});

	it('reports a prepull row without a time, and another row with one', () => {
		expect(diags('siml 1\nprepull:\n  cast x\n  reset_sequence("HHA") if a\n  # wait 1s\npriority:\n  -1s cast x\n  "a" cast y\n')).toEqual([
			'3:3 missing-time',
			'4:3 missing-time',
			'5:5 missing-time',
			'7:3 unexpected-time',
			'8:3 unexpected-time',
		]);
	});

	it('costs a bad statement only itself', () => {
		const { tree, diagnostics } = parse('siml 1\npriority:\n  cast x if a = b\n  cast y\n  wait\n  cast z if c\n');
		expect(diagnostics.map(d => d.code)).toEqual(['write-eq', 'parse']);
		expect(tree.sections[0].body.map(s => (s.type === 'row' ? show(s.action) : s.type))).toEqual(['unparsed', '{(cast y)}', 'unparsed', '{(cast z) if c}']);
	});

	it('gives every diagnostic the error severity and a message', () => {
		for (const d of parse('siml 2\npriority:\n  cast x foo\n').diagnostics) {
			expect(d.severity).toBe('error');
			expect(d.message).not.toBe('');
		}
	});
});

describe('the examples of SPEC.md §16', () => {
	const examples = specExamples();
	const example = (file: string) => examples.find(e => e.path.endsWith(file))!.text;

	it('finds them', () => {
		expect(examples.map(e => e.path)).toEqual([
			'ui/specs/hunter/dps/apls/default.apl.siml',
			'ui/specs/hunter/dps/apls/default_2.apl.siml',
			'ui/specs/warrior/dps/apls/arms.apl.siml',
			'ui/specs/hunter/dps/gear_sets/p1.gear.siml',
			'example.siml',
		]);
	});

	for (const { path, text } of examples) {
		it(`reads ${path} with no diagnostics and every statement read`, () => {
			const { tree, diagnostics } = parse(text, kindOf(path));
			expect(diagnostics).toEqual([]);
			expect(tree.statements.filter(s => s.type === 'unparsed')).toEqual([]);
		});
	}

	it('reads the hunter rotation into its sections', () => {
		const { tree } = parse(example('apls/default.apl.siml'), { section: 'apl' });
		expect(tree.sections.map(s => `${s.name}${s.group ? ` "${s.group}"` : ''} ${s.body.length}`)).toEqual([
			'apl 13',
			'prepull 3',
			'priority 13',
			'group "Weave" 3',
			'group "Move to starting range" 1',
		]);
		const apl = tree.sections[0];
		expect(apl.body[0].leading.flatMap(t => (t.type === 'comment' ? [t.text] : []))).toEqual([
			' Melee weave: shoot, step in for one main-hand swing, step back out before the next Auto Shot.',
		]);
		const sequence = tree.sections[2].body[7] as RowStatement;
		expect(show(sequence.action)).toBe(
			'{(sequence "HHA" {(cast summon_hawk)} {(cast summon_hawk)} {(cast arcane_shot)}) if (and $use_summon_hawk $use_arcane_shot)}',
		);
	});

	it('reads the full hunter setup into its sections', () => {
		const { tree } = parse(example('example.siml'));
		expect(tree.top.map(s => s.type)).toEqual(['version', 'spec', 'talents']);
		expect(tree.sections.map(s => `${s.name} ${s.body.map(b => b.type).join(',')}`)).toEqual([
			`settings ${[...Array(8).fill('field_entry'), 'flag_list', 'field_entry', 'field_entry'].join(',')}`,
			`gear ${Array(16).fill('slot_row').join(',')}`,
			`consumables ${Array(6).fill('field_entry').join(',')}`,
			'buffs flag_list',
			'party_buffs flag_list',
			'raid_buffs flag_list,flag_list',
			'debuffs flag_list,flag_list',
			'sim field_entry',
			'simple field_entry,flag_list,field_entry',
		]);
	});
});
