import path from "path";
import process from "process";

import {
  DAILY,
  PULSE,
  SCHEMAS,
  readJSON,
  validateWithSchema
} from "./util.mjs";

const root = process.cwd();
const toAbs = (p) => path.resolve(root, p);

const checks = [
  {
    name: "finance-daily",
    file: DAILY,
    schema: `${SCHEMAS}/finance-daily.schema.json`,
    limit: 60
  },
  {
    name: "pulse",
    file: PULSE,
    schema: `${SCHEMAS}/pulse.schema.json`,
    limit: 30
  }
];

const optionalChecks = [
  {
    name: "topics",
    file: `${SCHEMAS}/../topics.json`,
    schema: `${SCHEMAS}/topics.schema.json`
  }
];

async function run() {
  const errors = [];

  for (const check of checks) {
    const absFile = toAbs(check.file);
    const absSchema = toAbs(check.schema);
    const { valid, errors: schemaErrors } = await validateWithSchema(absFile, absSchema);
    if (!valid) {
      errors.push({
        name: check.name,
        type: "schema",
        details: schemaErrors
      });
      continue;
    }

    const data = await readJSON(absFile, []);
    if (Array.isArray(data) && check.limit && data.length > check.limit) {
      errors.push({
        name: check.name,
        type: "limit",
        details: [`length ${data.length} exceeds limit ${check.limit}`]
      });
    }
  }

  for (const check of optionalChecks) {
    const absSchema = toAbs(check.schema);
    try {
      const { valid, errors: schemaErrors } = await validateWithSchema(toAbs(check.file), absSchema);
      if (!valid) {
        errors.push({
          name: check.name,
          type: "schema",
          details: schemaErrors
        });
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  if (errors.length) {
    for (const error of errors) {
      console.error(`✗ ${error.name} (${error.type})`);
      if (Array.isArray(error.details)) {
        for (const detail of error.details) {
          if (typeof detail === "string") {
            console.error(`  - ${detail}`);
          } else if (detail) {
            console.error(`  - ${JSON.stringify(detail)}`);
          }
        }
      }
    }
    process.exitCode = 1;
    return;
  }

  console.log("✓ Wealth data validated");
}

run().catch((error) => {
  console.error("Unexpected validation failure", error);
  process.exitCode = 1;
});
