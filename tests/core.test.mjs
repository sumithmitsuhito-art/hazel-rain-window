import test from 'node:test';
import assert from 'node:assert/strict';
import { HalfBeatQueue, nextHalfBeat } from '../src/half-beat-queue.mjs';
import { SettingsStore, validateSettings } from '../src/settings.mjs';

const defaults = { version: 1, skin: 'uniform', pool: 'mixed', musicVolume: 0.35, voiceVolume: 0.9, masterVolume: 0.9, reduceMotion: false, bpm: 80, beatOffset: 0 };
test('half-beat boundary includes the music offset and excludes unsafe near-boundary input', () => {
  assert.equal(nextHalfBeat(1.01, 0.1, 120).when, 1.1);
  assert.equal(nextHalfBeat(1.095, 0.1, 120).when, 1.35);
});
test('same-slot inputs replace the candidate; discarded inputs never become a later backlog', () => {
  const q = new HalfBeatQueue();
  q.push({ id: 'A' }, 0.05, 0, 120); q.push({ id: 'B' }, 0.12, 0, 120); q.push({ id: 'C' }, 0.2, 0, 120);
  assert.equal(q.size, 1); assert.deepEqual(q.take(0.24).map(e => e.id), ['C']); assert.equal(q.size, 0);
  q.push({ id: 'D' }, 0.27, 0, 120); assert.equal(q.take(0.49)[0].when, 0.5);
});
test('stale inputs are discarded and cancel clears future audio requests', () => {
  const q = new HalfBeatQueue(); q.push({ id: 'old' }, 0.1, 0, 120);
  assert.deepEqual(q.take(5), []); q.push({ id: 'future' }, 5.1, 0, 120); q.clear(); assert.equal(q.size, 0);
});
test('untrusted settings cannot change enums, types, ranges or schema', () => {
  assert.deepEqual(validateSettings({ version: 1, skin: 'unknown', bpm: Infinity, beatOffset: -1, voiceVolume: '1', reduceMotion: 1 }, defaults), defaults);
  assert.deepEqual(validateSettings({ version: 2, skin: 'dress' }, defaults), defaults);
  const legacy = validateSettings({ version: 1, skin: 'dress', pool: 'soft', musicVolume: 0.6 }, defaults);
  assert.equal(legacy.skin, 'uniform'); assert.equal(legacy.pool, 'mixed'); assert.equal(legacy.musicVolume, 0.6);
});
test('storage errors preserve playable in-memory settings and portable import/export', () => {
  const store = new SettingsStore(defaults, { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } });
  assert.equal(store.available, false); store.update({ skin: 'dress' });
  store.import('{"version":1,"pool":"mixed","bpm":100,"masterVolume":8}');
  assert.equal(store.value.pool, 'mixed'); assert.equal(store.value.masterVolume, defaults.masterVolume);
  assert.equal(JSON.parse(store.export()).bpm, 100);
  assert.throws(() => store.import('{broken')); assert.throws(() => store.import('{"version":7}'));
});
