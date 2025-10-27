import { cleanText, ensureArray, normaliseLang, unique } from "./shared.js";

const INTERNAL_PAGE = "/lab/modelswatch.html";

export async function extractModelswatch({ files, readJson, flavour }) {
  const docChunks = [];
  const entityCards = [];
  const warnings = [];

  const type = flavour === "github" ? "repo" : "hf";
  const source = flavour === "github" ? "modelswatch_gh" : "modelswatch_hf";
  const docType = flavour === "github" ? "repo_profile" : "hf_model";

  for (const file of files) {
    const payload = await readJson(file);
    if (!payload || !Array.isArray(payload.items)) continue;
    payload.items.forEach((item, index) => {
      const canonicalId = item?.canonical_id || buildCanonicalId(item, type, index);
      if (!canonicalId) {
        warnings.push(`${source} item index ${index} missing canonical_id`);
        return;
      }

      const locales = unique(
        ensureArray(item?.locales).concat(Object.keys(item?.summaries || {}))
      ).filter(Boolean);
      if (!locales.length) {
        warnings.push(`${canonicalId} has no locale payload`);
        return;
      }

      locales.forEach((rawLang, chunkIndex) => {
        const lang = normaliseLang(rawLang);
        const text = cleanText(
          item?.summaries?.[lang] ||
            item?.summaries?.[rawLang] ||
            item?.summary_short?.[lang] ||
            item?.summary_short?.[rawLang] ||
            ""
        );
        if (!text) return;

        docChunks.push({
          docId: `${canonicalId}:summary:${lang}`,
          source,
          type: docType,
          lang,
          title: item?.name || canonicalId,
          url: buildPageUrl(item?.url, canonicalId),
          chunkId: `c${chunkIndex + 1}`,
          text,
          meta: {
            tags: item?.tags || [],
            updated_at: item?.updated_at || item?.generated_at || null,
            canonical_id: canonicalId,
            project_url: item?.url || null,
            stats: item?.stats || null,
          },
        });
      });

      entityCards.push({
        entityId: canonicalId,
        entityType: type,
        name: item?.name || canonicalId,
        summaries: {
          zh: cleanText(item?.summaries?.zh || item?.summary_short?.zh || ""),
          en: cleanText(item?.summaries?.en || item?.summary_short?.en || ""),
          es: cleanText(item?.summaries?.es || item?.summary_short?.es || ""),
        },
        links: {
          page: buildPageUrl(item?.url, canonicalId),
          homepage: item?.url || null,
        },
        tags: item?.tags || [],
        metrics: item?.stats || {},
        updatedAt: item?.updated_at || item?.generated_at || null,
      });
    });
  }

  return { docChunks, entityCards, warnings };
}

function buildCanonicalId(item, type, index) {
  if (item?.url) {
    try {
      const url = new URL(item.url);
      return `${type}:${url.hostname.replace(/^www\./, "")}${url.pathname}`;
    } catch (error) {
      return `${type}:${item.url}`;
    }
  }
  return `${type}:entry-${index}`;
}

function buildPageUrl(url, canonicalId) {
  if (url) return url;
  const anchor = canonicalId.replace(/[^a-z0-9]+/gi, "-").replace(/-+/g, "-");
  return `${INTERNAL_PAGE}#${anchor}`;
}
