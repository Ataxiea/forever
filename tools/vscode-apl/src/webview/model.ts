import { APLAction, APLValue } from '@generated/proto/apl';
import { Class } from '@generated/proto/common';
import i18n from '@i18n/config';
import type { Player } from '@sim/player/player';
import type { FieldInfo, IMessageType } from '@protobuf-ts/runtime';

import { actionKinds } from '@features/apl/model/action_kinds';
import type { APLFieldDescriptor } from '@features/apl/model/field_descriptors';
import { type AplFieldSpec, newKindImpl, resolveField } from '@features/apl/model/field_specs';
import { valueKinds } from '@features/apl/model/value_kinds';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type JsonPath = Array<string | number>;

export type Family = 'action' | 'value';

export interface KindModel {
	kind: string;
	label: string;
	submenu?: string[];
	shortDescription: string;
	fullDescription?: string;
	includeIf?: (player: Player<any>, isPrepull: boolean, isGroup: boolean) => boolean;
	newValue: () => unknown;
	fields: APLFieldDescriptor[];
}

const KINDS: Record<Family, Record<string, KindModel>> = {
	action: Object.fromEntries(Object.entries(actionKinds).map(([kind, model]) => [kind, { kind, ...model } as KindModel])),
	value: Object.fromEntries(Object.entries(valueKinds).map(([kind, model]) => [kind, { kind, ...model } as KindModel])),
};

const ONEOF: Record<Family, { type: IMessageType<any>; oneof: string }> = {
	action: { type: APLAction, oneof: 'action' },
	value: { type: APLValue, oneof: 'value' },
};

export function kindModel(family: Family, kind: string): KindModel | undefined {
	return KINDS[family][kind];
}

// The kind a JSON action or value holds: its one key that names a kind (an action also carries `condition`).
export function kindOf(family: Family, json: Json | undefined): string | undefined {
	if (!json || typeof json !== 'object' || Array.isArray(json)) {
		return undefined;
	}
	return Object.keys(json).find(key => key in KINDS[family]);
}

// The message type a kind's body is, read off the oneof in the proto.
export function kindMessage(family: Family, kind: string): IMessageType<any> | undefined {
	const field = ONEOF[family].type.fields.find(f => f.oneof === ONEOF[family].oneof && f.localName === kind);
	return field?.kind === 'message' ? field.T() : undefined;
}

export function fieldInfo(message: IMessageType<any> | undefined, field: string): FieldInfo | undefined {
	return message?.fields.find(f => f.localName === field || f.jsonName === field);
}

// The site's pickers read only the class off the player, to pick the wand or melee auto attack lists; the
// panel has no sim, so it answers that one question from the spec folder the file sits in.
let className: string | undefined;

export function setClassName(name: string | undefined): void {
	className = name;
}

const player = {
	getClass: () =>
		className
			? ((Class as unknown as Record<string, number>)[`Class${className[0].toUpperCase()}${className.slice(1)}`] ?? Class.ClassUnknown)
			: Class.ClassUnknown,
} as unknown as Player<any>;

export function resolve(descriptor: APLFieldDescriptor): AplFieldSpec {
	return resolveField(descriptor, player);
}

// Whether the site offers the kind in this list. A test that asks the sim something the panel cannot answer
// keeps the kind on offer.
export function offered(model: KindModel, isPrepull: boolean, isGroup: boolean): boolean {
	try {
		return model.includeIf?.(player, isPrepull, isGroup) ?? true;
	} catch {
		return true;
	}
}

export function kindsFor(family: Family, isPrepull: boolean, isGroup: boolean): KindModel[] {
	return Object.values(KINDS[family]).filter(model => offered(model, isPrepull, isGroup));
}

export function submenuLabel(segment: string): string {
	const key = `rotation_tab.apl.submenus.${segment}`;
	const translated = i18n.t(key);
	return translated === key ? segment : translated;
}

export function t(key: string): string {
	return i18n.t(key);
}

// Proto JSON for a newly picked kind, with the defaults the site's pickers write and without the editor uuids
// the site keys its rows by, which the APL files do not carry.
export function newKindJson(family: Family, kind: string): JsonObject {
	const model = kindModel(family, kind)!;
	const message = kindMessage(family, kind);
	const impl = newKindImpl(model, player)();
	return withoutUuids(message ? (message.toJson(message.create(impl as object)) as Json) : {}) as JsonObject;
}

export function withoutUuids(json: Json): Json {
	if (Array.isArray(json)) {
		return json.map(withoutUuids);
	}
	if (json && typeof json === 'object') {
		return Object.fromEntries(
			Object.entries(json)
				.filter(([key]) => key !== 'uuid')
				.map(([key, value]) => [key, withoutUuids(value)]),
		);
	}
	return json;
}

// The JSON name of a proto enum value: protobuf-ts strips a shared prefix from the TypeScript names and
// keeps it as the third element of the field's type tuple.
export function enumJsonName(info: FieldInfo | undefined, value: number): string | number {
	if (info?.kind !== 'enum') {
		return value;
	}
	const [, values, prefix] = info.T();
	const name = (values as Record<number, string>)[value];
	return name === undefined ? value : `${prefix ?? ''}${name}`;
}

export function enumNumber(info: FieldInfo | undefined, json: Json | undefined): number | undefined {
	if (typeof json === 'number') {
		return json;
	}
	if (info?.kind !== 'enum' || typeof json !== 'string') {
		return undefined;
	}
	const [, values, prefix] = info.T();
	const name = prefix && json.startsWith(prefix) ? json.slice(prefix.length) : json;
	const number = (values as Record<string, number>)[name];
	return typeof number === 'number' ? number : undefined;
}

// The enum values a proto field takes, by JSON name, for a field with no table of its own.
export function enumChoices(info: FieldInfo | undefined): Array<{ value: number; label: string }> {
	if (info?.kind !== 'enum') {
		return [];
	}
	const [, values, prefix] = info.T();
	return Object.entries(values as Record<string, number | string>)
		.filter(([, value]) => typeof value === 'number')
		.map(([name, value]) => ({ value: value as number, label: `${prefix ?? ''}${name}` }));
}

// "minIcdSeconds" reads as "Min icd seconds" where the site gives a field no label.
export function humanize(field: string): string {
	const words = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

export function isObject(json: Json | undefined): json is JsonObject {
	return !!json && typeof json === 'object' && !Array.isArray(json);
}
