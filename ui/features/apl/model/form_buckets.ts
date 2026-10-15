import i18n from '@i18n/config';
import type { UnitForm } from '@sim/player/player';

/** The no-form state, which every unit has unless it always holds a form. */
const NO_FORM = 0;

/** The submenu of the entries that work in one set of the unit's states. */
export interface FormBucket {
	label: string;
	/** The places of the states it names in the unit's state list. */
	places: Array<number>;
	/** Whether the set is every state of the unit. */
	any: boolean;
}

/** Any first, then by size, then by the places of the states each names, one after the other. */
export const compareBuckets = (a: FormBucket, b: FormBucket): number => {
	if (a.any !== b.any) return a.any ? -1 : 1;
	if (a.places.length !== b.places.length) return a.places.length - b.places.length;
	const i = a.places.findIndex((place, j) => place !== b.places[j]);
	return i < 0 ? 0 : a.places[i] - b.places[i];
};

/**
 * The names of the unit's states: `rotation_tab.apl.forms.names.<id>`, else the name of the spell
 * that enters the form. Forms that share a short name go by their spells' names, so no two sets of
 * states get the same label.
 */
const stateNames = (forms: Array<UnitForm>): Map<number, string> => {
	const shortNames = forms.map(form => i18n.t(`rotation_tab.apl.forms.names.${form.id}`, { defaultValue: '' }) || undefined);
	const names = new Map(
		forms.map((form, i) => {
			const name = shortNames[i];
			return [form.id, name !== undefined && shortNames.filter(other => other === name).length === 1 ? name : form.actionId.name];
		}),
	);
	names.set(NO_FORM, i18n.t('rotation_tab.apl.forms.no_form'));
	return names;
};

/**
 * The bucket an entry's forms file it under, among the unit's form states: "Any stance" or "Any
 * form" when it works in all of them, "<form> only" in one, "<form> + <form>" in several. An entry
 * that works in none, or a unit with no forms, gets none. Entries that work in the same states get
 * the same label.
 */
export const formBuckets = (forms: Array<UnitForm>, alwaysInForm: boolean) => {
	const states = forms.length === 0 ? [] : [...(alwaysInForm ? [] : [NO_FORM]), ...forms.map(form => form.id)];
	const names = stateNames(forms);
	const anyLabel = i18n.t(forms.every(form => form.stance) && alwaysInForm ? 'rotation_tab.apl.forms.any_stance' : 'rotation_tab.apl.forms.any_form');

	return (entryForms: ReadonlyArray<number>): FormBucket | undefined => {
		const places = states.flatMap((state, place) => (entryForms.includes(state) ? [place] : []));
		if (places.length === 0) return undefined;
		const any = places.length === states.length;
		const label = any
			? anyLabel
			: places.length === 1
				? i18n.t('rotation_tab.apl.forms.only', { form: names.get(states[places[0]]) })
				: places.map(place => names.get(states[place])).join(' + ');
		return { label, places, any };
	};
};
