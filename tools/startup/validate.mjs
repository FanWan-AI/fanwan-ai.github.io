import path from "node:path";
import { promises as fs } from "node:fs";
import { assertSchema, validateSchema } from "./lib/schemas.mjs";
import { gateCase, gateDaily } from "./lib/gates.mjs";
import { readJson } from "./lib/utils.mjs";
import { formatError, StartupError } from "./lib/errors.mjs";
import { DEFAULT_CASE_ROOT, DEFAULT_OPPORTUNITY_PATH, DEFAULT_CASE_INDEX_PATH } from "./lib/constants.mjs";

function arg(name, fallback) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }

async function validateOne(filePath, schemaName, gate) {
  const data = await readJson(filePath);
  await assertSchema(data, schemaName);
  const result = gate(data);
  if (!result.pass) throw new StartupError(`${path.basename(filePath)} business gate failed`, "QUALITY_GATE", result);
  return data;
}

async function main() {
  const draftPath = arg("--draft");
  if (draftPath) {
    const draft = await validateOne(path.resolve(draftPath), "case-detail.schema.json", gateCase);
    if (draft.status !== "draft") throw new StartupError("Draft validator requires status=draft", "DRAFT_STATUS");
    console.log(`Startup case draft validation passed: ${draft.slug}`);
    return;
  }
  const root = arg("--output-root");
  const opportunityPath = root ? path.resolve(root, "opportunities/latest.json") : DEFAULT_OPPORTUNITY_PATH;
  const indexPath = root ? path.resolve(root, "cases/index.json") : DEFAULT_CASE_INDEX_PATH;
  const caseRoot = root ? path.resolve(root, "cases") : DEFAULT_CASE_ROOT;
  let checked = 0;
  if (await fs.stat(opportunityPath).then(() => true).catch(() => false)) { await validateOne(opportunityPath, "opportunity-daily.schema.json", gateDaily); checked += 1; }
  if (await fs.stat(indexPath).then(() => true).catch(() => false)) {
    const index = await readJson(indexPath); await assertSchema(index, "cases-index.schema.json"); checked += 1;
    for (const entry of index.cases) { await validateOne(path.join(caseRoot, `${entry.slug}.json`), "case-detail.schema.json", gateCase); checked += 1; }
  }
  console.log(`Startup validation passed (${checked} public files checked).`);
}

main().catch((error) => { console.error(`Startup validation failed: ${formatError(error)}`); process.exitCode = 1; });
