// The name tables the tests read (SPEC.md §15): the corpus's fixture table, which every corpus case is read and
// printed with, and the committed table, which the files under ui/specs are read with.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NameTable } from './types.ts';

const SIML = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../sim/siml');
const read = (file: string) => JSON.parse(readFileSync(path.join(SIML, file), 'utf8')) as NameTable;

export const fixtureNames = read('testdata/names.json');
export const committedNames = read('names.json');
