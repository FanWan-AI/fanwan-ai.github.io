import { BANNED_PHRASES, MIN_SOURCE_COUNT } from "./constants.mjs";
import { cleanString } from "./utils.mjs";

const COST_WORDS = /成本|损失|罚款|延误|人工|风险|cost|loss|delay|manual|penalty/iu;
const TIMING_WORDS = /deadline|regulation|policy|launch|adoption|最近|新规|窗口|更新|变化|deadline/iu;
const AI_WORDS = /模型|推理|生成|抽取|分类|多模态|agent|model|inference|generation|reasoning/iu;
const REACH_WORDS = /14天|两周|试点|pilot|api|工作流|报告|交付|paid|付费/iu;

const bounded = (value, max) => Math.max(0, Math.min(max, Math.round(value)));

export function scoreOpportunity(item, sourcesById) {
  const evidence = Array.isArray(item.evidence) ? item.evidence : [];
  const sourceIds = [...new Set(evidence.flatMap((entry) => Array.isArray(entry?.source_ids) ? entry.source_ids : []))];
  const sources = sourceIds.map((id) => sourcesById.get(id)).filter(Boolean);
  const text = [item.customer, item.pain, item.ai_advantage, item.smallest_sellable_product, item.business_model, item.falsification_test, ...(item.why_now || [])].join(" ");
  const quality = sources.filter((source) => source.tier !== "discovery_only").length;
  const pain = bounded(8 + (item.customer ? 4 : 0) + (item.pain?.length >= 70 ? 6 : item.pain?.length >= 30 ? 3 : 0) + (COST_WORDS.test(text) ? 5 : 0), 25);
  const timing = bounded(6 + Math.min(8, (item.why_now?.length || 0) * 3) + (TIMING_WORDS.test(text) ? 6 : 0), 20);
  const evidenceScore = bounded(Math.min(12, sources.length * 4) + Math.min(8, quality * 4), 20);
  const aiFit = bounded(7 + (item.ai_advantage?.length >= 45 ? 6 : item.ai_advantage ? 3 : 0) + (AI_WORDS.test(item.ai_advantage || "") ? 7 : 0), 20);
  const reachability = bounded(5 + (item.smallest_sellable_product?.length >= 30 ? 4 : 0) + (item.business_model ? 3 : 0) + (REACH_WORDS.test(text) ? 3 : 0), 15);
  return { total: pain + timing + evidenceScore + aiFit + reachability, pain, timing, evidence: evidenceScore, ai_fit: aiFit, reachability };
}

export function containsBannedPhrase(value) { return BANNED_PHRASES.some((pattern) => pattern.test(String(value || ""))); }

export function sourceCoverage(item, sourcesById) {
  const evidence = Array.isArray(item.evidence) ? item.evidence : [];
  if (!evidence.length) return 0;
  const covered = evidence.filter((entry) => Array.isArray(entry.source_ids) && entry.source_ids.some((id) => sourcesById.has(id))).length;
  return covered / evidence.length;
}

export function hasIndependentSources(item, sourcesById) {
  const ids = [...new Set((item.evidence || []).flatMap((entry) => entry.source_ids || []))];
  const usable = ids.map((id) => sourcesById.get(id)).filter(Boolean);
  return new Set(usable.map((source) => source.publisher)).size >= 2 && usable.some((source) => source.tier !== "discovery_only") && usable.length >= MIN_SOURCE_COUNT;
}
