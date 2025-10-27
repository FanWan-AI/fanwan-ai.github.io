import { cleanText, ensureArray, normaliseLang, safeId, unique } from "./shared.js";

const INTERNAL_PAGE = "/lab/scholarpush.html";

export async function extractScholarpush({ files, readJson }) {
  const docChunks = [];
  const entityCards = [];
  const warnings = [];

  for (const file of files) {
    const payload = await readJson(file);
    if (!payload || !Array.isArray(payload.items)) continue;
    const dateStamp = extractDateFromPath(file) || extractDateFromPayload(payload);

    payload.items.forEach((item, index) => {
      const baseId = safeId(item?.id || `${dateStamp || "unknown"}-${index}`, "scholar");
      const canonicalId = deriveCanonicalId(item, dateStamp, baseId);
      const titleI18n = item?.title_i18n || {};
      const summaryI18n = item?.summary_i18n || {};
      const quickRead = item?.quick_read;
      const oneLiner = item?.one_liner;

      const candidateLangs = unique(
        Object.keys(summaryI18n || {}).concat(Object.keys(titleI18n || {}))
      ).filter(Boolean);

      if (!candidateLangs.length && (quickRead || oneLiner)) {
        candidateLangs.push(normaliseLang("zh"));
      }

      if (!candidateLangs.length) {
        warnings.push(`scholarpush item ${canonicalId} missing language payload`);
        return;
      }

      const tags = unique([...(item?.tags || []), item?.task, item?.type].filter(Boolean));
      const baseUrl = `${INTERNAL_PAGE}#${baseId}`;

      candidateLangs.forEach((rawLang, chunkIndex) => {
        const lang = normaliseLang(rawLang);
        const text = cleanText(
          summaryI18n?.[lang] || summaryI18n?.[rawLang] || quickRead || oneLiner || ""
        );
        if (!text) {
          warnings.push(`scholarpush ${canonicalId} lang ${lang} missing text`);
          return;
        }

        const title =
          titleI18n?.[lang] ||
          titleI18n?.[rawLang] ||
          item?.headline ||
          item?.one_liner ||
          `Scholarpush Insight ${baseId}`;

        docChunks.push({
          docId: `${canonicalId}:summary:${lang}`,
          source: "scholarpush",
          type: item?.type === "paper" ? "paper_insight" : "daily_brief",
          lang,
          title,
          url: baseUrl,
          chunkId: `c${chunkIndex + 1}`,
          text,
          meta: {
            tags,
            task: item?.task || null,
            novelty: item?.novelty || null,
            updated_at: item?.ts || payload.generated_at || null,
            canonical_id: canonicalId,
            original_id: baseId,
            links: item?.links || null,
          },
        });
      });

      entityCards.push({
        entityId: canonicalId,
        entityType: "paper",
        name: item?.headline || summaryI18n?.en || summaryI18n?.zh || baseId,
        summaries: {
          zh: cleanText(summaryI18n?.zh || quickRead || oneLiner || ""),
          en: cleanText(summaryI18n?.en || ""),
          es: cleanText(summaryI18n?.es || ""),
        },
        links: buildLinks(item?.links, baseUrl),
        tags,
        metrics: {
          impact_score: item?.impact_score || null,
          reproducibility_score: item?.reproducibility_score || null,
        },
        updatedAt: item?.ts || payload.generated_at || null,
      });
    });
  }

  return { docChunks, entityCards, warnings };
}

function deriveCanonicalId(item, dateStamp, baseId) {
  const link = item?.links?.paper || item?.links?.code || item?.links?.project;
  if (link) {
    return normaliseLinkId(link);
  }
  return `scholarpush:${dateStamp || "undated"}:${baseId}`;
}

function normaliseLinkId(link) {
  try {
    const url = new URL(link);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname}`;
  } catch (error) {
    return link.replace(/^https?:\/\//, "");
  }
}

function extractDateFromPath(filePath) {
  const match = filePath.match(/(20\d{2}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function extractDateFromPayload(payload) {
  const ts = payload?.generated_at;
  if (!ts) return null;
  return ts.slice(0, 10);
}

function buildLinks(links, fallbackPage) {
  const result = {};
  if (links?.paper && links.paper !== "N/A") result.pdf = links.paper;
  if (links?.code && links.code !== "N/A") result.code = links.code;
  if (links?.project && links.project !== "N/A") result.project = links.project;
  result.page = fallbackPage;
  return result;
}
