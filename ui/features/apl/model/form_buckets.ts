import i18n from '@i18n/config';
import type { UnitForm } from '@sim/player/player';

/** The no-form state, which every unit has unless it always holds a form. */
const NO_FORM = 0;

/** The submenu of the entries that work in one set of the unit's states. */
export interface FormBucket {
	label: string;
	/** Any first, then by size, then by the places of the states it names, one after the other. */
	order: number;
	/** Whether the set is every state of the unit. */
	any: boolean;
}

/**
 * The names of the unit's states: `rotation_tab.apl.forms.names.<id>`, else the name of the spell
 * that enters the form. Forms that share a short name go by their spells' names, so no two sets of
 * states get the same label.
 */
const stateNames = (forms: Array<UnitForm>): Map<number, string> => {
	const shortNames = forms.map(form => {
		const key = `rotation_tab.apl.forms.names.${form.id}`;
		const name = i18n.t(key);
		return name === key ? undefined : name;
	});
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
 * the same bucket.
 */
export const formBuckets = (forms: Array<UnitForm>, alwaysInForm: boolean) => {
	const states = forms.length === 0 ? [] : [...(alwaysInForm ? [] : [NO_FORM]), ...forms.map(form => form.id)];
	const names = stateNames(forms);
	const anyLabel = i18n.t(forms.every(form => form.stance) && alwaysInForm ? 'rotation_tab.apl.forms.any_stance' : 'rotation_tab.apl.forms.any_form');
	const buckets = new Map<string, FormBucket>();

	return (entryForms: ReadonlyArray<number>): FormBucket | undefined => {
		const allowed = states.filter(state => entryForms.includes(state));
		if (allowed.length === 0) return undefined;
		const key = allowed.join(',');
		let bucket = buckets.get(key);
		if (!bucket) {
			const any = allowed.length === states.length;
			const label = any
				? anyLabel
				: allowed.length === 1
					? i18n.t('rotation_tab.apl.forms.only', { form: names.get(allowed[0]) })
					: allowed.map(id => names.get(id)).join(' + ');
			const order = any ? 0 : allowed.reduce((rank, id) => rank * 100 + states.indexOf(id), allowed.length);
			bucket = { label, order, any };
			buckets.set(key, bucket);
		}
		return bucket;
	};
};
