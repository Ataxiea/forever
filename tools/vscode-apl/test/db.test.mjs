import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classOfPath, loadDatabase, repositoryRoot } from '../src/db.ts';

const repository = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');

test('the class is the spec folder the file sits in', () => {
	assert.equal(classOfPath('/r/ui/specs/hunter/dps/apls/default.apl.json'), 'hunter');
	assert.equal(classOfPath('C:\\r\\ui\\specs\\warlock\\dps\\apls\\default.apl.json'), 'warlock');
	assert.equal(classOfPath('/tmp/mine.apl.json'), undefined);
});

test('the database gives names and icons, and is found above any APL file', () => {
	assert.equal(repositoryRoot(`${repository}/ui/specs/hunter/dps/apls/default.apl.json`), repository);
	const db = loadDatabase(repository);
	assert.equal(db.spells[71]?.[0], 'Defensive Stance');
	assert.ok(Object.keys(db.items).length > 0);
	assert.equal(loadDatabase(repository), db, 'read once until the file changes');
});
