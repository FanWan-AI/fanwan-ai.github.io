import { MAX_CASE_SECTIONS, MAX_OPPORTUNITIES, PIPELINE_VERSION, SCHEMA_VERSION } from "./constants.mjs";
import { gateCase } from "./gates.mjs";
import { scoreOpportunity } from "./scoring.mjs";
import { cleanString, cleanStringArray, isoNow, slugify, sha256 } from "./utils.mjs";

const labelMap = new Map([
  ["fact", "fact"], ["事实", "fact"], ["company_claim", "company_claim"], ["公司自述", "company_claim"],
  ["editorial_inference", "editorial_inference"], ["编辑推断", "editorial_inference"], ["unknown", "unknown"], ["未知", "unknown"]
]);

export function normalizeOpportunity(raw, index, sourcesById) {
  const title = cleanString(raw?.title, 180);
  const evidence = (Array.isArray(raw?.evidence) ? raw.evidence : []).map((entry) => ({
    claim: cleanString(entry?.claim, 500), source_ids: [...new Set(Array.isArray(entry?.source_ids) ? entry.source_ids : [])], confidence: ["high", "medium", "low"].includes(entry?.confidence) ? entry.confidence : "low"
  }));
  const item = {
    id: slugify(raw?.id || title), rank: index + 1, depth: index < 3 ? "deep" : "brief", title,
    verdict: cleanString(raw?.verdict, 500), customer: cleanString(raw?.customer, 300), pain: cleanString(raw?.pain, 800),
    why_now: cleanStringArray(raw?.why_now, 5, 500), evidence,
    ai_advantage: cleanString(raw?.ai_advantage, 700), smallest_sellable_product: cleanString(raw?.smallest_sellable_product, 700),
    business_model: cleanString(raw?.business_model, 500), failure_modes: cleanStringArray(raw?.failure_modes, 6, 400),
    falsification_test: cleanString(raw?.falsification_test, 500), score: null, tags: cleanStringArray(raw?.tags, 8, 30)
  };
  item.score = scoreOpportunity(item, sourcesById);
  return item;
}

export function buildDailyDocument(raw, sources, date, warnings = []) {
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const rawItems = Array.isArray(raw?.opportunities) ? raw.opportunities : Array.isArray(raw) ? raw : [];
  const items = rawItems
    .slice(0, MAX_OPPORTUNITIES)
    .map((item, index) => normalizeOpportunity(item, index, sourcesById))
    .sort((a, b) => b.score.total - a.score.total)
    .map((item, index) => ({ ...item, rank: index + 1, depth: index < 3 ? "deep" : "brief" }));
  return {
    schema_version: SCHEMA_VERSION, kind: "startup_opportunity_daily", date, generated_at: isoNow(),
    headline: cleanString(raw?.headline || items[0]?.title || "AI 创业机会观察", 300),
    editorial_note: cleanString(raw?.editorial_note, 1200),
    opportunities: items, sources, quality: { status: "failed", passing_count: 0, source_coverage: 0, warnings: [...warnings] }, pipeline_version: PIPELINE_VERSION
  };
}

export function normalizeCase(raw, sources, { status = "draft", now = isoNow() } = {}) {
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const caseSlug = slugify(raw?.slug || raw?.title);
  const sections = (Array.isArray(raw?.sections) ? raw.sections : []).slice(0, MAX_CASE_SECTIONS).map((section, index) => ({
    id: /^[a-z0-9][a-z0-9-]{2,79}$/.test(section?.id || "") ? section.id : `section-${index + 1}`, heading: cleanString(section?.heading, 160), thesis: cleanString(section?.thesis, 500),
    paragraphs: cleanStringArray(section?.paragraphs, 12, 1800),
    source_ids: [...new Set(Array.isArray(section?.source_ids) ? section.source_ids : [])],
    evidence_labels: (Array.isArray(section?.evidence_labels) ? section.evidence_labels : []).map((entry) => ({
      label: labelMap.get(String(entry?.label || "").trim().toLowerCase()) || "unknown", text: cleanString(entry?.text, 700),
      source_ids: [...new Set(Array.isArray(entry?.source_ids) ? entry.source_ids : [])], confidence: ["high", "medium", "low"].includes(entry?.confidence) ? entry.confidence : "low"
    })).filter((entry) => entry.text)
  }));
  return {
    schema_version: SCHEMA_VERSION, kind: "startup_case_analysis", slug: /^[a-z0-9][a-z0-9-]{2,79}$/.test(caseSlug) ? caseSlug : `case-${sha256(raw?.title || "case").slice(0, 16)}`, status,
    story_type: cleanString(raw?.story_type || "technical_commercialization", 50), company: cleanString(raw?.company || "Unknown company", 120), central_question: cleanString(raw?.central_question, 500),
    title: cleanString(raw?.title, 180), dek: cleanString(raw?.dek, 700), verdict: cleanString(raw?.verdict, 700),
    ...(raw?.published_at ? { published_at: raw.published_at } : {}), updated_at: now, revision_note: cleanString(raw?.revision_note || "Generated and verified by startup pipeline.", 500),
    timeline: (Array.isArray(raw?.timeline) ? raw.timeline : []).slice(0, 16).map((entry) => ({ date: cleanString(entry?.date, 30), event: cleanString(entry?.event, 500), source_ids: [...new Set(Array.isArray(entry?.source_ids) ? entry.source_ids : [])] })),
    sections, unknowns: cleanStringArray(raw?.unknowns, 10, 500), copy: cleanStringArray(raw?.copy, 8, 500), avoid: cleanStringArray(raw?.avoid, 8, 500), next_experiment: cleanString(raw?.next_experiment, 700), sources
  };
}

export function casePasses(document) { return gateCase(document); }
