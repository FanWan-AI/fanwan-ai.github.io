import { cleanText, normaliseLang, safeId } from "./shared.js";

const INTERNAL_PAGE = "/lab/ai-radar.html";

export async function extractAiradar({ files, readJson }) {
  const docChunks = [];
  const entityCards = [];
  const warnings = [];
  const missingLangStats = new Map();
  const missingByHost = new Map();
  const droppedNoExcerpt = { count: 0, samples: [], hosts: new Map() };
  let totalItems = 0;
  let producedItems = 0;
  const missingLangCounts = new Map();

  for (const file of files) {
    const payload = await readJson(file);
    if (!payload || !Array.isArray(payload.items)) continue;
    const dateStamp = extractDateFromPath(file) || payload.generated_at?.slice(0, 10);
    const dailyId = `airadar:daily:${dateStamp || "undated"}`;
    const dailyItems = [];

    const items = Array.from(payload.items.entries());
    for (const [index, item] of items) {
      totalItems += 1;
      const baseId = safeId(item?.id || `${dateStamp || "undated"}-${index}`, "airadar");
      const canonicalId = item?.id ? `airadar:${item.id}` : `${dailyId}:${index}`;
      const titleI18n = item?.title_i18n || {};
      const excerptI18n = item?.excerpt_i18n || {};
  const pageUrl = `${INTERNAL_PAGE}#${baseId}`;
  const externalUrl = item?.url || null;
  const url = pageUrl;
      const publishedAt = item?.published_at || payload.generated_at || null;
      const host = resolveHost(item?.source?.site || url);

      const preferredLangs = Object.keys(excerptI18n).filter((key) => {
        const candidate = excerptI18n[key];
        return typeof candidate === "string" && candidate.trim();
      });

      const titleLangs = Object.keys(titleI18n || {});
      const langs = new Set(preferredLangs);
      if (!langs.size) {
        if (item?.primary_lang) langs.add(item.primary_lang);
        langs.add("en");
      }
      titleLangs.forEach((lang) => langs.add(lang));

      const missingLangs = new Set();
      let producedLangs = 0;

      for (const rawLang of langs) {
        const lang = normaliseLang(rawLang);
        const rawText = selectExcerpt({ lang, rawLang, excerptI18n, fallback: item?.raw_excerpt });
        const text = cleanText(rawText);
        if (!text) {
          missingLangs.add(lang);
          missingLangCounts.set(lang, (missingLangCounts.get(lang) || 0) + 1);
          continue;
        }

        producedLangs += 1;
        const title = titleI18n?.[lang] || titleI18n?.[rawLang] || item?.title || `AI Radar ${baseId}`;

        docChunks.push({
          docId: `${canonicalId}:snippet:${lang}`,
          source: "airadar",
          type: "news_item",
          lang,
          title,
          url,
          chunkId: `c${producedLangs}`,
          text,
          meta: {
            published_at: publishedAt,
            time_weight: computeTimeWeight(publishedAt),
            hotness: item?.hotness || null,
            canonical_id: canonicalId,
            external_url: externalUrl,
            source_host: host || null,
          },
        });
      }

      if (missingLangs.size) {
        const key = Array.from(missingLangs).sort().join(",");
        if (!missingLangStats.has(key)) {
          missingLangStats.set(key, { count: 0, samples: [] });
        }
        const bucket = missingLangStats.get(key);
        bucket.count += 1;
        if (bucket.samples.length < 5) {
          bucket.samples.push(canonicalId);
        }

        if (host) {
          const hostBucket = missingByHost.get(host) || { count: 0, langs: new Set(), samples: [] };
          hostBucket.count += 1;
          missingLangs.forEach((lang) => hostBucket.langs.add(lang));
          if (hostBucket.samples.length < 5) {
            hostBucket.samples.push(canonicalId);
          }
          missingByHost.set(host, hostBucket);
        }
      }

      if (!producedLangs) {
        droppedNoExcerpt.count += 1;
        if (droppedNoExcerpt.samples.length < 5) {
          droppedNoExcerpt.samples.push(canonicalId);
        }
        if (host) {
          const hostInfo = droppedNoExcerpt.hosts.get(host) || { count: 0, samples: [] };
          hostInfo.count += 1;
          if (hostInfo.samples.length < 3) {
            hostInfo.samples.push(canonicalId);
          }
          droppedNoExcerpt.hosts.set(host, hostInfo);
        }
        continue;
      }

      producedItems += 1;

      dailyItems.push({
        id: canonicalId,
        url: pageUrl,
        title: item?.title || titleI18n?.zh || titleI18n?.en,
        published_at: publishedAt,
        external_url: externalUrl,
      });
    }

    if (dailyItems.length) {
      entityCards.push({
        entityId: dailyId,
        entityType: "news_day",
        name: `${dateStamp || "最新"} AI 前沿要闻`,
        summaries: {
          zh: cleanText(buildDailySummary(dailyItems, "zh")),
          en: cleanText(buildDailySummary(dailyItems, "en")),
          es: cleanText(buildDailySummary(dailyItems, "es")),
        },
        links: { page: `${INTERNAL_PAGE}#${dateStamp || "latest"}` },
        tags: ["news", "ai-radar"],
        metrics: { items: dailyItems.length },
        updatedAt: payload.generated_at || null,
      });
    }
  }

  if (droppedNoExcerpt.count) {
    const samples = droppedNoExcerpt.samples.join(", ");
    warnings.push(
      samples
        ? `airadar skipped ${droppedNoExcerpt.count} items with no usable excerpt (e.g. ${samples})`
        : `airadar skipped ${droppedNoExcerpt.count} items with no usable excerpt`
    );
  }

  for (const [languages, info] of missingLangStats.entries()) {
    const sampleText = info.samples.length ? ` (e.g. ${info.samples.join(", ")})` : "";
    warnings.push(`airadar missing excerpt for languages [${languages}] in ${info.count} items${sampleText}`);
  }

  const metrics = {
    total_items: totalItems,
    produced_items: producedItems,
    skipped_no_excerpt: droppedNoExcerpt.count,
    missing_lang_counts: Object.fromEntries(missingLangCounts.entries()),
    missing_lang_buckets: Array.from(missingLangStats.entries()).map(([key, info]) => ({
      languages: key.split(","),
      count: info.count,
      samples: info.samples,
    })),
    missing_by_host: Array.from(missingByHost.entries()).map(([host, info]) => ({
      host,
      count: info.count,
      languages: Array.from(info.langs),
      samples: info.samples,
    })),
    skipped_hosts: Array.from(droppedNoExcerpt.hosts.entries()).map(([host, info]) => ({
      host,
      count: info.count,
      samples: info.samples,
    })),
    skipped_samples: droppedNoExcerpt.samples,
  };

  return { docChunks, entityCards, warnings, metrics };
}

function extractDateFromPath(filePath) {
  const match = filePath.match(/(20\d{2}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function computeTimeWeight(publishedAt) {
  if (!publishedAt) return null;
  const published = new Date(publishedAt).getTime();
  if (Number.isNaN(published)) return null;
  const ageHours = (Date.now() - published) / (1000 * 60 * 60);
  const halfLife = 72; // hours
  return Math.exp(-Math.max(ageHours, 0) / halfLife);
}

function buildDailySummary(items, lang) {
  const header =
    lang === "en"
      ? `Coverage: ${items.length} AI stories`
      : lang === "es"
      ? `Cobertura: ${items.length} historias de IA`
      : `共收录 ${items.length} 条要闻`;
  const bulletLines = items.slice(0, 4).map((item) => `- ${item.title ?? item.id}`);
  return [header, ...bulletLines].join("\n");
}

function selectExcerpt({ lang, rawLang, excerptI18n, fallback }) {
  const direct = excerptI18n?.[lang];
  if (direct && direct.trim()) return direct;
  const rawKey = excerptI18n?.[rawLang];
  if (rawKey && rawKey.trim()) return rawKey;
  if (fallback && fallback.trim()) return fallback;
  const available = Object.values(excerptI18n || {}).find((value) => value && value.trim());
  return available || "";
}

function resolveHost(value) {
  if (!value) return "";
  try {
    const url = new URL(value, "https://dummy.base");
    return url.hostname || "";
  } catch (error) {
    return "";
  }
}
