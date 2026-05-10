'use strict';
const fs     = require('fs');
const fsp    = require('fs/promises');
const path   = require('path');
const crypto = require('crypto');
const https  = require('https');
const http   = require('http');

const SHA256_LEN     = 64;
const MIN_FREE_BYTES = 512 * 1024 * 1024;   // 512 MB
const MAX_CONCURRENT = 3;
const MAX_RETRY      = 3;

class DownloadService {
  constructor(userDataPath) {
    this.casDir       = path.join(userDataPath, 'cas');
    this._failPath    = path.join(this.casDir, '_failures.json');
    this._failures    = {};
    this._lruMap      = {};   // sha256 → last-used ms (memory only)
    this._lruThrottle = {};   // sha256 → last mtime write ms
    this._ready       = this._init();
    this._onProgress  = null; // (downloaded, total, sha256) => void
  }

  setProgressCallback(fn) { this._onProgress = fn; }

  async _init() {
    await fsp.mkdir(this.casDir, { recursive: true });
    await this._cleanupOrphans();
    this._loadFailures();
  }

  async _cleanupOrphans() {
    try {
      for (const name of await fsp.readdir(this.casDir)) {
        if (name === '_failures.json') continue;
        const full = path.join(this.casDir, name);
        const st   = await fsp.stat(full).catch(() => null);
        if (!st) continue;
        if (name.endsWith('.tmp') || (name.length === SHA256_LEN && st.size === 0))
          await fsp.unlink(full).catch(() => {});
      }
    } catch {}
  }

  _loadFailures() {
    try {
      if (fs.existsSync(this._failPath))
        this._failures = JSON.parse(fs.readFileSync(this._failPath, 'utf8'));
    } catch { this._failures = {}; }
  }

  _saveFailures() {
    try { fs.writeFileSync(this._failPath, JSON.stringify(this._failures, null, 2)); }
    catch {}
  }

  casPath(sha256) { return path.join(this.casDir, sha256); }

  // Returns local file path if cached, null otherwise. Throttles mtime writes.
  getLocalFile(sha256) {
    const f = this.casPath(sha256);
    if (!fs.existsSync(f)) return null;
    const now  = Date.now();
    const last = this._lruThrottle[sha256] || 0;
    if (now - last >= 60_000) {
      try { fs.utimesSync(f, new Date(now), new Date(now)); } catch {}
      this._lruThrottle[sha256] = now;
    }
    this._lruMap[sha256] = now;
    return f;
  }

  async syncAssets(manifest) {
    await this._ready;

    const entries    = manifest.filter(e => e.sha256?.length === SHA256_LEN);
    const currentSet = new Set(entries.map(e => e.sha256));
    const missing    = [];

    for (const entry of entries) {
      const fail = this._failures[entry.sha256];
      if (fail?.attempts >= MAX_RETRY) continue; // permanently failed

      const f  = this.casPath(entry.sha256);
      const st = fs.existsSync(f) ? fs.statSync(f) : null;

      if (!st) {
        missing.push(entry);
      } else if (st.size === 0) {
        fs.unlinkSync(f);
        delete this._lruMap[entry.sha256];
        missing.push(entry);
      } else if (entry.size > 0 && st.size !== entry.size) {
        fs.unlinkSync(f);
        delete this._lruMap[entry.sha256];
        missing.push(entry);
      } else {
        this._lruMap[entry.sha256] = st.mtimeMs;
      }
    }

    // Build result map for already-present files
    const casFiles = {};
    for (const entry of entries) {
      const f = this.getLocalFile(entry.sha256);
      if (f) casFiles[entry.sha256] = f;
    }

    // Parallel downloads with concurrency cap
    let downloaded = 0;
    const total = missing.length;
    const queue = [...missing];

    const worker = async () => {
      while (queue.length > 0) {
        const entry = queue.shift();
        if (!entry) continue;
        const f = await this._fetchAsset(entry).catch(e => {
          console.error(`[CAS] download error ${entry.sha256.slice(0,8)}: ${e.message}`);
          return null;
        });
        if (f) {
          casFiles[entry.sha256] = f;
          downloaded++;
          this._onProgress?.(downloaded, total, entry.sha256);
        }
      }
    };

    const workers = Array.from({ length: Math.min(MAX_CONCURRENT, missing.length || 1) }, worker);
    await Promise.all(workers);

    await this._evictLRU(currentSet);
    return casFiles;
  }

  async _fetchAsset(entry) {
    const { sha256, url } = entry;
    const tmp   = this.casPath(sha256) + '.tmp';
    const final = this.casPath(sha256);
    const attempts = (this._failures[sha256]?.attempts || 0) + 1;

    try {
      await this._downloadToFile(url, tmp);
      const actual = await this._sha256File(tmp);

      if (actual !== sha256) {
        await fsp.unlink(tmp).catch(() => {});
        this._recordFailure(sha256, url, attempts, sha256, actual, 'hash mismatch');
        return null;
      }

      await fsp.rename(tmp, final);
      if (this._failures[sha256]) { delete this._failures[sha256]; this._saveFailures(); }
      this._lruMap[sha256] = Date.now();
      return final;
    } catch (e) {
      await fsp.unlink(tmp).catch(() => {});
      this._recordFailure(sha256, url, attempts, sha256, null, e.message);
      return null;
    }
  }

  _downloadToFile(url, dest) {
    return new Promise((resolve, reject) => {
      const proto = url.startsWith('https') ? https : http;
      const file  = fs.createWriteStream(dest);
      const req   = proto.get(url, { timeout: 90_000 }, (res) => {
        if (res.statusCode !== 200) {
          file.destroy();
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('download timeout')); });
    });
  }

  _sha256File(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      fs.createReadStream(filePath)
        .on('data', c => hash.update(c))
        .on('end',  () => resolve(hash.digest('hex')))
        .on('error', reject);
    });
  }

  _recordFailure(sha256, url, attempts, expected, actual, err) {
    this._failures[sha256] = { sha256, url, attempts, lastFailedMs: Date.now(),
      expectedHash: expected, actualHash: actual ?? null, lastError: err };
    this._saveFailures();
  }

  async _evictLRU(currentSet) {
    const free = await this._getFreeBytes();
    if (free > MIN_FREE_BYTES) return;

    const entries = [];
    for (const name of (await fsp.readdir(this.casDir).catch(() => []))) {
      if (name.length !== SHA256_LEN || currentSet.has(name)) continue;
      const full = path.join(this.casDir, name);
      const st   = await fsp.stat(full).catch(() => null);
      if (st) entries.push({ name, full, mtime: st.mtimeMs, size: st.size });
    }
    entries.sort((a, b) => a.mtime - b.mtime); // oldest first

    let freed = 0;
    const target = MIN_FREE_BYTES * 0.25;
    for (const c of entries) {
      await fsp.unlink(c.full).catch(() => {});
      delete this._lruMap[c.name];
      freed += c.size;
      if (freed >= target) break;
    }
    if (freed > 0) console.log(`[CAS] evicted ${(freed/1024/1024).toFixed(1)} MB`);
  }

  async _getFreeBytes() {
    try {
      const { statfs } = require('fs/promises');
      const s = await statfs(this.casDir);
      return s.bavail * s.bsize;
    } catch {
      // Node < 19 fallback: assume enough space
      return MIN_FREE_BYTES * 2;
    }
  }

  async verifyIntegrity(onProgress) {
    await this._ready;
    const names = (await fsp.readdir(this.casDir)).filter(n => n.length === SHA256_LEN);
    let checked = 0;
    for (const name of names) {
      const full   = path.join(this.casDir, name);
      const actual = await this._sha256File(full).catch(() => null);
      const ok     = actual === name;
      if (!ok) { await fsp.unlink(full).catch(() => {}); delete this._lruMap[name]; }
      checked++;
      onProgress?.(checked, names.length, name, ok);
    }
  }

  getDiskStatus(manifest = []) {
    const entries = manifest.filter(e => e.sha256?.length === SHA256_LEN);
    let casTotalBytes = 0, casFileCount = 0, manifestSynced = 0, manifestFailed = 0;
    try {
      for (const name of fs.readdirSync(this.casDir)) {
        if (name.length !== SHA256_LEN) continue;
        const st = fs.statSync(path.join(this.casDir, name));
        casTotalBytes += st.size;
        casFileCount++;
      }
    } catch {}
    for (const e of entries) {
      if (fs.existsSync(this.casPath(e.sha256))) manifestSynced++;
      if ((this._failures[e.sha256]?.attempts || 0) >= MAX_RETRY) manifestFailed++;
    }
    return {
      casDirPath:        this.casDir,
      casTotalBytes,
      casFileCount,
      freeBytesExternal: 0, // filled async by caller if needed
      manifestTotal:     entries.length,
      manifestSynced,
      manifestPending:   entries.length - manifestSynced,
      manifestFailed,
      failures:          Object.values(this._failures).filter(f => f.attempts >= MAX_RETRY),
    };
  }
}

module.exports = DownloadService;
