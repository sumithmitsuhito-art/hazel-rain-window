import { SettingsStore } from './settings.mjs';
import { ResourceStore } from './resources.mjs';
import { AudioEngine } from './audio.mjs';
import { VisualScene } from './visuals.mjs';
import { createOutputChain } from './mix.mjs';
import { beatInBar } from './beat-clock.mjs';

(async () => {
  const element = document.getElementById('embedded-resources');
  const payload = JSON.parse(element.textContent); element.remove();
  const catalog = payload.catalog;
  const records = Object.fromEntries(Object.entries(payload.index).map(([file, index]) => [file, payload.records[index]]));
  const resources = new ResourceStore(records);
  const defaults = { ...catalog.defaults, reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches };
  let storage = null; try { storage = window.localStorage; } catch {}
  const settings = new SettingsStore(defaults, storage);
  const stage = document.getElementById('stage'), welcome = document.getElementById('welcome');
  const startButton = document.getElementById('start-button'), pauseButton = document.getElementById('pause-button');
  const dialog = document.getElementById('settings-dialog');
  const scene = new VisualScene(document.getElementById('scene'), catalog);
  let latestIntent = null, startPromise = null, pausePromise = Promise.resolve(), generation = 0, acceptedInputs = 0, imagesReady = false, pauseRequested = false;
  let toastTimer = null, lastCaption = '', lastState = 'idle', lastDisplayedBeat = -2;
  const beatDots = [...document.querySelectorAll('.beat-dots i')];
  const pointers = new Set(), keys = new Set();
  const toast = text => {
    const node = document.getElementById('toast'); node.textContent = text; node.classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('visible'), 2700);
  };
  const welcomeText = (title, message, button) => {
    document.getElementById('welcome-title').textContent = title;
    document.getElementById('welcome-message').textContent = message;
    startButton.firstChild.textContent = `${button} `;
  };
  const audio = new AudioEngine(catalog, resources, () => settings.value, state => {
    lastState = state; pauseButton.disabled = !['running', 'paused'].includes(state);
    welcome.dataset.state = state;
    welcome.classList.toggle('hidden', state === 'running');
    document.getElementById('pause-symbol').textContent = state === 'paused' ? '▷' : 'Ⅱ';
    pauseButton.setAttribute('aria-label', state === 'paused' ? '继续音乐和语音' : '暂停音乐和语音');
    if (state === 'loading') welcomeText('声音正在靠近。', '正在准备音乐和小满的声音……', '准备中');
    else if (state === 'paused') welcomeText('雨还在下。', '轻点一下，继续窗边的时光。', '继续');
    else if (state === 'error') welcomeText('稍等，再试一次。', '声音暂时没有准备好，可以重新加载。', '重试');
  }, (voice, record) => scene.trigger(voice.start, voice.point, record.slot, voice.id));
  audio.onCancelled = voice => scene.cancelTrigger(voice);

  const loadImages = async () => {
    const files = catalog.characters.frames.map(f => f.file);
    const results = await Promise.allSettled(files.map(file => resources.image(file)));
    const images = new Map();
    for (let i = 0; i < files.length; i++) if (results[i].status === 'fulfilled') images.set(files[i], results[i].value);
    const essential = files;
    if (essential.some(file => !images.has(file))) throw Error('Required image failed');
    scene.setImages(images); imagesReady = true;
  };
  let imagePromise = loadImages();
  imagePromise.catch(() => {
    imagesReady = false; welcome.classList.remove('hidden'); welcomeText('画面还没准备好。', '请重试加载。', '重试');
  });

  const refreshControls = () => {
    const s = settings.value;
    document.body.classList.toggle('reduced-motion', s.reduceMotion);
    document.getElementById('tempo-readout').textContent = `${s.bpm.toFixed(2)} BPM`;
    document.getElementById('voice-count').textContent = `${catalog.voices.length} 条，随机播放`;
    for (const [prefix, key] of [['music', 'musicVolume'], ['voice', 'voiceVolume'], ['master', 'masterVolume']]) {
      document.getElementById(`${prefix}-volume`).value = s[key];
      document.getElementById(`${prefix}-value`).textContent = `${Math.round(s[key] * 100)}%`;
    }
    document.getElementById('reduce-motion').checked = s.reduceMotion;
    document.getElementById('bpm-input').value = s.bpm;
    document.getElementById('offset-input').value = s.beatOffset;
    document.getElementById('bar-phase').value = s.barPhase;
    document.getElementById('storage-status').textContent = settings.available ? '设置已保存。移动文件或换浏览器时，可用导入导出备份。' : '当前浏览器无法自动保存，仍可游玩；请导出设置备份。';
  };
  const update = patch => {
    const previous = settings.value;
    settings.update(patch); refreshControls(); audio.applyVolumes();
    if (previous.pool !== settings.value.pool) { generation++; latestIntent = null; audio.cancelInputs(); scene.clearFeedback(); }
    if (previous.bpm !== settings.value.bpm || previous.beatOffset !== settings.value.beatOffset) {
      generation++; latestIntent = null; audio.cancelInputs(); scene.clearFeedback();
      if (audio.state === 'running') { audio.startTransport(); toast('已按新的拍点重新开始音乐。'); }
    }
  };
  const ensureRunning = () => {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      if (!imagesReady) { imagePromise = loadImages(); await imagePromise; } else await imagePromise;
      await pausePromise;
      if (audio.state === 'paused') await audio.resume(); else await audio.initialize();
      if (document.hidden || pauseRequested) await audio.pause();
    })().finally(() => { startPromise = null; });
    return startPromise;
  };
  const request = async (inputId, point) => {
    pauseRequested = false;
    acceptedInputs++; scene.confirm(performance.now() / 1000, point);
    let sample = audio.choose();
    if (!sample) sample = catalog.voices.find(v => v.pools.includes(settings.value.pool));
    latestIntent = { inputId, point, sampleId: sample?.id, generation };
    try {
      await ensureRunning();
      const intent = latestIntent; latestIntent = null;
      if (intent && intent.generation === generation && audio.state === 'running') {
        const chosen = catalog.voices.find(v => v.id === intent.sampleId && audio.buffers.has(v.id));
        if (chosen) audio.request(chosen, intent.inputId, intent.point);
        else toast('这一条声音暂未准备好，请再点一次。');
      }
    } catch (error) {
      latestIntent = null; console.error('Audio preparation:', error); toast('声音准备失败，可点击重试。');
    }
  };
  const cancelAll = () => {
    generation++; latestIntent = null; pointers.clear(); keys.clear(); audio.cancelInputs(); scene.clearFeedback();
  };
  const pause = () => {
    pauseRequested = true;
    cancelAll(); pausePromise = audio.pause(); return pausePromise;
  };
  stage.addEventListener('pointerdown', event => {
    if (event.target.closest('[data-ui]') || dialog.open || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); if (pointers.has(event.pointerId)) return;
    pointers.add(event.pointerId); try { stage.setPointerCapture(event.pointerId); } catch {}
    request(`pointer:${event.pointerId}`, { x: event.clientX, y: event.clientY });
  }, { passive: false });
  window.addEventListener('pointerup', event => { pointers.delete(event.pointerId); });
  window.addEventListener('pointercancel', event => {
    pointers.delete(event.pointerId);
    if (latestIntent?.inputId === `pointer:${event.pointerId}`) latestIntent = null;
    audio.cancelPointer(`pointer:${event.pointerId}`);
  });
  window.addEventListener('keydown', event => {
    if (!['Space', 'Enter'].includes(event.code) || event.repeat || event.ctrlKey || event.altKey || event.metaKey || dialog.open) return;
    if (event.target.closest('button,input,select,textarea,[contenteditable=true]')) return;
    event.preventDefault(); if (keys.has(event.code)) return;
    keys.add(event.code); request(`keyboard:${event.code}`);
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  startButton.addEventListener('click', event => { event.stopPropagation(); request('start-button'); });
  pauseButton.addEventListener('click', async () => {
    if (audio.state === 'running') await pause();
    else try { pauseRequested = false; await ensureRunning(); } catch { toast('暂时无法恢复，请重试。'); }
  });
  document.getElementById('settings-button').addEventListener('click', () => { cancelAll(); refreshControls(); dialog.showModal(); });
  document.getElementById('close-settings').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  });
  for (const [prefix, key] of [['music', 'musicVolume'], ['voice', 'voiceVolume'], ['master', 'masterVolume']]) document.getElementById(`${prefix}-volume`).addEventListener('input', event => update({ [key]: Number(event.target.value) }));
  document.getElementById('reduce-motion').addEventListener('change', event => update({ reduceMotion: event.target.checked }));
  document.getElementById('bpm-input').addEventListener('change', event => update({ bpm: Number(event.target.value) }));
  document.getElementById('offset-input').addEventListener('change', event => update({ beatOffset: Number(event.target.value) }));
  document.getElementById('bar-phase').addEventListener('change', event => update({ barPhase: Number(event.target.value) }));
  document.getElementById('export-settings').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([settings.export()], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = '灰泽满-雨雾设置.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
  const importText = text => { settings.import(text); cancelAll(); refreshControls(); audio.applyVolumes(); if (audio.state === 'running') audio.startTransport(); };
  const fileInput = document.getElementById('settings-file');
  document.getElementById('import-settings').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    try { if (fileInput.files[0]) { importText(await fileInput.files[0].text()); toast('设置已导入。'); } }
    catch { toast('设置文件无法读取，请选择有效的设置 JSON。'); }
    fileInput.value = '';
  });
  window.addEventListener('resize', () => { cancelAll(); scene.resize(); });
  window.addEventListener('blur', () => { if (audio.state === 'running') pause(); else { pauseRequested = true; cancelAll(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (audio.state === 'running') pause(); else { pauseRequested = true; cancelAll(); } } });
  window.addEventListener('pagehide', () => { cancelAll(); audio.stopSources(); resources.dispose(); });
  const render = () => {
    requestAnimationFrame(render);
    scene.render({ time: audio.visualTime, ambientTime: performance.now() / 1000, beatPosition: audio.beatPosition, settings: settings.value, voices: audio.views, running: audio.state === 'running' });
    const beat = audio.state === 'running' && audio.beatPosition >= 0 ? beatInBar(audio.beatPosition, settings.value.barPhase) : -1;
    if (beat !== lastDisplayedBeat) { beatDots.forEach((dot, index) => dot.classList.toggle('active', index === beat)); lastDisplayedBeat = beat; }
    const caption = scene.latestCaption || '雨声很轻，节奏刚刚好。';
    if (caption !== lastCaption) { document.getElementById('voice-caption').textContent = caption; lastCaption = caption; }
  };
  refreshControls(); render();
  window.__hazel = {
    catalog, audio, scene, settings, request, pause, importText, createOutputChain,
    snapshot: () => ({ acceptedInputs, imagesReady, state: lastState, settings: { ...settings.value }, storageAvailable: settings.available, audio: audio.stats(), visual: scene.stats(), dialogOpen: dialog.open }),
  };
  await imagePromise.catch(() => {}); window.__hazelReady = imagesReady;
})().catch(error => { console.error('Application preparation:', error); document.getElementById('welcome-message').textContent = '画面准备失败，请重新打开页面。'; });
