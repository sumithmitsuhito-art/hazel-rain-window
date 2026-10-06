import test from 'node:test';
import assert from 'node:assert/strict';
import { refineBeatGrid } from '../tools/beat-grid.mjs';
import { validateSettings } from '../src/settings.mjs';
import { nextHalfBeat } from '../src/half-beat-queue.mjs';

test('whole-track attack refinement recovers a shifted 90 BPM grid without accumulated drift', () => {
  const fps = 11025 / 128, center = 256 / 11025, offset = 0.60061, period = 60 / 90;
  const onset = Array.from({length:Math.ceil(fps*84)}, (_, i) => 0.0001 * (1 + Math.sin(i * 1.3)));
  for(let beat=0;offset+beat*period<84;beat++){
    const position=(offset+beat*period-center)*fps;
    for(let i=Math.max(0,Math.floor(position)-3);i<=Math.min(onset.length-1,Math.ceil(position)+3);i++)onset[i]+=Math.exp(-(((i-position)/0.85)**2))*(1+0.15*Math.sin(beat));
  }
  const result=refineBeatGrid(onset,fps,center,{bpm:89.98,beatOffset:0.5921});
  assert(Math.abs(result.bpm-90)<0.01);assert(Math.abs(result.beatOffset-offset)<0.003);
  assert(result.attackCount>110);assert(result.p95ErrorMs<3);
});

test('new music resets old calibration while retaining volume, same music retains manual calibration', () => {
  const defaults={version:1,musicId:'new-track',skin:'uniform',pool:'mixed',bpm:89.992,beatOffset:0.60061,musicVolume:0.5,voiceVolume:0.9,masterVolume:0.9,reduceMotion:false};
  const old={...defaults,musicId:'old-track',bpm:120,beatOffset:0.267,musicVolume:0.8};
  const changed=validateSettings(old,defaults);assert.equal(changed.bpm,defaults.bpm);assert.equal(changed.beatOffset,defaults.beatOffset);assert.equal(changed.musicVolume,0.8);
  const current=validateSettings({...old,musicId:'new-track'},defaults);assert.equal(current.bpm,120);assert.equal(current.beatOffset,0.267);
});

test('a complete-bar music loop preserves half-beat alignment over repeated loops',()=>{
  const bpm=89.992,origin=0.66061,step=30/bpm,loop=31*240/bpm;
  const first=nextHalfBeat(origin+0.12,origin,bpm);
  for(const repeat of [1,10,100]){const next=nextHalfBeat(origin+repeat*loop+0.12,origin,bpm);assert(Math.abs(next.when-(first.when+repeat*loop))<1e-8);assert(Math.abs(next.when-origin-next.slot*step)<1e-8);}
});
