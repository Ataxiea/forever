import i18n from '@i18n/config';
import type { UnitForm } from '@sim/player/player';

/** The no-form state, which every unit has unless it always holds a form. */
const NO_FORM = 0;

const formName = (form: UnitForm | undefined, id: number): string => {
	if (id === NO_FORM) return i18n.t('rotation_tab.apl.forms.no_form');
	const key = `rotation_tab.apl.forms.names.${id}`;
	const name = i18n.t(key);
	return name === key ? (form?.actionId.name ?? String(id)) : name;
};

/**
 * The submenu an entry's forms file it under, among the unit's form states: "Any stance" or "Any
 * form" when it works in all of them, "<form> only" in one, "<form> + <form>" in several. An entry
 * that works in none, or a unit with no forms, gets none.
 */
export const formBuckets = (forms: Array<UnitForm>, alwaysInForm: boolean) => {
	const states = forms.length === 0 ? [] : [...(alwaysInForm ? [] : [NO_FORM]), ...forms.map(form => form.id)];
	const anyLabel = i18n.t(forms.every(form => form.stance) && alwaysInForm ? 'rotation_tab.apl.forms.any_stance' : 'rotation_tab.apl.forms.any_form');
	const keys = new Map<string, number>();

	const segment = (entryForms: ReadonlyArray<number>): string | undefined => {
		const allowed = states.filter(state => entryForms.includes(state));
		if (allowed.length === 0) return undefined;
		const label =
			allowed.length === states.length
				? anyLabel
				: allowed.length === 1
					? i18n.t('rotation_tab.apl.forms.only', {
							form: formName(
								forms.find(form => form.id === allowed[0]),
								allowed[0],
							),
						})
					: allowed
							.map(id =>
								formName(
									forms.find(form => form.id === id),
									id,
								),
							)
							.join(' + ');
		// Any first, then by size, then by the states it names in form order.
		const rank = allowed.length === states.length ? 0 : allowed.length * 1000 + Math.min(...allowed.map(id => states.indexOf(id)));
		if (!keys.has(label)) keys.set(label, rank);
		return label;
	};

	return { segment, order: (label: string) => keys.get(label) ?? Number.MAX_SAFE_INTEGER, anyLabel };
};
