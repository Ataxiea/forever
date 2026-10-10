import { spawn } from 'node:child_process';

import { findGo } from '../go.ts';

// Runs `tools/aplsim` and reads its result.

export type JsonPathKey = string; // A row's JSON path joined with '/': 'priorityList/3', 'groups/1/actions/0'.

export interface SimRequest {
	siml: string; // The text of an .apl.siml, which tools/aplsim parses with the committed name table.
	path: string; // Its file, relative to the repository root or absolute: use lines are read against it, and the one preset build whose rotation is the saved file's is loaded over the spec's defaults.
	compare?: { siml: string }; // Another text of the same file, simmed on the same character and seed.
	settingsFile?: string; // Settings the site exports, in protojson or as an x.siml, for everything but the APL.
	iterations?: number;
	seed?: number;
	timeline?: boolean;
	timelineLimit?: number;
}

export interface RowStats {
	executions: number; // Times the rotation ran the row per iteration; a cast that then fails still counts.
	hidden?: boolean;
}

export interface SpellStats {
	id: { spellId?: number; itemId?: number; otherId?: string; tag?: number; rank?: number };
	name?: string;
	dps: number;
	casts: number; // Per iteration.
	pet?: string; // The pet's name, for a pet's spell.
}

export interface TimelineEvent {
	timeMs: number; // Negative before the pull.
	path: JsonPathKey;
	label?: string; // The action as the sim prints it: 'Cast Spell(Multi-Shot)'.
	via?: JsonPathKey; // The group reference row that ran this group row.
}

export interface SimRun {
	dps: { mean: number; stdev: number };
	iterations: number;
	duration: number; // Average iteration length in seconds.
	rows: Record<JsonPathKey, RowStats>;
	spells: SpellStats[];
	timeline?: TimelineEvent[];
}

export interface CharacterInfo {
	source: string; // The spec's defaults.siml, a build over it, or the settings file.
	race: string;
	talents: string;
	gear?: string;
	warnings?: string[];
}

export interface DpsDifference {
	delta: number; // compare minus base.
	percent: number;
	stderr: number;
	z: number;
	significant: boolean; // |z| at or above 1.96, about 95% confidence.
}

export interface SimResult extends SimRun {
	character: CharacterInfo;
	compare?: SimRun;
	difference?: DpsDifference; // Set with compare.
}

const DEFAULT_ITERATIONS = 1000;
const MAX_ITERATIONS = 100000;

export function buildRequest(request: SimRequest): SimRequest {
	if (!request.siml || !request.path) {
		throw new Error('a sim needs the text of an .apl.siml and its path');
	}
	const iterations = Math.round(request.iterations ?? DEFAULT_ITERATIONS);
	const built: SimRequest = { ...request, iterations: Math.min(Math.max(iterations || DEFAULT_ITERATIONS, 1), MAX_ITERATIONS) };
	for (const key of Object.keys(built) as (keyof SimRequest)[]) {
		if (built[key] === undefined) {
			delete built[key];
		}
	}
	return built;
}

// The standard error of each mean is stdev / sqrt(iterations). Both APLs run on the same seed, so their
// iterations are positively correlated and the combined error from independent samples overstates the noise:
// a difference this calls significant is, and one it does not may still be real.
export function dpsDifference(base: SimRun, compare: SimRun): DpsDifference {
	const delta = compare.dps.mean - base.dps.mean;
	const se = (run: SimRun) => run.dps.stdev / Math.sqrt(Math.max(run.iterations, 1));
	const stderr = Math.hypot(se(base), se(compare));
	const z = stderr > 0 ? delta / stderr : delta === 0 ? 0 : Math.sign(delta) * Infinity;
	return {
		delta,
		percent: base.dps.mean > 0 ? (delta / base.dps.mean) * 100 : 0,
		stderr,
		z,
		significant: Math.abs(z) >= 1.96,
	};
}

// Rows the APL shows that never ran in any iteration.
export function deadRows(run: SimRun): JsonPathKey[] {
	return Object.entries(run.rows)
		.filter(([, row]) => !row.hidden && row.executions === 0)
		.map(([path]) => path);
}

export function parseResult(stdout: string): SimResult {
	let parsed: Partial<SimResult> & { error?: string };
	try {
		parsed = JSON.parse(stdout);
	} catch {
		throw new Error(`tools/aplsim printed no result: ${stdout.trim().slice(0, 200)}`);
	}
	if (parsed.error) {
		throw new Error(parsed.error);
	}
	if (!parsed.dps || !parsed.rows || !parsed.character) {
		throw new Error('tools/aplsim printed an incomplete result');
	}
	const result = parsed as SimResult;
	result.spells ??= [];
	if (result.compare) {
		result.compare.spells ??= [];
		result.difference = dpsDifference(result, result.compare);
	}
	return result;
}

// Sims a rotation with `tools/aplsim` in the repository at `root`. `goBinary` is the wowsims-apl.goBinary setting: 'go'
// looks for an install, anything else is the binary to run.
export function runSim(root: string, goBinary: string, request: SimRequest, signal?: AbortSignal): Promise<SimResult> {
	const go = findGo(goBinary);
	if (!go) return Promise.reject(new Error('no go binary found; set wowsims-apl.goBinary'));
	return runTool(root, go, request, signal);
}

// Runs `go run --tags=with_db ./tools/aplsim` in the repository. Aborting kills the tool and the sim binary `go run`
// started: on POSIX through the process group, on Windows with taskkill over the process tree.
export function runTool(root: string, go: string, request: SimRequest, signal?: AbortSignal): Promise<SimResult> {
	const body = JSON.stringify(buildRequest(request));
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(abortError());
			return;
		}
		const posix = process.platform !== 'win32';
		// Its own process group on POSIX, so one kill reaches the binary `go run` spawns.
		const child = spawn(go, ['run', '--tags=with_db', './tools/aplsim'], { cwd: root, detached: posix, windowsHide: true });
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let aborted = false;
		const onAbort = () => {
			aborted = true;
			try {
				if (child.pid === undefined) {
					child.kill();
				} else if (posix) {
					process.kill(-child.pid, 'SIGKILL');
				} else {
					spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => child.kill());
				}
			} catch {
				// Already gone.
			}
		};
		signal?.addEventListener('abort', onAbort, { once: true });
		child.stdout.on('data', chunk => stdout.push(chunk));
		child.stderr.on('data', chunk => stderr.push(chunk));
		child.on('error', error => {
			signal?.removeEventListener('abort', onAbort);
			reject(error);
		});
		child.on('close', code => {
			signal?.removeEventListener('abort', onAbort);
			if (aborted) {
				reject(abortError());
				return;
			}
			const out = Buffer.concat(stdout).toString('utf8');
			if (code !== 0 && !out.trim()) {
				const err = Buffer.concat(stderr).toString('utf8').trim().split('\n').slice(-3).join('\n');
				reject(new Error(err || `tools/aplsim exited with ${code}`));
				return;
			}
			try {
				resolve(parseResult(out));
			} catch (e) {
				reject(e as Error);
			}
		});
		child.stdin.on('error', () => {
			// The tool exited before reading the request; close reports why.
		});
		child.stdin.end(body);
	});
}

function abortError(): Error {
	const error = new Error('the sim was cancelled');
	error.name = 'AbortError';
	return error;
}
