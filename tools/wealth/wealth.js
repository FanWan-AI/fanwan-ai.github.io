const DAILY_URL = "/data/ai/wealth/finance-daily.json";
const PULSE_URL = "/data/ai/wealth/pulse.json";
const CACHE_TTL = 1000 * 60 * 60;
const PAGE_SIZE = 10;

function getLanguageOrder() {
	const order = [];
	const docLang = document.documentElement.lang || navigator.language;
	if (docLang) {
		const normalized = docLang.toLowerCase().split("-")[0];
		if (normalized) order.push(normalized);
	}
	order.push("zh", "en", "es");
	return Array.from(new Set(order));
}

const LANGUAGE_ORDER = getLanguageOrder();
const URL_PATTERN = /^https?:\/\//i;

const style = document.createElement("style");
style.textContent = `
.wealth-notice { margin-bottom: 12px; padding: 10px 14px; border-radius: 12px; border: 1px solid rgba(56,189,248,0.25); background: rgba(219,242,255,0.5); font-size: 0.85rem; color: #0f172a; }
.wealth-empty { padding: 36px 0; text-align: center; font-size: 0.95rem; color: #64748b; }
.wealth-daily-card { display: grid; gap: 16px; padding: 24px; border-radius: 18px; background: linear-gradient(160deg, rgba(236,253,245,0.95) 0%, rgba(219,242,255,0.9) 100%); border: 1px solid rgba(56,189,248,0.22); box-shadow: 0 18px 48px -30px rgba(15,118,110,0.24); }
.wealth-daily-meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 0.88rem; color: #0f766e; }
.wealth-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: rgba(56,189,248,0.16); border: 1px solid rgba(56,189,248,0.3); font-size: 0.78rem; font-weight: 600; color: #0f172a; }
.wealth-badge--fresh { background: rgba(56,189,248,0.18); border-color: rgba(56,189,248,0.32); color: #1d4ed8; }
.wealth-badge--degraded { background: rgba(248,113,113,0.1); border-color: rgba(248,113,113,0.26); color: #b91c1c; }
.wealth-badge--tag { background: rgba(16,185,129,0.14); border-color: rgba(16,185,129,0.28); color: #065f46; }
.wealth-daily-tags { display: flex; flex-wrap: wrap; gap: 8px; margin: -4px 0 4px; }
.wealth-daily-tags--compact { margin-top: 0; }
.wealth-meta-line { margin: 0; font-size: 0.85rem; color: #0f172a; display: flex; flex-wrap: wrap; gap: 12px; }
.wealth-meta-line span { display: inline-flex; align-items: center; gap: 6px; }
.wealth-points { margin: 0; padding-left: 20px; color: #0f172a; line-height: 1.6; }
.wealth-practice { border-top: 1px solid rgba(15,118,110,0.2); padding-top: 12px; display: grid; gap: 10px; }
.wealth-practice--history { border-top-color: rgba(148,163,184,0.3); }
.wealth-practice__title { margin: 0; font-size: 0.95rem; font-weight: 600; color: #0f172a; }
.wealth-practice__activity { margin: 0; font-weight: 600; color: #0f172a; }
.wealth-practice__list { margin: 0; padding-left: 20px; display: grid; gap: 10px; list-style: decimal; }
.wealth-practice__steps { margin: 6px 0 0; padding-left: 18px; display: grid; gap: 6px; list-style: disc; color: #1f2937; }
.wealth-practice__fallback { margin: 0; font-size: 0.92rem; line-height: 1.6; color: #334155; }
.wealth-risk { margin: 0; padding: 12px 16px; border-radius: 14px; border: 1px solid rgba(248,113,113,0.3); background: rgba(248,113,113,0.14); color: #991b1b; font-size: 0.9rem; line-height: 1.55; display: flex; gap: 8px; align-items: flex-start; }
.wealth-references { display: grid; gap: 10px; }
.wealth-references__label { margin: 0; font-size: 0.9rem; font-weight: 600; color: #0f172a; }
.wealth-links { display: flex; flex-wrap: wrap; gap: 10px; font-size: 0.9rem; }
.wealth-link__text { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; border: 1px solid rgba(56,189,248,0.24); background: rgba(219,242,255,0.55); color: #0369a1; text-decoration: none; }
.wealth-list { display: grid; gap: 18px; margin-top: 18px; }
.wealth-list-item { padding: 20px; border-radius: 16px; border: 1px solid rgba(56,189,248,0.18); background: rgba(239,246,255,0.8); box-shadow: 0 16px 38px -28px rgba(15,118,110,0.22); display: grid; gap: 12px; }
.wealth-load-more { padding: 10px 18px; border-radius: 999px; border: 1px solid rgba(56,189,248,0.3); background: rgba(219,242,255,0.7); color: #0369a1; font-weight: 600; cursor: pointer; }
.wealth-load-more:disabled { opacity: 0.6; cursor: not-allowed; }
.wealth-pulse-group { border-radius: 18px; border: 1px solid rgba(96,165,250,0.2); background: rgba(224,242,254,0.6); overflow: hidden; box-shadow: 0 18px 44px -30px rgba(37,99,235,0.22); }
.wealth-pulse-group details { border-bottom: 1px solid rgba(148,163,184,0.25); }
.wealth-pulse-group summary { cursor: pointer; padding: 18px 22px; font-weight: 600; font-size: 1rem; display: flex; justify-content: space-between; align-items: center; color: #0f172a; }
.wealth-pulse-item { padding: 0 22px 22px; display: grid; gap: 10px; }
.wealth-pulse-header { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: flex-start; }
.wealth-pulse-title { margin: 0; font-size: 1.05rem; font-weight: 600; color: #0f172a; }
.wealth-pulse-meta { display: flex; flex-wrap: wrap; gap: 8px; font-size: 0.78rem; color: #1d4ed8; }
.wealth-pulse-meta-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; border: 1px solid rgba(96,165,250,0.3); background: rgba(191,219,254,0.6); color: #1d4ed8; text-decoration: none; }
.wealth-pulse-time { display: inline-flex; align-items: center; gap: 4px; color: #1f2937; }
.wealth-pulse-facts { margin: 0; font-size: 0.95rem; line-height: 1.6; color: #1f2937; }
.wealth-pulse-impact { margin: 0; font-size: 0.95rem; line-height: 1.6; color: #0f172a; }
.wealth-legal-note { margin: 0; font-size: 0.82rem; color: #475569; }
@media (prefers-color-scheme: dark) {
	.wealth-daily-card { background: rgba(15,23,42,0.82); border-color: rgba(56,189,248,0.3); color: #e2e8f0; }
	.wealth-list-item { background: rgba(22,30,48,0.8); border-color: rgba(56,189,248,0.26); }
	.wealth-link__text { background: rgba(30,41,59,0.7); border-color: rgba(56,189,248,0.3); color: #bae6fd; }
	.wealth-load-more { background: rgba(30,41,59,0.8); color: #bae6fd; }
	.wealth-pulse-group { background: rgba(17,24,39,0.9); border-color: rgba(96,165,250,0.3); }
	.wealth-pulse-title { color: #e2e8f0; }
	.wealth-pulse-meta { color: #93c5fd; }
	.wealth-pulse-facts, .wealth-pulse-impact { color: #cbd5f5; }
	.wealth-notice { background: rgba(30,41,59,0.8); border-color: rgba(56,189,248,0.3); color: #e2e8f0; }
	.wealth-empty { color: #94a3b8; }
	.wealth-practice__fallback { color: #e2e8f0; }
}
`;
document.head.appendChild(style);

const dailyContainer = document.querySelector("#daily");
const pulseContainer = document.querySelector("#pulse");

function cacheKey(name) {
	return `wealth_${name}`;
}

function setCache(name, data) {
	try {
		localStorage.setItem(cacheKey(name), JSON.stringify({ timestamp: Date.now(), data }));
	} catch (error) {
		console.warn("Wealth cache write failed", error);
	}
}

function getCache(name) {
	try {
		const raw = localStorage.getItem(cacheKey(name));
		if (!raw) return null;
		const payload = JSON.parse(raw);
		if (!payload || typeof payload !== "object") return null;
		if (Date.now() - payload.timestamp > CACHE_TTL) {
			localStorage.removeItem(cacheKey(name));
			return null;
		}
		return payload.data;
	} catch (error) {
		console.warn("Wealth cache read failed", error);
		return null;
	}
}

function renderNotice(section, message) {
	const target = section === "daily" ? dailyContainer : pulseContainer;
	if (!target) return;
	let banner = target.querySelector(".wealth-notice");
	if (!banner) {
		banner = document.createElement("div");
		banner.className = "wealth-notice";
		target.prepend(banner);
	}
	banner.textContent = message;
}

async function fetchJSON(url, cacheName) {
	try {
		const response = await fetch(`${url}?ts=${Date.now()}`, { cache: "no-store" });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const data = await response.json();
		setCache(cacheName, data);
		return data;
	} catch (error) {
		console.warn(`Wealth fetch ${cacheName} failed`, error);
		const cached = getCache(cacheName);
		if (cached) {
			renderNotice(cacheName, "已加载缓存数据，稍后请刷新重试。");
			return cached;
		}
		throw error;
	}
}

function pickLang(value, order = LANGUAGE_ORDER) {
	if (!value) return "";
	if (typeof value === "string") return value.trim();
	if (Array.isArray(value)) {
		const item = value.find((entry) => typeof entry === "string" && entry.trim());
		return item ? item.trim() : "";
	}
	if (typeof value !== "object") return "";
	for (const lang of order) {
		const candidate = value[lang];
		if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
		if (Array.isArray(candidate)) {
			const item = candidate.find((entry) => typeof entry === "string" && entry.trim());
			if (item) return item.trim();
		}
	}
	for (const candidate of Object.values(value)) {
		if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
		if (Array.isArray(candidate)) {
			const item = candidate.find((entry) => typeof entry === "string" && entry.trim());
			if (item) return item.trim();
		}
	}
	return "";
}

function pickList(value, order = LANGUAGE_ORDER) {
	if (!value) return [];
	if (Array.isArray(value)) {
		return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
	}
	if (typeof value !== "object") return [];
	for (const lang of order) {
		const candidate = value[lang];
		if (Array.isArray(candidate) && candidate.length) {
			return candidate.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
		}
	}
	for (const candidate of Object.values(value)) {
		if (Array.isArray(candidate) && candidate.length) {
			return candidate.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
		}
	}
	return [];
}

function pickPracticeActivities(entry) {
	const practice = entry?.meta?.practice;
	if (!practice || typeof practice !== "object") return null;
	let activities = null;
	for (const lang of LANGUAGE_ORDER) {
		const candidate = practice[lang];
		if (Array.isArray(candidate) && candidate.length) {
			activities = candidate;
			break;
		}
	}
	if (!activities) {
		for (const candidate of Object.values(practice)) {
			if (Array.isArray(candidate) && candidate.length) {
				activities = candidate;
				break;
			}
		}
	}
	if (!activities) return null;
	const sanitized = activities
		.map((activity) => {
			if (!activity || typeof activity !== "object") return null;
			const title = pickLang(activity.title) || pickLang(activity.name);
			const stepsSource = activity.steps ?? activity.actions;
			const steps = Array.isArray(stepsSource)
				? stepsSource.map((step) => (typeof step === "string" ? step.trim() : "")).filter(Boolean)
				: pickList(stepsSource || {});
			if (!title && !steps.length) return null;
			return { title, steps };
		})
		.filter(Boolean);
	return sanitized.length ? sanitized : null;
}

function isHttpUrl(value) {
	return typeof value === "string" && URL_PATTERN.test(value);
}

function collectReferences(entry) {
	const collected = [];
	const metaSources = Array.isArray(entry?.meta?.sources) ? entry.meta.sources : [];
	metaSources.forEach((source, index) => {
		if (!source || typeof source !== "object") return;
		const label = pickLang(source.title) || pickLang(source.name) || source.url || `参考 ${index + 1}`;
		const url = isHttpUrl(source.url) ? source.url : "";
		const language = typeof source.language === "string" ? source.language.trim() : "";
		const note = pickLang(source.note);
		const parts = [label];
		if (language) parts.push(language);
		if (note) parts.push(note);
		collected.push({ label: parts.join(" · "), url });
	});

	if (!collected.length) {
		const fallback = Array.isArray(entry?.sources) ? entry.sources : [];
		fallback.forEach((item, index) => {
			if (!item) return;
			if (typeof item === "string") {
				const text = item.trim();
				if (!text) return;
				if (isHttpUrl(text)) {
					collected.push({ label: `参考 ${index + 1}`, url: text });
				} else {
					collected.push({ label: text, url: "" });
				}
				return;
			}
			if (typeof item === "object") {
				const label = pickLang(item.title) || pickLang(item.name) || item.url || `参考 ${index + 1}`;
				const url = isHttpUrl(item.url) ? item.url : "";
				collected.push({ label, url });
			}
		});
	}

	return collected.slice(0, 6);
}

function createBadge(text, className) {
	const span = document.createElement("span");
	span.className = className;
	span.textContent = text;
	return span;
}

function renderTags(meta, { compact = false } = {}) {
	const tags = Array.isArray(meta?.tags)
		? meta.tags.filter((tag) => typeof tag === "string" && tag.trim())
		: [];
	if (!tags.length) return null;
	const wrapper = document.createElement("div");
	wrapper.className = `wealth-daily-tags${compact ? " wealth-daily-tags--compact" : ""}`;
	tags.slice(0, 6).forEach((tag) => {
		wrapper.append(createBadge(tag.trim(), "wealth-badge wealth-badge--tag"));
	});
	return wrapper;
}

function renderMetaLine(entry, { compact = false } = {}) {
	const meta = entry?.meta || {};
	const parts = [];
	if (typeof meta.difficulty_label === "string" && meta.difficulty_label.trim()) {
		parts.push(`难度：${meta.difficulty_label.trim()}`);
	}
	if (!compact && typeof meta.learning_path === "string" && meta.learning_path.trim()) {
		parts.push(meta.learning_path.trim());
	}
	if (compact && typeof meta.practice_preview === "string" && meta.practice_preview.trim()) {
		parts.push(meta.practice_preview.trim());
	}
	if (compact && typeof meta.category === "string" && meta.category.trim()) {
		parts.push(meta.category.trim());
	}
	if (!parts.length) return null;
	const line = document.createElement("p");
	line.className = "wealth-meta-line";
	parts.forEach((text) => {
		const span = document.createElement("span");
		span.textContent = text;
		line.append(span);
	});
	return line;
}

function renderPractice(entry, { compact = false } = {}) {
	const activities = pickPracticeActivities(entry);
	const preview = typeof entry?.meta?.practice_preview === "string" ? entry.meta.practice_preview.trim() : "";
	const fallback = pickLang(entry.practice);
	if (!activities && !preview && !fallback) return null;

	const block = document.createElement("div");
	block.className = `wealth-practice${compact ? " wealth-practice--history" : ""}`;

	const title = document.createElement("p");
	title.className = "wealth-practice__title";
	title.textContent = compact ? "练习提要" : "今日练习";
	block.append(title);

	if (!compact && activities && activities.length) {
		const list = document.createElement("ol");
		list.className = "wealth-practice__list";
		activities.slice(0, 3).forEach((activity, index) => {
			const li = document.createElement("li");
			const heading = document.createElement("p");
			heading.className = "wealth-practice__activity";
			heading.textContent = activity.title || `练习 ${index + 1}`;
			li.append(heading);
			if (activity.steps.length) {
				const steps = document.createElement("ul");
				steps.className = "wealth-practice__steps";
				activity.steps.slice(0, 6).forEach((step) => {
					const item = document.createElement("li");
					item.textContent = step;
					steps.append(item);
				});
				li.append(steps);
			}
			list.append(li);
		});
		block.append(list);
		return block;
	}

	const summary =
		preview ||
		fallback ||
		(activities && activities.length
			? [activities[0].title, activities[0].steps[0]].filter(Boolean).join(" · ")
			: "");
	if (!summary) return null;
	const paragraph = document.createElement("p");
	paragraph.className = "wealth-practice__fallback";
	paragraph.textContent = summary;
	block.append(paragraph);
	return block;
}

function renderRisk(entry) {
	const text = pickLang(entry.risk_notes) || pickLang(entry?.meta?.risk_notes);
	if (!text) return null;
	const box = document.createElement("div");
	box.className = "wealth-risk";
	const label = document.createElement("strong");
	label.textContent = "风险提示";
	const body = document.createElement("span");
	body.textContent = text;
	box.append(label, body);
	return box;
}

function renderReferences(entry) {
	const references = collectReferences(entry);
	if (!references.length) return null;
	const block = document.createElement("div");
	block.className = "wealth-references";
	const label = document.createElement("p");
	label.className = "wealth-references__label";
	label.textContent = "参考资料";
	block.append(label);
	const list = document.createElement("div");
	list.className = "wealth-links";
	references.forEach((ref, index) => {
		if (ref.url) {
			const anchor = document.createElement("a");
			anchor.href = ref.url;
			anchor.target = "_blank";
			anchor.rel = "noopener";
			anchor.className = "wealth-link__text";
			anchor.textContent = ref.label || `参考 ${index + 1}`;
			list.append(anchor);
		} else {
			const span = document.createElement("span");
			span.className = "wealth-link__text";
			span.textContent = ref.label || `参考 ${index + 1}`;
			list.append(span);
		}
	});
	block.append(list);
	return block;
}

function formatTime(isoString) {
	if (!isoString) return "";
	try {
		const date = new Date(isoString);
		if (Number.isNaN(date.getTime())) {
			return typeof isoString === "string" ? isoString : "";
		}
		const formatted = new Intl.DateTimeFormat(undefined, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			timeZone: "UTC",
		}).format(date);
		return `${formatted} UTC`;
	} catch (error) {
		console.warn("Wealth time parse failed", error);
		return typeof isoString === "string" ? isoString : "";
	}
}

function createDailyCard(entry) {
	const card = document.createElement("article");
	card.className = "wealth-daily-card";
	card.setAttribute("tabindex", "0");

	const header = document.createElement("div");
	header.className = "wealth-daily-meta";

	const date = document.createElement("span");
	date.textContent = entry.date || pickLang(entry.display_date) || "今日纪要";
	header.append(date);

	header.append(createBadge("今日主题", "wealth-badge wealth-badge--fresh"));

	if (entry.degraded) {
		header.append(createBadge("降级：沿用上一条内容", "wealth-badge wealth-badge--degraded"));
	}

	card.append(header);

	const tags = renderTags(entry.meta || {});
	if (tags) card.append(tags);

	const metaLine = renderMetaLine(entry);
	if (metaLine) card.append(metaLine);

	const title = document.createElement("h3");
	title.textContent = pickLang(entry.topic) || pickLang(entry.title) || "今日主题";
	card.append(title);

	const summary = document.createElement("p");
	summary.textContent = pickLang(entry.summary) || "暂无摘要，稍后再试。";
	card.append(summary);

	const points = pickList(entry.key_points);
	if (points.length) {
		const list = document.createElement("ul");
		list.className = "wealth-points";
		points.slice(0, 5).forEach((point) => {
			const li = document.createElement("li");
			li.textContent = point;
			list.append(li);
		});
		card.append(list);
	}

	const practice = renderPractice(entry);
	if (practice) card.append(practice);

	const risk = renderRisk(entry);
	if (risk) card.append(risk);

	const references = renderReferences(entry);
	if (references) card.append(references);

	const legal = pickLang(entry?.meta?.legal_note);
	if (legal) {
		const note = document.createElement("p");
		note.className = "wealth-legal-note";
		note.textContent = legal;
		card.append(note);
	}

	return card;
}

function createHistoryItem(entry) {
	const article = document.createElement("article");
	article.className = "wealth-list-item";

	const title = document.createElement("h4");
	title.textContent = pickLang(entry.topic) || entry.date || "历史记录";
	article.append(title);

	const meta = document.createElement("div");
	meta.className = "wealth-daily-meta";

	const date = document.createElement("span");
	date.textContent = entry.date || "";
	meta.append(date);

	if (entry.degraded) {
		meta.append(createBadge("降级", "wealth-badge wealth-badge--degraded"));
	}

	article.append(meta);

	const tags = renderTags(entry.meta || {}, { compact: true });
	if (tags) article.append(tags);

	const metaLine = renderMetaLine(entry, { compact: true });
	if (metaLine) article.append(metaLine);

	const summary = document.createElement("p");
	summary.textContent = pickLang(entry.summary) || "暂无摘要。";
	article.append(summary);

	const points = pickList(entry.key_points);
	if (points.length) {
		const list = document.createElement("ul");
		list.className = "wealth-points";
		points.slice(0, 4).forEach((point) => {
			const li = document.createElement("li");
			li.textContent = point;
			list.append(li);
		});
		article.append(list);
	}

	const practice = renderPractice(entry, { compact: true });
	if (practice) article.append(practice);

	const risk = renderRisk(entry);
	if (risk) article.append(risk);

	const references = renderReferences(entry);
	if (references) article.append(references);

	return article;
}

function renderDaily(data) {
	if (!dailyContainer) return;
	const notice = dailyContainer.querySelector(".wealth-notice");
	dailyContainer.innerHTML = "";
	if (notice) dailyContainer.append(notice);

	if (!Array.isArray(data) || !data.length) {
		const empty = document.createElement("p");
		empty.className = "wealth-empty";
		empty.textContent = "暂未加载到课程内容，稍后再试。";
		dailyContainer.append(empty);
		return;
	}

	const [today, ...history] = data;
	dailyContainer.append(createDailyCard(today));

	if (!history.length) return;

	const listWrapper = document.createElement("div");
	listWrapper.className = "wealth-list";
	listWrapper.setAttribute("aria-live", "polite");

	const state = { page: 1 };

	const renderPage = () => {
		listWrapper.innerHTML = "";
		history.slice(0, state.page * PAGE_SIZE).forEach((entry) => {
			listWrapper.append(createHistoryItem(entry));
		});
	};

	renderPage();
	dailyContainer.append(listWrapper);

	if (history.length > PAGE_SIZE) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "wealth-load-more";
		button.textContent = "加载更多";
		button.addEventListener("click", () => {
			state.page += 1;
			renderPage();
			if (state.page * PAGE_SIZE >= history.length) {
				button.disabled = true;
				button.textContent = "没有更多了";
			}
		});
		dailyContainer.append(button);
	}
}

function renderPulse(data) {
	if (!pulseContainer) return;
	const notice = pulseContainer.querySelector(".wealth-notice");
	pulseContainer.innerHTML = "";
	if (notice) pulseContainer.append(notice);

	if (!Array.isArray(data) || !data.length) {
		const empty = document.createElement("p");
		empty.className = "wealth-empty";
		empty.textContent = "暂无市场快讯，稍后再试。";
		pulseContainer.append(empty);
		return;
	}

	const wrapper = document.createElement("div");
	wrapper.className = "wealth-pulse-group";

	let rendered = 0;

	data.slice(0, 14).forEach((group, groupIndex) => {
		if (!group) return;
		const details = document.createElement("details");
		if (groupIndex === 0) details.open = true;

		const summary = document.createElement("summary");
		summary.textContent = group.date || pickLang(group.title) || `分组 ${groupIndex + 1}`;
		details.append(summary);

		const items = Array.isArray(group.items) ? group.items : [];
		items.forEach((item) => {
			if (!item) return;
			const row = document.createElement("div");
			row.className = "wealth-pulse-item";

			const header = document.createElement("div");
			header.className = "wealth-pulse-header";

			const title = document.createElement("h5");
			title.className = "wealth-pulse-title";
			title.textContent = pickLang(item.title) || pickLang(item.headline) || "市场快讯";
			header.append(title);

			const meta = document.createElement("div");
			meta.className = "wealth-pulse-meta";

			const primaryLink = Array.isArray(item.links) ? item.links.find((href) => isHttpUrl(href)) : null;
			if (item.source || primaryLink) {
				const badge = document.createElement(primaryLink ? "a" : "span");
				badge.className = "wealth-pulse-meta-badge";
				badge.textContent = item.source || "资讯源";
				if (primaryLink) {
					badge.href = primaryLink;
					badge.target = "_blank";
					badge.rel = "noopener";
				}
				meta.append(badge);
			}

			const stamp = formatTime(item.time_utc || item.time);
			if (stamp) {
				const time = document.createElement("span");
				time.className = "wealth-pulse-time";
				time.textContent = stamp;
				meta.append(time);
			}

			if (meta.childNodes.length) {
				header.append(meta);
			}

			row.append(header);

			const facts = document.createElement("p");
			facts.className = "wealth-pulse-facts";
			facts.textContent = pickLang(item.facts) || pickLang(item.summary) || "暂无事实摘要。";
			row.append(facts);

			const impactText = pickLang(item.impact_one_liner) || pickLang(item.impact) || "";
			if (impactText) {
				const impact = document.createElement("p");
				impact.className = "wealth-pulse-impact";
				const label = document.createElement("strong");
				label.textContent = "可能影响：";
				const span = document.createElement("span");
				span.textContent = impactText;
				impact.append(label, span);
				row.append(impact);
			}

			const links = Array.isArray(item.links) ? item.links.filter((href) => isHttpUrl(href)) : [];
			if (links.length) {
				const linkWrap = document.createElement("div");
				linkWrap.className = "wealth-links";
				links.slice(0, 5).forEach((href, index) => {
					const anchor = document.createElement("a");
					anchor.href = href;
					anchor.target = "_blank";
					anchor.rel = "noopener";
					anchor.className = "wealth-link__text";
					anchor.textContent = `延伸阅读 ${index + 1}`;
					linkWrap.append(anchor);
				});
				row.append(linkWrap);
			}

			details.append(row);
			rendered += 1;
		});

		if (details.childNodes.length > 1) {
			wrapper.append(details);
		}
	});

	if (rendered === 0) {
		const empty = document.createElement("p");
		empty.className = "wealth-empty";
		empty.textContent = "暂无市场快讯，稍后再试。";
		pulseContainer.append(empty);
		return;
	}

	pulseContainer.append(wrapper);
}

async function init() {
	if (!dailyContainer && !pulseContainer) {
		return;
	}
	try {
		const [daily, pulse] = await Promise.all([
			fetchJSON(DAILY_URL, "daily"),
			fetchJSON(PULSE_URL, "pulse"),
		]);
		renderDaily(daily);
		renderPulse(pulse);
	} catch (error) {
		console.error("Wealth module failed", error);
		const fallbackDaily = getCache("daily");
		const fallbackPulse = getCache("pulse");
		if (fallbackDaily) {
			renderDaily(fallbackDaily);
		} else if (dailyContainer) {
			const message = document.createElement("p");
			message.className = "wealth-empty";
			message.textContent = "未能加载课程数据，请稍后刷新。";
			dailyContainer.append(message);
		}
		if (fallbackPulse) {
			renderPulse(fallbackPulse);
		} else if (pulseContainer) {
			const message = document.createElement("p");
			message.className = "wealth-empty";
			message.textContent = "未能加载市场快讯，请稍后刷新。";
			pulseContainer.append(message);
		}
	}
}

init();
