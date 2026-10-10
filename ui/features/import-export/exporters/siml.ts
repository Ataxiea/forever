import { APLRotation } from '@generated/proto/apl';
import { IndividualSimSettings } from '@generated/proto/ui';
import i18n from '@i18n/config';
import { SIM_CATEGORY_KEYS, type SimSettingCategories } from '@sim/constants/sim_settings';
import type { IndividualSimHost } from '@sim/sim_host';
import type { JsonObject } from '@sim/siml';

import { loadSiml } from '../load_siml';
import { selectedCategories } from './categories';
import type { ExporterDefinition } from './types';

/** The file a rotation export downloads as, whose double extension says it holds a rotation. */
export const SIML_ROTATION_FILE = 'rotation.apl.siml';

/**
 * The setup as a full SIML file, holding the sections of `categories`: a category whose settings write nothing is
 * an empty section, so importing the file resets it. No category, as in the JSON export, is every category.
 */
const printSimlSettings = async (host: IndividualSimHost<any>, categories: Array<SimSettingCategories>): Promise<string> => {
	const { siml, specField } = await loadSiml();
	return siml.print({
		kind: {},
		spec: specField(host.player.getSpec()),
		settings: IndividualSimSettings.toJson(host.toProto(categories)) as JsonObject,
		categories: categories.length ? categories.map(category => SIM_CATEGORY_KEYS.get(category)!) : undefined,
	});
};

/** The rotation the sim runs, an Auto or Simple one with the priority list it generates, as an x.apl.siml. */
const printSimlRotation = async (host: IndividualSimHost<any>): Promise<string> => {
	const { siml, specField } = await loadSiml();
	return siml.print({
		kind: siml.kindOf(SIML_ROTATION_FILE),
		spec: specField(host.player.getSpec()),
		settings: { player: { rotation: APLRotation.toJson(host.player.getResolvedAplRotation()) as JsonObject } },
	});
};

export const SIML_EXPORTER: ExporterDefinition = {
	title: i18n.t('export.siml.title'),
	allowDownload: true,
	downloadFileName: 'wowsims.siml',
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
