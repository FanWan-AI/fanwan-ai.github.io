import Parser from "rss-parser";
import { CURATED_FEEDS, DEFAULT_CONCURRENCY, DEFAULT_SEARCH_QUERIES } from "./constants.mjs";
import { fetchText } from "./http.mjs";
import { assertPublicUrl, normalizeUrl } from "./url-security.mjs";
import { cleanString, mapWithConcurrency, sha256, isoNow } from "./utils.mjs";

const parser = new Parser({ timeout: 12_000 });

function sourceId(title, url) { return `src-${sha256(`${title}\n${url}`).slice(0, 14)}`; }

function toSource(item, config, retrievedAt) {
  const rawUrl = item.link || item.guid || item.url;
  if (!rawUrl) return null;
  let url;
  try { url = normalizeUrl(rawUrl); } catch { return null; }
  const title = cleanString(item.title || "Untitled source", 300);
  let publishedAt = item.isoDate || item.pubDate || item.published_at || null;
  if (publishedAt) {
    const parsed = new Date(publishedAt);
    publishedAt = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return {
    id: sourceId(title, url), title, url,
    publisher: cleanString(config.publisher || item.creator || "Unknown publisher", 120),
    published_at: publishedAt,
    retrieved_at: retrievedAt,
    tier: config.tier || "discovery_only",
    snippet: cleanString(item.contentSnippet || item.content || item.summary || "", 900)
  };
}

export function dedupeSources(sources) {
  const seenUrls = new Set();
  const seenTitles = new Set();
  return sources.filter((source) => {
    const titleKey = source.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (seenUrls.has(source.url) || (titleKey && seenTitles.has(titleKey))) return false;
    seenUrls.add(source.url); if (titleKey) seenTitles.add(titleKey); return true;
  });
}

function roundRobin(groups, limit, perPublisher) {
  const selected = [];
  const buckets = [...groups.values()].map((items) => items.slice(0, perPublisher));
  for (let depth = 0; selected.length < limit && buckets.some((items) => depth < items.length); depth += 1) {
    for (const items of buckets) {
      if (selected.length >= limit) break;
      if (items[depth]) selected.push(items[depth]);
    }
  }
  return selected;
}

function groupByPublisher(sources) {
  const groups = new Map();
  for (const source of sources) {
    const key = source.publisher.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(source);
  }
  return groups;
}

export function selectEvidenceSources(sources, { maxTotal = 72, maxPerPublisher = 10, maxDiscovery = 18 } = {}) {
  const deduped = dedupeSources(sources);
  const byDate = (a, b) => String(b.published_at || "").localeCompare(String(a.published_at || ""));
  const trusted = deduped.filter((source) => source.tier !== "discovery_only").sort(byDate);
  const discovery = deduped.filter((source) => source.tier === "discovery_only").sort(byDate);
  const trustedSelection = roundRobin(groupByPublisher(trusted), Math.max(0, maxTotal - maxDiscovery), maxPerPublisher);
  const discoverySelection = roundRobin(groupByPublisher(discovery), Math.min(maxDiscovery, maxTotal - trustedSelection.length), 3);
  return [...trustedSelection, ...discoverySelection].slice(0, maxTotal);
}

function readableText(raw) {
  return cleanString(String(raw || "")
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&quot;/giu, "\""), 900);
}

export async function enrichSources(sources, { maxEnrich = 36, concurrency = DEFAULT_CONCURRENCY, resolveDns = true } = {}) {
  const targets = sources.slice(0, maxEnrich);
  const results = await mapWithConcurrency(targets, concurrency, async (source) => {
    const raw = await fetchText(source.url, { maxBytes: 700_000, timeoutMs: 8_000, retries: 1, resolveDns });
    const excerpt = readableText(raw);
    return excerpt.length >= 80 ? { ...source, snippet: cleanString(`${source.snippet || ""} ${excerpt}`, 900) } : source;
  });
  const failures = results.map((result, index) => result?.error ? `${targets[index].url}: ${result.error.code || result.error.message}` : null).filter(Boolean);
  const enriched = results.map((result, index) => result?.error ? targets[index] : result);
  return {
    sources: [...enriched, ...sources.slice(maxEnrich)],
    warnings: failures.length ? [`${failures.length} source pages could not be enriched; retained feed/search excerpts.`, ...failures.slice(0, 3)] : []
  };
}

export async function collectCuratedRss({ feeds = CURATED_FEEDS, concurrency = DEFAULT_CONCURRENCY, resolveDns = true } = {}) {
  const results = await mapWithConcurrency(feeds, concurrency, async (config) => {
    const retrievedAt = isoNow();
    try {
      const xml = await fetchText(config.url, { maxBytes: 800_000, timeoutMs: 12_000, retries: 2, resolveDns });
      const feed = await parser.parseString(xml);
      return (feed.items || []).slice(0, 40).map((item) => toSource(item, { ...config, publisher: config.publisher || feed.title }, retrievedAt)).filter(Boolean);
    } catch (error) { return { error, feed: config.url }; }
  });
  const sources = [];
  const warnings = [];
  for (const result of results) {
    if (Array.isArray(result)) sources.push(...result);
    else if (result?.error) warnings.push(`${result.feed}: ${result.error.code || result.error.message}`);
  }
  return { sources: dedupeSources(sources), warnings };
}

export async function collectBraveSearch({ apiKey = process.env.BRAVE_SEARCH_API_KEY, queries = DEFAULT_SEARCH_QUERIES, resolveDns = true } = {}) {
  if (!apiKey) return { sources: [], warnings: ["BRAVE_SEARCH_API_KEY not configured"] };
  const results = await mapWithConcurrency(queries.slice(0, 6), 2, async (query) => {
    const endpoint = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&freshness=pm`;
    const raw = await fetchText(endpoint, { timeoutMs: 10_000, maxBytes: 1_000_000, retries: 2, resolveDns });
    const payload = JSON.parse(raw);
    return (payload.web?.results || []).map((item) => toSource({ title: item.title, link: item.url, contentSnippet: item.description, published_at: item.age }, { publisher: item.profile?.long_name || "Brave Search", tier: "discovery_only" }, isoNow())).filter(Boolean);
  });
  const sources = results.filter(Array.isArray).flat();
  const warnings = results.filter((item) => item?.error).map((item) => item.error.message);
  return { sources: dedupeSources(sources), warnings };
}

export async function collectSources(options = {}) {
  const rss = await collectCuratedRss(options);
  const brave = options.brave === false ? { sources: [], warnings: [] } : await collectBraveSearch(options);
  const selected = selectEvidenceSources([...rss.sources, ...brave.sources]);
  const enriched = options.enrich === false ? { sources: selected, warnings: [] } : await enrichSources(selected, options);
  return { sources: enriched.sources, warnings: [...rss.warnings, ...brave.warnings, ...enriched.warnings] };
}

export function sourceMap(sources) { return new Map(sources.map((source) => [source.id, source])); }
