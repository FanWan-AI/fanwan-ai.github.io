import { VERIFIER_SCHEMA, dailySystemPrompt, evidencePacket, caseSystemPrompt } from "./prompts.mjs";
import { callStructured } from "./deepseek.mjs";
import { gateDaily, gateCase } from "./gates.mjs";
import { StartupError } from "./errors.mjs";

export function deterministicDailyVerification(document) {
  const result = gateDaily(document);
  return { approved: result.pass && result.passingCount > 0, issues: result.reasons, source_coverage: document.quality?.source_coverage || 0 };
}

export function deterministicCaseVerification(document) {
  const result = gateCase(document);
  return { approved: result.pass, issues: result.reasons, source_coverage: 1 };
}

export async function verifyDaily(document, { llm = true } = {}) {
  const local = deterministicDailyVerification(document);
  if (!local.approved) return local;
  if (!llm) return local;
  const remote = await callStructured({
    schemaName: "startup_daily_verifier", schema: VERIFIER_SCHEMA, system: `${dailySystemPrompt()} 你是独立审稿人，不负责写作。逐条检查每条机会的来源是否支持断言、是否混淆因果与热度、是否有可执行证伪动作。只要一条重大断言无来源就拒绝。`,
    user: JSON.stringify({ draft: document.opportunities, sources: evidencePacket(document.sources) }), useWebSearch: false
  });
  if (!remote?.approved) throw new StartupError(`Independent daily verifier rejected draft: ${(remote?.issues || []).join("; ")}`, "VERIFIER_REJECTED", remote);
  return remote;
}

export async function verifyCase(document, { llm = true } = {}) {
  const local = deterministicCaseVerification(document);
  if (!local.approved) return local;
  if (!llm) return local;
  const remote = await callStructured({
    schemaName: "startup_case_verifier", schema: VERIFIER_SCHEMA, system: `${caseSystemPrompt()} 你是独立审稿人，不负责改写。检查动态章节是否有证据标签、重大事实是否关联来源、编辑推断是否越界、未知项是否诚实。`,
    user: JSON.stringify({ draft: document, sources: evidencePacket(document.sources) }), useWebSearch: false
  });
  if (!remote?.approved) throw new StartupError(`Independent case verifier rejected draft: ${(remote?.issues || []).join("; ")}`, "VERIFIER_REJECTED", remote);
  return remote;
}
