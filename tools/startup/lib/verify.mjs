import { VERIFIER_SCHEMA, dailySystemPrompt, evidencePacket, caseSystemPrompt } from "./prompts.mjs";
import { callStructured } from "./deepseek.mjs";
import { gateDaily, gateCase } from "./gates.mjs";
import { StartupError } from "./errors.mjs";

const MIN_VERIFIER_COVERAGE = 0.85;

function checkedCoverage(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= MIN_VERIFIER_COVERAGE && value <= 1;
}

function caseSourceCoverage(document) {
  const sources = new Map((document.sources || []).map((source) => [source.id, source]));
  const units = [];
  for (const section of document.sections || []) {
    units.push(section.source_ids || []);
    for (const label of section.evidence_labels || []) if (label.label !== "unknown") units.push(label.source_ids || []);
  }
  for (const entry of document.timeline || []) units.push(entry.source_ids || []);
  if (!units.length) return 0;
  return units.filter((ids) => ids.some((id) => sources.has(id))).length / units.length;
}

export function validateRemoteVerifier(result, localCoverage) {
  const issues = Array.isArray(result?.issues) ? result.issues.filter((issue) => typeof issue === "string") : ["verifier issues must be an array of strings"];
  if (typeof result?.approved !== "boolean") issues.push("verifier approved must be boolean");
  if (!checkedCoverage(result?.source_coverage)) issues.push(`verifier source_coverage must be a number >= ${MIN_VERIFIER_COVERAGE}`);
  if (!checkedCoverage(localCoverage)) issues.push(`document source coverage is below ${MIN_VERIFIER_COVERAGE}`);
  return { approved: result?.approved === true && issues.length === 0 && checkedCoverage(result?.source_coverage) && checkedCoverage(localCoverage), issues, source_coverage: Math.min(Number(result?.source_coverage) || 0, localCoverage) };
}

export function deterministicDailyVerification(document) {
  const result = gateDaily(document);
  const sourceCoverage = result.itemResults.length ? result.itemResults.reduce((sum, item) => sum + item.coverage, 0) / result.itemResults.length : 0;
  return { approved: result.pass && result.passingCount > 0 && checkedCoverage(sourceCoverage), issues: result.reasons, source_coverage: sourceCoverage };
}

export function deterministicCaseVerification(document) {
  const result = gateCase(document);
  const sourceCoverage = caseSourceCoverage(document);
  return { approved: result.pass && checkedCoverage(sourceCoverage), issues: result.reasons, source_coverage: sourceCoverage };
}

export async function verifyDaily(document, { llm = true } = {}) {
  const local = deterministicDailyVerification(document);
  if (!local.approved) return local;
  if (!llm) return local;
  const remote = await callStructured({
    verify: true, schemaName: "startup_daily_verifier", schema: VERIFIER_SCHEMA, system: `${dailySystemPrompt()} 你是独立审稿人，不负责写作。逐条检查每条机会的来源是否支持断言、是否混淆因果与热度、是否有可执行证伪动作。只要一条重大事实断言无来源就拒绝。创业方案、客户假设和拟议实验应当被标注为假设，不要求已有事实证明商业成功。通过时issues必须为空数组。`,
    user: JSON.stringify({ draft: document.opportunities, sources: evidencePacket(document.sources) })
  });
  const checked = validateRemoteVerifier(remote, local.source_coverage);
  if (!checked.approved) throw new StartupError(`Independent daily verifier rejected draft: ${checked.issues.join("; ")}`, "VERIFIER_REJECTED", checked);
  return checked;
}

export async function verifyCase(document, { llm = true } = {}) {
  const local = deterministicCaseVerification(document);
  if (!local.approved) return local;
  if (!llm) return local;
  const remote = await callStructured({
    verify: true, schemaName: "startup_case_verifier", schema: VERIFIER_SCHEMA, system: `${caseSystemPrompt()} 你是独立审稿人，不负责改写。检查动态章节是否有证据标签、重大事实是否关联来源、编辑推断是否越界、未知项是否诚实。通过时issues必须为空数组。`,
    user: JSON.stringify({ draft: document, sources: evidencePacket(document.sources) })
  });
  const checked = validateRemoteVerifier(remote, local.source_coverage);
  if (!checked.approved) throw new StartupError(`Independent case verifier rejected draft: ${checked.issues.join("; ")}`, "VERIFIER_REJECTED", checked);
  return checked;
}
