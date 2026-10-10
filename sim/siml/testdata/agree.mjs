// The TypeScript side of the agreement test (SPEC.md §15): reads each path with ui/sim/siml and prints one
// JSON line per path, which sim/siml/agree_test.go compares with what the Go package gives.
//
//	node --experimental-strip-types sim/siml/testdata/agree.mjs --schema <schema.json> --names <table> [--print] <path>...
//
// --schema is the SIML schema, ui/generated/siml/schema.json or what WriteSchema writes. --names is the name table
// every path is read and printed with. --print takes print cases: each path is a print case's .json, printed with the
// categories its .categories file gives, if any.
//
// A file is read with file access for `use`, except an error case directly in the errors folder, which is read as a
// host without it. Each line is {"path", "json", "format", "print", "diagnostics", "rawRefs", "names"}: the JSON of
// the loader's message for the file's kind (null when there is an error), the formatted text (null when format finds
// an error), the printed text (--print only), the diagnostics and the raw-ref diagnostics of SPEC.md §7.3, each as
// {"line", "col", "severity", "code", "message"}, and the names the file writes that mean something, each as
// {"line", "col", "name", "namespace"}.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { createSiml } from '../../../ui/sim/siml/index.ts';

// A reader that stops early, such as head, ends the output.
process.stdout.on('error', e => {
	if (e.code !== 'EPIPE') throw e;
	process.exit(0);
});

const { values, positionals } = parseArgs({
	options: { schema: { type: 'string' }, names: { type: 'string' }, print: { type: 'boolean' } },
	allowPositionals: true,
});
if (!values.schema) throw new Error('agree.mjs needs --schema <schema.json>');
if (!values.names) throw new Error('agree.mjs needs --names <table>');
const schema = JSON.parse(readFileSync(values.schema, 'utf8'));
const siml = createSiml(schema, JSON.parse(readFileSync(values.names, 'utf8')));
const specs = schema.specs.map(s => s.field);
// A file the host cannot read, a folder among them, is one `use` does not find.
const open = file => {
	try {
		return readFileSync(file, 'utf8');
	} catch {
		return undefined;
	}
};

// The JSON of the loader's message for the parse's kind (SPEC.md §1).
function loaded(parsed) {
	const json = parsed.kind.section === 'apl' ? parsed.rotation : parsed.kind.section === 'gear' ? parsed.equipment : parsed.settings;
	return json ?? null;
}

// A print case's spec: the case name starts with the spec's field (SPEC.md §15).
function specOf(file) {
	const base = path.basename(file);
	return specs.filter(field => base.startsWith(`${field}_`) || base.startsWith(`${field}.`)).sort((a, b) => b.length - a.length)[0];
}

const lineOf = d => ({ line: d.range.start.line + 1, col: d.range.start.character + 1, severity: d.severity, code: d.code, message: d.message });
const at = range => `${range.start.line}:${range.start.character}`;

for (const file of positionals) {
	const line = { path: file };
	let text = readFileSync(file, 'utf8');
	let sourcePath = file;
	if (values.print) {
		sourcePath = file.replace(/\.json$/, '.siml');
		const kind = siml.kindOf(sourcePath);
		const json = JSON.parse(text);
		const settings = kind.section === 'apl' ? { player: { rotation: json } } : kind.section === 'gear' ? { player: { equipment: json } } : json;
		const letters = file.replace(/\.json$/, '.categories');
		const categories = existsSync(letters) ? [...readFileSync(letters, 'utf8').trim()] : undefined;
		text = siml.print({ kind, spec: specOf(file), settings, categories });
	}
	const parsed = siml.parse(text, { path: sourcePath, open: path.basename(path.dirname(sourcePath)) === 'errors' ? undefined : open });
	const errors = parsed.diagnostics.some(d => d.severity === 'error');
	line.json = errors ? null : loaded(parsed);
	line.format = siml.format(text, { path: sourcePath }).text ?? null;
	if (values.print) line.print = text;
	line.diagnostics = parsed.diagnostics.map(lineOf);
	line.rawRefs = parsed.rawRefs.map(lineOf);
	// parse's refs also hold the names that mean nothing, each at its unknown-name.
	const unknown = new Set(parsed.diagnostics.filter(d => d.code === 'unknown-name').map(d => at(d.range)));
	line.names = parsed.refs
		.filter(r => !unknown.has(at(r.range)))
		.map(r => ({ line: r.range.start.line + 1, col: r.range.start.character + 1, name: r.name, namespace: r.namespace }));
	process.stdout.write(`${JSON.stringify(line)}\n`);
}
