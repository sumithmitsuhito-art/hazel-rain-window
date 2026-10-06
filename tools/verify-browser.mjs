import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const content = JSON.parse(fs.readFileSync(path.join(root, 'assets/catalog.json'), 'utf8'));
const selectedFiles = fs.readdirSync(path.join(root, 'assets/source/voice')).filter(file => file.toLowerCase().endsWith('.mp4')).sort();
assert.deepEqual(content.voices.map(v => v.original).sort(), selectedFiles);
for (const voice of content.voices) {
  const source = fs.readFileSync(path.join(root, 'assets/source/voice', voice.original));
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'), voice.sourceSha256);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'assets/production', voice.file))).digest('hex'), voice.sha256);
  assert(voice.file.endsWith('.flac')); assert(voice.onsetOffset <= 0.0061);
}
const expectedVoiceCount = selectedFiles.length;
const sourceWav = fs.readFileSync(path.resolve(root, content.music.source));
assert.equal(crypto.createHash('sha256').update(sourceWav).digest('hex'), content.music.sourceSha256);
let wavFormat, wavData;
for (let position = 12; position + 8 <= sourceWav.length;) {
  const name = sourceWav.toString('ascii', position, position + 4), length = sourceWav.readUInt32LE(position + 4);
  if (name === 'fmt ') wavFormat = { encoding: sourceWav.readUInt16LE(position + 8), channels: sourceWav.readUInt16LE(position + 10), rate: sourceWav.readUInt32LE(position + 12), align: sourceWav.readUInt16LE(position + 20), bits: sourceWav.readUInt16LE(position + 22) };
  if (name === 'data') wavData = sourceWav.subarray(position + 8, position + 8 + length);
  position += 8 + length + (length % 2);
}
assert.equal(wavFormat.encoding, 3); assert.equal(wavFormat.bits, 32);
const fingerprints = [10, 40, 70].filter(time => time + 0.25 < content.music.duration).map(time => {
  const samples = new Float32Array(2205), begin = Math.round(time * wavFormat.rate);
  for (let i = 0; i < samples.length; i++) { const frame = begin + i * 4; for (let ch = 0; ch < wavFormat.channels; ch++) samples[i] += wavData.readFloatLE(frame * wavFormat.align + ch * 4) / wavFormat.channels; }
  return { time, rate: wavFormat.rate / 4, base64: Buffer.from(samples.buffer).toString('base64') };
});
const entryOnly = process.argv.includes('--entry-only');
const evidenceFile = entryOnly ? 'entry-evidence.json' : 'browser-evidence.json';
const output = path.join(root, 'test-results'); fs.mkdirSync(output, { recursive: true });
const profile = path.join(root, `.browser-profile-${Date.now()}`); fs.mkdirSync(profile);
const browserPath = process.env.HAZEL_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket, serial = 0, exceptions = [], requests = [], browserInfo, consoleErrors = [];
const pending = new Map(), evidence = { date: new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()), version: JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version, scenarios: [], notes: ['Headless checks do not establish human listening quality or real-device touch behavior.'] };
evidence.selectedVoiceFiles = selectedFiles;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const routes = { '/': 'dist/game.html', '/game.html': 'dist/game.html', '/dist/game.html': 'dist/game.html', '/index.html': 'index.html' };
  if (!Object.hasOwn(routes, req.url)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); fs.createReadStream(path.join(root, routes[req.url])).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value;
}
async function until(condition, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await evaluate(condition)) return; await sleep(35); }
  throw Error(`Condition timeout: ${condition}; console=${JSON.stringify(consoleErrors)}; snapshot=${JSON.stringify(await evaluate('window.__hazel?.snapshot()'))}`);
}
async function click(x, y) {
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}
async function shot(name) {
  const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(output, name), Buffer.from(result.data, 'base64'));
}
async function navigate(url) {
  exceptions = []; requests = [];
  await call('Page.navigate', { url }); await until('window.__hazelReady === true');
}
try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200 && !fs.existsSync(portFile); i++) {
    if (browser.exitCode !== null) throw Error(`Verification browser exited: ${browser.exitCode}`);
    await sleep(50);
  }
  if (!fs.existsSync(portFile)) throw Error('Browser debug endpoint was not created');
  const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params.args.map(a=>a.value??a.description));
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    if (!message.id) return;
    const item = pending.get(message.id); if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer);
    message.error ? item.reject(Error(JSON.stringify(message.error))) : item.resolve(message.result);
  });
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  await call('Network.setBlockedURLs', { urls: ['https://*'] });
  browserInfo = await call('Browser.getVersion'); evidence.browser = browserInfo;
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  evidence.entryPoints = [];
  for (const [name, entryUrl, expectedUrl] of [
    ['file', pathToFileURL(path.join(root, 'index.html')).href, pathToFileURL(path.join(root, 'dist/game.html')).href],
    ['http', `http://127.0.0.1:${server.address().port}/index.html`, `http://127.0.0.1:${server.address().port}/dist/game.html`]
  ]) {
    await navigate(entryUrl);
    const loaded = await evaluate(`({url:location.href,position:getComputedStyle(document.querySelector('.identity')).position,background:getComputedStyle(document.body).backgroundColor,images:__hazel.scene.stats().decodedImages})`);
    assert.equal(loaded.url, expectedUrl); assert.equal(loaded.position, 'absolute'); assert.equal(loaded.images, 1);
    await click(700, 560); await until('__hazel.audio.state==="running" && __hazel.audio.history.length>0');
    assert.equal(exceptions.length, 0);
    const unexpectedRequests = requests.filter(r => !r.startsWith('data:') && !r.startsWith('blob:') && r !== entryUrl && r !== expectedUrl);
    assert.deepEqual(unexpectedRequests, []);
    await shot(`entry-${name}.png`);
    if(entryOnly){await until('__hazel.scene.stats().lanes.some(l=>l.x>320&&l.x<1120&&l.y>180&&l.y<720)');await shot(`entry-${name}-sparse.png`);}
    evidence.entryPoints.push({ name, entryUrl, ...loaded, playable:true, unexpectedRequests });
  }
  if (!entryOnly) {
  for (const [name, url] of [['file', pathToFileURL(path.join(root, 'dist/game.html')).href], ['http', `http://127.0.0.1:${server.address().port}/`]]) {
    await navigate(url);
    await evaluate("localStorage.removeItem('hazel-rain-window-settings-v1')");
    await call('Page.reload', { ignoreCache: true }); await until('window.__hazelReady === true');
    const before = await evaluate('__hazel.snapshot()'); assert.equal(before.audio.contextsCreated, 0);
    await shot(`${name}-rhythm-ready.png`);
    for (let i = 0; i < 5; i++) await click(700, 560);
    await until('__hazel.audio.state === "running" && __hazel.audio.history.length > 0');
    const started = await evaluate('__hazel.snapshot()'); assert.equal(started.audio.contextsCreated, 1); assert.equal(started.audio.decodedVoices, expectedVoiceCount);
    assert.equal(started.settings.bpm, content.defaults.bpm); assert.equal(started.settings.beatOffset, content.defaults.beatOffset);
    assert.equal(started.settings.barPhase, 1); assert.equal(started.settings.musicId, content.defaults.musicId);
    assert(Math.abs(started.audio.musicLoopSeconds / (240 / content.defaults.bpm) - Math.round(started.audio.musicLoopSeconds / (240 / content.defaults.bpm))) < 1e-6);
    const decoderAlignment = await evaluate(`(()=>{const buffer=__hazel.audio.musicBuffer,channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));return ${JSON.stringify(fingerprints)}.map(f=>{const binary=atob(f.base64),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);const reference=new Float32Array(bytes.buffer);let best={lag:null,correlation:-1};for(let delta=-240;delta<=240;delta++){const lag=delta*0.000125;let cross=0,leftEnergy=0,rightEnergy=0;for(let i=0;i<reference.length;i++){const position=(f.time+i/f.rate+lag)*buffer.sampleRate,index=Math.floor(position),fraction=position-index;let actual=0;for(const data of channels)actual+=(data[index]*(1-fraction)+data[index+1]*fraction)/channels.length;cross+=reference[i]*actual;leftEnergy+=reference[i]**2;rightEnergy+=actual**2;}const correlation=cross/Math.sqrt(leftEnergy*rightEnergy);if(correlation>best.correlation)best={lag,correlation};}return {time:f.time,...best};});})()`);
    assert(decoderAlignment.every(row => Math.abs(row.lag) < 0.003 && row.correlation > 0.9));
    assert.equal(started.audio.failedVoices.length, 0);
    const imageAlpha = await evaluate(`(()=>{const result=[];for(const f of __hazel.catalog.characters.frames){const c=document.createElement('canvas');c.width=f.width;c.height=f.height;const x=c.getContext('2d');x.drawImage(__hazel.scene.images.get(f.file),0,0);const d=x.getImageData(0,0,c.width,c.height).data;let min=255,max=0;for(let i=3;i<d.length;i+=4){min=Math.min(min,d[i]);max=Math.max(max,d[i]);}result.push({skin:f.skin,state:f.state,min,max});}return result;})()`);
    assert.equal(imageAlpha.length, 1); assert(imageAlpha.every(f => f.min === 0 && f.max > 240));
    assert.equal(await evaluate('__hazel.catalog.background.kind'), 'procedural');
    assert.equal(await evaluate('__hazel.catalog.resources.filter(r=>r.file.endsWith(".webp")).length'), 1);
    const animation = await evaluate(`(()=>{const scene=__hazel.scene,base={time:10,ambientTime:20.05,settings:{...__hazel.settings.value,reduceMotion:false},voices:[],running:true};scene.clearFeedback();const samples=[0,0.5,1,4,8,12,16,20].map(beatPosition=>{scene.render({...base,beatPosition});return {...scene.stats(),beatPosition};});scene.render({...base,beatPosition:0,settings:{...base.settings,reduceMotion:true}});const reduced=scene.stats();scene.render({...base,beatPosition:0.5});const pixel=()=>Array.from(scene.ctx.getImageData(Math.round(100*scene.dpr),Math.round(360*scene.dpr),1,1).data).slice(0,3);const backgroundBefore=pixel();const variants=[];for(let i=0;i<5;i++){scene.clearFeedback();scene.confirm(20,{x:1100,y:300});scene.render({...base,beatPosition:0.5});variants.push(scene.stats().lastTap.variant);}const clicked=scene.stats(),backgroundAfter=pixel();scene.clearFeedback();for(let i=0;i<60;i++)scene.confirm(20,{x:200,y:300});const boundedCount=scene.effects.length;scene.render({...base,ambientTime:22,beatPosition:0.5});const expired=scene.stats();scene.clearFeedback();return {samples,reduced,clicked,variants,backgroundBefore,backgroundAfter,boundedCount,expired};})()`);
    const idleRange = animation.samples[0].scale - animation.samples[1].scale;
    assert(idleRange > 0 && idleRange <= 0.005);
    assert(Math.abs(animation.samples[0].scale - animation.samples[2].scale) < 1e-6);
    assert.equal(new Set(animation.samples.map(s=>s.rhythmPattern)).size, 6);
    assert(animation.samples.every(s=>Math.abs(s.bounds.x+s.bounds.width/2-720)<1e-6&&Math.abs(s.bounds.y+s.bounds.height/2-450)<1e-6&&s.frame==='idle'));
    assert.equal(animation.reduced.scale, 1); assert.equal(animation.clicked.effectCount, 1);
    assert(animation.clicked.scale > animation.samples[1].scale);
    assert.equal(new Set(animation.variants).size, 5);
    assert.deepEqual({x:animation.clicked.lastTap.x,y:animation.clicked.lastTap.y},{x:1100,y:300});
    assert(animation.clicked.haloFlash > 0.4);
    assert.notDeepEqual(animation.backgroundBefore, animation.backgroundAfter);
    assert(animation.boundedCount <= 16); assert.equal(animation.expired.effectCount, 0);
    const rhythmFeedback = await evaluate(`(async()=>{const scene=__hazel.scene,seed=scene.fieldSeed,base={time:20,ambientTime:30,settings:{...__hazel.settings.value,reduceMotion:false},voices:[],running:true};scene.clearFeedback();scene.fieldSeed=7;let flight;for(let beat=0;beat<48;beat+=0.5){scene.render({...base,beatPosition:beat});flight=scene.stats().lanes.find(l=>l.slot/2===beat);if(flight)break;}if(!flight)throw Error('No sparse flight found');const target=flight.slot/2;scene.render({...base,beatPosition:target-0.5});const approach=scene.stats();scene.render({...base,beatPosition:target-0.1});const near=scene.stats();scene.trigger(20,{x:flight.x,y:flight.y},flight.slot,987);scene.render({...base,time:19.99,beatPosition:target-0.01});const pending=scene.stats();scene.render({...base,time:20.08,beatPosition:target+0.12});const hit=scene.stats();scene.render({...base,time:20.08,beatPosition:target+0.12,settings:{...base.settings,reduceMotion:true}});const reduced=scene.stats();scene.clearFeedback();const counts=[];for(let beat=0;beat<96;beat+=0.25){scene.render({...base,beatPosition:beat});counts.push(scene.stats().noteCount);}const audio=__hazel.audio;let controlled=3.01;Object.defineProperty(audio,'beatPosition',{configurable:true,get:()=>controlled});const dots=[];for(const beat of [3.01,4.01,5.01,6.01]){controlled=beat;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));dots.push([...document.querySelectorAll('.beat-dots i')].findIndex(n=>n.classList.contains('active')));}delete audio.beatPosition;scene.fieldSeed=seed;scene.clearFeedback();return {flight,approach,near,pending,hit,reduced,counts,dots};})()`);
    assert(rhythmFeedback.approach.noteCount>=1&&rhythmFeedback.approach.noteCount<=2);
    const approaching=rhythmFeedback.approach.lanes.find(l=>l.id===rhythmFeedback.flight.id),nearby=rhythmFeedback.near.lanes.find(l=>l.id===rhythmFeedback.flight.id);
    assert(Math.hypot(approaching.x-nearby.x,approaching.y-nearby.y)>150); assert(nearby.span>=1440*0.24);
    assert(rhythmFeedback.pending.lanes.some(l=>l.id===rhythmFeedback.flight.id));
    assert(rhythmFeedback.hit.lanes.every(l=>l.id!==rhythmFeedback.flight.id)); assert.equal(rhythmFeedback.hit.hitBursts,1);
    assert.equal(rhythmFeedback.reduced.noteCount,0);assert(rhythmFeedback.counts.includes(0));assert(Math.max(...rhythmFeedback.counts)<=2);
    assert.deepEqual(rhythmFeedback.dots,[0,1,2,3]);
    // A deterministic RNG and a reset last-played ID make coordinate independence observable.
    await evaluate('globalThis.__originalRandom=Math.random;Math.random=()=>0.2');
    const choices = [];
    for (const [x, y] of [[8, 8], [1430, 8], [10, 790], [1200, 690]]) {
      await evaluate('__hazel.audio.lastSample=null;__hazel.audio.queue.clear()');
      const count = await evaluate('__hazel.audio.history.length'); await click(x, y);
      const tap = await evaluate('__hazel.scene.stats().lastTap'); assert.deepEqual({x:tap.x,y:tap.y},{x,y});
      await until(`__hazel.audio.history.length > ${count}`);
      choices.push(await evaluate('__hazel.audio.history.at(-1).sampleId'));
    }
    assert.equal(new Set(choices).size, 1); await evaluate('Math.random=__originalRandom');
    await evaluate('__hazel.audio.cancelInputs();__hazel.audio.history.length=0');
    await evaluate(`(async()=>{const a=__hazel.audio,step=30/__hazel.settings.value.bpm;while(((a.ctx.currentTime-a.origin)%step+step)%step>0.03)await new Promise(r=>setTimeout(r,5));for(let i=0;i<10;i++)__hazel.request('merge-test-'+i);})()`);
    await until('__hazel.audio.history.length === 1'); await sleep(200);
    assert.equal(await evaluate('__hazel.audio.history.length'), 1);
    const merged = await evaluate('__hazel.audio.history[0]'); assert(merged.gridErrorMs <= 20);
    assert(Math.abs(merged.sourceStart+merged.onsetOffset-merged.when)<1e-9);
    const accepted = await evaluate('__hazel.snapshot().acceptedInputs');
    await evaluate('document.getElementById("settings-button").click()'); assert.equal(await evaluate('__hazel.snapshot().acceptedInputs'), accepted);
    await call('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
    assert.equal(await evaluate('__hazel.snapshot().acceptedInputs'), accepted);
    assert.equal(await evaluate(`Array.from({length:50},()=>__hazel.audio.choose()).every(v=>v.pools.length===1&&v.pools[0]==='mixed')`), true);
    assert.equal(await evaluate('document.getElementById("pool-select")'), null);
    await evaluate("document.getElementById('close-settings').click()");
    const voiceChecks = await evaluate(`(()=>{const a=__hazel.audio;return __hazel.catalog.voices.map(v=>{const buffer=a.buffers.get(v.id);let peak=0;for(let ch=0;ch<buffer.numberOfChannels;ch++)for(const value of buffer.getChannelData(ch))peak=Math.max(peak,Math.abs(value));return {id:v.id,decoded:buffer.duration,expectedDuration:v.duration,rate:1,peakAfterGain:peak*v.gain,trimMs:v.trimSeconds*1000,prerollMs:v.onsetOffset*1000};});})()`);
    assert(voiceChecks.every(v => v.decoded > 0 && Math.abs(v.decoded-v.expectedDuration)<0.0001 && v.peakAfterGain <= 0.245 && v.prerollMs<=6.1));
    const mix = await evaluate(`(async()=>{const a=__hazel.audio,previous={...__hazel.settings.value};a.cancelInputs();for(const id of ['music-volume','master-volume']){const input=document.getElementById(id);input.value=1;input.dispatchEvent(new Event('input'));}await new Promise(r=>setTimeout(r,1500));const controls={musicBus:a.musicBus.gain.value,master:a.master.gain.value};const rate=a.ctx.sampleRate,frames=Math.ceil(rate*6);const measure=buffer=>{let peak=0,sum=0,count=0;for(let ch=0;ch<buffer.numberOfChannels;ch++)for(const value of buffer.getChannelData(ch)){if(!Number.isFinite(value))throw Error('Non-finite audio output');peak=Math.max(peak,Math.abs(value));sum+=value*value;count++;}return {peak,rms:Math.sqrt(sum/count)};};const render=async(mode,voices)=>{const ctx=new OfflineAudioContext(2,frames,rate);let master;if(mode==='old'){master=ctx.createGain();master.gain.value=0.7;const comp=ctx.createDynamicsCompressor();comp.threshold.value=-12;comp.knee.value=15;comp.ratio.value=1.8;comp.attack.value=0.003;comp.release.value=0.22;master.connect(comp);comp.connect(ctx.destination);}else{({master}=__hazel.createOutputChain(ctx,ctx.destination));master.gain.value=1;}const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=a.musicBuffer;gain.gain.value=mode==='old'?0.16000488296151616:__hazel.catalog.music.gain;source.connect(gain);gain.connect(master);source.start(0,12);if(voices){const sample=__hazel.catalog.voices.reduce((best,v)=>v.activeRms*v.gain>best.activeRms*best.gain?v:best);for(let i=0;i<4;i++){const s=ctx.createBufferSource(),g=ctx.createGain();s.buffer=a.buffers.get(sample.id);g.gain.value=sample.gain;s.connect(g);g.connect(master);s.start(1);}}return measure(await ctx.startRendering());};const old=await render('old',false),music=await render('new',false),overlap=await render('new',true);__hazel.importText(JSON.stringify(previous));return {controls,old,music,overlap,rmsRatio:music.rms/old.rms,gainDb:20*Math.log10(music.rms/old.rms)};})()`);
    assert(mix.controls.musicBus > 0.9); assert(mix.controls.master > 0.99);
    assert(mix.rmsRatio > 4); assert(mix.music.peak < 1); assert(mix.overlap.peak < 1);
    // Exercise actual source ownership, stealing and natural cleanup at the fastest allowed grid.
    const stress = await evaluate(`(async()=>{__hazel.importText(JSON.stringify({...__hazel.settings.value,bpm:180}));const a=__hazel.audio;await new Promise(r=>setTimeout(r,60));a.history.length=0;let maxActive=0,maxFading=0;const rates=[];for(const sample of __hazel.catalog.voices){a.request(sample,'stress:'+sample.id);await new Promise(r=>setTimeout(r,180));maxActive=Math.max(maxActive,a.voices.size);maxFading=Math.max(maxFading,a.fading.size);rates.push(...[...a.voices.values()].map(v=>v.source.playbackRate.value));}await new Promise(r=>setTimeout(r,3000));return {maxActive,maxFading,rates,played:[...new Set(a.history.map(v=>v.sampleId))],after:a.stats()};})()`);
    assert(stress.maxActive <= 4); assert(stress.maxFading <= 1); assert(stress.rates.every(r => r === 1));
    assert.equal(stress.played.length, expectedVoiceCount); assert.equal(stress.after.activeVoices, 0); assert.equal(stress.after.fadingVoices, 0); assert.equal(stress.after.queued, 0);
    await evaluate(`(()=>{__hazel.importText(JSON.stringify({...__hazel.settings.value,bpm:__hazel.catalog.defaults.bpm,beatOffset:__hazel.catalog.defaults.beatOffset}));__hazel.audio.history.length=0;const stage=document.getElementById('stage');stage.dispatchEvent(new PointerEvent('pointerdown',{pointerId:77,pointerType:'touch',bubbles:true}));window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:77,bubbles:true}));})()`);
    await sleep(450); assert.equal(await evaluate('__hazel.audio.history.length'), 0);
    await evaluate(`(()=>{const stage=document.getElementById('stage');stage.dispatchEvent(new PointerEvent('pointerdown',{pointerId:78,pointerType:'touch',bubbles:true}));window.dispatchEvent(new PointerEvent('pointerup',{pointerId:78,bubbles:true}));})()`);
    await until('__hazel.audio.history.length===1');
    await evaluate("__hazel.audio.cancelInputs();__hazel.scene.clearFeedback()");
    await until('__hazel.audio.voices.size===0&&__hazel.audio.fading.size===0&&__hazel.scene.currentFrame==="idle"');
    await shot(`${name}-rhythm-desktop.png`);
    await click(1120, 350); await sleep(100); await shot(`${name}-rhythm-click.png`);
    for (let i=0;i<5;i++){await evaluate('__hazel.scene.clearFeedback()');await click(1120,350);await sleep(90);await shot(`${name}-effect-${i}.png`);}
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(100); await shot(`${name}-rhythm-mobile.png`);
    const beforeTouch = await evaluate('__hazel.snapshot().acceptedInputs');
    await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 380, id: 1 }, { x: 270, y: 430, id: 2 }] });
    await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await until('__hazel.audio.history.length > 1');
    assert.equal(await evaluate('__hazel.snapshot().acceptedInputs'), beforeTouch + 2);
    const mobile = await evaluate('__hazel.snapshot()'); assert(mobile.visual.bounds.x >= -5); assert(mobile.visual.bounds.x + mobile.visual.bounds.width <= 395);
    assert(Math.abs(mobile.visual.bounds.x + mobile.visual.bounds.width / 2 - 195) < 1e-6);
    assert(Math.abs(mobile.visual.bounds.y + mobile.visual.bounds.height / 2 - 422) < 1e-6);
    await evaluate('window.dispatchEvent(new Event("blur"))'); await until('__hazel.audio.state==="paused"&&__hazel.audio.voices.size===0&&__hazel.audio.fading.size===0');
    const countBefore = await evaluate('__hazel.audio.history.length'); await sleep(500); await click(200, 380);
    await until(`__hazel.audio.state==="running"&&__hazel.audio.history.length===${countBefore + 1}`);
    assert.equal(await evaluate('__hazel.audio.contextsCreated'), 1);
    await call('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
    await sleep(100); const landscape = await evaluate('__hazel.scene.stats()');
    assert(Math.abs(landscape.bounds.x + landscape.bounds.width / 2 - 422) < 1e-6);
    assert(Math.abs(landscape.bounds.y + landscape.bounds.height / 2 - 195) < 1e-6);
    assert(landscape.bounds.y >= 0 && landscape.bounds.y + landscape.bounds.height <= 390);
    await shot(`${name}-rhythm-landscape.png`);
    await evaluate('document.getElementById("settings-button").click();document.getElementById("reduce-motion").checked=true;document.getElementById("reduce-motion").dispatchEvent(new Event("change"))');
    await shot(`${name}-settings.png`);
    const exported = await evaluate('__hazel.settings.export()'); assert.equal(JSON.parse(exported).reduceMotion, true);
    await evaluate(`__hazel.importText(${JSON.stringify('{"version":1,"skin":"uniform","pool":"mixed","bpm":89.98,"voiceVolume":9}')} )`);
    assert.equal(await evaluate('__hazel.settings.value.voiceVolume'), 0.9);
    assert.equal(await evaluate('__hazel.settings.value.bpm'), content.defaults.bpm);
    assert.equal(await evaluate('__hazel.settings.value.beatOffset'), content.defaults.beatOffset);
    assert.equal(await evaluate('__hazel.settings.value.barPhase'), 1);
    await evaluate('document.getElementById("close-settings").click()');
    await call('Page.reload', { ignoreCache: true }); await until('window.__hazelReady === true');
    assert.equal(await evaluate('__hazel.settings.value.pool'), 'mixed');
    const restored = await evaluate('__hazel.snapshot()');
    const heap = await call('Runtime.getHeapUsage');
    const externalRequests = requests.filter(r => !r.startsWith('data:') && !r.startsWith('blob:') && r !== url && !r.startsWith('file:'));
    assert.equal(exceptions.length, 0); assert.equal(externalRequests.length, 0);
    evidence.scenarios.push({ name, url, started, decoderAlignment, imageAlpha, animation, rhythmFeedback, mix, coordinateChoices: choices, mergeResult: merged, voiceChecks, stress, cancellationAndRelease: true, multiTouchInputs: 2, mobile, landscape, restored, heap, externalRequests, exceptions });
    console.log(JSON.stringify({ scenario: name, decodedVoices: expectedVoiceCount, onlySelectedVoiceDirectory: true, sprites: 1, centeredCharacter: true, beatScaling: true, proceduralBackground: true, coordinateIndependent: true, sameSlotMerged: true, fileBytes: fs.statSync(path.join(root, 'dist/game.html')).size }));
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  }
  await navigate(pathToFileURL(path.join(root, 'dist/game.html')).href);
  await evaluate("localStorage.setItem('hazel-rain-window-settings-v1','{broken')");
  await call('Page.reload', { ignoreCache: true }); await until('window.__hazelReady===true');
  assert.equal(await evaluate('__hazel.settings.value.skin'), 'uniform');
  const hook = await call('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(Storage.prototype,'getItem',{value(){throw new DOMException('denied','SecurityError')}});Object.defineProperty(Storage.prototype,'setItem',{value(){throw new DOMException('denied','SecurityError')}});` });
  await call('Page.reload', { ignoreCache: true }); await until('window.__hazelReady===true'); await click(700, 560); await until('__hazel.audio.state==="running"');
  assert.equal(await evaluate('__hazel.settings.available'), false); evidence.storageUnavailable = await evaluate('__hazel.snapshot()');
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: hook.identifier });
  await call('Page.reload', { ignoreCache: true }); await until('window.__hazelReady===true');
  await evaluate('__TEST_FAIL_RESOURCE=__hazel.catalog.music.file'); await click(700, 560);
  await until('__hazel.audio.state==="error"&&__hazel.audio.promise===null');
  await evaluate('delete window.__TEST_FAIL_RESOURCE'); await click(700, 560); await until('__hazel.audio.state==="running"');
  assert.equal(await evaluate('__hazel.audio.contextsCreated'), 2); evidence.retryAfterFailure = await evaluate('__hazel.snapshot()');
  assert.equal(exceptions.length, 0);
  }
  evidence.pass = true;
  fs.writeFileSync(path.join(output, evidenceFile), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, browser: browserInfo.product, evidence: `test-results/${evidenceFile}` }));
} catch (error) {
  evidence.pass = false; evidence.error = error.stack;
  evidence.failureRequests = requests; evidence.failureExceptions = exceptions;
  try { evidence.failureSnapshot = await evaluate('window.__hazel?.snapshot()'); await shot('failure.png'); } catch {}
  fs.writeFileSync(path.join(output, evidenceFile), JSON.stringify(evidence, null, 2));
  throw error;
} finally {
  server.close();
  if (socket?.readyState === WebSocket.OPEN) { try { await call('Browser.close'); } catch {} socket.close(); }
  for (let i = 0; i < 40 && browser.exitCode === null; i++) await sleep(50);
  if (browser.exitCode === null) browser.kill();
  const relative = path.relative(root, profile);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }); }
    catch { console.log(JSON.stringify({ retainedTestProfile: profile })); }
  }
}
