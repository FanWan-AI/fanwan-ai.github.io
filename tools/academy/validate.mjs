import path from "path";
import process from "process";

import {
  DAILY,
  SCHEMAS,
  TOPICS,
  readJSON,
  validateWithSchema
} from "./util.mjs";

const root = process.cwd();
const toAbs = (p) => path.resolve(root, p);
const DAILY_SCHEMA = `${SCHEMAS}/daily.schema.json`;
const TOPIC_SCHEMA = `${SCHEMAS}/topics.schema.json`;
const LESSON_LIMIT = 90;

async function run() {
  const errors = [];
  const { valid, errors: schemaErrors } = await validateWithSchema(toAbs(DAILY), toAbs(DAILY_SCHEMA));
  if (!valid) {
    errors.push({ name: "academy-daily", type: "schema", details: schemaErrors });
  } else {
    const doc = await readJSON(toAbs(DAILY), { lessons: [] });
    const lessons = Array.isArray(doc.lessons) ? doc.lessons : [];
    if (lessons.length > LESSON_LIMIT) {
      errors.push({ name: "academy-daily", type: "limit", details: [`${lessons.length} lessons > limit ${LESSON_LIMIT}`] });
    }
  }

  try {
    const topicSchema = await readJSON(toAbs(TOPIC_SCHEMA), null);
    if (topicSchema) {
      const { valid: topicsValid, errors: topicErrors } = await validateWithSchema(toAbs(TOPICS), toAbs(TOPIC_SCHEMA));
      if (!topicsValid) {
        errors.push({ name: "academy-topics", type: "schema", details: topicErrors });
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  if (errors.length) {
    for (const issue of errors) {
      console.error(`✗ ${issue.name} (${issue.type})`);
      (issue.details || []).forEach((detail) => console.error(`  - ${typeof detail === "string" ? detail : JSON.stringify(detail)}`));
    }
    process.exitCode = 1;
    return;
  }

  console.log("✓ Academy data validated");
}

run().catch((error) => {
  console.error("Unexpected academy validation failure", error);
  process.exitCode = 1;
});
