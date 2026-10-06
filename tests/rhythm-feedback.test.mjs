import test from 'node:test';
import assert from 'node:assert/strict';
import { beatInBar } from '../src/beat-clock.mjs';
import { rhythmField } from '../src/rhythm-field.mjs';
import { findVoiceOnset } from '../tools/voice-onset.mjs';
import { validateSettings } from '../src/settings.mjs';
import { AudioEngine } from '../src/audio.mjs';

test('musical beat one maps to the first indicator after the corrected original fourth-beat report', () => {
  assert.equal(beatInBar(3, 1), 0);
  assert.deepEqual([3, 4, 5, 6].map(beat => beatInBar(beat, 1)), [0, 1, 2, 3]);
  assert.equal(beatInBar(3 + 124 * 100, 1), 0);
});
test('calibration revision clears stale phase and timing while keeping volume; same revision preserves manual phase', () => {
  const defaults = { version: 1, musicId: 'track:phase1-v2', musicVolume: 0.5, bpm: 89.992, beatOffset: 0.60061, barPhase: 1 };
  const old = { ...defaults, musicId: 'track:phase2', musicVolume: 0.8, bpm: 90, beatOffset: 1, barPhase: 0 };
  assert.deepEqual(validateSettings(old, defaults), { ...defaults, musicVolume: 0.8 });
  assert.equal(validateSettings({ ...defaults, barPhase: 3 }, defaults).barPhase, 3);
  for (const invalid of [-1, 1.5, 4, '2']) assert.equal(validateSettings({ ...defaults, barPhase: invalid }, defaults).barPhase, 1);
});
test('voice trim preserves faint consonant and short preroll rather than retaining a silent lead-in', () => {
  const rate = 44100, samples = new Float32Array(rate);
  for (let i = rate * 0.18; i < rate * 0.20; i++) samples[i] = Math.sin(i * 0.15) * 0.0018;
  for (let i = rate * 0.20; i < samples.length; i++) samples[i] = Math.sin(i * 0.1) * 0.3;
  const result = findVoiceOnset(samples, rate);
  assert(result.trimSeconds > 0.169 && result.trimSeconds < 0.180);
  assert(Math.abs(result.onsetOffset - 0.006) < 1 / rate);
  assert(result.trimFrame < rate * 0.18);
});
test('already audible opening and later silence remain untouched; all-silent source is rejected', () => {
  const samples = new Float32Array(44100);
  for (let i = 0; i < 3000; i++) samples[i] = Math.sin(i * 0.2) * 0.014;
  for (let i = 15000; i < samples.length; i++) samples[i] = Math.sin(i * 0.1) * 0.7;
  assert.equal(findVoiceOnset(samples).trimFrame, 0);
  assert.throws(() => findVoiceOnset(new Float32Array(4410)), /no stable/);
});
test('sparse flights have gaps, long lines and varied screen-wide paths without accumulated state', () => {
  let frames = [], mobile = [];
  for(let beat=0;beat<240;beat+=0.125){frames.push(rhythmField(beat,1440,900,1,new Set(),7));mobile.push(rhythmField(beat,390,844,1,new Set(),7));}
  assert(frames.some(f=>f.length===0)); assert(frames.some(f=>f.length>0));
  assert(Math.max(...frames.map(f=>f.length))<=3); assert(Math.max(...mobile.map(f=>f.length))<=1);
  assert(frames.flat().every(f=>f.span>=1440*0.24));
  assert(mobile.flat().every(f=>f.span>=390*0.43));
  const unique=new Map(frames.flat().map(f=>[f.id,f]));
  assert(new Set([...unique.values()].map(f=>Math.round(f.angle*10))).size>10);
  const flight=[...unique.values()][0], at=flight.slot/2;
  const before=rhythmField(at-0.5,1440,900,1,new Set(),7).find(f=>f.id===flight.id),after=rhythmField(at+0.5,1440,900,1,new Set(),7).find(f=>f.id===flight.id);
  assert(Math.hypot(after.x-before.x,after.y-before.y)>400);
  assert(rhythmField(at,1440,900,1,new Set([flight.id]),7).every(f=>f.id!==flight.id));
  assert.notDeepEqual(rhythmField(at,1440,900,1,new Set(),7),rhythmField(at,1440,900,1,new Set(),19));
});

test('replacement cancels an already scheduled same-slot source and keeps audible onset on its beat', () => {
  const sample = { id: 'v01', gain: 0.6, onsetOffset: 0.006 }, created = [], canceled = [];
  const a = new AudioEngine({ voices: [sample] }, null, () => ({ bpm: 90 }));
  const param = { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} };
  a.ctx = { currentTime: 0.12, createGain: () => ({ gain: {...param}, connect() {}, disconnect() {} }), createBufferSource: () => {
    const source = { playbackRate: { value: 1 }, connect() {}, disconnect() {}, start(time) {this.when=time;}, stop(time) {this.stopped=time;} };
    created.push(source); return source;
  } };
  a.buffers.set(sample.id, { duration: 1 }); a.updateDucking = () => {}; a.onCancelled = voice => canceled.push(voice.id);
  a.play({ id: 1, sampleId: 'v01', when: 0.4, slot: 1 });
  a.ctx.currentTime = 0.18; a.play({ id: 2, sampleId: 'v01', when: 0.4, slot: 1 });
  assert.equal(created[0].stopped, 0.18); assert.deepEqual(canceled, [1]);
  assert.equal(a.voices.size, 1); assert.deepEqual(a.history.map(r=>r.id), [2]);
  assert(Math.abs(created[1].when + sample.onsetOffset - 0.4) < 1e-9);
  assert.equal(a.history[0].gridErrorMs, 0);
});
