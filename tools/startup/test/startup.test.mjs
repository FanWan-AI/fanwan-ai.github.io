import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildFixture } from "../lib/fixtures.mjs";
import { dedupeSources, selectEvidenceSources } from "../lib/collect.mjs";
import { collectBraveSearch, enrichSources, extractReadableContent } from "../lib/collect.mjs";
import { gateCase, gateDaily, retainPassingOpportunities } from "../lib/gates.mjs";
import { publishDaily, promoteCase, validatePublicPaths, writeCaseDraft } from "../lib/publish.mjs";
import { assertSchema, validateSchema, retainSchemaValidOpportunities } from "../lib/schemas.mjs";
import { hasIndependentSources, scoreOpportunity } from "../lib/scoring.mjs";
import { isSafeUrl, normalizeUrl, assertPublicUrl } from "../lib/url-security.mjs";
import { todayInTimeZone, writeJsonAtomic } from "../lib/utils.mjs";
import { DEFAULT_CASE_INDEX_PATH, DEFAULT_CASE_ROOT, DEFAULT_OPPORTUNITY_PATH } from "../lib/constants.mjs";
import { fetchText } from "../lib/http.mjs";
import { callStructured } from "../lib/deepseek.mjs";
import { deterministicCaseVerification, deterministicDailyVerification, validateRemoteVerifier } from "../lib/verify.mjs";
import { buildDailyDocument, normalizeOpportunity, normalizeCase } from "../lib/normalize.mjs";

test("normalization keeps the public headline and never erases unsupported source claims", () => {
  const fixture = buildFixture();
  const normalized = buildDailyDocument({ ...fixture.daily, headline: "A useful daily business headline" }, fixture.daily.sources, fixture.daily.date);
  assert.equal(normalized.headline, "A useful daily business headline");
  const item = structuredClone(fixture.daily.opportunities[0]);
  item.evidence.push({ claim: "Unsupported factual statement", source_ids: ["src-invented"], confidence: "high" });
  const map = new Map(fixture.daily.sources.map(s => [s.id, s]));
  const result = normalizeOpportunity(item, 0, map);
  assert.equal(result.evidence.at(-1).source_ids[0], "src-invented");
  assert.equal(gateDaily({ ...fixture.daily, opportunities: [result] }).pass, false);
  const caseDraft = structuredClone(fixture.case);
  caseDraft.sections[0].source_ids.push("src-invented");
  assert.equal(gateCase(normalizeCase(caseDraft, caseDraft.sources)).pass, false);
  assert.equal(validateRemoteVerifier({ approved: true, issues: ["Unsupported claim"], source_coverage: 1 }, 1).approved, false);
});

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

test("one schema-invalid candidate does not discard a valid edition", async () => {
  const { daily } = buildFixture();
  const broken = structuredClone(daily.opportunities[0]);
  broken.business_model = "short";
  const result = await retainSchemaValidOpportunities({ ...daily, opportunities: [broken, daily.opportunities[0]] });
  assert.equal(result.opportunities.length, 1);
  assert.equal(result.opportunities[0].rank, 1);
  assert.equal(result.opportunities[0].depth, "deep");
});

test("public validation is fail-closed for missing public files, with explicit empty mode", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "startup-validate-required-"));
  const opportunityPath = path.join(root, "opportunities/latest.json");
  const indexPath = path.join(root, "cases/index.json");
  const casePath = path.join(root, "cases/cursor-workflow-wedge.json");
  const fixture = buildFixture();
  await assert.rejects(() => validatePublicPaths({ opportunityPath, indexPath, caseRoot: path.join(root, "cases") }), /ENOENT/u);
  assert.deepEqual(await validatePublicPaths({ opportunityPath, indexPath, caseRoot: path.join(root, "cases"), allowEmpty: true }), []);
  await publishDaily(fixture.daily, { outputPath: opportunityPath, archiveDir: path.join(root, "opportunities/archive") });
  const draftPath = path.join(root, "cases/drafts/cursor-workflow-wedge.json");
  await writeCaseDraft(fixture.case, draftPath);
  await promoteCase({ draftPath, caseRoot: path.join(root, "cases"), indexPath });
  const savedIndex = JSON.parse(await fs.readFile(indexPath, "utf8"));

  await fs.unlink(opportunityPath);
  await assert.rejects(() => validatePublicPaths({ opportunityPath, indexPath, caseRoot: path.join(root, "cases") }), /ENOENT/u);
  await writeJsonAtomic(opportunityPath, fixture.daily);
  await fs.unlink(indexPath);
  await assert.rejects(() => validatePublicPaths({ opportunityPath, indexPath, caseRoot: path.join(root, "cases") }), /ENOENT/u);
  await writeJsonAtomic(indexPath, savedIndex);
  await fs.unlink(casePath);
  await assert.rejects(() => validatePublicPaths({ opportunityPath, indexPath, caseRoot: path.join(root, "cases"), allowEmpty: true }), /ENOENT/u);
});

test("fetchText forwards controlled headers but strips credentials across origins", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, headers: new Headers(init.headers) });
    if (calls.length === 1) return new Response("", { status: 302, headers: { location: "https://example.com/final" } });
    return new Response("ok", { status: 200 });
  };
  try {
    assert.equal(await fetchText("https://api.example.test/search", { resolveDns: false, retries: 0, headers: { "X-Subscription-Token": "secret-test-key" } }), "ok");
    assert.equal(calls[0].headers.get("x-subscription-token"), "secret-test-key");
    assert.equal(calls[1].headers.get("x-subscription-token"), null);
  } finally { globalThis.fetch = originalFetch; }
});

test("Brave search sends its API key as a header and readable extraction skips navigation", async () => {
  const originalFetch = globalThis.fetch;
  let requestHeaders;
  globalThis.fetch = async (_url, init) => {
    requestHeaders = new Headers(init.headers);
    return new Response(JSON.stringify({ web: { results: [{ title: "Result", url: "https://example.com/article", description: "A useful discovery" }] } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await collectBraveSearch({ apiKey: "secret-test-key", queries: ["test"], resolveDns: false });
    assert.equal(result.sources.length, 1);
    assert.equal(requestHeaders.get("x-subscription-token"), "secret-test-key");
    const readable = extractReadableContent("<nav>Navigation that must not be evidence</nav><article><p>This is the article paragraph with enough content to be retained as source evidence rather than page chrome.</p></article>");
    assert.match(readable, /article paragraph/u);
    assert.doesNotMatch(readable, /Navigation/u);
  } finally { globalThis.fetch = originalFetch; }
});

test("source enrichment prefers article body and recovers publication date metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<meta property=\"article:published_time\" content=\"2026-09-07T00:00:00Z\"><nav>Chrome</nav><article><p>This is a substantive article paragraph with enough words to pass the body extraction threshold and replace the feed navigation excerpt.</p></article>", { status: 200 });
  try {
    const { sources: enrichedSources } = await enrichSources([{ id: "src-test-source", title: "Test", url: "https://example.com/article", publisher: "Example", published_at: null, retrieved_at: new Date().toISOString(), tier: "primary", snippet: "feed excerpt" }], { resolveDns: false, maxEnrich: 1 });
    const [source] = enrichedSources;
    assert.equal(source.published_at, "2026-09-07T00:00:00.000Z");
    assert.match(source.snippet, /substantive article paragraph/u);
    assert.doesNotMatch(source.snippet, /Chrome/u);
  } finally { globalThis.fetch = originalFetch; }
});

test("DeepSeek uses Chat Completions JSON mode and rejects truncated output", async () => {
  const originalFetch = globalThis.fetch;
  const saved = { key: process.env.DEEPSEEK_API_KEY, base: process.env.DEEPSEEK_BASE_URL, model: process.env.DEEPSEEK_MODEL, retries: process.env.DEEPSEEK_RETRIES };
  const calls = [];
  process.env.DEEPSEEK_API_KEY = "secret-test-key";
  delete process.env.DEEPSEEK_BASE_URL;
  delete process.env.DEEPSEEK_MODEL;
  process.env.DEEPSEEK_RETRIES = "2";
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: new Headers(init.headers) });
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{\"ok\":true}" } }] }), { status: 200 });
  };
  try {
    assert.deepEqual(await callStructured({ system: "输出 JSON", user: "test", schemaName: "test", schema: { type: "object" } }), { ok: true });
    assert.match(calls[0].url, /api\.deepseek\.com\/chat\/completions/u);
    assert.equal(calls[0].body.response_format.type, "json_object");
    assert.equal(calls[0].body.model, "deepseek-v4-flash");
    assert.equal(calls[0].body.tools, undefined);
    assert.equal(calls[0].headers.get("authorization"), "Bearer secret-test-key");
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "{\"cut" } }] }), { status: 200 });
    await assert.rejects(() => callStructured({ system: "输出 JSON", user: "test", schemaName: "test", schema: { type: "object" } }), /truncated/u);
    let unauthorizedCalls = 0;
    globalThis.fetch = async () => { unauthorizedCalls += 1; return new Response("invalid key", { status: 401 }); };
    await assert.rejects(() => callStructured({ system: "输出 JSON", user: "test", schemaName: "test", schema: { type: "object" } }), /DeepSeek HTTP 401/u);
    assert.equal(unauthorizedCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (saved.key === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = saved.key;
    if (saved.base === undefined) delete process.env.DEEPSEEK_BASE_URL; else process.env.DEEPSEEK_BASE_URL = saved.base;
    if (saved.model === undefined) delete process.env.DEEPSEEK_MODEL; else process.env.DEEPSEEK_MODEL = saved.model;
    if (saved.retries === undefined) delete process.env.DEEPSEEK_RETRIES; else process.env.DEEPSEEK_RETRIES = saved.retries;
  }
});

test("verifiers require a boolean approval and real >=0.85 source coverage", () => {
  const fixture = buildFixture();
  assert.equal(deterministicDailyVerification(fixture.daily).approved, true);
  assert.equal(deterministicCaseVerification(fixture.case).approved, true);
  assert.equal(validateRemoteVerifier({ approved: "true", issues: [], source_coverage: 1 }, 1).approved, false);
  assert.equal(validateRemoteVerifier({ approved: true, issues: [], source_coverage: 0.84 }, 1).approved, false);
  assert.equal(validateRemoteVerifier({ approved: true, issues: [], source_coverage: 1 }, 0.84).approved, false);
});

test("daily generation can discard one bad candidate before sorting the survivors", () => {
  const fixture = buildFixture();
  const bad = structuredClone(fixture.daily.opportunities[0]);
  bad.id = "bad-candidate";
  bad.evidence = [];
  bad.score = { ...bad.score, total: 100 };
  const retained = retainPassingOpportunities({ ...fixture.daily, opportunities: [bad, ...fixture.daily.opportunities] });
  assert.equal(retained.opportunities.length, fixture.daily.opportunities.length);
  assert.equal(gateDaily(retained).pass, true);
  assert.deepEqual(retained.opportunities.map((item) => item.rank), [1, 2, 3]);
});
