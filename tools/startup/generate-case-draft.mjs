import path from "node:path";
import { collectSources } from "./lib/collect.mjs";
import { CASE_PROMPT_SCHEMA, caseSystemPrompt, evidencePacket } from "./lib/prompts.mjs";
import { callStructured } from "./lib/deepseek.mjs";
import { normalizeCase } from "./lib/normalize.mjs";
import { writeCaseDraft } from "./lib/publish.mjs";
import { formatError, StartupError } from "./lib/errors.mjs";
import { slugify, writeJsonAtomic } from "./lib/utils.mjs";
import { verifyCase } from "./lib/verify.mjs";

function arg(name, fallback = undefined) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }
const topic = arg("--topic", process.env.STARTUP_CASE_TOPIC);
if (!topic) { console.error("Usage: npm run startup:case -- --topic \"company or question\""); process.exitCode = 2; }
const dryRun = process.argv.includes("--dry-run");
const outputRoot = arg("--output-root");
const logRoot = path.resolve(outputRoot || "data/ai/startup", "logs/case");

async function main() {
  if (!topic) return;
  console.log("[startup] Collecting case sources");
  const collected = await collectSources({ queries: [topic, `${topic} official announcement metrics product`], brave: process.env.BRAVE_SEARCH_API_KEY ? true : false });
  await writeJsonAtomic(path.join(logRoot, "sources.json"), collected);
  console.log(`[startup] Collected ${collected.sources.length} sources; ${collected.warnings.length} collection warnings`);
  if (collected.sources.length < 2) throw new StartupError("Fewer than two usable sources collected; refusing to draft", "COLLECT_EMPTY", collected.warnings);
  const raw = await callStructured({
    schemaName: "startup_case_generation", schema: CASE_PROMPT_SCHEMA, system: caseSystemPrompt(),
    user: JSON.stringify({ topic, task: "写一篇案例解剖草稿。章节数量 3–8，按中心矛盾动态决定顺序；每个章节必须提供 evidence_labels。不要把搜索摘要当成事实，不要补全缺失数字。", sources: evidencePacket(collected.sources) })
  });
  await writeJsonAtomic(path.join(logRoot, "generation.json"), raw);
  const document = normalizeCase(raw, collected.sources, { status: "draft" });
  console.log(`[startup] Verifying ${document.sections.length} case sections`);
  const verification = await verifyCase(document, { llm: !dryRun });
  if (!verification.approved) throw new StartupError(`Case verifier rejected draft: ${(verification.issues || []).join("; ")}`, "VERIFIER_REJECTED");
  if (dryRun) { console.log(JSON.stringify(document, null, 2)); return; }
  const draftPath = outputRoot ? path.resolve(outputRoot, "cases/drafts", `${slugify(document.slug)}.json`) : path.resolve("data/ai/startup/cases/drafts", `${slugify(document.slug)}.json`);
  await writeCaseDraft(document, draftPath);
  console.log(`Case draft written (not published): ${draftPath}`);
}

main().catch(async (error) => {
  await writeJsonAtomic(path.join(logRoot, "failure.json"), { at: new Date().toISOString(), code: error.code, message: formatError(error), ...(["SCHEMA_INVALID", "QUALITY_GATE", "VERIFIER_REJECTED"].includes(error.code) ? { details: error.details } : {}) }).catch(() => {});
  console.error(`Startup case draft failed: ${formatError(error)}`); process.exitCode = 1;
});
