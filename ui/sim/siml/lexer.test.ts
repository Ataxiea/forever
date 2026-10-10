import { describe, expect, it } from 'vitest';

import { lex, LineMap, sourceText } from './lexer.ts';

const kinds = (text: string) => lex(text).tokens.map(t => [t.kind, t.text]);

// The lexer's diagnostics as LINE:COL code, the form the corpus's .diag files use.
function errors(text: string): string[] {
	const { tokens, lines } = lex(text);
	return tokens.flatMap(t => {
		if (!t.error) return [];
		const at = lines.position(t.error.start);
		return [`${at.line + 1}:${at.character + 1} ${t.error.code}`];
	});
}

describe('lex', () => {
	it('reads idents, strings, raw JSON, variables, placeholders and every punctuation mark', () => {
		expect(kinds('cast _x2 "a" `{"b": 1}` $v ${Melee weave} %p %{P q} >= <= == != < > + - * / ( ) [ ] , = . : #')).toEqual([
			['ident', 'cast'],
			['ident', '_x2'],
			['string', '"a"'],
			['raw', '`{"b": 1}`'],
			['var', '$v'],
			['var', '${Melee weave}'],
			['placeholder', '%p'],
			['placeholder', '%{P q}'],
			...['>=', '<=', '==', '!=', '<', '>', '+', '-', '*', '/', '(', ')', '[', ']', ',', '=', '.', ':', '#'].map(p => ['punct', p]),
		]);
	});

	it('reads a number with each unit, and compound durations, keeping the text exactly', () => {
		const literals = ['7', '5.00', '30%', '400ms', '1.5s', '2m', '1h', '3ns', '2us', '5µs', '1m30s', '1h2m3.5s'];
		expect(kinds(literals.join(' '))).toEqual(literals.map(l => ['number', l]));
		expect(kinds('-22s')).toEqual([
			['punct', '-'],
			['number', '22s'],
		]);
	});

	it('ends a number at anything that is not a letter, digit or _', () => {
		expect(kinds('1.5.x 2) 3,')).toEqual([
			['number', '1.5'],
			['punct', '.'],
			['ident', 'x'],
			['number', '2'],
			['punct', ')'],
			['number', '3'],
			['punct', ','],
		]);
	});

	it('decodes strings and keeps the names of variables and placeholders', () => {
		const [s, v, braced, empty, p] = lex('"a\\"b\\\\n\\u0041\\t" $melee ${Melee weave} ${} %{P q}').tokens;
		expect(s.value).toBe('a"b\\nA\t');
		expect([v.value, braced.value, empty.value, p.value]).toEqual(['melee', 'Melee weave', '', 'P q']);
	});

	it('reads raw JSON across lines', () => {
		const { tokens } = lex('`{\n  "a": [1,\n 2]\n}` x');
		expect(tokens.map(t => t.kind)).toEqual(['raw', 'ident']);
		expect(tokens[0].value).toBe('{\n  "a": [1,\n 2]\n}');
	});

	it('keeps comments, notes and blank lines as trivia, with the note text past one space and before trailing blanks', () => {
		const { tokens, trivia } = lex('// file\n\n  \n/// a note \t\n///tight\ncast x // trailing\n//// four\n///  \n');
		expect(tokens.map(t => t.text)).toEqual(['cast', 'x']);
		expect(trivia.map(t => [t.type, t.type === 'blank' ? '' : t.text, t.range.start.line, t.range.start.character])).toEqual([
			['comment', ' file', 0, 0],
			['blank', '', 1, 0],
			['blank', '', 2, 0],
			['note', 'a note', 3, 0],
			['note', 'tight', 4, 0],
			['comment', ' trailing', 5, 7],
			['note', '/ four', 6, 0],
			['note', '', 7, 0],
		]);
	});

	it('records no blank line for the end of the file', () => {
		expect(lex('siml 1\n').trivia).toEqual([]);
		expect(lex('siml 1\n   ').trivia).toEqual([]);
	});

	it('reads \\r\\n as \\n', () => {
		const { tokens, trivia } = lex('siml 1\r\n\r\nspec x // c\r\n');
		expect(tokens.map(t => [t.text, t.error])).toEqual([
			['siml', undefined],
			['1', undefined],
			['spec', undefined],
			['x', undefined],
		]);
		expect(trivia.map(t => [t.type, t.range.start.line, t.type === 'comment' ? t.text : ''])).toEqual([
			['blank', 1, ''],
			['comment', 2, ' c'],
		]);
	});

	it('counts columns in UTF-16 code units', () => {
		const { tokens, lines } = lex('"Fahrad’s" x "\u{1F525}" y');
		expect(tokens.map(t => lines.position(t.start).character)).toEqual([0, 11, 13, 18]);
	});

	it('gives each token that reads as nothing its targeted diagnostic', () => {
		expect(errors('a @ b')).toEqual(['1:3 bad-character']);
		expect(errors('é \u{1F525} \rx')).toEqual(['1:1 bad-character', '1:3 bad-character', '1:6 bad-character']);
		expect(errors('x "abc\ny')).toEqual(['1:3 unclosed-string']);
		expect(errors('x "a\\qb"')).toEqual(['1:5 bad-character']);
		expect(errors('x "a\tb"')).toEqual(['1:5 bad-character']);
		expect(errors('x\n`{"a": 1}\ny')).toEqual(['2:1 unclosed-raw']);
		expect(errors('$ % ${abc\n%{x')).toEqual(['1:1 expected-name', '1:3 expected-name', '1:5 expected-name', '2:1 expected-name']);
		expect(errors('!a != b')).toEqual(['1:1 write-not']);
		expect(errors('a && b & c')).toEqual(['1:3 write-and', '1:8 write-and']);
		expect(errors('a || b | c')).toEqual(['1:3 write-or', '1:8 write-or']);
		expect(errors('5min 1e5 1m30 30%x')).toEqual(['1:1 bad-literal', '1:6 bad-literal', '1:10 bad-literal']);
	});

	it('skips one byte order mark at the start, and writes another as its escape', () => {
		expect(sourceText('\uFEFFsiml 1')).toBe('siml 1');
		expect(sourceText('siml \uFEFF1')).toBe('siml \uFEFF1');
		const text = sourceText('\uFEFF\uFEFFsiml 1');
		expect(errors(text)).toEqual(['1:1 bad-character']);
		expect(lex(text).tokens[0].error?.message).toBe("'\\uFEFF' starts nothing SIML reads");
	});

	it('marks an unclosed string to the end of its line, and an unclosed raw at its backtick', () => {
		const { tokens } = lex('"abc\r\n`x');
		expect(tokens.map(t => [t.text, t.error?.start, t.error?.end])).toEqual([
			['"abc', 0, 4],
			['`x', 6, 7],
		]);
	});
});

describe('LineMap', () => {
	it('maps offsets to zero-based lines and characters and back to ranges', () => {
		const lines = new LineMap('ab\ncd\n\nef');
		expect([0, 2, 3, 5, 6, 7, 9].map(o => lines.position(o))).toEqual([
			{ line: 0, character: 0, offset: 0 },
			{ line: 0, character: 2, offset: 2 },
			{ line: 1, character: 0, offset: 3 },
			{ line: 1, character: 2, offset: 5 },
			{ line: 2, character: 0, offset: 6 },
			{ line: 3, character: 0, offset: 7 },
			{ line: 3, character: 2, offset: 9 },
		]);
		expect(lines.range(3, 5)).toEqual({ start: { line: 1, character: 0, offset: 3 }, end: { line: 1, character: 2, offset: 5 } });
	});
});
