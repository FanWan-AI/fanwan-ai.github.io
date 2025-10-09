import { promises as fs } from 'fs';
import path from 'path';
import { atomicWriteJson } from './atomic.mjs';
import { resolveAuditPath } from './paths.mjs';
import { validateArtifact } from './schema.mjs';
import { PIPELINE_VERSION, SCHEMA_VERSION } from './constants.mjs';
import { formatDateKey, nowUtcISOString } from './time.mjs';

async function readRunlog(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

export class RunlogWriter {
  constructor(step, runId, dateKey = formatDateKey()) {
    this.step = step;
    this.runId = runId;
    this.dateKey = dateKey;
    this.filePath = resolveAuditPath(`${dateKey}_runlog.json`);
    this.entries = [];
    this.loaded = false;
  }

  async ensureLoaded() {
    if (this.loaded) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const existing = await readRunlog(this.filePath);
    if (existing && Array.isArray(existing.entries)) {
      this.entries = existing.entries;
    }
    this.loaded = true;
  }

  async append(status, details = {}) {
    await this.ensureLoaded();
    const entry = {
      run_id: this.runId,
      step: this.step,
      status,
      timestamp: nowUtcISOString(),
      ...details
    };
    this.entries.push(entry);
    await this.persist();
    return entry;
  }

  async persist() {
    const payload = {
      schema_version: SCHEMA_VERSION,
      pipeline_version: PIPELINE_VERSION,
      date: this.dateKey,
      entries: this.entries
    };
    await validateArtifact('runlog', payload);
    await atomicWriteJson(this.filePath, payload, { pretty: true });
  }
}

export async function logRunEvent({ step, runId, status, details, dateKey }) {
  const writer = new RunlogWriter(step, runId, dateKey);
  return writer.append(status, details);
}
