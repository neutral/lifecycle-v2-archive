import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readAtlas } from '../../../implementations/atlas-reader/src/index.mjs';
import { RESOLVED_PROFILE, STRUCTURAL_PROFILE, validateAtlas } from '../src/index.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const starter = path.join(root, 'spec-source/examples/starter');
const validate = profile => validateAtlas(starter, { profile, specificationRevision: '0.8.0' });

// These tests verify the example's representation, not an agent's semantic judgment.
test('starter validates without adopted Checks or publication profiles', () => {
  for (const profile of [STRUCTURAL_PROFILE, RESOLVED_PROFILE]) {
    const result = validate(profile);
    assert.equal(result.complete, true);
    assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.diagnostics, []);
  }
  const model = validate(RESOLVED_PROFILE).normalized;
  assert.deepEqual(model.checks, []);
  assert.deepEqual(model.publicationProfiles, []);
  assert.equal(model.points.length, 2);
  const decision = model.points.find(point => point.id === 'redis-for-sessions');
  const implementation = model.points.find(point => point.id === 'api-session-migration');
  assert.deepEqual(decision.records.map(record => [record.kind, record.map]), [
    ['anchor', 'architecture'], ['context', 'operations'],
  ]);
  assert.equal(decision.records[0].body.trim(), '');
  assert.equal(decision.records[0].areas.length, 0);
  assert.equal(decision.records[1].areas[0].area, 'recovery');
  assert.equal(implementation.relations[0].type, 'implements');
  assert.equal(implementation.relations[0].targetPoint, decision.id);
  assert.match(implementation.summary, /API.*r17/u);
});

test('independent reader agrees on the starter', () => {
  assert.deepEqual(readAtlas(starter), validate(RESOLVED_PROFILE).normalized);
});

function snapshot(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    .flatMap(entry => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? snapshot(target, relative) : [[relative, fs.readFileSync(target)]];
    });
}

test('validation and independent reading leave example bytes unchanged', () => {
  const before = snapshot(starter);
  validate(RESOLVED_PROFILE);
  readAtlas(starter);
  assert.deepEqual(snapshot(starter), before);
});
