import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { StartupError } from "./errors.mjs";

export const SCHEMA_DIR = fileURLToPath(new URL("../schemas", import.meta.url));

const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);
const validators = new Map();
let sourceSchemaLoaded = false;

async function ensureSourceSchema() {
  if (sourceSchemaLoaded) return;
  const sourceSchema = JSON.parse(await fs.readFile(path.join(SCHEMA_DIR, "source.schema.json"), "utf8"));
  ajv.addSchema(sourceSchema, "source.schema.json");
  sourceSchemaLoaded = true;
}

export async function validateSchema(value, schemaName) {
  await ensureSourceSchema();
  let validate = validators.get(schemaName);
  if (!validate) {
    const schema = JSON.parse(await fs.readFile(path.join(SCHEMA_DIR, schemaName), "utf8"));
    validate = ajv.compile(schema);
    validators.set(schemaName, validate);
  }
  const valid = validate(value);
  return { valid: Boolean(valid), errors: validate.errors || [] };
}

export async function assertSchema(value, schemaName) {
  const result = await validateSchema(value, schemaName);
  if (!result.valid) throw new StartupError(`Schema validation failed for ${schemaName}`, "SCHEMA_INVALID", result.errors);
  return value;
}

export async function retainSchemaValidOpportunities(document) {
  await assertSchema({ ...document, opportunities: [] }, "opportunity-daily.schema.json");
  const valid = [];
  for (const item of document.opportunities) {
    const result = await validateSchema({ ...document, opportunities: [item] }, "opportunity-daily.schema.json");
    if (result.valid) valid.push(item);
  }
  return { ...document, opportunities: valid.map((item, i) => ({ ...item, rank: i + 1, depth: i < 3 ? "deep" : "brief" })) };
}
