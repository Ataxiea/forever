import { APLRotation, APLRotation_Type as APLRotationType } from '@generated/proto/apl';
import { IndividualSimSettings } from '@generated/proto/ui';
import i18n from '@i18n/config';
import { SIM_CATEGORY_KEYS, type SimSettingCategories } from '@sim/constants/sim_settings';
import type { IndividualSimHost } from '@sim/sim_host';
import type { JsonObject, SimlDoc } from '@sim/siml';

import { loadSiml, located, type SimlTools } from '../load_siml';
import { selectedCategories } from './categories';
import type { ExporterDefinition } from './types';

/** The file a rotation export downloads as, whose double extension says it holds a rotation. */
export const SIML_ROTATION_FILE = 'rotation.apl.siml';

// What a setup export reads back as, which is what pasted text reads as.
const SETUP_FILE = 'wowsims.siml';

/**
 * `doc` as text, which reads back as the file `path` names: text that would not import is refused with its problems,
 * rather than handed out.
 */
const printReadable = ({ siml }: SimlTools, doc: SimlDoc, path: string): string => {
	const text = siml.print(doc);
	const errors = siml.parse(text, { path }).diagnostics.filter(d => d.severity === 'error');
	if (errors.length) {
		throw new Error(i18n.t('export.siml.error_unreadable', { problems: errors.map(located).join('; ') }));
	}
	return text;
};

/**
 * The setup as a full SIML file, holding the sections of `categories`: a category whose settings write nothing is
 * an empty section, so importing the file resets it. No category, as in the JSON export, is every category. The
 * rotation keeps the type the player set, so an Auto or Simple one reads back as Auto or Simple.
 */
const printSimlSettings = async (host: IndividualSimHost<any>, categories: Array<SimSettingCategories>): Promise<string> => {
	const tools = await loadSiml();
	return printReadable(
		tools,
		{
			kind: {},
			spec: tools.specField(host.player.getSpec()),
			settings: IndividualSimSettings.toJson(host.toProto(categories)) as JsonObject,
			categories: categories.length ? categories.map(category => SIM_CATEGORY_KEYS.get(category)!) : undefined,
		},
		SETUP_FILE,
	);
};

/**
 * The rotation the sim runs, as an x.apl.siml to edit and import back. An Auto or Simple rotation is written as the
 * APL list the sim generates for it: kept as Auto or Simple, the import would have the sim generate the list again
 * and drop the edits.
 */
const printSimlRotation = async (host: IndividualSimHost<any>): Promise<string> => {
	const tools = await loadSiml();
	const rotation = { ...host.player.getResolvedAplRotation(), type: APLRotationType.TypeAPL, simple: undefined };
	return printReadable(
		tools,
		{
			kind: tools.siml.kindOf(SIML_ROTATION_FILE),
			spec: tools.specField(host.player.getSpec()),
			settings: { player: { rotation: APLRotation.toJson(rotation) as JsonObject } },
		},
		SIML_ROTATION_FILE,
	);
};

export const SIML_EXPORTER: ExporterDefinition = {
	title: i18n.t('export.siml.title'),
	allowDownload: true,
	downloadFileName: SETUP_FILE,
	downloadMimeType: 'text/plain',
	selectCategories: true,
	getData: (host, categories) => printSimlSettings(host, selectedCategories(categories)),
};

export const SIML_ROTATION_EXPORTER: ExporterDefinition = {
	title: i18n.t('export.siml_rotation.title'),
	allowDownload: true,
	downloadFileName: SIML_ROTATION_FILE,
	downloadMimeType: 'text/plain',
	getData: printSimlRotation,
};
