import { cleanText, ensureArray, normaliseLang, safeId, unique } from "./shared.js";

const INTERNAL_PAGE = "/ai-lab.html#wealth-pulse";

export async function extractWealthPulse({ files, readJson }) {
  const docChunks = [];
  const entityCards = [];
  const warnings = [];

  for (const file of files) {
    const payload = await readJson(file);
    if (!Array.isArray(payload)) {
      warnings.push(`wealth_pulse payload in ${file} is not an array`);
      continue;
    }

    payload.forEach((daily, dayIndex) => {
      const date = daily?.date || inferDateFromItems(daily?.items) || `undated-${dayIndex}`;
      const entityId = `wealth_pulse:daily:${date}`;
      const dailyDigest = { zh: [], en: [] };

      ensureArray(daily?.items).forEach((item, itemIndex) => {
        if (!item) return;
        const baseId = safeId(item?.title || `${date}-${itemIndex}`, "wp");
        const canonicalId = `wealth_pulse:${date}:${baseId}`;
        const langs = unique(
          Object.keys(item?.facts || {}).concat(Object.keys(item?.impact_one_liner || {}))
        );

        if (!langs.length) {
          warnings.push(`wealth_pulse ${canonicalId} missing language payload`);
          return;
        }

        const publishedAt = item?.time_utc || null;
        const url = ensureArray(item?.links)[0] || `${INTERNAL_PAGE}#${date}`;
        const tags = [item?.source].filter(Boolean);

        langs.forEach((rawLang, chunkIndex) => {
          const lang = normaliseLang(rawLang);
          const facts = cleanText(item?.facts?.[lang] || item?.facts?.[rawLang] || "");
          const impact = cleanText(
            item?.impact_one_liner?.[lang] || item?.impact_one_liner?.[rawLang] || ""
          );
          const textBlocks = [facts];
          if (impact) textBlocks.push(`市场影响\n${impact}`);
          const text = cleanText(textBlocks.filter(Boolean).join("\n\n"));
          if (!text) {
            warnings.push(`wealth_pulse ${canonicalId} lang ${lang} missing text`);
            return;
          }

          docChunks.push({
            docId: `${canonicalId}:brief:${lang}`,
            source: "wealth_pulse",
            type: "macro_brief",
            lang,
            title: item?.title || `Wealth Pulse ${date}`,
            url,
            chunkId: `c${chunkIndex + 1}`,
            text,
            meta: {
              source_name: item?.source || null,
              published_at: publishedAt,
              canonical_id: canonicalId,
              links: ensureArray(item?.links),
              tags,
            },
          });

          if (dailyDigest[lang]) {
            dailyDigest[lang].push(buildDigestLine(item, impact || facts, lang));
          }
        });
      });

      const summaries = {
        zh: cleanText(buildDailySummary(date, dailyDigest.zh, "zh")),
        en: cleanText(buildDailySummary(date, dailyDigest.en, "en")),
        es: "",
      };

      entityCards.push({
        entityId,
        entityType: "macro_day",
        name: `${date} Wealth Pulse`,
        summaries,
        links: { page: `${INTERNAL_PAGE}#${date}` },
        tags: ["macro", "markets", "wealth-pulse"],
        metrics: { items: daily?.items?.length || 0 },
        updatedAt: inferDateTime(daily?.items) || null,
      });
    });
  }

  return { docChunks, entityCards, warnings };
}

function inferDateFromItems(items) {
  if (!items || !items.length) return null;
  const ts = items[0]?.time_utc;
  if (!ts) return null;
  return ts.slice(0, 10);
}

function inferDateTime(items) {
  if (!items || !items.length) return null;
  return items[0]?.time_utc || null;
}

function buildDailySummary(date, lines, lang) {
  if (!lines?.length) return "";
  const intro =
    lang === "en"
      ? `Daily macro pulse for ${date}:`
      : `${date} 宏观市场脉搏：`;
  const bullets = lines.slice(0, 6).map((line) => `- ${line}`);
  return [intro, ...bullets].join("\n");
}

function buildDigestLine(item, highlight, lang) {
  const title = cleanText(item?.title || item?.source || "要闻");
  const detail = cleanText(highlight || "");
  if (!detail) return title;
  if (lang === "en") {
    return `${title}: ${detail}`;
  }
  return `${title}：${detail}`;
}
