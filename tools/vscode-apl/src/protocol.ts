// What the extension and the panel's page send each other, and the shapes of the SIML server's requests they carry
// (sim/siml/lsp/panel.go, patterns.go and sim.go).

export type JsonPath = Array<string | number>;
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject {
	[key: string]: JsonValue;
}

// An edit of the rotation's JSON, which siml/splice makes in the text.
export type AplEdit =
	| { op: 'set'; path: JsonPath; value?: unknown } // No value removes the property or element.
	| { op: 'insert'; path: JsonPath; index: number; value: unknown } // `path` names the array.
	| { op: 'move'; path: JsonPath; from: number; to: number }; // Within one array; `to` is the index the element ends at.

// Zero-based, as the protocol counts.
export interface Range {
	start: { line: number; character: number };
	end: { line: number; character: number };
}

export interface TextEdit {
	range: Range;
	newText: string;
}

// A diagnostic of the file, at the rotation path of the text it is about.
export interface Finding {
	path: JsonPath;
	severity: 'error' | 'warning' | 'info';
	code: string;
	message: string;
}

// What the panel shows for an id: the name and the icon file name from the database.
export type Named = [name: string, icon: string];

// siml/database: the spell and item names and icons of the repository's database.
export interface AplDatabase {
	spells: Record<number, Named>;
	items: Record<number, Named>;
}

// An ActionID as JSON: a spell's id, tag and rank, an item's id, or another action.
export interface ActionIdJson {
	spellId?: number;
	itemId?: number;
	otherId?: string;
	tag?: number;
	rank?: number;
}

// A name of sim/siml/names.json and the ActionID it writes.
export interface RegisteredName {
	name: string;
	id: ActionIdJson;
}

// The names a spec's builds register, by the namespace each position reads (SPEC.md §7.1), and the items with a use.
export interface RegisteredSpec {
	spells: RegisteredName[];
	auras: RegisteredName[];
	targetAuras: RegisteredName[];
	petAuras: RegisteredName[];
	targetSpells: RegisteredName[];
	items: RegisteredName[];
}

export type Registered =
	| { status: 'loading' }
	| { status: 'ready'; spec: string; registered: RegisteredSpec } // `spec` is the field of Player's spec oneof.
	| { status: 'unavailable'; reason: string };

// siml/rotation: the rotation an .apl.siml reads as at a document version. `rotation` is left out while the text has
// errors; `spans` are the text of each JSON path; `used` the files its `use` lines read.
export interface RotationResult {
	version: number;
	rotation?: JsonObject;
	readOnly?: string;
	className?: string;
	findings: Finding[];
	spans: { path: JsonPath; range: Range }[];
	used: string[];
	registered: Registered;
}

// siml/patterns: a common shape Insert Pattern offers, and the values it asks for.
export interface AplPlaceholder {
	name: string;
	label: string;
	kind: 'spell' | 'aura' | 'target_aura' | 'duration' | 'number' | 'group' | 'variable' | 'choice';
	default?: unknown;
	optional?: boolean;
	existing?: boolean;
	options?: string[];
}

export interface AplPattern {
	id: string;
	label: string;
	description: string;
	target: 'row' | 'condition' | 'group' | 'prepull';
	placeholders: AplPlaceholder[];
}

// siml/sim: the result `wowsimcli siml sim` writes, rows keyed by their JSON path joined with '/'.
export interface SimRun {
	dps: { mean: number; stdev: number };
	iterations: number;
	duration: number; // Average iteration length in seconds.
	rows: Record<string, { executions: number; hidden?: boolean }>;
	spells: { id: ActionIdJson; name?: string; dps: number; casts: number; pet?: string }[];
	timeline?: { timeMs: number; path: string; label?: string; via?: string }[];
}

export interface SimResult extends SimRun {
	character: { source: string; race: string; talents: string; gear?: string; warnings?: string[] };
	compare?: SimRun;
	difference?: { delta: number; percent: number; stderr: number; z: number; significant: boolean }; // Set with compare.
	baseline?: 'saved' | 'HEAD'; // What a compare's base was.
}

// What the extension sends the panel.
export type ToPanel =
	| { type: 'init'; db: AplDatabase; fileName: string; uri: string }
	// The rotation the text reads as, at a document version. `handled` is the last of the panel's edits the extension
	// has made or refused before reading it. With `readOnly` the panel shows why it cannot edit; `rotation` is left out
	// while the text has errors, and the panel keeps showing the last one.
	| {
			type: 'rotation';
			version: number;
			handled: number;
			rotation?: JsonObject;
			readOnly?: string;
			className?: string;
			findings: Finding[];
	  }
	| { type: 'cursor'; path: JsonPath }
	| { type: 'registered'; registered: Registered }
	// The file's last sim; `stale` once the text has changed since.
	| { type: 'sim'; sim?: { result: SimResult; stale: boolean; baseline?: 'saved' | 'HEAD' }; running?: boolean };

// What the panel sends the extension. An edit names the document version of the rotation it was made against and its
// place in the panel's sequence of edits; one against a version that someone else's change has moved past is dropped.
export type FromPanel =
	| { type: 'ready' }
	| { type: 'edit'; version: number; seq: number; edits: AplEdit[] }
	| { type: 'reveal'; path: JsonPath }
	| { type: 'sim'; compare: boolean }
	// Insert a pattern after the row at `path` (an index of -1 is the start of an empty list).
	| { type: 'pattern'; path: JsonPath };

// What the panel keeps through a window reload, so the restored panel finds its file.
export interface PanelState {
	uri: string;
}
