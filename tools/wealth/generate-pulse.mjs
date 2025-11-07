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
	uniqueBy,
	writeJSON
} from "./util.mjs";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");
const maxRetries = dryRun ? 0 : 2;
const hasLLM = Boolean(process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY);
const translationCache = new Map();

const CJK_PATTERN = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const LETTER_PATTERN = /[A-Za-z]/;
const LINK_TIMEOUT_MS = 5000;

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

const normalizeText = (value) => (typeof value === "string" ? value.trim() : "");
const isLikelyChinese = (text) => !!text && CJK_PATTERN.test(text);
const isLikelyEnglish = (text) => !!text && LETTER_PATTERN.test(text) && !CJK_PATTERN.test(text);

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
	const primaryFacts = factLines.join("\n");
	const facts = {};
	if (primaryFacts) {
		if (isLikelyChinese(primaryFacts)) {
			facts.zh = primaryFacts;
		} else {
			facts.en = primaryFacts;
		}
	}
	const impactEn = category === "china"
		? "May affect onshore risk sentiment, RMB, and China/HK equities."
		: "May influence global risk assets, yields, FX, and commodities.";
	const impact = impactEn ? { en: impactEn } : {};
	const links = sanitizeLinks(entries.map((e) => e.link).filter(Boolean));
	return { title, source, time_utc: time, facts, impact_one_liner: impact, links, category, degraded: false };
}

async function translateText(text, target) {
	if (!text || !hasLLM || dryRun) return null;
	const cacheKey = `${target}::${text}`;
	if (translationCache.has(cacheKey)) {
		return translationCache.get(cacheKey);
	}
	try {
		const explicitTarget = target === "Chinese" ? "Simplified Chinese" : target;
		const prompt = `You are a bilingual financial copy editor. Translate the following finance text into ${explicitTarget}.\n- Keep numbers, tickers, and macro terms precise.\n- Preserve leading bullet symbols (e.g. "- ", "1.") and paragraph breaks.\n- Output valid JSON with the shape {"translation": "..."} and nothing else.\n\nTEXT:\n${text}`;
		const out = await callLLM(prompt);
		let result = null;
		try {
			const obj = JSON.parse(out);
			const candidateKeys = ["translation", "text", "output", "result", "value"];
			for (const key of candidateKeys) {
				const val = obj?.[key];
				if (typeof val === "string" && val.trim()) {
					result = val.trim();
					break;
				}
			}
			if (!result) {
				const fallbackValue = Object.values(obj).find((entry) => typeof entry === "string" && entry.trim());
				if (fallbackValue) {
					result = fallbackValue.trim();
				}
			}
		} catch (_) {
			if (typeof out === "string" && out.trim()) {
				result = out.trim();
			}
		}
		if (result) {
			translationCache.set(cacheKey, result);
			return result;
		}
	} catch (e) {
		console.warn(`Translate to ${target} failed:`, e.message);
	}
	translationCache.set(cacheKey, null);
	return null;
}

async function normalizeI18nField(field, fallback = "") {
	const bag = field && typeof field === "object" ? { ...field } : {};
	let zhText = normalizeText(bag.zh);
	let enText = normalizeText(bag.en);
	let esText = normalizeText(bag.es);
	const pivot = normalizeText(fallback) || enText || zhText;

	if ((!enText || isLikelyChinese(enText)) && zhText) {
		const translated = await translateText(zhText, "English");
		enText = normalizeText(translated) || enText;
	}
	if (!enText) {
		enText = zhText || pivot;
	}

	if ((!zhText || isLikelyEnglish(zhText)) && enText) {
		const translated = await translateText(enText, "Chinese");
		zhText = normalizeText(translated) || zhText;
	}
	if (!zhText) {
		zhText = enText || pivot;
	}

	if (!esText && enText) {
		const translated = await translateText(enText, "Spanish");
		esText = normalizeText(translated) || esText;
	}
	if (!esText) {
		esText = enText || zhText || pivot;
	}

	const finalEn = normalizeText(enText) || normalizeText(zhText) || normalizeText(esText) || normalizeText(pivot);
	const finalZh = normalizeText(zhText) || finalEn;
	const finalEs = normalizeText(esText) || finalEn || finalZh;
	const result = {};
	if (finalEn) result.en = finalEn;
	if (finalZh) result.zh = finalZh;
	if (finalEs) result.es = finalEs;
	return result;
}

async function ensureTranslations(item) {
	const titleSeed = typeof item.title === "string"
		? item.title
		: normalizeText(item?.title?.en || item?.title?.zh || Object.values(item.title || {}).find((entry) => typeof entry === "string" && entry.trim()) || "");
	item.title = await normalizeI18nField(item.title, titleSeed);
	item.facts = await normalizeI18nField(item.facts, "");
	item.impact_one_liner = await normalizeI18nField(item.impact_one_liner, "");
	return item;
}

async function enrichItem(item) {
	const normalized = await ensureTranslations(item);
	const validatedLinks = await filterValidLinks(normalized.links);
	normalized.links = validatedLinks;
	return normalized;
}

const enrichItems = async (items) => Promise.all(items.map((entry) => enrichItem(entry)));

function ensureI18nTextField(value, fallback = "") {
	const out = {};
	const assign = (lang, text) => {
		if (!lang || typeof text !== "string") return;
		const trimmed = text.trim();
		if (!trimmed) return;
		out[lang] = trimmed;
	};
	if (typeof value === "string") {
		assign("en", value);
	} else if (value && typeof value === "object") {
		for (const [lang, raw] of Object.entries(value)) {
			if (typeof raw === "string" && raw.trim()) assign(lang, raw);
		}
	}
	const fallbackText = normalizeText(fallback);
	if (!Object.keys(out).length && fallbackText) {
		assign("en", fallbackText);
	}
	return out;
}

function ensureI18n(obj, fallback = "") {
	const bag = ensureI18nTextField(obj, fallback);
	const zh = normalizeText(bag.zh || bag["zh-CN"] || bag["zh_cn"] || "");
	const en = normalizeText(bag.en || bag["en-US"] || bag["en_us"] || "");
	const es = normalizeText(bag.es || bag["es-ES"] || bag["es_es"] || "");
	const out = {};
	if (en) out.en = en;
	if (zh) {
		out.zh = zh;
	} else if (en) {
		out.zh = en;
	}
	if (es) {
		out.es = es;
	} else if (en) {
		out.es = en;
	} else if (zh) {
		out.es = zh;
	}
	return out;
}

function sanitizeLinks(links) {
	if (!Array.isArray(links)) return [];
	return links
		.map((u) => (typeof u === "string" ? u.trim() : ""))
		.filter((u) => /^https?:\/\//i.test(u))
		.slice(0, 6);
}

const isAcceptableStatus = (status) => {
	if (typeof status !== "number") return false;
	if (status >= 200 && status < 400) return true;
	return status === 401 || status === 403;
};

async function fetchWithTimeout(url, options = {}, timeoutMs = LINK_TIMEOUT_MS) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...options, signal: controller.signal, redirect: "follow" });
	} finally {
		clearTimeout(timer);
	}
}

async function checkLink(url) {
	try {
		let response = await fetchWithTimeout(url, { method: "HEAD" });
		if (response && isAcceptableStatus(response.status)) {
			return true;
		}
		if (response && response.status === 405) {
			response = await fetchWithTimeout(url, { method: "GET" });
			if (response && isAcceptableStatus(response.status)) {
				return true;
			}
		}
	} catch (error) {
		if (error.name !== "AbortError") {
			console.warn(`Link check failed for ${url}: ${error.message}`);
		}
	}
	return false;
}

async function filterValidLinks(links) {
	const sanitized = sanitizeLinks(links);
	if (!sanitized.length) return [];
	const verdicts = await Promise.all(sanitized.map((href) => checkLink(href)));
	const filtered = sanitized.filter((_, index) => verdicts[index]);
	if (filtered.length !== sanitized.length) {
		console.warn(`Filtered ${sanitized.length - filtered.length} unreachable link(s) from pulse item.`);
	}
	return filtered;
}

function coerceItem(raw, category, date) {
	const titleFallback = category === "china" ? "中国财经快讯" : "Global markets update";
	const title = ensureI18nTextField(raw?.title ?? raw?.headline ?? {}, titleFallback);
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
		title: ensureI18nTextField(
			it?.title,
			cat === "global" ? "Global markets update" : "中国财经快讯"
		),
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
		let fromGlobal = coerceItemFromRSSEntries(globalEntries, "global", dateISO);
		let fromChina = coerceItemFromRSSEntries(chinaEntries, "china", dateISO);

		if (fromGlobal || fromChina) {
			fromGlobal = fromGlobal || degradeOneFromHistory(history, dateISO, "global");
			fromChina = fromChina || degradeOneFromHistory(history, dateISO, "china");
			const items = await enrichItems([fromGlobal, fromChina]);
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
			const prepared = await enrichItems(coerced);
			return { date: dateISO, items: prepared };
		} catch (error) {
			lastError = error;
			console.warn(`Attempt ${attempt + 1} failed: ${error.message}`);
			if (attempt < maxRetries) await sleep(backoff(attempt));
		}
	}

	console.error("Pulse LLM generation failed, degrading from previous day.", lastError?.message || lastError);
	const prevItems = history[0]?.items || [];
	const degradedItems = cloneDegradedItems(prevItems, dateISO);
	const prepared = await enrichItems(degradedItems);
	return { date: dateISO, items: prepared };
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
	const deduped = uniqueBy(updated, (entry) => entry?.date || "");
	if (deduped.length !== updated.length) {
		console.warn(`Deduplicated ${updated.length - deduped.length} pulse group(s) with identical dates.`);
	}
	const trimmed = await rollWindowAndArchive(
		deduped,
		30,
		path.resolve(root, PULSE_ARCH),
		(entry) => entry?.date?.slice(0, 7)
	);
	const translatedTrimmed = await Promise.all(trimmed.map(async (entry) => {
		const clone = { ...entry };
		const items = Array.isArray(entry.items) ? entry.items : [];
		clone.items = await Promise.all(items.map(async (item) => ensureTranslations({ ...item })));
		return clone;
	}));
	await writeJSON(path.resolve(root, PULSE), translatedTrimmed);

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
