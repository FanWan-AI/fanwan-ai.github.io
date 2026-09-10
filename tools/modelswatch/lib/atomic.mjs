import { promises as fs } from 'fs';
import path from 'path';
import { DEFAULT_FILE_ENCODING } from './constants.mjs';

let batch = null;
export function beginWriteBatch() {
  if (batch) throw new Error('A publish transaction is already active');
  batch = new Map();
}
export function discardWriteBatch() { batch = null; }
export async function readStagedFile(filePath, encoding) {
  const staged = batch?.get(path.resolve(filePath));
  if (staged) return encoding ? Buffer.from(staged.data).toString(encoding) : Buffer.from(staged.data);
  return fs.readFile(filePath, encoding);
}
export async function commitWriteBatch({ beforeWrite } = {}) {
  const writes = batch;
  if (!writes) throw new Error('No publish transaction');
  batch = null;
  const previous = new Map(), changed = [];
  // Capture every original before touching any release file.
  for (const file of writes.keys()) {
    try { previous.set(file, await fs.readFile(file)); }
    catch (err) { if (err.code !== 'ENOENT') throw err; previous.set(file, null); }
  }
  try {
    for (const [file, { data, options }] of writes) {
      if (beforeWrite) await beforeWrite(file);
      changed.push(file);
      await atomicWriteFile(file, data, options);
    }
  } catch (err) {
    const failures = [];
    for (const file of changed.reverse()) {
      try {
        const original = previous.get(file);
        if (original === null) await fs.unlink(file).catch(e => { if (e.code !== 'ENOENT') throw e; });
        else await atomicWriteFile(file, original);
      } catch (rollback) { failures.push(rollback); }
    }
    if (failures.length) throw new AggregateError([err, ...failures], 'Publish rollback failed; restore from the prior deployed revision');
    throw err;
  }
}

function buildTempPath(targetPath) {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const stamp = `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
  return path.join(dir, `.${base}.${stamp}.tmp`);
}

export async function atomicWriteFile(targetPath, data, options = {}) {
  if (batch) { batch.set(path.resolve(targetPath), { data, options }); return targetPath; }
  const { mode = 0o644, encoding = DEFAULT_FILE_ENCODING, skipSync = false } = options;
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = buildTempPath(targetPath);
  const fileHandle = await fs.open(tempPath, 'w', mode);
  try {
    if (typeof data === 'string' || data instanceof Uint8Array) {
      await fileHandle.writeFile(data);
    } else {
      await fileHandle.writeFile(String(data), { encoding });
    }
    if (!skipSync) {
      await fileHandle.datasync();
    }
  } finally {
    await fileHandle.close();
  }

  await fs.rename(tempPath, targetPath);

  if (!skipSync && process.platform !== 'win32') {
    const dirHandle = await fs.open(dir, 'r');
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
  }

  await fs.chmod(targetPath, mode);
  return targetPath;
}

export async function atomicWriteJson(targetPath, payload, options = {}) {
  const { pretty = true, trailingNewline = true } = options;
  const json = pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
  const data = trailingNewline ? `${json}\n` : json;
  return atomicWriteFile(targetPath, data, options);
}
