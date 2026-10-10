import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { codeActions } from '../src/lang/actions.ts';
import { complete } from '../src/lang/complete.ts';
import { diagnose } from '../src/lang/diagnostics.ts';
import { parseText } from '../src/lang/document.ts';
import { formatting, minimalReplace } from '../src/lang/format.ts';
import { hover } from '../src/lang/hover.ts';
import { LEGEND, semanticTokens } from '../src/lang/semantic.ts';
import { createSiml, indexSchema, Names } from '../src/lang/siml.ts';
import { definition, documentLinks, documentSymbols, foldingRanges, prepareRename, references, rename } from '../src/lang/symbols.ts';
import { loadWorkspace, registeredNames } from '../src/lang/workspace.ts';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const ws = loadWorkspace(repository);
const corpus = name => readFileSync(join(repository, 'sim', 'siml', 'testdata', name), 'utf8');
const HUNTER = join(repository, 'x.apl.siml');
const SETUP = join(repository, 'x.siml');
const SPECS = join(repository, 'ui', 'specs', 'hunter', 'dps', 'apls', 'x.apl.siml');

// The text with its `|` taken out, and the position the `|` marked.
function marked(text) {
	const at = text.indexOf('|');
	const before = text.slice(0, at);
	const line = before.split('\n').length - 1;
	return { text: before + text.slice(at + 1), position: { line, character: at - (before.lastIndexOf('\n') + 1) } };
}

function completions(source, path = HUNTER, workspace = ws) {
	const { text, position } = marked(source);
	return complete(parseText(workspace, path, text), position);
}

const labels = items => items.map(item => item.label);

// The offset of a position in `text`.
const offsetIn = (text, { line, character }) => text.split('\n').slice(0, line).join('\n').length + (line > 0 ? 1 : 0) + character;

// A position in `text`: where `needle` starts, plus `k`.
function positionOf(text, needle, k = 0) {
	const at = text.indexOf(needle) + k;
	const before = text.slice(0, at);
	return { line: before.split('\n').length - 1, character: at - (before.lastIndexOf('\n') + 1) };
}

const ROTATION = ['siml 1', 'spec hunter', '', 'var ${Melee weave} = true', ''].join('\n');

// A table of four names: a hunter spell its builds register, one no build registers, and two shared ones, the first
// registered by the warrior's builds alone.
function smallWorkspace() {
	const schema = JSON.parse(readFileSync(join(repository, 'ui', 'generated', 'siml', 'schema.json'), 'utf8'));
	const table = {
		classes: { hunter: { spell: { steady: { spellId: 900001, registeredBy: ['hunter'] }, kept: { spellId: 900002, registeredBy: [] } } } },
		shared: {
			spell: {
				warriors_only: { spellId: 900003, registeredBy: ['dps_warrior'] },
				everyones: { spellId: 900004, registeredBy: ['dps_warrior', 'hunter'] },
			},
		},
	};
	const index = indexSchema(schema);
	return { root: repository, schema, index, table, names: new Names(index, table), siml: createSiml(schema, table) };
}

describe('the workspace', () => {
	test('reads the schema and the table of the repository a file sits in', () => {
		assert.ok(!('error' in ws), ws.error);
		assert.ok(ws.names.spell('hunter', 'spell', 'hunters_mark'));
	});

	test('says what to run when the schema is missing', () => {
		const missing = loadWorkspace(join(repository, 'sim', 'siml', 'testdata'));
		assert.match(missing.error, /make ui\/generated\/siml\/schema.json/);
	});

	test('a spec reads the names its builds register, the class first, then the shared ones', () => {
		const small = smallWorkspace();
		assert.deepEqual(
			registeredNames(small.table, 'hunter', 'hunter', 'spell').map(n => [n.name, n.shared]),
			[
				['steady', false],
				['everyones', true],
			],
		);
		assert.deepEqual(
			registeredNames(small.table, undefined, undefined, 'spell').map(n => n.name),
			['warriors_only', 'everyones'],
		);
	});
});

describe('completion', () => {
	test('a prepull row starts with its time, and its action comes after the time', () => {
		const start = labels(completions(`${ROTATION}prepull:\n  |\n`));
		assert.ok(start.includes('-1s'));
		assert.ok(start.includes('${Melee weave}'));
		assert.ok(!start.includes('cast'), 'no action before the time');
		const action = labels(completions(`${ROTATION}prepull:\n  -1s |\n`));
		assert.ok(action.includes('cast') && action.includes('group'));
		assert.ok(labels(completions(`${ROTATION}prepull:\n  -1s cast |\n`)).includes('hunters_mark'));
	});

	test('a priority row offers the action keywords and kinds, and a condition the values', () => {
		const row = labels(completions(`${ROTATION}priority:\n  |\n`));
		assert.ok(['cast', 'channel', 'wait until', 'move for', 'sequence', 'autocast_other_cooldowns'].every(word => row.includes(word)));
		const condition = labels(completions(`${ROTATION}priority:\n  cast hunters_mark if |\n`));
		assert.ok(['aura', 'dot', 'current_time', 'target.', '${Melee weave}', 'not'].every(word => condition.includes(word)));
		assert.deepEqual(labels(completions(`${ROTATION}priority:\n  cast hunters_mark |\n`)), ['on', 'if']);
	});

	test("an accessor's property, and the property's arguments", () => {
		const props = labels(completions(`${ROTATION}priority:\n  cast x if target.aura(hunters_mark).|\n`));
		assert.ok(['is_active', 'remaining_time', 'num_stacks', 'should_refresh'].every(p => props.includes(p)));
		const args = labels(completions(`${ROTATION}priority:\n  cast x if target.aura(hunters_mark).num_stacks(|\n`));
		assert.deepEqual(args, ['include_reaction_time', 'include_reaction_time=']);
		const unprefixed = labels(completions(`${ROTATION}priority:\n  cast x if aura(hunters_mark).should_refresh(|\n`));
		assert.ok(unprefixed.includes('source_unit=') && unprefixed.includes('max_overlap='));
	});

	test("an aura is offered from its unit's namespace: the prefix, or a unit argument after it", () => {
		const target = labels(completions(`${ROTATION}priority:\n  cast x if target.aura(|\n`));
		assert.ok(target.includes('hunters_mark') && !target.includes('aspect_of_the_hawk'));
		const player = labels(completions(`${ROTATION}priority:\n  cast x if aura(|\n`));
		assert.ok(player.includes('aspect_of_the_hawk') && !player.includes('hunters_mark'));
		const argument = labels(completions(`${ROTATION}priority:\n  cast x if aura(|).should_refresh(source_unit=target)\n`));
		assert.ok(argument.includes('hunters_mark') && !argument.includes('aspect_of_the_hawk'));
		assert.ok(labels(completions(`${ROTATION}priority:\n  cast x if pet1.aura(|\n`)).includes('frenzy'));
	});

	test('a name of the table is offered only when the spec registers it', () => {
		const small = smallWorkspace();
		const hunter = labels(completions(`${ROTATION}priority:\n  cast |\n`, HUNTER, small));
		assert.ok(hunter.includes('steady') && hunter.includes('everyones'));
		assert.ok(!hunter.includes('kept') && !hunter.includes('warriors_only'));
		const noSpec = labels(completions('siml 1\n\ncooldowns(id=|\n', join(repository, 'x.cooldowns.siml'), small));
		assert.ok(noSpec.includes('warriors_only') && noSpec.includes('everyones') && !noSpec.includes('steady'));
	});

	test("a class's names come before the shared ones, which say what adds them", () => {
		const offered = completions(`${ROTATION}priority:\n  cast |\n`, HUNTER, smallWorkspace())
			.filter(item => item.kind === 21)
			.sort((a, b) => (a.sortText < b.sortText ? -1 : 1));
		assert.deepEqual(
			offered.map(item => [item.label, item.detail]),
			[
				['steady', '(900001)'],
				['everyones', '(900004), from gear, consumables or encounters'],
			],
		);
	});

	test('item., other., units, enum values, groups, sequences and variables', () => {
		assert.ok(labels(completions(`${ROTATION}priority:\n  cast item.|\n`)).includes('goblin_sapper_charge'));
		assert.ok(labels(completions(`${ROTATION}priority:\n  cast other.|\n`)).includes('potion'));
		assert.ok(labels(completions(`${ROTATION}priority:\n  cast hunters_mark on |\n`)).includes('previous_target'));
		assert.ok(labels(completions(`${ROTATION}priority:\n  cast x if is_execute_phase(|\n`)).includes('e20'));
		const groups = completions(`${ROTATION}priority:\n  group "|"\n\ngroup "Weave":\n  none\n`);
		assert.deepEqual(labels(groups), ['"Weave"']);
		assert.deepEqual(groups[0].textEdit.range, { start: { line: 5, character: 8 }, end: { line: 5, character: 10 } }, 'the whole string');
		assert.deepEqual(labels(completions(`${ROTATION}priority:\n  reset_sequence(|)\n  sequence "HHA" [none]\n`)), ['sequence_name=', '"HHA"']);
		assert.deepEqual(labels(completions(`${ROTATION}priority:\n  cast x if $|\n`)), ['${Melee weave}']);
		assert.deepEqual(labels(completions(`${ROTATION}priority:\n  group "G" with %|\n\ngroup "G":\n  cast x if %ready\n`)), ['%ready']);
	});

	test('groups and sequences defined below a call whose bracket is still open', () => {
		const below = '\n  sequence "S" [none]\n\ngroup "G":\n  none\n';
		assert.deepEqual(labels(completions(`${ROTATION}priority:\n  reset_sequence("|${below}`)), ['"S"']);
		assert.deepEqual(labels(completions(`${ROTATION}priority:\n  cast x if sequence(|${below}`)), ['"S"']);
		assert.ok(labels(completions(`${ROTATION}priority:\n  cast x if action_group_used(|${below}`)).includes('"G"'));
		const continued = `${ROTATION}priority:\n  cast x if and(\n      gcd_is_ready,\n      action_group_used("|${below}`;
		assert.deepEqual(labels(completions(continued)), ['"G"'], 'opened again on a continuation line');
	});

	test('nothing in a comment or a note', () => {
		assert.deepEqual(completions(`${ROTATION}priority:\n  // cast |\n`), []);
		assert.deepEqual(completions(`${ROTATION}priority:\n  /// cast |\n  none\n`), []);
	});

	test('sections at the start of a line, and the spec after spec', () => {
		const lines = labels(completions('siml 1\n|\n', SETUP));
		assert.ok(['settings:', 'gear:', 'consumables:', 'priority:', 'group "Name":', 'spec', 'use'].every(word => lines.includes(word)));
		assert.ok(labels(completions('siml 1\nspec |\n', SETUP)).includes('dps_warrior'));
	});

	test("entries: a section's fields, an enum's values, a flag list's flags", () => {
		const settings = labels(completions(`siml 1\nspec hunter\n\nsettings:\n  |\n`, SETUP));
		assert.ok(['race', 'distance_from_target', 'quiver_bonus', 'cobra_reflexes'].every(f => settings.includes(f)));
		assert.ok(labels(completions(`siml 1\nspec hunter\n\nsettings:\n  race |\n`, SETUP)).includes('orc'));
		assert.ok(labels(completions(`siml 1\nspec hunter\n\nsettings:\n  quiver_bonus |\n`, SETUP)).includes('ancient_sinew_wrapped_lamina'));
		const buffs = labels(completions('siml 1\n\nbuffs: |\n', SETUP));
		assert.ok(buffs.includes('greater_blessing_of_kings'));
		assert.ok(labels(completions('siml 1\n\nparty_buffs: battle_shout=|\n', SETUP)).includes('improved'));
	});

	test('consumables by field', () => {
		const pots = labels(completions('siml 1\n\nconsumables:\n  pot |\n', SETUP));
		assert.ok(pots.includes('major_frenzy_potion') && !pots.includes('swiftstrike_steak'));
		const food = labels(completions('siml 1\n\nconsumables:\n  food |\n', SETUP));
		assert.ok(food.includes('swiftstrike_steak') && !food.includes('major_frenzy_potion'));
	});

	test("slot rows: items by slot, the item's suffixes, the enchants that fit", () => {
		const gear = join(repository, 'x.gear.siml');
		assert.ok(labels(completions('siml 1\n\n|\n', gear)).includes('main_hand'));
		const heads = labels(completions('siml 1\n\nhead |\n', gear));
		assert.ok(heads.includes('lieutenant_commanders_chain_helmet') && !heads.includes('mongoose_boots'));
		const offHand = labels(completions('siml 1\n\noff_hand |\n', gear));
		assert.ok(
			offHand.includes('thunderfury_blessed_blade_of_the_windseeker') && !offHand.includes('legionite_glaive'),
			'a two-hander goes in the main hand only',
		);
		const suffixes = labels(completions('siml 1\n\nmain_hand notched_shortsword |\n', gear));
		assert.ok(suffixes.includes('of_the_eagle') && suffixes.includes('+'));
		const enchants = labels(completions('siml 1\n\nhead lieutenant_commanders_chain_helmet + |\n', gear));
		assert.ok(enchants.includes('falcons_call') && !enchants.includes('cloak_agility'));
		const twoHand = labels(completions('siml 1\n\nmain_hand legionite_glaive + |\n', gear));
		const oneHand = labels(completions('siml 1\n\nmain_hand thunderfury_blessed_blade_of_the_windseeker + |\n', gear));
		assert.ok(twoHand.includes('enchant_2h_weapon_agility') && !oneHand.includes('enchant_2h_weapon_agility'));
	});
});

describe('hover', () => {
	const text = corpus('parse/hunter_default.apl.siml');
	const p = parseText(ws, HUNTER, text);
	const shown = async (needle, k = 1, card) => (await hover(p, positionOf(text, needle, k), card))?.contents.value;

	test('a spell names its game name, its id and who registers it, with its row of the game files', async () => {
		const value = await shown('hunters_mark', 1, async id => `row of ${id}`);
		assert.match(value, /\*\*Hunter's Mark\*\* · a spell · spell 14325/);
		assert.match(value, /registered by hunter/);
		assert.match(value, /row of 14325/);
	});

	test('an aura on a target, a unit, a kind and a variable', async () => {
		assert.match(await shown('aura(hunters_mark', 6), /an aura on a target/);
		assert.match(await shown('target.aura', 1), /"CurrentTarget"/);
		assert.match(await shown('auto_time_to_next', 1), /kind \*\*auto_time_to_next\*\*/);
		assert.match(await shown('$melee_weave', 2), /var \$\{Melee weave\} = true/);
	});

	test('an item, an enchant and a suffix from the database', async () => {
		const gear = 'siml 1\n\nhead lieutenant_commanders_chain_helmet + falcons_call\nmain_hand notched_shortsword of_the_eagle\n';
		const g = parseText(ws, join(repository, 'x.gear.siml'), gear);
		assert.match((await hover(g, positionOf(gear, 'lieutenant', 2))).contents.value, /Lieutenant Commander's Chain Helm.* · item \d+/);
		assert.match((await hover(g, positionOf(gear, 'falcons_call', 2))).contents.value, /enchant effect 2586[\s\S]*fits head, legs/);
		assert.match((await hover(g, positionOf(gear, 'of_the_eagle', 2))).contents.value, /random suffix/);
	});
});

describe('diagnostics', () => {
	const PLAIN = 'siml 1\nspec hunter\n\n';

	test("the parser's, with its did-you-mean", () => {
		const found = diagnose(parseText(ws, HUNTER, `${PLAIN}priority:\n  cast hunters_mrk\n`));
		assert.deepEqual(
			found.map(d => [d.range.start.line, d.code, d.severity]),
			[[4, 'unknown-name', 1]],
		);
		assert.match(found[0].message, /did you mean hunters_mark/);
	});

	test('a name the spec registers for no build, which is an error under ui/specs', () => {
		const small = smallWorkspace();
		const text = `${PLAIN}priority:\n  cast kept\n  cast steady\n`;
		const outside = diagnose(parseText(small, HUNTER, text));
		assert.deepEqual(
			outside.map(d => [d.range.start.line, d.code, d.severity]),
			[[4, 'unregistered-name', 2]],
		);
		assert.equal(outside[0].message, 'kept is a spell no hunter build registers');
		assert.equal(diagnose(parseText(small, SPECS, text))[0].severity, 1);
	});

	test('the rotation lints, at the text of the node they are about', () => {
		const text = `${PLAIN}prepull:\n  1s cast hunters_mark\n`;
		const found = diagnose(parseText(ws, HUNTER, text)).filter(d => d.code === 'prepull-positive-time');
		assert.deepEqual(
			found.map(d => [d.range.start.line, d.range.start.character, d.range.end.character]),
			[[4, 2, 4]],
		);
	});

	test('raw refs and warnings under ui/specs', () => {
		const text = `${PLAIN}priority:\n  cast \`{"spellId":14325}\`\n  group "Nowhere"\n`;
		const outside = diagnose(parseText(ws, HUNTER, text));
		assert.deepEqual(
			outside.map(d => [d.code, d.severity]),
			[['undefined-group', 2]],
		);
		const inside = diagnose(parseText(ws, SPECS, text));
		assert.deepEqual(inside.map(d => [d.code, d.severity]).sort(), [
			['raw-ref', 1],
			['undefined-group', 1],
		]);
	});

	test('slot rows the database says do not go together', () => {
		const gear = [
			'siml 1',
			'',
			'head fury_of_the_forgotten_swarm + cloak_agility',
			'main_hand thunderfury_blessed_blade_of_the_windseeker + enchant_2h_weapon_agility',
			'neck fury_of_the_forgotten_swarm of_the_eagle',
			'off_hand legionite_glaive',
			'',
		].join('\n');
		assert.deepEqual(
			diagnose(parseText(ws, join(repository, 'x.gear.siml'), gear)).map(d => [d.range.start.line, d.code]),
			[
				[2, 'gear-slot'],
				[2, 'gear-enchant'],
				[3, 'gear-enchant'],
				[4, 'gear-suffix'],
				[5, 'gear-slot'],
			],
		);
	});
});

describe('variables, groups, sequences and placeholders', () => {
	const text = [
		'siml 1',
		'spec hunter',
		'',
		'var ${Melee weave} = true',
		'',
		'priority:',
		'  group "Weave" with %on = $melee_weave if ${Melee weave}',
		'  reset_sequence("S") if sequence("S").is_complete',
		'  sequence "S" [none]',
		'  cast hunters_mark if action_group_used("Weave")',
		'',
		'group "Weave":',
		'  cast hunters_mark if %on',
		'',
	].join('\n');
	const p = parseText(ws, HUNTER, text);
	const lines = locations => locations.map(l => `${l.range.start.line}:${l.range.start.character}`);

	test('go to definition', () => {
		assert.deepEqual(lines(definition(p, 'u', positionOf(text, '$melee_weave', 1))), ['3:4']);
		assert.deepEqual(lines(definition(p, 'u', positionOf(text, 'action_group_used("Weave', 20))), ['11:6']);
		assert.deepEqual(lines(definition(p, 'u', positionOf(text, 'sequence("S"', 10))), ['8:11']);
	});

	test('find references, both spellings of a variable included', () => {
		assert.deepEqual(lines(references(p, 'u', positionOf(text, '${Melee weave} = true', 2), true)), ['3:4', '6:27', '6:43']);
		assert.deepEqual(lines(references(p, 'u', positionOf(text, '"Weave":', 1), false)), ['6:8', '9:41']);
		assert.deepEqual(lines(references(p, 'u', positionOf(text, '%on', 1), true)), ['6:21', '12:23']);
	});

	test('rename writes each occurrence the way the new name is written', () => {
		const edits = rename(p, 'u', positionOf(text, '$melee_weave', 1), 'weave').changes.u;
		assert.deepEqual(
			edits.map(e => e.newText),
			['$weave', '$weave', '$weave'],
		);
		assert.deepEqual(
			rename(p, 'u', positionOf(text, '"S"', 1), 'Two words').changes.u.map(e => e.newText),
			['"Two words"', '"Two words"', '"Two words"'],
		);
		assert.ok('error' in prepareRename(p, positionOf(text, 'hunters_mark', 1)));
	});

	test('rename refuses a name that cannot be written or that another of its kind has where it is seen', () => {
		const refused = (needle, newName) => rename(p, 'u', positionOf(text, needle, 1), newName).error;
		assert.equal(refused('$melee_weave', 'a}b'), "A variable's name cannot hold } or a line break.");
		assert.equal(refused('%on', 'a\nb'), "A placeholder's name cannot hold } or a line break.");
		assert.equal(refused('"S" [', ''), 'A name cannot be empty.');
		const twoText = text.replace('var ${Melee weave} = true', 'var ${Melee weave} = true\nvar $other = false');
		const two = parseText(ws, HUNTER, twoText);
		assert.equal(rename(two, 'u', positionOf(twoText, '$melee_weave', 1), 'other').error, 'x.apl.siml has a variable named other already.');
		assert.equal(
			rename(two, 'u', positionOf(twoText, '$melee_weave', 1), 'Other').error,
			'x.apl.siml has a variable named other already.',
			'$other would name both',
		);
		const groups = parseText(ws, HUNTER, `${text}\ngroup "Other":\n  none\n`);
		assert.equal(rename(groups, 'u', positionOf(text, '"Weave":', 1), 'Other').error, 'x.apl.siml has a group named Other already.');
		assert.equal(rename(p, 'u', positionOf(text, '$melee_weave', 1), 'Melee Weave').changes.u.length, 3, 'its own name in another spelling');
	});

	test('the outline and folding', () => {
		const symbols = documentSymbols(p);
		assert.deepEqual(
			symbols.map(s => s.name),
			['Melee weave', 'priority', 'group "Weave"'],
		);
		assert.deepEqual(
			symbols[1].children.map(c => c.name),
			['S'],
		);
		assert.ok(foldingRanges(p).some(f => f.startLine === 5 && f.endLine === 9));
	});
});

test('a use path links to the file it names, and go to definition opens that file', () => {
	const path = join(repository, 'ui', 'specs', 'hunter', 'dps', 'builds', 'mm.siml');
	const text = readFileSync(path, 'utf8');
	const p = parseText(ws, path, text);
	const links = documentLinks(p);
	assert.deepEqual(
		links.map(l => [l.range.start.line, relative(repository, fileURLToPath(l.target)).split(sep).join('/')]),
		[
			[3, 'ui/specs/hunter/dps/gear_sets/p1.gear.siml'],
			[4, 'ui/specs/hunter/dps/apls/turret.apl.siml'],
		],
	);
	assert.deepEqual(
		definition(p, pathToFileURL(path).href, positionOf(text, 'apls/turret', 3)).map(l => l.uri),
		[links[1].target],
	);
	const missing = parseText(ws, path, text.replace('../apls/turret.apl.siml', '../apls/missing.apl.siml'));
	assert.deepEqual(
		documentLinks(missing).map(l => l.range.start.line),
		[3],
		'no link to a file that does not exist',
	);
});

describe('a variable a `use … with` list sets', () => {
	// default.apl.siml declares ${Use Summon Hawk}, which hawks.apl.siml beside it sets.
	const fixture = name => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
	const read = name => {
		const path = fixture(name);
		const text = readFileSync(path, 'utf8');
		return { text, p: parseText(ws, path, text), uri: pathToFileURL(path).href };
	};
	const declared = read('default.apl.siml');
	const setting = read('hawks.apl.siml');
	const where = locations => locations.map(l => `${basename(fileURLToPath(l.uri))} ${l.range.start.line}:${l.range.start.character}`);
	const bind = positionOf(setting.text, '$use_summon_hawk', 1);

	test('goes to its declaration in the file that declares it, from the with list', () => {
		assert.deepEqual(where(definition(setting.p, setting.uri, bind)), ['default.apl.siml 15:4']);
		assert.equal(prepareRename(setting.p, bind).placeholder, 'Use Summon Hawk');
	});

	test('its references are those in the declaring file and the with lists that set it, from either file', () => {
		const all = [
			'default.apl.siml 15:4',
			'default.apl.siml 29:28',
			'default.apl.siml 31:9',
			'default.apl.siml 33:22',
			'default.apl.siml 34:47',
			'hawks.apl.siml 3:28',
		];
		assert.deepEqual(where(references(setting.p, setting.uri, bind, true)), all);
		assert.deepEqual(where(references(declared.p, declared.uri, positionOf(declared.text, '${Use Summon Hawk}', 2), true)), all);
	});

	test('rename edits the declaring file and the with lists that set it, from either file', () => {
		for (const [from, position] of [
			[declared, positionOf(declared.text, '${Use Summon Hawk}', 2)],
			[setting, bind],
		]) {
			const { changes } = rename(from.p, from.uri, position, 'Summon hawks');
			assert.deepEqual(
				Object.entries(changes).map(([uri, edits]) => [basename(fileURLToPath(uri)), edits.length, edits[0].newText]),
				[
					['default.apl.siml', 5, '${Summon hawks}'],
					['hawks.apl.siml', 1, '${Summon hawks}'],
				],
			);
		}
	});

	test('rename from the with list refuses a name the declaring file has', () => {
		assert.equal(rename(setting.p, setting.uri, bind, 'Use Aimed Shot').error, 'default.apl.siml has a variable named Use Aimed Shot already.');
	});
});

test('semantic tokens colour sections, kinds, properties, units, names and variables', () => {
	const text = `${ROTATION}priority:\n  cast hunters_mark if target.aura(hunters_mark).is_active and $melee_weave\n`;
	const { data } = semanticTokens(parseText(ws, HUNTER, text));
	const tokens = [];
	let line = 0;
	let character = 0;
	for (let i = 0; i < data.length; i += 5) {
		line += data[i];
		character = data[i] === 0 ? character + data[i + 1] : data[i + 1];
		tokens.push([text.split('\n')[line].slice(character, character + data[i + 2]), LEGEND.tokenTypes[data[i + 3]]]);
	}
	assert.deepEqual(tokens, [
		['hunter', 'class'],
		['${Melee weave}', 'variable'],
		['priority', 'namespace'],
		['hunters_mark', 'type'],
		['target', 'variable'],
		['aura', 'function'],
		['hunters_mark', 'type'],
		['is_active', 'method'],
		['$melee_weave', 'variable'],
	]);
});

describe('code actions', () => {
	test('an and or or of one operand becomes the operand, and a nested one joins the one around it', () => {
		const text = `${ROTATION}priority:\n  cast hunters_mark if current_time > 1s and and(gcd_is_ready) or (gcd_is_ready or current_time < 5s)\n`;
		const p = parseText(ws, HUNTER, text);
		const actions = codeActions(p, 'u', { start: { line: 0, character: 0 }, end: { line: 9, character: 0 } }, []);
		assert.deepEqual(
			actions.map(a => a.edit.changes.u[0].newText),
			['gcd_is_ready', 'gcd_is_ready or current_time < 5s'],
		);
	});

	test('a word the parser does not know changes to a candidate its diagnostic names', () => {
		const text = `${ROTATION}priority:\n  cast mongoos_bite if target.aura(hunters_mrk).is_active\n`;
		const p = parseText(ws, HUNTER, text);
		const diagnostics = diagnose(p);
		const fixes = codeActions(p, 'u', { start: { line: 5, character: 0 }, end: { line: 5, character: 60 } }, diagnostics);
		assert.deepEqual(
			fixes.map(a => [a.title, a.kind, a.isPreferred, a.diagnostics[0].range.start.character]),
			[
				['Change to mongoose_bite', 'quickfix', true, 7],
				['Change to hunters_mark', 'quickfix', true, 35],
			],
		);
		let fixed = text;
		for (const fix of [...fixes].reverse()) {
			const { range, newText } = fix.edit.changes.u[0];
			fixed = fixed.slice(0, offsetIn(fixed, range.start)) + newText + fixed.slice(offsetIn(fixed, range.end));
		}
		assert.deepEqual(
			diagnose(parseText(ws, HUNTER, fixed)).map(d => d.code),
			['unused-variable'],
			'the file reads',
		);
		const elsewhere = diagnostics.map(d => ({ ...d, source: 'another-extension' }));
		assert.deepEqual(codeActions(p, 'u', diagnostics[0].range, elsewhere), [], "only the parser's diagnostics");
	});
});

test('formatting is one edit over the lines format changes', () => {
	const text = 'siml 1\nspec hunter\npriority:\n    cast   hunters_mark\n';
	const [edit] = formatting(parseText(ws, HUNTER, text));
	const replace = minimalReplace(text, ws.siml.format(text, { path: HUNTER }).text);
	assert.equal(edit.newText, replace.text);
	assert.deepEqual(formatting(parseText(ws, HUNTER, `${ROTATION}priority:\n  cast\n`)), [], 'none while the text has an error');
});
