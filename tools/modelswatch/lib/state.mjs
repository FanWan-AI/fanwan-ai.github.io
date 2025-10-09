import { promises as fs } from 'fs';
import path from 'path';
import { resolveDataPath } from './paths.mjs';
import { atomicWriteJson } from './atomic.mjs';
import { validateArtifact } from './schema.mjs';
import { PIPELINE_VERSION, SCHEMA_VERSION } from './constants.mjs';
import { nowUtcISOString } from './time.mjs';

const STATE_FILE = resolveDataPath('state.json');

async function readStateFile() {
  try {
    const txt = await fs.readFile(STATE_FILE, 'utf8');
    return JSON.parse(txt);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

export async function readState() {
  const data = await readStateFile();
  if (!data) {
    return {
      schema_version: SCHEMA_VERSION,
      pipeline_version: PIPELINE_VERSION,
      run_id: null,
      updated_at: null,
      locks: {},
      counters: {},
      notes: {}
    };
  }
  return data;
}

export async function writeState(partial, { runId } = {}) {
  const current = await readState();
  const payload = {
    ...current,
    ...partial,
    schema_version: SCHEMA_VERSION,
    pipeline_version: PIPELINE_VERSION,
    run_id: runId ?? partial.run_id ?? current.run_id,
    updated_at: nowUtcISOString()
  };
  await validateArtifact('state', payload);
  const skipSync = process.platform === 'win32';
  await atomicWriteJson(STATE_FILE, payload, { pretty: true, skipSync });
  return payload;
}
