import type { SemanticTokens, SemanticTokensLegend } from 'vscode-languageserver-types';

import { classify, type Span } from './classify.ts';
import type { Parsed } from './document.ts';
import { isSpellLike } from './siml.ts';

// The token types and modifiers the server sends. The grammar colours keywords, literals, strings and comments; these
// colour what only the schema and the table know: sections, fields, kinds, units, enum values and names.
const TYPES = ['namespace', 'class', 'property', 'function', 'method', 'variable', 'parameter', 'enumMember', 'type'] as const;
const MODIFIERS = ['declaration', 'readonly', 'defaultLibrary'] as const;

export const LEGEND: SemanticTokensLegend = { tokenTypes: [...TYPES], tokenModifiers: [...MODIFIERS] };

type TokenType = (typeof TYPES)[number];
type Modifier = (typeof MODIFIERS)[number];

function tokenOf(span: Span): [TokenType, Modifier[]] | undefined {
	switch (span.role) {
		case 'section':
			return ['namespace', []];
		case 'spec':
			return ['class', []];
		case 'field':
			return ['property', []];
		case 'kind':
			return ['function', []];
		case 'head':
			return ['function', ['defaultLibrary']];
		case 'prop':
			return ['method', []];
		case 'unit':
			return ['variable', ['readonly', 'defaultLibrary']];
		case 'enum':
		case 'slot':
			return ['enumMember', []];
		case 'variable':
			return ['variable', span.declaration ? ['declaration'] : []];
		case 'placeholder':
			return ['parameter', []];
		case 'name':
			return ['type', isSpellLike(span.ref.namespace) ? [] : ['readonly']];
	}
}

export function semanticTokens(p: Parsed): SemanticTokens {
	const data: number[] = [];
	let line = 0;
	let character = 0;
	let reached = 0; // The offset the last token ends at; tokens never overlap.
	for (const span of classify(p)) {
		const token = tokenOf(span);
		const { start, end } = span.range;
		if (!token || start.line !== end.line || end.character <= start.character || start.offset < reached) continue;
		reached = end.offset;
		const modifiers = token[1].reduce((bits, m) => bits | (1 << MODIFIERS.indexOf(m)), 0);
		data.push(
			start.line - line,
			start.line === line ? start.character - character : start.character,
			end.character - start.character,
			TYPES.indexOf(token[0]),
			modifiers,
		);
		line = start.line;
		character = start.character;
	}
	return { data };
}
