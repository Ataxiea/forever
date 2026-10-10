// The examples of SPEC.md §16, as the files they stand for: each code block under a `### 16.` heading. The first
// block takes the path the heading gives, and a further block one beside it, so that a `use` of the first reads it.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../sim/siml/SPEC.md');

export interface Example {
	path: string;
	text: string;
}

export function specExamples(): Example[] {
	const spec = readFileSync(SPEC, 'utf8');
	const section = spec.slice(spec.indexOf('\n## 16. '));
	const out: Example[] = [];
	for (const part of section.split('\n### 16.').slice(1)) {
		const named = /`([^`]*\.siml)`/.exec(part.slice(0, part.indexOf('\n')))![1];
		const file = named.startsWith('.') ? `example${named}` : named;
		const blocks = [...part.matchAll(/\n```\n([\s\S]*?)```\n/g)].map(m => m[1]);
		blocks.forEach((text, i) => out.push({ path: i ? file.replace(/^(.*?)(\.[a-z_]+)?\.siml$/, `$1_${i + 1}$2.siml`) : file, text }));
	}
	return out;
}
