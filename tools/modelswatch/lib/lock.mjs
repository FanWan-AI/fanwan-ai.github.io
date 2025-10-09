import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { DEFAULT_LOCK_TTL_MS } from './constants.mjs';
import { resolveDataPath } from './paths.mjs';

export class PipelineLock {
  constructor(lockName = 'pipeline.lock') {
    this.lockPath = resolveDataPath(lockName);
    this.handle = null;
  }

  async acquire(options = {}) {
    const {
      owner = 'daily',
      ttlMs = DEFAULT_LOCK_TTL_MS,
      force = false
    } = options;

    await fs.mkdir(path.dirname(this.lockPath), { recursive: true });
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    const payload = {
      owner,
      host: os.hostname(),
      pid: process.pid,
      started_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      ttl_ms: ttlMs
    };

    if (force) {
      await this.release().catch(() => {});
    } else {
      const existing = await this.read().catch(() => null);
      if (existing && !this.isExpired(existing)) {
        const err = new Error(`Pipeline lock already held by ${existing.owner} (pid=${existing.pid})`);
        err.code = 'LOCK_HELD';
        err.lock = existing;
        throw err;
      }
    }

    const serialized = JSON.stringify(payload, null, 2);
    try {
      this.handle = await fs.open(this.lockPath, 'wx', 0o644);
      await this.handle.writeFile(`${serialized}\n`);
      await this.handle.sync();
      return payload;
    } catch (err) {
      if (err.code === 'EEXIST') {
        const existing = await this.read().catch(() => null);
        if (existing && this.isExpired(existing)) {
          await this.release().catch(() => {});
          return this.acquire(options);
        }
        err.lock = existing;
      }
      throw err;
    }
  }

  async read() {
    const buf = await fs.readFile(this.lockPath, 'utf8');
    return JSON.parse(buf);
  }

  isExpired(lock) {
    if (!lock || !lock.expires_at) return true;
    return Date.now() >= Date.parse(lock.expires_at);
  }

  async release() {
    if (this.handle) {
      await this.handle.close().catch(() => {});
      this.handle = null;
    }
    await fs.unlink(this.lockPath).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }
}

export async function withPipelineLock(callback, options = {}) {
  const lock = new PipelineLock(options.lockName);
  await lock.acquire(options);
  try {
    return await callback();
  } finally {
    await lock.release();
  }
}
