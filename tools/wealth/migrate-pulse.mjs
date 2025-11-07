import path from "path";
import process from "process";

import {
  PULSE,
  i18nPick,
  readJSON,
  writeJSON
} from "./util.mjs";

const root = process.cwd();

function ensureI18n(obj, fallback = "") {
  if (!obj || typeof obj !== "object") return { zh: fallback, en: fallback };
  const out = {};
  if (typeof obj.zh === "string" && obj.zh.trim()) out.zh = obj.zh.trim();
  if (typeof obj.en === "string" && obj.en.trim()) out.en = obj.en.trim();
  if (!out.zh && out.en) out.zh = out.en;
  if (!out.en && out.zh) out.en = out.zh;
  if (typeof obj.es === "string" && obj.es.trim()) out.es = obj.es.trim();
  if (!out.zh) out.zh = fallback;
  if (!out.en) out.en = fallback;
  if (!out.es) out.es = out.en || out.zh || fallback;
  return out;
}

function isChinaItem(item) {
  const title = typeof item?.title === "string" ? item.title : i18nPick(item?.title, ["zh", "en", "es"]);
  const facts = item?.facts && typeof item.facts === "object"
    ? i18nPick(item.facts, ["zh", "en", "es"])
    : "";
  const hay = [title, item?.source, facts]
    .filter(Boolean)
    .join(" ");
  const keywords = [
    "中国", "人民币", "A股", "沪深", "央行", "人民银行", "财政部", "国务院", "证监会", "海关总署", "上交所", "深交所", "北交所", "社融", "专项债"
  ];
  return keywords.some((k) => hay.includes(k));
}

function coerceCategory(item) {
  if (item.category === "global" || item.category === "china") return item.category;
  return isChinaItem(item) ? "china" : "global";
}

function cloneDegradedItem(from, date, category) {
  const title = ensureI18n(
    from?.title,
    category === "global" ? "Global markets update" : "中国财经快讯"
  );
  const source = from?.source || (category === "global" ? "News" : "新闻");
  const facts = ensureI18n(from?.facts || { zh: "临时沿用前一日概览。", en: "Temporarily carrying over the previous day's summary." });
  const impact = ensureI18n(from?.impact_one_liner || { zh: "请结合当日市场信息审慎参考。", en: "Cross-check with today's conditions before acting." });
  const links = Array.isArray(from?.links) ? from.links.slice(0, 6) : [];
  const time = category === "china" ? `${date}T02:00:00Z` : `${date}T12:00:00Z`;
  return { title, source, time_utc: time, facts, impact_one_liner: impact, links, category, degraded: true };
}

function findNearest(groups, idx, category) {
  const n = groups.length;
  // search outward by distance
  for (let dist = 1; dist < n; dist += 1) {
    const left = idx - dist;
    const right = idx + dist;
    if (left >= 0) {
      const it = groups[left]?.items?.find((i) => i.category === category);
      if (it) return it;
    }
    if (right < n) {
      const it = groups[right]?.items?.find((i) => i.category === category);
      if (it) return it;
    }
  }
  // fallback: any item from first group
  const any = groups[0]?.items?.[0] || {};
  return any;
}

async function migrate() {
  const absPulse = path.resolve(root, PULSE);
  const groups = await readJSON(absPulse, []);
  if (!Array.isArray(groups) || groups.length === 0) {
    console.log("No pulse history to migrate.");
    return;
  }

  // Ensure stable order (newest first expected)
  groups.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  let changed = false;

  for (let idx = 0; idx < groups.length; idx += 1) {
    const g = groups[idx];
    if (!Array.isArray(g.items)) g.items = [];

    // Assign categories to items missing it
    for (const it of g.items) {
      if (!it.category) {
        it.category = coerceCategory(it);
        changed = true;
      }
    }

    const hasGlobal = g.items.some((i) => i.category === "global");
    const hasChina = g.items.some((i) => i.category === "china");

    // Ensure at least one per category by cloning nearest if missing
    if (!hasGlobal) {
      const near = findNearest(groups, idx, "global");
      g.items.push(cloneDegradedItem(near, g.date, "global"));
      changed = true;
    }
    if (!hasChina) {
      const near = findNearest(groups, idx, "china");
      g.items.push(cloneDegradedItem(near, g.date, "china"));
      changed = true;
    }
  }

  if (!changed) {
    console.log("Pulse data already categorized; no changes needed.");
    return;
  }

  // Normalize item order per day: global first then china then others
  for (const g of groups) {
    g.items.sort((a, b) => {
      const rank = (c) => (c === "global" ? 0 : c === "china" ? 1 : 2);
      return rank(a.category) - rank(b.category);
    });
  }

  await writeJSON(absPulse, groups);
  console.log(`Migrated pulse data: updated ${groups.length} day(s) to include category coverage`);
}

migrate().catch((err) => {
  console.error("Migration failed", err);
  process.exitCode = 1;
});
