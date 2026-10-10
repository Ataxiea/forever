// The schema Go generates from the protos, which the tests type against.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SimlSchema } from './schema.ts';

const SCHEMA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../generated/siml/schema.json');

function loadSchema(): SimlSchema {
	if (!existsSync(SCHEMA)) throw new Error(`${SCHEMA} is missing: run make ui/generated/siml/schema.json`);
	return JSON.parse(readFileSync(SCHEMA, 'utf8')) as SimlSchema;
}

export const testSchema = loadSchema();
