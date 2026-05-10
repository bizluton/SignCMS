'use strict';
const fs   = require('fs');
const path = require('path');

class ConfigManager {
  constructor(userDataPath) {
    this._path = path.join(userDataPath, 'config.json');
    this._data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this._path))
        return JSON.parse(fs.readFileSync(this._path, 'utf8'));
    } catch {}
    return {};
  }

  _save() {
    try { fs.writeFileSync(this._path, JSON.stringify(this._data, null, 2), 'utf8'); }
    catch (e) { console.error('[Config] save failed:', e.message); }
  }

  get(key, def = null)  { return this._data[key] ?? def; }
  set(key, value)       { this._data[key] = value; this._save(); }
  setAll(obj)           { Object.assign(this._data, obj); this._save(); }
  getAll()              { return { ...this._data }; }
  isConfigured()        { return !!(this._data.serverUrl && this._data.deviceToken); }
}

module.exports = ConfigManager;
