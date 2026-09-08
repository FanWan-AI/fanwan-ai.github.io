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
import { assertSchema } from "./lib/schemas.mjs";

function arg(name, fallback = undefined) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }
const dryRun = process.argv.includes("--dry-run");
const date = arg("--date", todayInTimeZone());
const outputRoot = arg("--output-root");
const outputPath = outputRoot ? path.resolve(outputRoot, "opportunities/latest.json") : undefined;
const archiveDir = outputRoot ? path.resolve(outputRoot, "opportunities/archive") : undefined;
const logRoot = path.resolve(outputRoot || "data/ai/startup", `logs/daily-${new Date().toISOString().replace(/[:.]/g, "-")}`);

async function main() {
  console.log("[startup] Collecting current sources");
  const collected = await collectSources({ brave: process.env.BRAVE_SEARCH_API_KEY ? true : false });
  await writeJsonAtomic(path.join(logRoot, "sources.json"), collected);
  console.log(`[startup] Collected ${collected.sources.length} sources; ${collected.warnings.length} collection warnings`);
  if (collected.sources.length < 2) throw new StartupError("Fewer than two usable sources collected; refusing to generate", "COLLECT_EMPTY", collected.warnings);
  let document, previousAttempt;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callStructured({
      schemaName: "startup_daily_generation", schema: DAILY_PROMPT_SCHEMA, system: dailySystemPrompt(),
      user: JSON.stringify({ date, task: "面向中文读者与懂AI的小团队创业者，筛选证据充分的轻量商业机会。上限10条，没有机会就返回空数组，不凑数。每条至少引用两个不同出版方，不要把同一公司的多条新闻当成独立验证。优先客户可接触、能两周试卖的服务/软件，不做需要重资本的产业想象；排除军用武器、侵犯个人隐私和规避版权监管的用途。商业方案/客户需求未经验证时必须明确是假设。正文给读者看，不写编辑原则。遵守各字段长度要求。", sources: evidencePacket(collected.sources), ...(previousAttempt ? { correction: previousAttempt } : {}) })
    });
    await writeJsonAtomic(path.join(logRoot, `generation-${attempt + 1}.json`), raw);
    try {
      document = buildDailyDocument(raw, collected.sources, date, collected.warnings);
      const candidates = gateDaily(document);
      await writeJsonAtomic(path.join(logRoot, "candidate-checks.json"), candidates);
      document = retainPassingOpportunities(document);
      const gate = gateDaily(document);
      if (!gate.pass || gate.passingCount === 0) throw new StartupError(`No publishable daily opportunities: ${candidates.reasons.join("; ") || "writer returned no supported opportunities"}`, "QUALITY_GATE", candidates);
      const used = new Set(document.opportunities.flatMap(item => item.evidence.flatMap(e => e.source_ids)));
      document.sources = document.sources.filter(s => used.has(s.id));
      document.quality = { ...document.quality, status: "passed", passing_count: document.opportunities.length, source_coverage: 1 };
      await assertSchema(document, "opportunity-daily.schema.json");
      console.log(`[startup] Verifying ${document.opportunities.length} candidate opportunities`);
      const verification = await verifyDaily(document, { llm: !dryRun });
      if (!verification.approved) throw new StartupError(`Daily verifier rejected output: ${(verification.issues || []).join("; ")}`, "VERIFIER_REJECTED");
      document.quality.verified_at = new Date().toISOString();
      break;
    } catch (error) {
      if (attempt === 1 || !["SCHEMA_INVALID", "QUALITY_GATE", "VERIFIER_REJECTED"].includes(error.code)) throw error;
      previousAttempt = { draft: raw, issues: error.details || error.message };
      console.log(`[startup] One correction attempt after ${error.code}`);
    }
  }
  if (dryRun) { console.log(JSON.stringify(document, null, 2)); return; }
  const published = await publishDaily(document, { outputPath, archiveDir });
  await writeJsonAtomic(path.join(logRoot, "result.json"), { status: "published", date, count: published.opportunities.length });
  console.log(`Daily startup opportunities published: ${published.opportunities.length} (${published.date})`);
}

main().catch(async (error) => {
  await writeJsonAtomic(path.join(logRoot, "failure.json"), { at: new Date().toISOString(), code: error.code, message: formatError(error), ...(["SCHEMA_INVALID", "QUALITY_GATE", "VERIFIER_REJECTED"].includes(error.code) ? { details: error.details } : {}) }).catch(() => {});
  console.error(`Startup daily failed: ${formatError(error)}`); process.exitCode = 1;
});
