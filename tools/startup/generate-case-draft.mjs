import path from "node:path";
import { collectSources } from "./lib/collect.mjs";
import { CASE_PROMPT_SCHEMA, caseSystemPrompt, evidencePacket } from "./lib/prompts.mjs";
import { callStructured } from "./lib/deepseek.mjs";
import { normalizeCase } from "./lib/normalize.mjs";
import { writeCaseDraft } from "./lib/publish.mjs";
import { formatError, StartupError } from "./lib/errors.mjs";
import { slugify } from "./lib/utils.mjs";
import { verifyCase } from "./lib/verify.mjs";

function arg(name, fallback = undefined) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }
const topic = arg("--topic", process.env.STARTUP_CASE_TOPIC);
if (!topic) { console.error("Usage: npm run startup:case -- --topic \"company or question\""); process.exitCode = 2; }
const dryRun = process.argv.includes("--dry-run");
const outputRoot = arg("--output-root");

async function main() {
  if (!topic) return;
  const collected = await collectSources({ queries: [topic, `${topic} official announcement metrics product`], brave: process.env.BRAVE_SEARCH_API_KEY ? true : false });
  if (collected.sources.length < 2) throw new StartupError("Fewer than two usable sources collected; refusing to draft", "COLLECT_EMPTY", collected.warnings);
  const raw = await callStructured({
    schemaName: "startup_case_generation", schema: CASE_PROMPT_SCHEMA, system: caseSystemPrompt(),
    user: JSON.stringify({ topic, task: "写一篇案例解剖草稿。章节数量 3–8，按中心矛盾动态决定顺序；每个章节必须提供 evidence_labels。不要把搜索摘要当成事实，不要补全缺失数字。", sources: evidencePacket(collected.sources) }), useWebSearch: true
  });
  const document = normalizeCase(raw, collected.sources, { status: "draft" });
  const verification = await verifyCase(document, { llm: !dryRun });
  if (!verification.approved) throw new StartupError(`Case verifier rejected draft: ${(verification.issues || []).join("; ")}`, "VERIFIER_REJECTED");
  if (dryRun) { console.log(JSON.stringify(document, null, 2)); return; }
  const draftPath = outputRoot ? path.resolve(outputRoot, "cases/drafts", `${slugify(document.slug)}.json`) : path.resolve("data/ai/startup/cases/drafts", `${slugify(document.slug)}.json`);
  await writeCaseDraft(document, draftPath);
  console.log(`Case draft written (not published): ${draftPath}`);
}

main().catch((error) => { console.error(`Startup case draft failed: ${formatError(error)}`); process.exitCode = 1; });
