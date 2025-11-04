import path from "path";
import process from "process";

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
