// The TextMate grammar of SIML (sim/siml/SPEC.md §2-§4), built from ui/generated/siml/schema.json: its keywords, the
// accessor heads, the unit words and the section names come from the schema, so a word the schema adds is coloured on
// the next build. The language server's semantic tokens colour what only the schema and the name table know on top.

const ACTION_WORDS = new Set(['cast', 'channel', 'wait', 'move', 'group', 'sequence', 'schedule']);
const LOGIC_WORDS = new Set(['and', 'or', 'not']);
const CONSTANT_WORDS = new Set(['true', 'false', 'none']);
const NUMBER = '[0-9]+(?:\\.[0-9]+)?';
const UNIT = '(?:ns|us|µs|ms|s|m|h)';
const IDENT_END = '(?![A-Za-z0-9_])';

const escape = word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const words = list => [...list].map(escape).join('|');

export function simlGrammar(schema) {
	const keywords = schema.keywords;
	const control = keywords.filter(w => !ACTION_WORDS.has(w) && !LOGIC_WORDS.has(w) && !CONSTANT_WORDS.has(w));
	const units = Object.keys(schema.units.words);
	const prefixes = Object.keys(schema.units.indexed);
	const sections = schema.sections.map(s => s.name).filter(name => name !== 'group');
	return {
		$schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
		name: 'SIML',
		scopeName: 'source.siml',
		patterns: [
			{ name: 'comment.line.triple-slash.documentation.siml', match: '///.*$' },
			{ name: 'comment.line.double-slash.siml', match: '//.*$' },
			{
				match: '^(group)\\s*("(?:[^"\\\\]|\\\\.)*")\\s*(:)',
				captures: {
					1: { name: 'keyword.other.section.siml' },
					2: { name: 'entity.name.section.group.siml' },
					3: { name: 'punctuation.separator.colon.siml' },
				},
			},
			{
				match: `^\\s*(${words(sections)})\\s*(:)`,
				captures: { 1: { name: 'entity.name.section.siml' }, 2: { name: 'punctuation.separator.colon.siml' } },
			},
			{ match: '^\\s*(#)(?=\\s)', captures: { 1: { name: 'keyword.other.hidden.siml' } } },
			{ include: '#value' },
		],
		repository: {
			value: {
				patterns: [
					{
						name: 'string.quoted.double.siml',
						begin: '"',
						end: '"|$',
						patterns: [{ name: 'constant.character.escape.siml', match: '\\\\(?:["\\\\/bfnrt]|u[0-9A-Fa-f]{4})' }],
					},
					{
						name: 'meta.embedded.block.json.siml',
						begin: '`',
						end: '`',
						beginCaptures: { 0: { name: 'punctuation.definition.raw.begin.siml' } },
						endCaptures: { 0: { name: 'punctuation.definition.raw.end.siml' } },
						patterns: [{ include: 'source.json' }],
					},
					{ name: 'variable.other.siml', match: '\\$(?:\\{[^}\\n]*\\}|[A-Za-z_][A-Za-z0-9_]*)' },
					{ name: 'variable.parameter.placeholder.siml', match: '%(?:\\{[^}\\n]*\\}|[A-Za-z_][A-Za-z0-9_]*)' },
					{
						name: 'constant.numeric.siml',
						match: `(?<![A-Za-z0-9_.])${NUMBER}(?:%|${UNIT}(?:${NUMBER}${UNIT})*)?${IDENT_END}`,
					},
					// Before the keywords: `sequence(` is the accessor head, `sequence "S"` the action.
					{ name: 'support.function.head.siml', match: `\\b(?:${words(schema.heads)})(?=\\s*\\()` },
					{ name: 'keyword.other.action.siml', match: `\\b(?:${words(ACTION_WORDS)})${IDENT_END}` },
					{ name: 'keyword.operator.word.siml', match: `\\b(?:${words(LOGIC_WORDS)})${IDENT_END}` },
					{ name: 'constant.language.siml', match: `\\b(?:${words(CONSTANT_WORDS)})${IDENT_END}` },
					{ name: 'keyword.control.siml', match: `\\b(?:${words(control)})${IDENT_END}` },
					{
						name: 'variable.language.unit.siml',
						match: `\\b(?:${words(units)}|(?:${words(prefixes)})[1-9][0-9]*)${IDENT_END}`,
					},
					{ name: 'entity.name.function.siml', match: '\\b[a-z_][a-z0-9_]*(?=\\()' },
					{ name: 'keyword.operator.comparison.siml', match: '==|!=|>=|<=|>|<' },
					{ name: 'keyword.operator.arithmetic.siml', match: '[+\\-*/]' },
					{ name: 'keyword.operator.assignment.siml', match: '=' },
				],
			},
		},
	};
}

export function simlGrammarText(schema) {
	return `${JSON.stringify(simlGrammar(schema), null, '\t')}\n`;
}
