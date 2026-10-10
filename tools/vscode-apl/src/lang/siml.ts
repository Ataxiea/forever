// Everything the language services take from the SIML module (ui/sim/siml), named in one place. The module's
// public API is `createSiml` and its types; the rest are the parser's own rules, which the editor reads rather
// than copies: which namespace a position reads, a unit word's JSON, how a variable reference resolves, which file a
// `use` line names, which words start a top-level line.

export { createSiml } from '../../../../ui/sim/siml/index.ts';
export type * from '../../../../ui/sim/siml/index.ts';
export { resolveVariable, declaredIn } from '../../../../ui/sim/siml/check.ts';
export { identifier } from '../../../../ui/sim/siml/identifier.ts';
export { lex, LineMap, type Token } from '../../../../ui/sim/siml/lexer.ts';
export { auraNamespaceOf, classOf, fieldNamespace, isSpellLike, Names, THINGS, unitFieldOf, unitReference } from '../../../../ui/sim/siml/names.ts';
export { indexSchema, OTHER_ENUM, sectionFields, SLOT_ENUM, STAT_ENUM, type SchemaIndex } from '../../../../ui/sim/siml/schema.ts';
export { resolveUse } from '../../../../ui/sim/siml/setup.ts';
export { fileSections, TOP_WORDS } from '../../../../ui/sim/siml/syntax.ts';
