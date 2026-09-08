import path from "node:path";
import { promises as fs } from "node:fs";
import { DEFAULT_CASE_INDEX_PATH, DEFAULT_CASE_ROOT, DEFAULT_OPPORTUNITY_ARCHIVE, DEFAULT_OPPORTUNITY_PATH, PIPELINE_VERSION } from "./constants.mjs";
import { gateCase, gateDaily } from "./gates.mjs";
import { assertSchema } from "./schemas.mjs";
import { isoNow, readJson, writeJsonAtomic } from "./utils.mjs";
import { StartupError } from "./errors.mjs";

export async function publishDaily(document, { outputPath = DEFAULT_OPPORTUNITY_PATH, archiveDir = DEFAULT_OPPORTUNITY_ARCHIVE } = {}) {
  const gate = gateDaily(document);
  if (!gate.pass || gate.passingCount === 0) throw new StartupError(`Daily publish blocked: ${gate.reasons.join("; ") || "zero passing opportunities"}`, "PUBLISH_BLOCKED", gate);
  await assertSchema(document, "opportunity-daily.schema.json");
  const published = { ...document, quality: { ...document.quality, status: gate.passingCount < 3 ? "degraded" : "passed", passing_count: gate.passingCount, source_coverage: gate.itemResults.length ? gate.itemResults.reduce((sum, result) => sum + result.coverage, 0) / gate.itemResults.length : 0 }, pipeline_version: PIPELINE_VERSION };
  await writeJsonAtomic(path.join(archiveDir, `${document.date}.json`), published);
  await writeJsonAtomic(outputPath, published);
  return published;
}

export async function writeCaseDraft(document, outputPath) {
  const gate = gateCase(document);
  if (!gate.pass) throw new StartupError(`Case draft blocked: ${gate.reasons.join("; ")}`, "DRAFT_BLOCKED", gate);
  await assertSchema(document, "case-detail.schema.json");
  if (document.status !== "draft") throw new StartupError("Case generator may only write draft status", "DRAFT_STATUS");
  await writeJsonAtomic(outputPath, { ...document, pipeline_version: PIPELINE_VERSION });
  return document;
}

export async function promoteCase({ draftPath, caseRoot = DEFAULT_CASE_ROOT, indexPath = DEFAULT_CASE_INDEX_PATH, now = isoNow() }) {
  const draft = await readJson(draftPath);
  const draftGate = gateCase(draft);
  if (!draftGate.pass || draft.status !== "draft") throw new StartupError(`Promotion blocked: ${draftGate.reasons.join("; ") || "draft status required"}`, "PROMOTION_BLOCKED", draftGate);
  const published = { ...draft, status: "published", published_at: draft.published_at || now, updated_at: now, revision_note: "Promoted after editorial review." };
  await assertSchema(published, "case-detail.schema.json");
  const finalPath = path.join(caseRoot, `${published.slug}.json`);
  const currentIndex = await readJson(indexPath, { schema_version: 1, kind: "startup_case_index", updated_at: now, cases: [] });
  const entry = { slug: published.slug, published_at: published.published_at, title: published.title, company: published.company, story_type: published.story_type, dek: published.dek, verdict: published.verdict, read_minutes: Math.max(1, Math.ceil(published.sections.reduce((sum, section) => sum + section.paragraphs.join(" ").length, 0) / 700)), case_path: `cases/${published.slug}.json`, cover_theme: published.story_type };
  const cases = [entry, ...(currentIndex.cases || []).filter((item) => item.slug !== entry.slug)].sort((a, b) => b.published_at.localeCompare(a.published_at));
  const nextIndex = { schema_version: 1, kind: "startup_case_index", updated_at: now, cases };
  await assertSchema(nextIndex, "cases-index.schema.json");
  await writeJsonAtomic(finalPath, published);
  await writeJsonAtomic(indexPath, nextIndex);
  return { published, index: nextIndex, finalPath };
}

export async function validatePublicPaths({ opportunityPath = DEFAULT_OPPORTUNITY_PATH, indexPath = DEFAULT_CASE_INDEX_PATH, caseRoot = DEFAULT_CASE_ROOT, allowEmpty = false } = {}) {
  const checked = [];
  let daily;
  try { daily = await readJson(opportunityPath); } catch (error) { if (!allowEmpty || error.code !== "ENOENT") throw error; }
  if (daily !== undefined) {
    await assertSchema(daily, "opportunity-daily.schema.json");
    const gate = gateDaily(daily);
    if (!gate.pass) throw new StartupError("Daily business gate failed", "QUALITY_GATE", gate);
    checked.push(opportunityPath);
  }

  let index;
  try { index = await readJson(indexPath); } catch (error) { if (!allowEmpty || error.code !== "ENOENT") throw error; }
  if (index !== undefined) {
    await assertSchema(index, "cases-index.schema.json");
    checked.push(indexPath);
    for (const entry of index.cases) {
      const casePath = path.join(caseRoot, path.basename(entry.case_path));
      const detail = await readJson(casePath);
      await assertSchema(detail, "case-detail.schema.json");
      const gate = gateCase(detail);
      if (!gate.pass || detail.status !== "published") throw new StartupError(`Case ${entry.slug} business gate failed`, "QUALITY_GATE", gate);
      checked.push(casePath);
    }
  }
  return checked;
}
