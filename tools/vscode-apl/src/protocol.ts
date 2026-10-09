import type { AplDatabase } from './db';
import type { AplEdit } from './edits';

export type JsonPath = Array<string | number>;

// What `tools/aplspells` prints for one spec: the SpellStats and AuraStats the sim registers, as proto JSON.
export interface RegisteredSpec {
	spells: Array<Record<string, unknown>>;
	auras: Array<Record<string, unknown>>;
	petAuras: Array<Record<string, unknown>>;
	targetAuras: Array<Record<string, unknown>>;
	names: Record<string, string>; // The game files' names, for spells the UI database does not list.
}

export type Registered =
	| { status: 'loading' }
	| { status: 'ready'; spec: string; registered: RegisteredSpec }
	// The file is not in a spec folder, the sim cannot build the spec, or the tool failed.
	| { status: 'unavailable'; reason: string };

// What the extension sends the panel.
export type ToPanel =
	| { type: 'init'; db: AplDatabase; className?: string; fileName: string; uri: string }
	| { type: 'text'; text: string; version: number }
	| { type: 'cursor'; path: JsonPath }
	| { type: 'registered'; registered: Registered };

// What the panel sends the extension. An edit names the document version it was made against, and one
// against a version the document has moved past is dropped.
export type FromPanel = { type: 'ready' } | { type: 'edit'; version: number; edits: AplEdit[] } | { type: 'reveal'; path: JsonPath };

// What the panel keeps through a window reload, so the restored panel finds its file.
export interface PanelState {
	uri: string;
}
