import { MAX_CASE_SECTIONS, MIN_CASE_SECTIONS, MIN_OPPORTUNITY_SCORE, MIN_SOURCE_COUNT, MIN_SOURCE_COVERAGE, EVIDENCE_LABELS } from "./constants.mjs";
import { containsBannedPhrase, hasIndependentSources, sourceCoverage } from "./scoring.mjs";

const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;

export function gateOpportunity(item, sourcesById) {
  const reasons = [];
  if (!nonEmpty(item.id) || !nonEmpty(item.title) || !nonEmpty(item.verdict)) reasons.push("identity or verdict missing");
  for (const field of ["customer", "pain", "ai_advantage", "smallest_sellable_product", "business_model", "falsification_test"]) if (!nonEmpty(item[field])) reasons.push(`${field} missing`);
  if (!Array.isArray(item.why_now) || item.why_now.length < 1) reasons.push("why_now missing");
  if (!Array.isArray(item.failure_modes) || item.failure_modes.length < 1) reasons.push("failure_modes missing");
  if (!Array.isArray(item.evidence) || item.evidence.length < 1) reasons.push("evidence missing");
  const ids = [...new Set((item.evidence || []).flatMap((entry) => entry?.source_ids || []))];
  if (ids.some(id => !sourcesById.has(id))) reasons.push("unknown source reference");
  if ((item.evidence || []).some(entry => !nonEmpty(entry?.claim) || !entry.source_ids?.length)) reasons.push("unsupported evidence claim");
  if (ids.length < MIN_SOURCE_COUNT || !hasIndependentSources(item, sourcesById)) reasons.push("fewer than two independent usable sources");
  const coverage = sourceCoverage(item, sourcesById);
  if (coverage < MIN_SOURCE_COVERAGE) reasons.push(`source coverage ${coverage.toFixed(2)} below ${MIN_SOURCE_COVERAGE}`);
  if (!item.score || item.score.total < MIN_OPPORTUNITY_SCORE) reasons.push(`score ${item.score?.total ?? 0} below ${MIN_OPPORTUNITY_SCORE}`);
  if (containsBannedPhrase([item.title, item.verdict, item.pain, ...(item.why_now || [])].join(" "))) reasons.push("banned promotional language");
  return { pass: reasons.length === 0, reasons, coverage };
}

export function gateDaily(document) {
  const sourcesById = new Map((document.sources || []).map((source) => [source.id, source]));
  const items = Array.isArray(document.opportunities) ? document.opportunities : [];
  const results = items.map((item) => gateOpportunity(item, sourcesById));
  const reasons = results.flatMap((result, index) => result.pass ? [] : [`opportunity ${index + 1}: ${result.reasons.join(", ")}`]);
  if (items.length > 10) reasons.push("more than ten opportunities");
  if (items.slice(0, 3).some((item) => item.depth !== "deep")) reasons.push("top three must be deep");
  if (items.slice(3).some((item) => item.depth !== "brief")) reasons.push("opportunities after the top three must be brief");
  if (items.some((item, index) => item.rank !== index + 1)) reasons.push("ranks must be unique and sequential");
  if (items.some((item, index) => index > 0 && item.score.total > items[index - 1].score.total)) reasons.push("opportunities must be sorted by descending score");
  if (items.length > 0 && results.every((result) => !result.pass)) reasons.push("zero passing opportunities");
  return { pass: reasons.length === 0, reasons, itemResults: results, passingCount: results.filter((result) => result.pass).length };
}

export function retainPassingOpportunities(document) {
  const sourcesById = new Map((document.sources || []).map((source) => [source.id, source]));
  const passing = (document.opportunities || [])
    .filter((item) => gateOpportunity(item, sourcesById).pass)
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, 10)
    .map((item, index) => ({ ...item, rank: index + 1, depth: index < 3 ? "deep" : "brief" }));
  return { ...document, opportunities: passing };
}

export function gateCase(document) {
  const reasons = [];
  if (document.status !== "draft" && document.status !== "published") reasons.push("invalid case status");
  if (!nonEmpty(document.slug) || !nonEmpty(document.title) || !nonEmpty(document.verdict) || !nonEmpty(document.central_question)) reasons.push("case identity, question, or verdict missing");
  if (!Array.isArray(document.sections) || document.sections.length < MIN_CASE_SECTIONS || document.sections.length > MAX_CASE_SECTIONS) reasons.push("sections must contain 3–8 dynamic sections");
  for (const [index, section] of (document.sections || []).entries()) {
    if (!nonEmpty(section.id) || !nonEmpty(section.heading) || !nonEmpty(section.thesis) || !Array.isArray(section.paragraphs) || section.paragraphs.length < 1) reasons.push(`section ${index + 1} incomplete`);
    const labels = section.evidence_labels || [];
    if (!labels.length || labels.some((entry) => !EVIDENCE_LABELS.includes(entry.label) || !nonEmpty(entry.text))) reasons.push(`section ${index + 1} evidence labels invalid`);
  }
  if (!Array.isArray(document.copy) || document.copy.length < 1 || !Array.isArray(document.avoid) || document.avoid.length < 1) reasons.push("copy/avoid lessons missing");
  if (!nonEmpty(document.next_experiment)) reasons.push("next experiment missing");
  const sourcesById = new Map((document.sources || []).map((source) => [source.id, source]));
  const sourceIds = new Set((document.sections || []).flatMap((section) => [...(section.source_ids || []), ...(section.evidence_labels || []).flatMap((entry) => entry.source_ids || [])]));
  if (sourceIds.size < 2 || [...sourceIds].some((id) => !sourcesById.has(id))) reasons.push("case source references incomplete");
  const referencedPublishers = new Set([...sourceIds].map((id) => sourcesById.get(id)?.publisher).filter(Boolean));
  if (referencedPublishers.size < 2) reasons.push("case requires evidence from at least two publishers");
  for (const [index, section] of (document.sections || []).entries()) {
    for (const label of section.evidence_labels || []) {
      if (label.label !== "unknown" && (!label.source_ids?.length || label.source_ids.some((id) => !sourcesById.has(id)))) reasons.push(`section ${index + 1} evidence label has incomplete sources`);
    }
  }
  const timelineIds = (document.timeline || []).flatMap((entry) => entry.source_ids || []);
  if (timelineIds.some((id) => !sourcesById.has(id))) reasons.push("timeline source references incomplete");
  if (document.sections?.some((section) => containsBannedPhrase(`${section.heading} ${section.thesis} ${section.paragraphs.join(" ")}`))) reasons.push("banned promotional language");
  return { pass: reasons.length === 0, reasons };
}
