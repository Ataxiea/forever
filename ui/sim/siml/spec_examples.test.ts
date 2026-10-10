// The examples of SPEC.md §16, read with the committed name table: each reads with no diagnostic and no raw ref
// (§7.3). The committed files under ui/specs are checked by wowsimcli's repository check, and TestAgreement checks
// that this module reads, formats and names them as the Go package does.

import { expect, it } from 'vitest';

import { createSiml } from './index.ts';
import { specExamples } from './test_examples.ts';
import { committedNames } from './test_names.ts';
import { testSchema } from './test_schema.ts';

const siml = createSiml(testSchema, committedNames);

const examples = specExamples();
for (const { path: file, text } of examples) {
	it(`reads SPEC.md §16's ${file} with no diagnostic and no raw ref`, () => {
		const parsed = siml.parse(text, { path: file, open: p => examples.find(e => e.path === p)?.text });
		expect(parsed.diagnostics).toEqual([]);
		expect(parsed.rawRefs).toEqual([]);
	});
}
