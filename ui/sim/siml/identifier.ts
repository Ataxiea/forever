// The identifier a game name reads as (SPEC.md §7.6): ASCII letters lowercased and digits kept, ' and ’
// dropped, and every run of other characters one _, with none at either end. "Hunter's Mark" is hunters_mark.
export function identifier(s: string): string {
	let out = '';
	let separated = false;
	for (const ch of s) {
		if (ch === "'" || ch === '’') continue;
		const lower = ch >= 'A' && ch <= 'Z' ? ch.toLowerCase() : ch;
		if (!((lower >= 'a' && lower <= 'z') || (lower >= '0' && lower <= '9'))) {
			separated = true;
			continue;
		}
		if (separated && out) out += '_';
		separated = false;
		out += lower;
	}
	return out;
}
