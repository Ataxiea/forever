import { Spec } from '@generated/proto/common';
import type { Siml, SimlDiagnostic } from '@sim/siml';

export interface SimlTools {
	siml: Siml;
	/** The `spec` word a file writes for a spec: the field of Player's spec oneof, such as `hunter` for SpecHunter. */
	specField: (spec: Spec) => string | undefined;
}

/** A problem in a text, at its line and column counted from 1. */
export const located = (d: SimlDiagnostic) => `${d.range.start.line + 1}:${d.range.start.character + 1} ${d.message}`;

let loading: Promise<SimlTools> | undefined;

/**
 * The SIML module with the schema and the name table it reads, loaded on first use: together they are larger than
 * anything else a dialog needs, so they stay out of the page's bundle until a SIML dialog asks for them. A load that
 * fails, such as a chunk the network dropped, is tried again on the next call.
 */
export const loadSiml = (): Promise<SimlTools> => {
	loading ??= Promise.all([import('@sim/siml'), import('virtual:siml-data')]).then(
		([{ createSiml }, { schema, names }]) => {
			const fields = new Map(schema.specs.map(spec => [spec.spec, spec.field]));
			return { siml: createSiml(schema, names), specField: spec => fields.get(Spec[spec]) };
		},
		error => {
			loading = undefined;
			throw error;
		},
	);
	return loading;
};
