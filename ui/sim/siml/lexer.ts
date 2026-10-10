// The tokens and trivia of SIML text (SPEC.md §2). Offsets count UTF-16 code units, as JavaScript strings do.

import type { DiagnosticCode, Position, Range, Trivia } from './types.ts';

export type TokenKind = 'ident' | 'number' | 'string' | 'raw' | 'var' | 'placeholder' | 'punct' | 'bad';

export interface Token {
	kind: TokenKind;
	text: string;
	start: number;
	end: number;
	value?: string; // A string's decoded text, a raw token's JSON text, a variable's or placeholder's name.
	error?: TokenError; // A token that does not read as one; the parser stops in front of it.
}

export interface TokenError {
	code: DiagnosticCode;
	message: string;
	start: number;
	end: number;
}

export interface Lexed {
	tokens: Token[];
	trivia: Trivia[];
	lines: LineMap;
}

export class LineMap {
	readonly starts: number[] = [0];

	constructor(text: string) {
		for (let i = 0; i < text.length; i++) if (text[i] === '\n') this.starts.push(i + 1);
	}

	line(offset: number): number {
		let lo = 0;
		let hi = this.starts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (this.starts[mid] <= offset) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	}

	position(offset: number): Position {
		const line = this.line(offset);
		return { line, character: offset - this.starts[line], offset };
	}

	range(start: number, end: number): Range {
		return { start: this.position(start), end: this.position(end) };
	}
}

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/y;
const NUMBER = '[0-9]+(?:\\.[0-9]+)?';
const UNIT = '(?:ns|us|µs|ms|s|m|h)';
// A number with no unit, a percentage, a duration, or a compound duration such as 1h2m3.5s.
const LITERAL = new RegExp(`${NUMBER}(?:%|${UNIT}(?:${NUMBER}${UNIT})*)?(?![A-Za-z0-9_])`, 'y');
// What a number that reads as no literal covers, for its diagnostic.
const BAD_LITERAL = /[0-9][0-9A-Za-z_µ.]*/y;
const PUNCT2 = new Set(['>=', '<=', '==', '!=']);
const PUNCT1 = new Set(['<', '>', '+', '-', '*', '/', '(', ')', '[', ']', ',', '=', '.', ':', '#']);
const REJECTED: Record<string, { code: DiagnosticCode; message: string }> = {
	'&&': { code: 'write-and', message: 'write and in place of &&' },
	'||': { code: 'write-or', message: 'write or in place of ||' },
	'!': { code: 'write-not', message: 'write not in place of !' },
	'&': { code: 'write-and', message: 'write and in place of &' },
	'|': { code: 'write-or', message: 'write or in place of |' },
};
const ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't']);
const HEX4 = /^[0-9A-Fa-f]{4}$/;

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
const isIdentStart = (c: string | undefined) => c !== undefined && ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_');

// Where the line holding `pos` ends, before its `\n` or `\r\n`.
function contentEnd(text: string, pos: number): number {
	const nl = text.indexOf('\n', pos);
	if (nl < 0) return text.length;
	return nl > pos && text[nl - 1] === '\r' ? nl - 1 : nl;
}

// The text a host gives, as SIML reads it (SPEC.md §2): a byte order mark at the start is skipped, so positions count
// from the character after it.
export const sourceText = (text: string) => (text.startsWith('\uFEFF') ? text.slice(1) : text);

export function lex(text: string): Lexed {
	const lines = new LineMap(text);
	const tokens: Token[] = [];
	const trivia: Trivia[] = [];
	let pos = 0;
	let lineStart = true;
	while (pos < text.length) {
		if (lineStart) {
			lineStart = false;
			let p = pos;
			while (text[p] === ' ' || text[p] === '\t') p++;
			const crlf = text[p] === '\r' && text[p + 1] === '\n';
			if (text[p] === '\n' || crlf) {
				trivia.push({ type: 'blank', range: lines.range(pos, p) });
				pos = p + (crlf ? 2 : 1);
				lineStart = true;
				continue;
			}
			pos = p;
			continue;
		}
		const c = text[pos];
		if (c === '\n') {
			pos++;
			lineStart = true;
		} else if (c === ' ' || c === '\t' || (c === '\r' && text[pos + 1] === '\n')) {
			pos++;
		} else if (c === '/' && text[pos + 1] === '/') {
			const end = contentEnd(text, pos);
			if (text[pos + 2] === '/') {
				// One space after the `///`, and the spaces and tabs that end the line, are not part of the note.
				const body = text.slice(pos + 3, end).replace(/[ \t]+$/, '');
				trivia.push({ type: 'note', text: body.startsWith(' ') ? body.slice(1) : body, range: lines.range(pos, end) });
			} else {
				trivia.push({ type: 'comment', text: text.slice(pos + 2, end), range: lines.range(pos, end) });
			}
			pos = end;
		} else {
			const token = scan(text, pos);
			tokens.push(token);
			pos = token.end;
		}
	}
	return { tokens, trivia, lines };
}

function scan(text: string, pos: number): Token {
	const c = text[pos];
	if (c === '`') return scanRaw(text, pos);
	if (c === '"') return scanString(text, pos);
	if (c === '$' || c === '%') return scanName(text, pos);
	if (isDigit(c)) return scanNumber(text, pos);
	if (isIdentStart(c)) {
		IDENT.lastIndex = pos;
		const word = IDENT.exec(text)![0];
		return { kind: 'ident', text: word, start: pos, end: pos + word.length };
	}
	const two = text.slice(pos, pos + 2);
	if (PUNCT2.has(two)) return { kind: 'punct', text: two, start: pos, end: pos + 2 };
	const rejected = REJECTED[two] ? two : REJECTED[c] ? c : undefined;
	if (rejected) {
		const end = pos + rejected.length;
		return { kind: 'punct', text: rejected, start: pos, end, error: { ...REJECTED[rejected], start: pos, end } };
	}
	if (PUNCT1.has(c)) return { kind: 'punct', text: c, start: pos, end: pos + 1 };
	const ch = String.fromCodePoint(text.codePointAt(pos)!);
	const end = pos + ch.length;
	// A byte order mark past the start is invisible, so the message writes its escape.
	const shown = c === '\r' ? '\\r' : c === '\uFEFF' ? '\\uFEFF' : ch;
	return { kind: 'bad', text: ch, start: pos, end, error: { code: 'bad-character', message: `'${shown}' starts nothing SIML reads`, start: pos, end } };
}

// Backticked JSON, which may span lines.
function scanRaw(text: string, pos: number): Token {
	const close = text.indexOf('`', pos + 1);
	if (close < 0) {
		return {
			kind: 'raw',
			text: text.slice(pos),
			start: pos,
			end: text.length,
			value: text.slice(pos + 1),
			error: { code: 'unclosed-raw', message: 'the raw JSON has no closing `', start: pos, end: pos + 1 },
		};
	}
	return { kind: 'raw', text: text.slice(pos, close + 1), start: pos, end: close + 1, value: text.slice(pos + 1, close) };
}

// A JSON string on one line.
function scanString(text: string, pos: number): Token {
	let i = pos + 1;
	while (i < text.length && text[i] !== '"' && text[i] !== '\n') i += text[i] === '\\' && text[i + 1] !== '\n' ? 2 : 1;
	if (text[i] !== '"') {
		const end = contentEnd(text, pos);
		return {
			kind: 'string',
			text: text.slice(pos, end),
			start: pos,
			end,
			error: { code: 'unclosed-string', message: 'the string has no closing " on its line', start: pos, end },
		};
	}
	const source = text.slice(pos, i + 1);
	const token: Token = { kind: 'string', text: source, start: pos, end: i + 1 };
	token.error = badEscape(text, pos, i);
	// A string badEscape passes is a JSON string.
	if (!token.error) token.value = JSON.parse(source) as string;
	return token;
}

// The first control character or escape that makes the string between `open` and `close` no JSON string, or an
// escape of a lone surrogate, which names no character; undefined when there is none.
function badEscape(text: string, open: number, close: number): TokenError | undefined {
	for (let i = open + 1; i < close; i++) {
		if (text.charCodeAt(i) < 0x20) {
			return { code: 'bad-character', message: 'a control character in a string is written as an escape, such as \\t', start: i, end: i + 1 };
		}
		if (text[i] !== '\\') continue;
		if (ESCAPES.has(text[i + 1])) {
			i++;
			continue;
		}
		const c = unicodeEscape(text, i, close);
		if (c !== undefined) {
			if (c >= 0xd800 && c <= 0xdfff) {
				const low = unicodeEscape(text, i + 6, close);
				if (c >= 0xdc00 || low === undefined || low < 0xdc00 || low > 0xdfff) {
					return { code: 'bad-character', message: `'${text.slice(i, i + 6)}' is a lone surrogate, which names no character`, start: i, end: i + 6 };
				}
				i += 6;
			}
			i += 5;
			continue;
		}
		const end = Math.min(i + (text[i + 1] === 'u' ? 6 : 2), close);
		return {
			code: 'bad-character',
			message: `'${text.slice(i, end)}' is no escape: a string escapes only \\" \\\\ \\/ \\b \\f \\n \\r \\t and \\uXXXX`,
			start: i,
			end,
		};
	}
	return undefined;
}

// The code unit of the \uXXXX escape at `i`, before `close`.
function unicodeEscape(text: string, i: number, close: number): number | undefined {
	return i + 6 <= close && text.startsWith('\\u', i) && HEX4.test(text.slice(i + 2, i + 6)) ? parseInt(text.slice(i + 2, i + 6), 16) : undefined;
}

// `$name`, `${Name}`, `%name`, `%{Name}`.
function scanName(text: string, pos: number): Token {
	const sigil = text[pos];
	const kind = sigil === '$' ? 'var' : 'placeholder';
	if (text[pos + 1] === '{') {
		const end = contentEnd(text, pos);
		const close = text.indexOf('}', pos + 2);
		if (close >= 0 && close < end) return { kind, text: text.slice(pos, close + 1), start: pos, end: close + 1, value: text.slice(pos + 2, close) };
		return {
			kind,
			text: text.slice(pos, end),
			start: pos,
			end,
			error: { code: 'expected-name', message: `${sigil}{ needs its } on the same line`, start: pos, end },
		};
	}
	if (isIdentStart(text[pos + 1])) {
		IDENT.lastIndex = pos + 1;
		const name = IDENT.exec(text)![0];
		return { kind, text: sigil + name, start: pos, end: pos + 1 + name.length, value: name };
	}
	const message = `expected a name after ${sigil}: write ${sigil}name or ${sigil}{Name}`;
	return { kind, text: sigil, start: pos, end: pos + 1, error: { code: 'expected-name', message, start: pos, end: pos + 1 } };
}

function scanNumber(text: string, pos: number): Token {
	LITERAL.lastIndex = pos;
	const m = LITERAL.exec(text);
	if (m) return { kind: 'number', text: m[0], start: pos, end: pos + m[0].length };
	BAD_LITERAL.lastIndex = pos;
	const bad = BAD_LITERAL.exec(text)![0];
	const end = pos + bad.length;
	const message = `'${bad}' is no number: a number may end in one of % ns us µs ms s m h, or be a duration such as 1m30s`;
	return { kind: 'number', text: bad, start: pos, end, error: { code: 'bad-literal', message, start: pos, end } };
}
