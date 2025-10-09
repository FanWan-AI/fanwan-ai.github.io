import { promises as fs } from 'fs';
import path from 'path';
import { DEFAULT_FILE_ENCODING } from './constants.mjs';

function buildTempPath(targetPath) {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const stamp = `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
  return path.join(dir, `.${base}.${stamp}.tmp`);
}

export async function atomicWriteFile(targetPath, data, options = {}) {
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

  if (!skipSync) {
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
