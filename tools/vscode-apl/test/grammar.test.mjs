import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { simlGrammar } from '../scripts/grammar.mjs';

const schema = JSON.parse(readFileSync(new URL('../../../ui/generated/siml/schema.json', import.meta.url), 'utf8'));
const grammar = simlGrammar(schema);

// Every match pattern of the grammar, flattened.
const patterns = [...grammar.patterns, ...Object.values(grammar.repository).flatMap(entry => entry.patterns)].filter(p => p.match);

// The scope the first pattern to match `text` gives `part` of it: the whole match, or one of its captures.
function scopeOf(text, part = text) {
	for (const pattern of patterns) {
		const match = new RegExp(pattern.match).exec(text);
		if (!match) continue;
		if (pattern.name && match[0] === part) return pattern.name;
		for (const [group, capture] of Object.entries(pattern.captures ?? {})) if (match[Number(group)] === part) return capture.name;
	}
	return undefined;
}

test('every keyword of the schema is coloured as one', () => {
	for (const word of schema.keywords) assert.match(scopeOf(word) ?? '', /^(keyword|constant\.language)\./, word);
});

test('every accessor head is coloured as one before its parenthesis, a keyword of the same word as the keyword', () => {
	for (const head of schema.heads) assert.equal(scopeOf(`${head}(`, head), 'support.function.head.siml', head);
	assert.equal(scopeOf('sequence("S")', 'sequence'), 'support.function.head.siml');
	assert.equal(scopeOf('sequence "S" [none]', 'sequence'), 'keyword.other.action.siml');
});

test('every unit word and indexed unit is coloured as a unit', () => {
	for (const word of Object.keys(schema.units.words)) assert.equal(scopeOf(word), 'variable.language.unit.siml', word);
	for (const prefix of Object.keys(schema.units.indexed)) assert.equal(scopeOf(`${prefix}2`), 'variable.language.unit.siml', prefix);
});

test('every section is coloured as a header at the start of a line', () => {
	for (const section of schema.sections.filter(s => s.name !== 'group'))
		assert.equal(scopeOf(`${section.name}:`, section.name), 'entity.name.section.siml', section.name);
	assert.equal(scopeOf('group "Weave":', '"Weave"'), 'entity.name.section.group.siml');
});

test('literals, variables and placeholders', () => {
	for (const literal of ['5', '1.5s', '400ms', '30%', '1m30s', '5.00']) assert.equal(scopeOf(literal), 'constant.numeric.siml', literal);
	assert.equal(scopeOf('${Melee weave}'), 'variable.other.siml');
	assert.equal(scopeOf('%{Two words}'), 'variable.parameter.placeholder.siml');
	assert.equal(scopeOf('// a comment'), 'comment.line.double-slash.siml');
	assert.equal(scopeOf('/// a note'), 'comment.line.triple-slash.documentation.siml');
});
