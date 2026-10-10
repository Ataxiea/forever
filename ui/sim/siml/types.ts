// The public types of the SIML module: what `createSiml` returns and what its functions take and give.
// sim/siml/SPEC.md is the language these types describe.

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject {
	[key: string]: JsonValue;
}
export type JsonPath = Array<string | number>;

// Zero-based, as VS Code and the LSP count; `character` and `offset` count UTF-16 code units. A diagnostic
// printed as LINE:COL adds one to both.
export interface Position {
	line: number;
	character: number;
	offset: number;
}

export interface Range {
	start: Position;
	end: Position;
}

export type DiagnosticCode =
	| 'bad-character'
	| 'unclosed-string'
	| 'unclosed-raw'
	| 'unclosed-bracket'
	| 'expected-name'
	| 'missing-version'
	| 'unsupported-version'
	| 'misplaced-statement'
	| 'indented-header'
	| 'unknown-section'
	| 'section-not-allowed'
	| 'duplicate-section'
	| 'misplaced-note'
	| 'misplaced-var'
	| 'bad-hidden-row'
	| 'missing-time'
	| 'unexpected-time'
	| 'spec-required'
	| 'unknown-spec'
	| 'spec-mismatch'
	| 'use-not-found'
	| 'use-cycle'
	| 'use-refused'
	| 'section-conflict'
	| 'with-unknown-variable'
	| 'with-not-rotation'
	| 'parse'
	| 'write-not'
	| 'write-and'
	| 'write-or'
	| 'write-eq'
	| 'chained-comparison'
	| 'expected-if'
	| 'args-on-head'
	| 'unknown-kind'
	| 'unknown-property'
	| 'unknown-field'
	| 'duplicate-field'
	| 'positional-not-allowed'
	| 'wrong-type'
	| 'unknown-enum'
	| 'bad-literal'
	| 'bad-raw'
	| 'unknown-slot'
	| 'duplicate-slot'
	| 'unknown-name'
	| 'ambiguous-variable'
	| 'duplicate-group'
	| 'duplicate-variable'
	| 'reference-cycle'
	| 'undefined-variable'
	| 'undefined-group'
	| 'undefined-placeholder'
	| 'undefined-sequence'
	| 'raw-ref';

export interface SimlDiagnostic {
	range: Range;
	severity: 'error' | 'warning';
	code: DiagnosticCode;
	message: string;
	data?: unknown;
}

// The file kind its name gives: `x.<section>.siml` holds that section's body, and `x.siml` (or text with no
// file name) any sections.
export interface SimlKind {
	section?: string;
}

// Where a name is looked up (SPEC.md §7.1): the position decides the namespace. The five spell-like namespaces are
// read per class, and items, enchants and random suffixes are one namespace each for every file.
export type SpellNamespace = 'spell' | 'aura' | 'target_aura' | 'target_spell' | 'pet_aura';
export type Namespace = SpellNamespace | 'item' | 'enchant' | 'suffix';

// A spell-like entry of the name table: an ActionID's spell id, tag and rank, and the specs whose builds register it.
export interface SpellName {
	spellId: number;
	tag?: number;
	rank?: number;
	registeredBy: string[];
}

export type SpellNames = Partial<Record<SpellNamespace, Record<string, SpellName>>>;

// The name table, sim/siml/names.json, in the form of SPEC.md §7.4: a class's entries keyed by its short name.
export interface NameTable {
	classes?: Record<string, SpellNames>;
	enchants?: Record<string, { effectId: number; slots: string[] }>; // The slots are ItemSlot short names.
	items?: Record<string, number>;
	shared?: SpellNames;
	suffixes?: Record<string, number>;
}

// A name in a ref position: the JSON path it fills and the namespace it is read in.
export interface RefUse {
	name: string;
	range: Range;
	path?: JsonPath; // None for a name outside the loader's message, in a section the file kind does not hold.
	namespace: Namespace;
}

// A JSON path into the rotation JSON (or the settings JSON of a full file) and the text that writes it.
export interface PathSpan {
	path: JsonPath;
	range: Range;
}

export interface SimlParse {
	kind: SimlKind;
	spec?: string; // The spec oneof field.
	settings?: JsonObject; // IndividualSimSettings JSON; undefined when there is any error.
	rotation?: JsonObject; // APLRotation JSON, for x.apl.siml and full files with a rotation.
	equipment?: JsonObject; // EquipmentSpec JSON, for x.gear.siml and full files with gear.
	categories: string[]; // The category letters present.
	diagnostics: SimlDiagnostic[];
	// raw-ref at each raw token whose JSON holds a spell, item, enchant or suffix id (SPEC.md §7.3). The parser does
	// not report them: a host reports them for a file under ui/specs, which writes names only.
	rawRefs: SimlDiagnostic[];
	refs: RefUse[];
	spans: PathSpan[];
	tree: SyntaxTree;
}

export interface SimlDoc {
	kind: SimlKind;
	spec?: string;
	settings: JsonObject;
	categories?: string[];
}

// An edit the rotation panel asks for, addressed by the JSON path of what it changes.
export type AplEdit =
	| { op: 'set'; path: JsonPath; value?: unknown } // No value removes the property or element.
	| { op: 'insert'; path: JsonPath; index: number; value: unknown } // `path` names the array.
	| { op: 'move'; path: JsonPath; from: number; to: number }; // Within one array; `to` is the index the element ends at.

export interface TextEdit {
	range: Range;
	newText: string;
}

export interface ParseOptions {
	path?: string;
	// Reads a file that `use` names, resolved against `path`; undefined when it does not exist. A host without
	// one refuses `use`.
	open?: (path: string) => string | undefined;
}

export interface Siml {
	kindOf(path: string): SimlKind;
	parse(text: string, o?: ParseOptions): SimlParse;
	print(doc: SimlDoc): string;
	format(text: string, o?: { path?: string }): { text?: string; diagnostics: SimlDiagnostic[] };
	// The edits that apply `edits` to the rotation of an x.apl.siml: only the statements they change are printed
	// again, and every other line of the text is kept.
	splice(text: string, parsed: SimlParse, edits: AplEdit[]): { edits: TextEdit[] } | { error: string };
}

// --- The syntax tree. Every node carries its range; trivia stay with the statements around them.

// `//` and the rest of the line; `text` is everything after the `//`.
export interface Comment {
	type: 'comment';
	text: string;
	range: Range;
}

// `///` and the rest of the line; `text` drops one space after the `///`.
export interface Note {
	type: 'note';
	text: string;
	range: Range;
}

// A line holding only whitespace.
export interface Blank {
	type: 'blank';
	range: Range;
}

export type Trivia = Comment | Note | Blank;

export interface Name {
	text: string;
	range: Range;
}

// A number with an optional unit, its text exactly as written, a leading minus included (`-22s`, `5.00`).
export interface LiteralNode {
	type: 'literal';
	text: string;
	range: Range;
}

export interface StringNode {
	type: 'string';
	value: string;
	range: Range;
}

export interface BoolNode {
	type: 'bool';
	value: boolean;
	range: Range;
}

export interface NoneNode {
	type: 'none';
	range: Range;
}

// `$name`, or `${Name}` when `braced`.
export interface VarNode {
	type: 'var';
	name: string;
	braced: boolean;
	range: Range;
}

// `%name`, or `%{Name}` when `braced`.
export interface PlaceholderNode {
	type: 'placeholder';
	name: string;
	braced: boolean;
	range: Range;
}

// Backticked JSON.
export interface RawNode {
	type: 'raw';
	json: JsonValue;
	range: Range;
}

// Kept, because parentheses keep an `and` inside an `and` (or an `or` inside an `or`) apart.
export interface ParenNode {
	type: 'paren';
	expr: Expr;
	range: Range;
}

export interface NotNode {
	type: 'not';
	operand: Expr;
	range: Range;
}

// `a and b and c`: one node for the whole run.
export interface LogicNode {
	type: 'and' | 'or';
	operands: Expr[];
	range: Range;
}

export type CompareOp = '==' | '!=' | '>=' | '>' | '<=' | '<';
export type MathOp = '+' | '-' | '*' | '/';

export interface CompareNode {
	type: 'compare';
	op: CompareOp;
	left: Expr;
	right: Expr;
	range: Range;
}

export interface MathNode {
	type: 'math';
	op: MathOp;
	left: Expr;
	right: Expr;
	range: Range;
}

// `name` or `name(args)`: a kind, or a name of the table, unit word or enum value, as its position types it.
export interface CallNode {
	type: 'call';
	name: Name;
	args?: Args;
	range: Range;
}

// `object.name`: a unit-prefixed kind (`target.current_health`), `other.<value>` or `item.<name>`.
export interface MemberNode {
	type: 'member';
	object: Name;
	name: Name;
	range: Range;
}

// `[unit.]head(subject).prop[(args)]`.
export interface AccessorNode {
	type: 'accessor';
	unit?: Name;
	head: Name;
	subject: Term;
	prop: Name;
	args?: Args;
	range: Range;
}

export type Expr =
	| LiteralNode
	| StringNode
	| BoolNode
	| NoneNode
	| VarNode
	| PlaceholderNode
	| RawNode
	| ParenNode
	| NotNode
	| LogicNode
	| CompareNode
	| MathNode
	| CallNode
	| MemberNode
	| AccessorNode;

export interface Args {
	items: Arg[];
	range: Range; // The parentheses and what they hold.
}

export interface Arg {
	name?: Name;
	value: Term;
	range: Range;
}

export interface ListNode {
	type: 'list';
	items: Term[];
	range: Range;
}

// An argument or entry value. The field it fills decides which of these a call or name stands for.
export type Term = Expr | ActionNode | ListNode;

export interface ActionNode {
	type: 'action';
	step: Step;
	condition?: Expr;
	range: Range;
}

export interface CastStep {
	type: 'cast';
	spell: Expr;
	target?: Expr;
	range: Range;
}

export interface ChannelStep {
	type: 'channel';
	spell: Expr;
	target?: Expr;
	until?: Expr;
	recast: boolean;
	range: Range;
}

// `wait v`, `wait until v`.
export interface WaitStep {
	type: 'wait' | 'wait_until';
	value: Expr;
	range: Range;
}

// `move v`, `move for v`.
export interface MoveStep {
	type: 'move' | 'move_for';
	value: Expr;
	range: Range;
}

export interface PlaceholderBind {
	placeholder: PlaceholderNode;
	value: Expr;
	range: Range;
}

export interface GroupStep {
	type: 'group';
	name: StringNode;
	with: PlaceholderBind[];
	range: Range;
}

// The inner step takes no `if`; the row's `if` is the schedule's.
export interface ScheduleStep {
	type: 'schedule';
	schedule: StringNode;
	step: Step;
	range: Range;
}

export interface SequenceStep {
	type: 'sequence';
	name: StringNode;
	actions: ActionNode[];
	range: Range;
}

export type Step = NoneNode | CastStep | ChannelStep | WaitStep | MoveStep | GroupStep | ScheduleStep | SequenceStep | CallNode | RawNode;

export interface VarBind {
	variable: VarNode;
	value: Expr;
	range: Range;
}

interface StatementTrivia {
	range: Range;
	leading: Trivia[]; // The blank, comment and note lines between the previous statement and this one.
	inner: Trivia[]; // The trivia on this statement's lines: trailing comments, and lines inside a continuation.
}

export interface VersionStatement extends StatementTrivia {
	type: 'version';
	version: LiteralNode;
}

export interface SpecStatement extends StatementTrivia {
	type: 'spec';
	spec: Name;
}

export interface TalentsStatement extends StatementTrivia {
	type: 'talents';
	talents: StringNode;
}

export interface UseStatement extends StatementTrivia {
	type: 'use';
	path: StringNode;
	with: VarBind[];
}

// `name:` or `group "Name":`, with the body line written after the colon, if any.
export interface HeaderStatement extends StatementTrivia {
	type: 'header';
	name: Name;
	group?: StringNode;
	body?: Statement;
}

export interface VarStatement extends StatementTrivia {
	type: 'var';
	variable: VarNode;
	value?: Expr; // Absent for a variable with no value.
}

export interface RowStatement extends StatementTrivia {
	type: 'row';
	notes: Note[];
	hide: boolean;
	doAt?: Expr;
	action: ActionNode;
}

export interface SlotRowStatement extends StatementTrivia {
	type: 'slot_row';
	slot: Name;
	item: Name | RawNode;
	suffix?: Name;
	enchant?: Name;
}

// `name` alone is a flag; `name=value` sets a flag-value enum to another value.
export interface Flag {
	name: Name;
	value?: Term;
	range: Range;
}

export interface FlagListStatement extends StatementTrivia {
	type: 'flag_list';
	flags: Flag[];
}

export interface FieldEntryStatement extends StatementTrivia {
	type: 'field_entry';
	name: Name;
	values: Term[];
}

export interface MessageEntryStatement extends StatementTrivia {
	type: 'message_entry';
	name: Name;
	args: Args;
}

export interface RawEntryStatement extends StatementTrivia {
	type: 'raw_entry';
	value: RawNode;
}

// A statement that could not be read, or one under a header that names no section. Its diagnostic, if any,
// is in the parse result.
export interface UnparsedStatement extends StatementTrivia {
	type: 'unparsed';
}

export type Statement =
	| VersionStatement
	| SpecStatement
	| TalentsStatement
	| UseStatement
	| HeaderStatement
	| VarStatement
	| RowStatement
	| SlotRowStatement
	| FlagListStatement
	| FieldEntryStatement
	| MessageEntryStatement
	| RawEntryStatement
	| UnparsedStatement;

// A section, from its header (none for the section a section file implies) to the next header. `body` holds
// its statements in order, a header's own body line first.
export interface Section {
	name: string;
	group?: string;
	header?: HeaderStatement;
	body: Statement[];
	range: Range;
}

export interface SyntaxTree {
	statements: Statement[]; // Every line's statement in file order; a header's body line sits in the header.
	top: Statement[]; // `siml`, `spec`, `talents` and `use`, and the `var` lines of a full file before any header.
	sections: Section[]; // In file order.
	trailing: Trivia[]; // The trivia after the last statement.
}
