export const SETTINGS_KEY = 'hazel-rain-window-settings-v1';

export function validateSettings(input, defaults) {
  const result = { ...defaults };
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== 1) return result;
  const choices = { skin: ['uniform'], pool: ['mixed'] };
  for (const [key, values] of Object.entries(choices)) if (values.includes(input[key])) result[key] = input[key];
  const ranges = { musicVolume: [0, 1], voiceVolume: [0, 1], masterVolume: [0, 1], bpm: [40, 180], beatOffset: [0, 5] };
  const sameMusic = !defaults.musicId || input.musicId === defaults.musicId;
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (!sameMusic && (key === 'bpm' || key === 'beatOffset')) continue;
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max) result[key] = value;
  }
  if (typeof input.reduceMotion === 'boolean') result.reduceMotion = input.reduceMotion;
  if (sameMusic && Number.isInteger(input.barPhase) && input.barPhase >= 0 && input.barPhase <= 3) result.barPhase = input.barPhase;
  return result;
}

export class SettingsStore {
  constructor(defaults, storage) {
    this.defaults = defaults; this.storage = storage; this.available = true;
    try { this.value = validateSettings(JSON.parse(storage?.getItem(SETTINGS_KEY) ?? 'null'), defaults); }
    catch { this.value = { ...defaults }; this.available = false; }
  }
  update(patch) {
    this.value = validateSettings({ ...this.value, ...patch, version: 1 }, this.defaults);
    try { if (!this.storage) throw Error('Storage unavailable'); this.storage.setItem(SETTINGS_KEY, JSON.stringify(this.value)); this.available = true; }
    catch { this.available = false; }
    return this.value;
  }
  import(text) {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== 1) throw Error('Unsupported settings file');
    return this.update(validateSettings(raw, this.defaults));
  }
  export() { return JSON.stringify(this.value, null, 2); }
}
