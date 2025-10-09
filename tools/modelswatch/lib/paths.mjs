import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '../../..');
export const MODEL_SWATCH_DIR = path.join(ROOT_DIR, 'data/ai/modelswatch');
export const AUDIT_DIR = path.join(ROOT_DIR, 'tools/modelswatch/audit');
export const SCHEMA_DIR = path.join(ROOT_DIR, 'docs/schemas/modelswatch');

export function resolveDataPath(...segments) {
  return path.join(MODEL_SWATCH_DIR, ...segments);
}

export function resolveAuditPath(...segments) {
  return path.join(AUDIT_DIR, ...segments);
}

export function resolveSchemaPath(fileName) {
  return path.join(SCHEMA_DIR, fileName);
}
