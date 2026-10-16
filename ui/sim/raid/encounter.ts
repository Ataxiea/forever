import {
	AreaType,
	Encounter as EncounterProto,
	MobType,
	PresetEncounter,
	PresetTarget,
	SpellSchool,
	Stat,
	Target as TargetProto,
	TargetInput,
} from '@generated/proto/common';

import { ENCOUNTER_DEFAULTS } from '../constants/encounter';
import * as Mechanics from '../constants/mechanics';
import { CURRENT_API_VERSION } from '../constants/other';
import { UnitMetadataList } from '../player/player';
import { Stats } from '../proto/stats';
import { Sim } from '../sim';
import { batch } from '../state/batch';
import { EncounterSlice, SimStore } from '../state/sim_store';

const clampProportion = (value: number) => Math.round(Math.min(Math.max(value, 0), 1) * 10000) / 10000;

const EXECUTE_KEYS = ['executeProportion20', 'executeProportion25', 'executeProportion35', 'executeProportion45', 'executeProportion90'] as const;

// Manages all the settings for an Encounter. State lives in the Zustand
// store's `encounter` slice.
export class Encounter {
	readonly sim: Sim;
	private readonly store: SimStore;

	targetsMetadata: UnitMetadataList;

	constructor(sim: Sim) {
		this.sim = sim;
		this.store = sim.store;
		// Seed the default target (initialization, not a change).
		this.store.setState(s => ({ encounter: { ...s.encounter, targets: [Encounter.defaultTargetProto()] } }));
		this.targetsMetadata = new UnitMetadataList();
	}

	private get enc(): EncounterSlice {
		return this.store.getState().encounter;
	}

	private set(patch: Partial<EncounterSlice>) {
		this.store.setState(s => ({ encounter: { ...s.encounter, ...patch } }));
	}

	// Read-only access. The returned protos are live objects — do NOT mutate
	// them; route all writes through setTargets/modifyTarget so change events fire.
	get primaryTarget(): TargetProto {
		return this.enc.targets[0];
	}

	getTargets(): Array<TargetProto> {
		return this.enc.targets;
	}

	getTarget(index: number): TargetProto | undefined {
		return this.enc.targets[index];
	}

	setTargets(newTargets: Array<TargetProto>) {
		// Always notifies: a same-reference write is stored as a fresh array so
		// subscribers still see a change.
		this.set({ targets: newTargets === this.enc.targets ? newTargets.slice() : newTargets });
	}

	// Target mutation with a single change event — the write path for the
	// encounter picker's per-field edits. Replace-on-write: the callback gets a
	// clone, which then replaces the original in a new targets array.
	modifyTarget(index: number, modify: (target: TargetProto) => void) {
		const targets = this.enc.targets.slice();
		if (!targets[index]) {
			// Old behavior for a missing target: the write went to a throwaway
			// object and the change event still fired.
			this.set({ targets });
			return;
		}
		const clone = TargetProto.clone(targets[index]);
		modify(clone);
		targets[index] = clone;
		this.set({ targets });
	}

	getDurationVariation(): number {
		return this.enc.durationVariation;
	}
	setDurationVariation(newDuration: number) {
		if (newDuration == this.enc.durationVariation) return;
		this.set({ durationVariation: newDuration });
	}

	getDuration(): number {
		return this.enc.duration;
	}
	setDuration(newDuration: number) {
		if (newDuration == this.enc.duration) return;
		this.set({ duration: newDuration });
	}

	private setExecuteProportionAt(index: number, value: number) {
		const enc = this.enc;
		const next = EXECUTE_KEYS.map(k => enc[k]);
		next[index] = clampProportion(value);
		for (let i = index - 1; i >= 0; i--) next[i] = Math.min(next[i], next[i + 1]);
		for (let i = index + 1; i < next.length; i++) next[i] = Math.max(next[i], next[i - 1]);
		if (EXECUTE_KEYS.every((k, i) => next[i] === enc[k])) return;
		this.set({
			executeProportion20: next[0],
			executeProportion25: next[1],
			executeProportion35: next[2],
			executeProportion45: next[3],
			executeProportion90: next[4],
		});
	}

	getExecuteProportion20(): number {
		return this.enc.executeProportion20;
	}
	setExecuteProportion20(value: number) {
		this.setExecuteProportionAt(0, value);
	}
	getExecuteProportion25(): number {
		return this.enc.executeProportion25;
	}
	setExecuteProportion25(value: number) {
		this.setExecuteProportionAt(1, value);
	}
	getExecuteProportion35(): number {
		return this.enc.executeProportion35;
	}
	setExecuteProportion35(value: number) {
		this.setExecuteProportionAt(2, value);
	}
	getExecuteProportion45(): number {
		return this.enc.executeProportion45;
	}
	setExecuteProportion45(value: number) {
		this.setExecuteProportionAt(3, value);
	}
	getExecuteProportion90(): number {
		return this.enc.executeProportion90;
	}
	setExecuteProportion90(value: number) {
		this.setExecuteProportionAt(4, value);
	}
	getUseHealth(): boolean {
		return this.enc.useHealth;
	}
	setUseHealth(newUseHealth: boolean) {
		if (newUseHealth == this.enc.useHealth) return;
		this.set({ useHealth: newUseHealth });
	}

	getAreaTypes(): Array<AreaType> {
		return this.enc.areaTypes;
	}
	setAreaTypes(newAreaTypes: Array<AreaType>, zoneId = 0) {
		const areaTypes = [...new Set(newAreaTypes)].filter(areaType => areaType != AreaType.AreaTypeUnknown).sort((a, b) => a - b);
		const current = this.enc.areaTypes;
		const sameSet = areaTypes.length == current.length && areaTypes.every((areaType, i) => areaType == current[i]);
		if (sameSet && zoneId == this.enc.zoneId) return;
		this.set({ areaTypes, zoneId });
	}

	getZoneId(): number {
		return this.enc.zoneId;
	}
	// An unknown zone (0 is Custom) keeps the set and clears the zone.
	setZone(zoneId: number) {
		const zone = zoneId ? this.sim.db.getZone(zoneId) : null;
		this.setAreaTypes(zone ? zone.areaTypes : this.enc.areaTypes, zone ? zoneId : 0);
	}

	matchesPreset(preset: PresetEncounter): boolean {
		const targets = this.enc.targets;
		return preset.targets.length == targets.length && targets.every((t, i) => TargetProto.equals(t, preset.targets[i].target));
	}

	// A preset's target proto is owned by `sim.db` and shared by every encounter naming that preset,
	// so the store gets a clone: what it holds, it owns.
	applyPreset(preset: PresetEncounter) {
		this.set({ targets: preset.targets.map(presetTarget => (presetTarget.target ? TargetProto.clone(presetTarget.target) : TargetProto.create())) });

		const zoneId = this.sim.db?.getNpc(preset.targets[0]?.target?.id ?? 0)?.zoneId ?? 0;
		if (zoneId && this.sim.db.getZone(zoneId)?.areaTypes.length) this.setZone(zoneId);
	}

	applyPresetTarget(preset: PresetTarget, index: number) {
		const targets = this.enc.targets.slice();
		targets[index] = preset.target ? TargetProto.clone(preset.target) : TargetProto.create();
		this.set({ targets });
	}

	toProto(): EncounterProto {
		const enc = this.enc;
		return EncounterProto.create({
			duration: enc.duration,
			durationVariation: enc.durationVariation,
			executeProportion20: enc.executeProportion20,
			executeProportion25: enc.executeProportion25,
			executeProportion35: enc.executeProportion35,
			executeProportion45: enc.executeProportion45,
			executeProportion90: enc.executeProportion90,
			useHealth: enc.useHealth,
			areaTypes: enc.areaTypes,
			zoneId: enc.zoneId,
			targets: enc.targets,
			apiVersion: CURRENT_API_VERSION,
		});
	}

	fromProto(proto: EncounterProto) {
		batch(() => {
			this.setDuration(proto.duration);
			this.setDurationVariation(proto.durationVariation);
			const p20 = clampProportion(proto.executeProportion20);
			const p25 = Math.max(clampProportion(proto.executeProportion25), p20);
			const p35 = Math.max(clampProportion(proto.executeProportion35), p25);
			const p45 = Math.max(clampProportion(proto.executeProportion45), p35);
			const p90 = Math.max(clampProportion(proto.executeProportion90), p45);
			this.set({
				executeProportion20: p20,
				executeProportion25: p25,
				executeProportion35: p35,
				executeProportion45: p45,
				executeProportion90: p90,
			});
			this.setUseHealth(proto.useHealth);
			this.setAreaTypes(proto.areaTypes, proto.zoneId);
			// Clone so edits in the Advanced Encounter picker cannot mutate the
			// saved entry's (or the config default's) own target protos.
			this.setTargets(proto.targets.map(t => TargetProto.clone(t)));
		});
	}

	applyDefaults() {
		this.fromProto(Encounter.defaultEncounterProto());
	}

	static defaultEncounterProto(numTargets = 1): EncounterProto {
		return EncounterProto.create({
			...ENCOUNTER_DEFAULTS,
			targets: Array.from({ length: numTargets }, () => Encounter.defaultTargetProto()),
			apiVersion: CURRENT_API_VERSION,
		});
	}

	static defaultTargetProto(): TargetProto {
		// Copy default raid target used as fallback for missing DB.
		// https://github.com/wowsims/forever/blob/3570c4fcf1a4e2cd81926019d4a1b3182f613de1/sim/encounters/register_all.go#L24
		return TargetProto.create({
			id: 31146,
			name: 'Raid Target',
			level: Mechanics.BOSS_LEVEL,
			mobType: MobType.MobTypeMechanical,
			stats: Stats.fromMap({
				[Stat.StatArmor]: 3731,
				[Stat.StatAttackPower]: 320,
				[Stat.StatBlockValue]: 54,
				[Stat.StatHealth]: 1299000,
			}).asProtoArray(),
			minBaseDamage: 2601,
			damageSpread: 0.5,
			tankIndex: 0,
			swingSpeed: 2,
			suppressDodge: false,
			parryHaste: true,
			canCrush: true,
			dualWield: false,
			dualWieldPenalty: false,
			spellSchool: SpellSchool.SpellSchoolPhysical,
			targetInputs: new Array<TargetInput>(0),
		});
	}
}
