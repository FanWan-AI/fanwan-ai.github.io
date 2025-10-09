import crypto from 'crypto';
import { formatDateKey } from './time.mjs';

export function generateRunId(step) {
  const stamp = new Date().toISOString().replace(/[-:TZ]/g, '').slice(0, 15);
  const hash = crypto.randomBytes(4).toString('hex');
  const safeStep = String(step || 'run').replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '').toLowerCase();
  return `${safeStep || 'run'}-${formatDateKey()}-${stamp}-${hash}`;
}
