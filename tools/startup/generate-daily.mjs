import path from "node:path";
import { collectSources } from "./lib/collect.mjs";
import { DAILY_PROMPT_SCHEMA, dailySystemPrompt, evidencePacket } from "./lib/prompts.mjs";
import { callStructured } from "./lib/deepseek.mjs";
import { buildDailyDocument } from "./lib/normalize.mjs";
import { gateDaily, retainPassingOpportunities } from "./lib/gates.mjs";
import { publishDaily } from "./lib/publish.mjs";
import { formatError, StartupError } from "./lib/errors.mjs";
import { todayInTimeZone, writeJsonAtomic } from "./lib/utils.mjs";
import { verifyDaily } from "./lib/verify.mjs";

function arg(name, fallback = undefined) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }
const dryRun = process.argv.includes("--dry-run");
const date = arg("--date", todayInTimeZone());
const outputRoot = arg("--output-root");
const outputPath = outputRoot ? path.resolve(outputRoot, "opportunities/latest.json") : undefined;
const archiveDir = outputRoot ? path.resolve(outputRoot, "opportunities/archive") : undefined;
const logRoot = path.resolve(outputRoot || "data/ai/startup", "logs/daily");

async function main() {
  console.log("[startup] Collecting current sources");
  const collected = await collectSources({ brave: process.env.BRAVE_SEARCH_API_KEY ? true : false });
  await writeJsonAtomic(path.join(logRoot, "sources.json"), collected);
  console.log(`[startup] Collected ${collected.sources.length} sources; ${collected.warnings.length} collection warnings`);
  if (collected.sources.length < 2) throw new StartupError("Fewer than two usable sources collected; refusing to generate", "COLLECT_EMPTY", collected.warnings);
  const raw = await callStructured({
    schemaName: "startup_daily_generation", schema: DAILY_PROMPT_SCHEMA, system: dailySystemPrompt(),
    user: JSON.stringify({ date, task: "从这些来源中筛选 0–10 个可在两周内验证的 AI 创业机会。最多输出 10 条，不足就少于 10 条。每个 source_ids 必须来自输入。", sources: evidencePacket(collected.sources) })
  });
  await writeJsonAtomic(path.join(logRoot, "generation.json"), raw);
  let document = buildDailyDocument(raw, collected.sources, date, collected.warnings);
  await writeJsonAtomic(path.join(logRoot, "candidate-checks.json"), gateDaily(document));
  document = retainPassingOpportunities(document);
  const gate = gateDaily(document);
  if (!gate.pass || gate.passingCount === 0) throw new StartupError(`No publishable daily opportunities: ${gate.reasons.join("; ")}`, "QUALITY_GATE", gate);
  document.quality = { ...document.quality, status: "passed", passing_count: document.opportunities.length, source_coverage: document.opportunities.length ? document.opportunities.reduce((sum, item) => sum + (item.evidence.length ? item.evidence.filter((entry) => entry.source_ids.length).length / item.evidence.length : 0), 0) / document.opportunities.length : 0 };
  console.log(`[startup] Verifying ${document.opportunities.length} candidate opportunities`);
  const verification = await verifyDaily(document, { llm: !dryRun });
  if (!verification.approved) throw new StartupError(`Daily verifier rejected output: ${(verification.issues || []).join("; ")}`, "VERIFIER_REJECTED");
  if (dryRun) { console.log(JSON.stringify(document, null, 2)); return; }
  const published = await publishDaily(document, { outputPath, archiveDir });
  console.log(`Daily startup opportunities published: ${published.opportunities.length} (${published.date})`);
}

main().catch(async (error) => {
  await writeJsonAtomic(path.join(logRoot, "failure.json"), { at: new Date().toISOString(), code: error.code, message: formatError(error), ...(["SCHEMA_INVALID", "QUALITY_GATE", "VERIFIER_REJECTED"].includes(error.code) ? { details: error.details } : {}) }).catch(() => {});
  console.error(`Startup daily failed: ${formatError(error)}`); process.exitCode = 1;
});
