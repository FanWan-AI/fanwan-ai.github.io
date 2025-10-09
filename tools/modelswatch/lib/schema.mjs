import { promises as fs } from 'fs';
import { resolveSchemaPath } from './paths.mjs';

const SCHEMA_FILES = {
  raw_corpus: 'raw_corpus.schema.json',
  daily_draft: 'daily_draft.schema.json',
  unqualified: 'unqualified.schema.json',
  pending_summaries: 'pending_summaries.schema.json',
  tri_staging: 'tri_cache_staging.schema.json',
  summary_cache: 'summary_cache.schema.json',
  passonce: 'passonce.schema.json',
  qualified: 'qualified.schema.json',
  daily_tasklist: 'daily_tasklist.schema.json',
  runlog: 'runlog.schema.json',
  state: 'state.schema.json',
  daily_release: 'daily_release.schema.json',
  daily_legacy: 'daily_legacy.schema.json',
  models_by_task_index: 'models_by_task.schema.json',
  projects_by_category_index: 'projects_by_category.schema.json',
  models_hotlist: 'models_hotlist.schema.json',
  projects_hotlist: 'projects_hotlist.schema.json',
  publish_audit: 'publish_audit.schema.json'
};

let ajvInstancePromise = null;

async function loadAjv() {
  if (!ajvInstancePromise) {
    ajvInstancePromise = (async () => {
      let AjvMod;
      let addFormats;
      try {
        AjvMod = await import('ajv');
        addFormats = (await import('ajv-formats')).default;
      } catch (err) {
        throw new Error(
          'Missing dependency "ajv" or "ajv-formats". Please run `npm install` before executing the modelswatch pipeline.'
        );
      }
      const ajv = new AjvMod.default({
        strict: false,
        allErrors: true,
        allowUnionTypes: true
      });
      addFormats(ajv);
      return ajv;
    })();
  }
  return ajvInstancePromise;
}

const validatorCache = new Map();
const schemaCache = new Map();

async function loadSchema(name) {
  if (schemaCache.has(name)) {
    return schemaCache.get(name);
  }
  const fileName = SCHEMA_FILES[name];
  if (!fileName) {
    throw new Error(`Unknown schema: ${name}`);
  }
  const fullPath = resolveSchemaPath(fileName);
  const text = await fs.readFile(fullPath, 'utf8');
  const schema = JSON.parse(text);
  schemaCache.set(name, schema);
  return schema;
}

async function getValidator(name) {
  if (validatorCache.has(name)) {
    return validatorCache.get(name);
  }
  const ajv = await loadAjv();
  const schema = await loadSchema(name);
  const validate = ajv.compile(schema);
  validatorCache.set(name, validate);
  return validate;
}

export async function validateArtifact(name, payload) {
  const validate = await getValidator(name);
  const ok = validate(payload);
  if (!ok) {
    const errors = (validate.errors || [])
      .map((err) => `${err.instancePath || '/'} ${err.message}`)
      .join('; ');
    throw new Error(`Schema validation failed for ${name}: ${errors}`);
  }
  return true;
}

export function listSchemas() {
  return Object.keys(SCHEMA_FILES);
}
