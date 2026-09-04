import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildFixture } from "../lib/fixtures.mjs";
import { dedupeSources, selectEvidenceSources } from "../lib/collect.mjs";
import { gateCase, gateDaily } from "../lib/gates.mjs";
import { publishDaily, promoteCase, validatePublicPaths, writeCaseDraft } from "../lib/publish.mjs";
import { assertSchema, validateSchema } from "../lib/schemas.mjs";
import { hasIndependentSources, scoreOpportunity } from "../lib/scoring.mjs";
import { isSafeUrl, normalizeUrl, assertPublicUrl } from "../lib/url-security.mjs";
import { todayInTimeZone, writeJsonAtomic } from "../lib/utils.mjs";
import { DEFAULT_CASE_INDEX_PATH, DEFAULT_CASE_ROOT, DEFAULT_OPPORTUNITY_PATH } from "../lib/constants.mjs";

test("all machine-readable fixture contracts validate", async () => {
  const fixture = buildFixture();
  assert.equal((await validateSchema(fixture.daily, "opportunity-daily.schema.json")).valid, true);
  assert.equal((await validateSchema(fixture.case, "case-detail.schema.json")).valid, true);
  const index = { schema_version: 1, kind: "startup_case_index", updated_at: new Date().toISOString(), cases: [{ slug: fixture.case.slug, published_at: new Date().toISOString(), title: fixture.case.title, company: fixture.case.company, story_type: fixture.case.story_type, dek: fixture.case.dek, verdict: fixture.case.verdict, read_minutes: 4, case_path: `cases/${fixture.case.slug}.json`, cover_theme: fixture.case.story_type }] };
  assert.equal((await validateSchema(index, "cases-index.schema.json")).valid, true);
});

test("committed public startup edition satisfies schemas and business gates", async () => {
  const daily = JSON.parse(await fs.readFile(DEFAULT_OPPORTUNITY_PATH, "utf8"));
  const index = JSON.parse(await fs.readFile(DEFAULT_CASE_INDEX_PATH, "utf8"));
  assert.equal((await validateSchema(daily, "opportunity-daily.schema.json")).valid, true);
  assert.equal(gateDaily(daily).pass, true);
  assert.equal((await validateSchema(index, "cases-index.schema.json")).valid, true);
  for (const entry of index.cases) {
    const detail = JSON.parse(await fs.readFile(path.join(DEFAULT_CASE_ROOT, path.basename(entry.case_path)), "utf8"));
    assert.equal((await validateSchema(detail, "case-detail.schema.json")).valid, true);
    assert.equal(gateCase(detail).pass, true);
    assert.equal(detail.status, "published");
  }
});

test("URL security normalizes tracking parameters and rejects private/non-http URLs", async () => {
  assert.equal(normalizeUrl("https://example.com/a/?utm_source=x&b=2#part"), "https://example.com/a?b=2");
  for (const url of ["http://localhost/x", "http://127.0.0.1", "http://192.168.1.2/x", "http://[::1]/", "file:///tmp/a", "javascript:alert(1)"]) assert.equal(isSafeUrl(url), false);
  await assert.rejects(() => assertPublicUrl("http://localhost", { resolveDns: false }), /Private|loopback/u);
  assert.equal(await assertPublicUrl("https://example.com", { resolveDns: false }), "https://example.com/");
});

test("editorial date follows the configured Asia/Singapore day", () => {
  assert.equal(todayInTimeZone("Asia/Singapore", new Date("2026-09-03T23:17:00Z")), "2026-09-04");
});

test("source dedupe is stable by canonical URL and normalized title", () => {
  const fixture = buildFixture();
  const duplicate = { ...fixture.sources[0], id: "src-aaaaaaaaaaaaaa", url: `${fixture.sources[0].url}?utm_medium=email`, title: fixture.sources[0].title.toUpperCase() };
  const result = dedupeSources([fixture.sources[0], duplicate, fixture.sources[1]]);
  assert.equal(result.length, 2);
});

test("source selection caps publisher concentration and discovery noise", () => {
  const fixture = buildFixture();
  const crowded = Array.from({ length: 20 }, (_, index) => ({ ...fixture.sources[0], id: `src-crowded-${index}`, title: `Crowded source ${index}`, url: `https://example.com/${index}` }));
  const selected = selectEvidenceSources([...crowded, ...fixture.sources.slice(1)], { maxTotal: 8, maxPerPublisher: 2, maxDiscovery: 2 });
  assert.ok(selected.length <= 8);
  assert.equal(selected.filter((source) => source.publisher === fixture.sources[0].publisher).length, 2);
});

test("scoring and quality gates enforce evidence and the 68 threshold", () => {
  const fixture = buildFixture();
  const map = new Map(fixture.sources.map((source) => [source.id, source]));
  const item = fixture.daily.opportunities[0];
  assert.ok(scoreOpportunity(item, map).total >= 68);
  assert.equal(hasIndependentSources(item, map), true);
  assert.equal(gateDaily(fixture.daily).pass, true);
  const weakened = structuredClone(fixture.daily);
  weakened.opportunities[0].evidence = [{ claim: "unsupported", source_ids: ["missing"], confidence: "low" }];
  weakened.opportunities[0].score = scoreOpportunity(weakened.opportunities[0], map);
  assert.equal(gateDaily(weakened).pass, false);
});

test("fail-closed publish never overwrites a valid latest file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "startup-fail-closed-"));
  const latest = path.join(root, "opportunities/latest.json");
  await writeJsonAtomic(latest, { sentinel: true });
  const invalid = { ...buildFixture().daily, opportunities: [] };
  await assert.rejects(() => publishDaily(invalid, { outputPath: latest, archiveDir: path.join(root, "archive") }), /Daily publish blocked/u);
  assert.deepEqual(JSON.parse(await fs.readFile(latest, "utf8")), { sentinel: true });
});

test("offline fixture runs through draft, promotion, index and public validation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "startup-e2e-"));
  const fixture = buildFixture();
  await publishDaily(fixture.daily, { outputPath: path.join(root, "opportunities/latest.json"), archiveDir: path.join(root, "opportunities/archive") });
  const draftPath = path.join(root, "cases/drafts/cursor-workflow-wedge.json");
  await writeCaseDraft(fixture.case, draftPath);
  const promoted = await promoteCase({ draftPath, caseRoot: path.join(root, "cases"), indexPath: path.join(root, "cases/index.json") });
  assert.equal(promoted.published.status, "published");
  assert.deepEqual(await validatePublicPaths({ opportunityPath: path.join(root, "opportunities/latest.json"), indexPath: path.join(root, "cases/index.json"), caseRoot: path.join(root, "cases") }), [path.join(root, "opportunities/latest.json"), path.join(root, "cases/index.json"), path.join(root, "cases/cursor-workflow-wedge.json")]);
});
