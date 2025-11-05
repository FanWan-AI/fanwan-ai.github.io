import path from "path";
import process from "process";
import Parser from "rss-parser";

import {
	DATA_DIR,
	PULSE,
	PULSE_ARCH,
	SCHEMAS,
	backoff,
	readJSON,
	rollWindowAndArchive,
	sleep,
	today,
	validateWithSchema,
	writeJSON
} from "./util.mjs";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");
const maxRetries = dryRun ? 0 : 2;

// --- RSS sources and filters ---
// Curated feeds: focus on macro/markets/policy; avoid purely political topics
const RSS_SOURCES = {
	global: [
		"https://feeds.a.dj.com/rss/RSSMarketsMain.xml", // WSJ Markets
		"https://feeds.marketwatch.com/marketwatch/topstories/", // MarketWatch Top
		"https://www.ecb.europa.eu/rss/press-releases.xml", // ECB press
		"https://www.federalreserve.gov/feeds/press_monpol.xml", // Fed monetary policy
		"https://www.ft.com/markets?format=rss" // FT Markets
	],
	china: [
		"https://feeds.reuters.com/reuters/ChinaNews", // Reuters China
		"https://www.scmp.com/rss/41/feed", // SCMP China Business
		"https://www.hkma.gov.hk/eng/rss/press-releases.xml" // HKMA press
	]
};

const POSITIVE_KEYWORDS = [
	// English
	"interest", "rate", "rates", "pmi", "gdp", "trade", "tariff", "export", "import", "real estate", "housing",
	"monetary policy", "fed", "ecb", "central bank", "inflation", "cpi", "ppi", "employment", "jobs", "unemployment",
	"bond", "bonds", "treasury", "yield", "yields", "stock", "stocks", "equities", "futures", "etf", "currency", "fx",
	// Chinese
	"利率", "PMI", "GDP", "贸易", "房地产", "货币政策", "美联储", "央行", "通胀", "CPI", "PPI", "就业", "失业", "债券", "国债", "收益率", "股市", "期货", "汇率", "关税", "出口", "进口"
];
const NEGATIVE_KEYWORDS = [
	// English
	"corruption", "politics", "election", "protest", "leader", "geopolit", "conflict", "war", "sanction",
	// Chinese
	"腐败", "政治", "选举", "抗议", "领导人", "地缘", "冲突", "战争", "制裁"
];

function allowedDateSet(dateISO) {
	const d0 = new Date(dateISO);
	const prev = new Date(d0.getTime() - 24 * 60 * 60 * 1000);
	const pad = (n) => String(n).padStart(2, "0");
	const make = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
	return new Set([make(d0), make(prev)]);
}

async function fetchAndFilterRSS(urls, category, dateISO) {
	const parser = new Parser();
	const allowDates = allowedDateSet(dateISO);
	let items = [];
	for (const url of urls) {
		try {
			const feed = await parser.parseURL(url);
			const feedTitle = (feed?.title || "").trim();
			const recent = (feed?.items || [])
				.map((entry) => ({ ...entry, __feed: feedTitle }))
				.filter((entry) => {
					const rawDate = entry.isoDate || entry.pubDate || entry.pubdate || entry.date;
					if (!rawDate) return false;
					const dt = new Date(rawDate);
					if (Number.isNaN(dt.getTime())) return false;
					const ds = dt.toISOString().slice(0, 10);
					return allowDates.has(ds);
				})
				.filter((entry) => {
					const hay = [entry.title, entry.contentSnippet, entry.content, entry.summary]
						.filter(Boolean)
						.join(" ")
						.toLowerCase();
					const pos = POSITIVE_KEYWORDS.some((k) => hay.includes(String(k).toLowerCase()));
					const neg = NEGATIVE_KEYWORDS.some((k) => hay.includes(String(k).toLowerCase()));
					return pos && !neg;
				})
				.slice(0, 10);
			items.push(...recent);
		} catch (error) {
			console.warn(`RSS fetch failed for ${url}: ${error.message}`);
		}
		await sleep(400); // polite delay per source
	}
	// Sort by published time desc
	items.sort((a, b) => new Date(b.isoDate || b.pubDate || 0) - new Date(a.isoDate || a.pubDate || 0));
	return items.slice(0, 6);
}

function degradeOneFromHistory(history, dateISO, category) {
	const prevItems = history[0]?.items || [];
	const pick = prevItems.find((i) => i.category === category) || prevItems[0] || {};
	const time = category === "china" ? `${dateISO}T02:00:00Z` : `${dateISO}T12:00:00Z`;
	return coerceItem({
		title: pick?.title,
		source: pick?.source,
		time_utc: time,
		facts: pick?.facts,
		impact_one_liner: pick?.impact_one_liner,
		links: pick?.links,
		degraded: true
	}, category, dateISO);
}

function coerceItemFromRSSEntries(entries, category, dateISO) {
	if (!Array.isArray(entries) || entries.length === 0) return null;
	const top = entries[0];
	const title = (top.title || (category === "global" ? "Global Finance Update" : "中国财经快讯")).toString();
	const source = (top.__feed || top.creator || top.author || "Aggregated News").toString();
	const t = top.isoDate || top.pubDate || "";
	const time = t ? new Date(t).toISOString() : `${dateISO}T${category === "china" ? "02:00:00" : "12:00:00"}Z`;
	const factLines = entries
		.map((e) => (e.contentSnippet || e.summary || e.content || "").toString().trim())
		.filter(Boolean)
		.slice(0, 3)
		.map((s) => (s.startsWith("- ") ? s : `- ${s}`));
	const factsEn = factLines.join("\n");
	const facts = ensureI18n({ en: factsEn, zh: factsEn });
	const impactEn = category === "china"
		? "May affect onshore risk sentiment, RMB, and China/HK equities."
		: "May influence global risk assets, yields, FX, and commodities.";
	const impact = ensureI18n({ en: impactEn, zh: impactEn });
	const links = sanitizeLinks(entries.map((e) => e.link).filter(Boolean));
	return { title, source, time_utc: time, facts, impact_one_liner: impact, links, category, degraded: false };
}

function ensureI18n(obj, fallback = "") {
	if (!obj || typeof obj !== "object") return { zh: fallback, en: fallback };
	const out = {};
	if (typeof obj.zh === "string" && obj.zh.trim()) out.zh = obj.zh.trim();
	if (typeof obj.en === "string" && obj.en.trim()) out.en = obj.en.trim();
	if (!out.zh && out.en) out.zh = out.en;
	if (!out.en && out.zh) out.en = out.zh;
	if (typeof obj.es === "string" && obj.es.trim()) out.es = obj.es.trim();
	return out;
}

function sanitizeLinks(links) {
	if (!Array.isArray(links)) return [];
	return links
		.map((u) => (typeof u === "string" ? u.trim() : ""))
		.filter((u) => /^https?:\/\//i.test(u))
		.slice(0, 6);
}

function coerceItem(raw, category, date) {
	const title = (raw?.title ?? "").toString().trim();
	const source = (raw?.source ?? "").toString().trim();
	let time = (raw?.time_utc ?? raw?.time ?? "").toString().trim();
	if (!time) {
		// Provide stable defaults when time is missing
		time = `${date}T${category === "china" ? "02:00:00" : "12:00:00"}Z`;
	}
	const facts = ensureI18n(raw?.facts || {});
	const impact = ensureI18n(raw?.impact_one_liner || {});
	const links = sanitizeLinks(raw?.links || []);
	return {
		title,
		source,
		time_utc: time,
		facts,
		impact_one_liner: impact,
		links,
		category,
		degraded: Boolean(raw?.degraded)
	};
}

function buildPrompt(dateISO) {
	return `You are a bilingual financial markets editor. Produce today's market pulse focusing on one global finance headline and one China finance headline. Return strict JSON only.

Output JSON shape:
{
	"date": "${dateISO}",
	"items": [
		{
			"title": "",
			"source": "",
			"time_utc": "${dateISO}T12:00:00Z",
			"facts": { "zh": "", "en": "" },
			"impact_one_liner": { "zh": "", "en": "" },
			"links": ["https://..."],
			"category": "global"
		},
		{
			"title": "",
			"source": "",
			"time_utc": "${dateISO}T02:00:00Z",
			"facts": { "zh": "", "en": "" },
			"impact_one_liner": { "zh": "", "en": "" },
			"links": ["https://..."],
			"category": "china"
		}
	]
}

Rules:
- Keep language crisp, factual, and specific; no recommendations.
- facts should summarize what happened, with numbers/dates if available.
- impact_one_liner should explain likely market impact in one sentence.
- Prefer authoritative sources for links.
- Use Chinese for zh and English for en.
`;
}

async function callLLM(prompt) {
	const apiKey = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY;
	if (!apiKey) {
		throw new Error("Missing LLM_API_KEY or DEEPSEEK_API_KEY environment variable");
	}
	const baseURL = process.env.LLM_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
	const model = process.env.LLM_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat";

	const response = await fetch(`${baseURL}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`
		},
		body: JSON.stringify({
			model,
			temperature: 0.2,
			response_format: { type: "json_object" },
			messages: [
				{ role: "system", content: "You are a meticulous assistant that only replies with valid JSON." },
				{ role: "user", content: prompt }
			]
		})
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`LLM request failed: ${response.status} ${text}`);
	}
	const body = await response.json();
	const message = body.choices?.[0]?.message?.content;
	if (!message) throw new Error("LLM response missing content");
	return message.trim();
}

function parsePulse(rawText) {
	let text = rawText.trim();
	if (text.startsWith("```")) {
		const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
		if (match) text = match[1];
	}
	const obj = JSON.parse(text);
	return obj;
}

function cloneDegradedItems(prevItems, date) {
	const pick = (cat) => prevItems.find((i) => i.category === cat) || prevItems[0];
	const global = pick("global");
	const china = pick("china");
	const make = (it, cat, t) => ({
		title: it?.title || (cat === "global" ? "Global markets update" : "中国财经快讯"),
		source: it?.source || (cat === "global" ? "News" : "新闻"),
		time_utc: t,
		facts: ensureI18n(it?.facts || { zh: "临时沿用前一日概览。", en: "Temporarily carrying over the previous day's summary." }),
		impact_one_liner: ensureI18n(it?.impact_one_liner || { zh: "请结合当日市场信息审慎参考。", en: "Cross-check with today's conditions before acting." }),
		links: sanitizeLinks(it?.links || []),
		category: cat,
		degraded: true
	});
	return [
		make(global, "global", `${date}T12:00:00Z`),
		make(china, "china", `${date}T02:00:00Z`)
	];
}

async function generateForDate(dateISO, history) {
	if (dryRun) {
		// Minimal mock for dry runs
		return {
			date: dateISO,
			items: [
				coerceItem({
					title: "Global markets await key inflation prints",
					source: "Reuters",
					time_utc: `${dateISO}T12:00:00Z`,
					facts: { zh: "全球市场在通胀数据公布前观望，主要股指窄幅波动。", en: "Markets tread water ahead of inflation data; major indices trade in narrow ranges." },
					impact_one_liner: { zh: "短线波动或受数据意外影响。", en: "Short-term moves hinge on surprises in prints." },
					links: ["https://www.reuters.com"]
				}, "global", dateISO),
				coerceItem({
					title: "中国政策窗口期聚焦稳增长",
					source: "新华社",
					time_utc: `${dateISO}T02:00:00Z`,
					facts: { zh: "多部门强调扩大内需与科技投资，专项融资工具续作预期升温。", en: "Authorities stress demand support and tech investment; expectations rise for follow-on financing instruments." },
					impact_one_liner: { zh: "信用利差与成长板块情绪或受提振。", en: "Credit spreads and growth sentiment may improve." },
					links: ["https://www.xinhuanet.com"]
				}, "china", dateISO)
			]
		};
	}

	// Try RSS first. If one category fails, degrade from history; if both fail, fall back to LLM.
	try {
		const [globalEntries, chinaEntries] = await Promise.all([
			fetchAndFilterRSS(RSS_SOURCES.global, "global", dateISO),
			fetchAndFilterRSS(RSS_SOURCES.china, "china", dateISO)
		]);
		const fromGlobal = coerceItemFromRSSEntries(globalEntries, "global", dateISO);
		const fromChina = coerceItemFromRSSEntries(chinaEntries, "china", dateISO);

		if (fromGlobal || fromChina) {
			const items = [];
			items.push(fromGlobal || degradeOneFromHistory(history, dateISO, "global"));
			items.push(fromChina || degradeOneFromHistory(history, dateISO, "china"));
			return { date: dateISO, items };
		}
	} catch (e) {
		console.warn("RSS generation pipeline error; will try LLM fallback", e.message);
	}

	let lastError = null;
	for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
		try {
			const prompt = buildPrompt(dateISO);
			const raw = await callLLM(prompt);
			const parsed = parsePulse(raw);
			const items = Array.isArray(parsed?.items) ? parsed.items : [];
			const coerced = [
				coerceItem(items.find((i) => i?.category === "global") || {}, "global", dateISO),
				coerceItem(items.find((i) => i?.category === "china") || {}, "china", dateISO)
			];
			return { date: dateISO, items: coerced };
		} catch (error) {
			lastError = error;
			console.warn(`Attempt ${attempt + 1} failed: ${error.message}`);
			if (attempt < maxRetries) await sleep(backoff(attempt));
		}
	}

	console.error("Pulse LLM generation failed, degrading from previous day.", lastError?.message || lastError);
	const prevItems = history[0]?.items || [];
	return { date: dateISO, items: cloneDegradedItems(prevItems, dateISO) };
}

async function main() {
	const history = await readJSON(path.resolve(root, PULSE), []);
	const dateISO = today();

	const group = await generateForDate(dateISO, history);

	if (dryRun) {
		console.log(JSON.stringify(group, null, 2));
		return;
	}

	const updated = [group, ...history].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
	const trimmed = await rollWindowAndArchive(
		updated,
		30,
		path.resolve(root, PULSE_ARCH),
		(entry) => entry?.date?.slice(0, 7)
	);
	await writeJSON(path.resolve(root, PULSE), trimmed);

	const { valid, errors } = await validateWithSchema(
		path.resolve(root, PULSE),
		path.resolve(root, `${SCHEMAS}/pulse.schema.json`)
	);
	if (!valid) {
		console.error("Generated pulse failed schema validation", errors);
		process.exitCode = 1;
		return;
	}
	console.log(`Generated pulse for ${group.date}: global + china coverage ensured`);
}

main().catch((error) => {
	console.error("Pulse generation failed", error);
	process.exitCode = 1;
});
