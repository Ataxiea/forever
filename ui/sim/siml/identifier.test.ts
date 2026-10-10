import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { identifier } from './identifier.ts';

const IDENT_TXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../sim/siml/testdata/ident.txt');

describe('identifier', () => {
	it('reads the examples of SPEC.md §7.6', () => {
		expect(identifier("Hunter's Mark")).toBe('hunters_mark');
		expect(identifier('Saf-T Ultra Precision Scope')).toBe('saf_t_ultra_precision_scope');
		expect(identifier('Ez-Thro Dynamite II')).toBe('ez_thro_dynamite_ii');
	});

	it('gives every pair of sim/siml/testdata/ident.txt, which the Go implementation reads too', () => {
		const pairs = readFileSync(IDENT_TXT, 'utf8')
			.split('\n')
			.filter(line => line !== '')
			.map(line => line.split('\t'));
		expect(pairs.length).toBeGreaterThan(0);
		for (const [name, want] of pairs) expect(identifier(name), JSON.stringify(name)).toBe(want);
	});

	it('treats a character outside the BMP as one separator', () => {
		expect(identifier('Fire\u{1F525}Ball')).toBe('fire_ball');
	});
});
