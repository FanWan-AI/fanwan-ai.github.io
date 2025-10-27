import { cleanText, normaliseLang, safeId } from "./shared.js";

const INTERNAL_BASE = "/";

export async function extractSiteDocs({ files, readText }) {
  if (!readText) {
    throw new Error("extractSiteDocs requires readText function in context");
  }

  const docChunks = [];
  const entityCards = [];
  const warnings = [];

  for (const file of files) {
    const html = await readText(file);
    if (!html) {
      warnings.push(`site_docs could not read ${file}`);
      continue;
    }

    const urlPath = deriveUrlPath(file);
    const pageId = `site:${urlPath.replace(/^\/+/, "") || "index"}`;
    const pageTitle = extractTitle(html) || urlPath || "Site Page";
    const pageLang = normaliseLang(extractLang(html));
    const bodyHtml = extractBody(html) || html;

    const sections = splitIntoSections(bodyHtml, pageTitle);
    if (!sections.length) {
      const text = truncateText(htmlToPlainText(bodyHtml), 1600);
      if (!text) continue;
      docChunks.push(buildDocChunk({
        pageId,
        urlPath,
        pageLang,
        title: pageTitle,
        text,
        anchor: "intro",
        index: docChunks.length + 1,
      }));
    } else {
      sections.forEach((section, sectionIndex) => {
        const text = truncateText(htmlToPlainText(section.content), 1600);
        if (!text) return;
        docChunks.push(
          buildDocChunk({
            pageId,
            urlPath,
            pageLang,
            title: section.title,
            text,
            anchor: section.anchor || `s${sectionIndex + 1}`,
            index: docChunks.length + 1,
          })
        );
      });
    }

    const summaryText = buildSummary(docChunks, pageId, pageLang);
    entityCards.push({
      entityId: pageId,
      entityType: "page",
      name: pageTitle,
      summaries: {
        zh: pageLang === "zh" ? summaryText : "",
        en: pageLang === "en" ? summaryText : "",
        es: pageLang === "es" ? summaryText : "",
      },
      links: { page: urlPath || INTERNAL_BASE },
      tags: ["site", "page"],
      metrics: { sections: sections.length || 1 },
      updatedAt: extractLastModified(html) || null,
    });
  }

  return { docChunks, entityCards, warnings };
}

function deriveUrlPath(file) {
  const lower = file.toLowerCase();
  const marker = "fanwan-ai.github.io";
  const idx = lower.lastIndexOf(marker);
  let relative = idx >= 0 ? file.slice(idx + marker.length) : file;
  relative = relative.replace(/^[\\/]+/, "");
  if (!relative) return "/";
  const normalised = `/${relative.replace(/\\/g, "/")}`;
  if (normalised.endsWith("index.html")) return normalised.replace(/index\.html$/, "");
  return normalised;
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? cleanText(htmlToPlainText(match[1])) : "";
}

function extractLang(html) {
  const match = html.match(/<html[^>]*lang="([^"]+)"/i);
  if (match) return match[1];
  return "zh";
}

function extractBody(html) {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return match ? match[1] : null;
}

function splitIntoSections(bodyHtml, fallbackTitle) {
  if (!bodyHtml) return [];
  const cleaned = stripIrrelevant(bodyHtml);
  const headingRegex = /<(h[1-3])[^>]*>([\s\S]*?)<\/\1>/gi;
  const matches = Array.from(cleaned.matchAll(headingRegex));
  if (!matches.length) {
    return [];
  }

  const sections = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const headingHtml = match[0];
    const title = cleanText(htmlToPlainText(headingHtml));
    const start = match.index + headingHtml.length;
    const end = i + 1 < matches.length ? matches[i + 1].index : cleaned.length;
    const content = cleaned.slice(start, end);
    sections.push({
      title: title || fallbackTitle,
      content,
      anchor: slugify(title || fallbackTitle),
    });
  }
  return sections;
}

function stripIrrelevant(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "");
}

function htmlToPlainText(html) {
  if (!html) return "";
  return decodeHtml(
    html
      .replace(/\r\n/g, "\n")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<\/(p|div|section|article|ul|ol|table|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '\"')
    .replace(/&#39;/g, "'");
}

function truncateText(text, limit) {
  const cleaned = cleanText(text);
  if (!cleaned) return "";
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit - 3)}...`;
}

function slugify(value) {
  return safeId(value || "section", "section")
    .toLowerCase()
    .replace(/[^a-z0-9\-]/g, "-")
    .replace(/-+/g, "-");
}

function buildDocChunk({ pageId, urlPath, pageLang, title, text, anchor, index }) {
  const url = anchor ? `${urlPath}#${anchor}` : urlPath;
  return {
    docId: `${pageId}:${anchor}`,
    source: "site_docs",
    type: "page_section",
    lang: pageLang,
    title,
    url,
    chunkId: `c${index}`,
    text,
    meta: {
      page: urlPath,
      canonical_id: pageId,
      section_anchor: anchor,
    },
  };
}

function buildSummary(docChunks, pageId, pageLang) {
  const related = docChunks.filter((chunk) => chunk.meta?.canonical_id === pageId && chunk.lang === pageLang);
  if (!related.length) return "";
  const top = related
    .slice(0, 3)
    .map((chunk) => `${chunk.title}: ${chunk.text.split("\n")[0]}`)
    .join("\n");
  return cleanText(top);
}

function extractLastModified(html) {
  const match = html.match(/<meta[^>]+property="article:modified_time"[^>]+content="([^"]+)"/i);
  if (match) return match[1];
  const alt = html.match(/<meta[^>]+name="last-modified"[^>]+content="([^"]+)"/i);
  return alt ? alt[1] : null;
}
