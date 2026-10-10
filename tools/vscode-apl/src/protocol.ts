import type { AplDatabase } from './db';
import type { AplEdit, JsonObject, JsonPath } from './lang/siml.ts';
import type { LintFinding } from './lint/index';
import type { SimResult } from './sim/tool';

export type { AplEdit, JsonObject, JsonPath };

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
			findings: LintFinding[];
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
