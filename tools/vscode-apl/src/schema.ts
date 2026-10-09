import { APLRotation } from '@generated/proto/apl';
import type { FieldInfo, IMessageType } from '@protobuf-ts/runtime';

type Schema = Record<string, unknown>;

// protobuf-ts ScalarType values: the 64-bit integers are strings or numbers in proto JSON.
const INT64 = new Set([3, 4, 6, 16, 18]);
const FLOAT = new Set([1, 2]);
const BOOL = 8;
const TEXT = new Set([9, 12]);

function scalar(type: number): Schema {
	if (type === BOOL) return { type: 'boolean' };
	if (TEXT.has(type)) return { type: 'string' };
	if (FLOAT.has(type)) return { type: 'number' };
	if (INT64.has(type)) return { type: ['integer', 'string'] };
	return { type: 'integer' };
}

// The proto JSON a message reads from: every field by its JSON name, enums by their proto names, and no
// field the proto does not have. A oneof is left to the sim to check, since JSON Schema states "at most one
// of these keys" only pair by pair.
export function protoJsonSchema(root: IMessageType<any>): Schema {
	const definitions: Record<string, Schema> = {};

	const field = (info: FieldInfo): Schema => {
		switch (info.kind) {
			case 'scalar':
				return scalar(info.T);
			case 'enum': {
				const [, values, prefix] = info.T();
				const names = Object.keys(values).filter(name => typeof (values as Record<string, unknown>)[name] === 'number');
				return { enum: names.map(name => `${prefix ?? ''}${name}`) };
			}
			case 'message':
				return { $ref: `#/definitions/${message(info.T())}` };
			case 'map':
				return {
					type: 'object',
					additionalProperties:
						info.V.kind === 'scalar' ? scalar(info.V.T) : info.V.kind === 'enum' ? {} : { $ref: `#/definitions/${message(info.V.T())}` },
				};
		}
	};

	const message = (type: IMessageType<any>): string => {
		if (!(type.typeName in definitions)) {
			definitions[type.typeName] = {};
			const properties = Object.fromEntries(type.fields.map(info => [info.jsonName, info.repeat ? { type: 'array', items: field(info) } : field(info)]));
			definitions[type.typeName] = { type: 'object', properties, additionalProperties: false };
		}
		return type.typeName;
	};

	const name = message(root);
	return { $schema: 'http://json-schema.org/draft-07/schema#', $ref: `#/definitions/${name}`, definitions };
}

export const aplRotationSchema = () => protoJsonSchema(APLRotation);
