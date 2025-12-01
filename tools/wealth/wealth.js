const DAILY_URL = "/data/ai/wealth/finance-daily.json";
const PULSE_URL = "/data/ai/wealth/pulse.json";
const CACHE_TTL = 1000 * 60 * 60; // Cache time-to-live

function getLanguageOrder() {
	const root = document.documentElement;
	const base = (root && root.lang)
		? root.lang.toLowerCase().split("-")[0]
		: (navigator.language || "en").toLowerCase().split("-")[0];
	if (base === "zh") return ["zh", "en", "es"]; // zh primary; fallback en -> es
	if (base === "en") return ["en", "zh", "es"]; // en primary; fallback zh -> es
	if (base === "es") return ["es", "en", "zh"]; // es primary; fallback en -> zh
	return [base, "en", "zh", "es"]; // generic
}

const LANGUAGE_ORDER = getLanguageOrder(); // Language order based on document language
const URL_PATTERN = /^https?:\/\//i;
const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9ffc]/;

let __wealth_last_daily = null;
let __wealth_last_pulse = null;
const dailyContainer = document.getElementById("daily");
const pulseContainer = document.getElementById("pulse");
const dailyTrackEl = dailyContainer?.querySelector('[data-role="daily-track"]');
const dailyActiveLabel = dailyContainer?.querySelector('[data-role="daily-active-date"]');
const dailyPrevBtn = dailyContainer?.querySelector('[data-role="daily-track-prev"]');
const dailyNextBtn = dailyContainer?.querySelector('[data-role="daily-track-next"]');
const dailyStatusEl = dailyContainer?.querySelector('[data-role="status"]');
const dailyPageContainer = dailyContainer?.querySelector('.wealth-track-page');
const dailyPageLabels = {
	zh: dailyContainer?.querySelector('[data-role="daily-track-page-zh"]'),
	en: dailyContainer?.querySelector('[data-role="daily-track-page-en"]'),
	es: dailyContainer?.querySelector('[data-role="daily-track-page-es"]'),
};

const pulseTabsEl = pulseContainer?.querySelector('[data-role="pulse-tabs"]');
const pulseGridEl = pulseContainer?.querySelector('[data-role="pulse-grid"]');
const pulseStatusEl = pulseContainer?.querySelector('[data-role="status"]');
const pulseMoreBtn = pulseContainer?.querySelector('[data-role="pulse-more"]');

const lessonModal = document.getElementById("wealth-lesson-modal");
const lessonModalBody = lessonModal?.querySelector('[data-role="modal-body"]');
const lessonModalClosers = lessonModal ? Array.from(lessonModal.querySelectorAll('[data-role="modal-close"]')) : [];

const PULSE_PAGE_LIMIT = 6;

const TRACK_PAGE_SIZE = 15;
const dailyState = { items: [], activeIndex: 0, page: 0 };
const pulseState = { items: [], filter: "all", page: 1, categories: [] };
let visibleTimelineCards = [];

function formatTemplate(template, replacements) {
	if (typeof template !== "string") return "";
	if (!replacements || typeof replacements !== "object") return template;
	return template.replace(/\{(\w+)\}/g, (match, token) => {
		if (Object.prototype.hasOwnProperty.call(replacements, token)) {
			const value = replacements[token];
			return value === null || value === undefined ? "" : String(value);
		}
		return match;
	});
}

function t(key, fallback = "", replacements) {
	const tables = (typeof window !== "undefined" && window.translations) || null;
	if (tables && key) {
		const order = getLanguageOrder();
		const fallbackOrder = ["zh", "en", "es"];
		const searchOrder = Array.from(new Set([...(Array.isArray(order) ? order : []), ...fallbackOrder]));
		for (const lang of searchOrder) {
			const group = tables[lang];
			if (group && typeof group[key] === "string") {
				return formatTemplate(group[key], replacements);
			}
		}
	}
	const text = typeof fallback === "string" ? fallback : "";
	return formatTemplate(text, replacements);
}

const style = document.createElement("style");
style.textContent = `
:root {
	--wealth-card-bg: linear-gradient(160deg, rgba(244, 250, 248, 0.98) 0%, rgba(231, 245, 254, 0.95) 100%);
	--wealth-card-border: rgba(56, 189, 248, 0.22);
	--wealth-card-shadow: 0 18px 48px -30px rgba(15, 118, 110, 0.24);
	--wealth-card-text: #0f172a;
	--wealth-card-muted: #334155;
	--wealth-card-strong: #0f766e;
	--wealth-card-tag-bg: rgba(16, 185, 129, 0.14);
	--wealth-card-tag-border: rgba(16, 185, 129, 0.28);
	--wealth-card-tag-text: #065f46;
	--wealth-card-risk-bg: rgba(248, 113, 113, 0.14);
	--wealth-card-risk-border: rgba(248, 113, 113, 0.3);
	--wealth-card-risk-text: #991b1b;
	--wealth-card-link-bg: rgba(219, 242, 255, 0.55);
	--wealth-card-link-border: rgba(56, 189, 248, 0.24);
	--wealth-card-link-text: #0369a1;
	--wealth-card-load-bg: rgba(219, 242, 255, 0.7);
	--wealth-card-load-text: #0369a1;
	--wealth-card-pulse-bg: rgba(224, 242, 254, 0.6);
	--wealth-card-pulse-border: rgba(96, 165, 250, 0.2);
	--wealth-card-pulse-title: #0f172a;
	--wealth-card-pulse-meta: #1d4ed8;
	--wealth-card-practice-divider: rgba(15, 118, 110, 0.2);
	--wealth-card-practice-secondary: #1f2937;
	--wealth-card-fallback: #334155;
	--wealth-card-notice-bg: rgba(219, 242, 255, 0.5);
	--wealth-card-notice-border: rgba(56, 189, 248, 0.25);
	--wealth-card-notice-text: #0f172a;
	--wealth-card-empty: #64748b;
	--wealth-audio-status: #475569;
	--wealth-list-bg: rgba(239, 246, 255, 0.8);
	--wealth-list-border: rgba(56, 189, 248, 0.18);
	--wealth-list-shadow: 0 16px 38px -28px rgba(15, 118, 110, 0.22);
	--wealth-load-border: rgba(56, 189, 248, 0.3);
}

:root[data-theme="dark"],
:root[data-theme^="system-dark"] {
	--wealth-card-bg: linear-gradient(160deg, rgba(17, 24, 39, 0.92) 0%, rgba(20, 30, 48, 0.9) 100%);
	--wealth-card-border: rgba(56, 189, 248, 0.34);
	--wealth-card-shadow: 0 18px 48px -30px rgba(2, 6, 23, 0.72);
	--wealth-card-text: #e2e8f0;
	--wealth-card-muted: #cbd5f5;
	--wealth-card-strong: #5eead4;
	--wealth-card-tag-bg: rgba(45, 212, 191, 0.2);
	--wealth-card-tag-border: rgba(45, 212, 191, 0.38);
	--wealth-card-tag-text: #99f6e4;
	--wealth-card-risk-bg: rgba(248, 113, 113, 0.2);
	--wealth-card-risk-border: rgba(248, 113, 113, 0.45);
	--wealth-card-risk-text: #fee2e2;
	--wealth-card-link-bg: rgba(30, 41, 59, 0.7);
	--wealth-card-link-border: rgba(56, 189, 248, 0.35);
	--wealth-card-link-text: #bfdbfe;
	--wealth-card-load-bg: rgba(30, 41, 59, 0.78);
	--wealth-card-load-text: #bfdbfe;
	--wealth-card-pulse-bg: rgba(17, 24, 39, 0.88);
	--wealth-card-pulse-border: rgba(96, 165, 250, 0.32);
	--wealth-card-pulse-title: #e2e8f0;
	--wealth-card-pulse-meta: #93c5fd;
	--wealth-card-practice-divider: rgba(148, 163, 184, 0.35);
	--wealth-card-practice-secondary: #dbeafe;
	--wealth-card-fallback: #e2e8f0;
	--wealth-card-notice-bg: rgba(30, 41, 59, 0.8);
	--wealth-card-notice-border: rgba(56, 189, 248, 0.3);
	--wealth-card-notice-text: #e2e8f0;
	--wealth-card-empty: #94a3b8;
	--wealth-audio-status: #cbd5f5;
	--wealth-list-bg: rgba(22, 30, 48, 0.84);
	--wealth-list-border: rgba(56, 189, 248, 0.3);
	--wealth-list-shadow: 0 16px 38px -28px rgba(2, 6, 23, 0.7);
	--wealth-load-border: rgba(56, 189, 248, 0.38);
}

@media (prefers-color-scheme: dark) {
	:root:not([data-theme="light"]):not([data-theme^="system-light"]) {
		--wealth-card-bg: linear-gradient(160deg, rgba(17, 24, 39, 0.92) 0%, rgba(20, 30, 48, 0.9) 100%);
		--wealth-card-border: rgba(56, 189, 248, 0.34);
		--wealth-card-shadow: 0 18px 48px -30px rgba(2, 6, 23, 0.72);
		--wealth-card-text: #e2e8f0;
		--wealth-card-muted: #cbd5f5;
		--wealth-card-strong: #5eead4;
		--wealth-card-tag-bg: rgba(45, 212, 191, 0.2);
		--wealth-card-tag-border: rgba(45, 212, 191, 0.38);
		--wealth-card-tag-text: #99f6e4;
		--wealth-card-risk-bg: rgba(248, 113, 113, 0.2);
		--wealth-card-risk-border: rgba(248, 113, 113, 0.45);
		--wealth-card-risk-text: #fee2e2;
		--wealth-card-link-bg: rgba(30, 41, 59, 0.7);
		--wealth-card-link-border: rgba(56, 189, 248, 0.35);
		--wealth-card-link-text: #bfdbfe;
		--wealth-card-load-bg: rgba(30, 41, 59, 0.78);
		--wealth-card-load-text: #bfdbfe;
		--wealth-card-pulse-bg: rgba(17, 24, 39, 0.88);
		--wealth-card-pulse-border: rgba(96, 165, 250, 0.32);
		--wealth-card-pulse-title: #e2e8f0;
		--wealth-card-pulse-meta: #93c5fd;
		--wealth-card-practice-divider: rgba(148, 163, 184, 0.35);
		--wealth-card-practice-secondary: #dbeafe;
		--wealth-card-fallback: #e2e8f0;
		--wealth-card-notice-bg: rgba(30, 41, 59, 0.8);
		--wealth-card-notice-border: rgba(56, 189, 248, 0.3);
		--wealth-card-notice-text: #e2e8f0;
		--wealth-card-empty: #94a3b8;
		--wealth-audio-status: #cbd5f5;
		--wealth-list-bg: rgba(22, 30, 48, 0.84);
		--wealth-list-border: rgba(56, 189, 248, 0.3);
		--wealth-list-shadow: 0 16px 38px -28px rgba(2, 6, 23, 0.7);
		--wealth-load-border: rgba(56, 189, 248, 0.38);
	}
}

.wealth-notice { margin-bottom: 12px; padding: 10px 14px; border-radius: 12px; border: 1px solid var(--wealth-card-notice-border); background: var(--wealth-card-notice-bg); font-size: 0.85rem; color: var(--wealth-card-notice-text); }
.wealth-empty { padding: 36px 0; text-align: center; font-size: 0.95rem; color: var(--wealth-card-empty); }
.wealth-daily-card { display: grid; gap: 16px; padding: 24px; border-radius: 18px; background: var(--wealth-card-bg); border: 1px solid var(--wealth-card-border); box-shadow: var(--wealth-card-shadow); color: var(--wealth-card-text); }
.wealth-daily-meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 0.88rem; color: var(--wealth-card-strong); }
.wealth-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: rgba(56, 189, 248, 0.16); border: 1px solid rgba(56, 189, 248, 0.3); font-size: 0.78rem; font-weight: 600; color: var(--wealth-card-text); }
.wealth-badge--fresh { background: rgba(56, 189, 248, 0.18); border-color: rgba(56, 189, 248, 0.32); color: #1d4ed8; }
.wealth-badge--degraded { background: rgba(248, 113, 113, 0.1); border-color: rgba(248, 113, 113, 0.26); color: #b91c1c; }
.wealth-badge--tag { background: var(--wealth-card-tag-bg); border-color: var(--wealth-card-tag-border); color: var(--wealth-card-tag-text); }
.wealth-daily-tags { display: flex; flex-wrap: wrap; gap: 8px; margin: -4px 0 4px; }
.wealth-daily-tags--compact { margin-top: 0; }
.wealth-meta-line { margin: 0; font-size: 0.85rem; color: var(--wealth-card-muted); display: flex; flex-wrap: wrap; gap: 12px; }
.wealth-meta-line span { display: inline-flex; align-items: center; gap: 6px; }
.wealth-points { margin: 0; padding-left: 20px; color: var(--wealth-card-text); line-height: 1.6; }
.wealth-practice { border-top: 1px solid var(--wealth-card-practice-divider); padding-top: 12px; display: grid; gap: 10px; }
.wealth-practice--history { border-top-color: rgba(148, 163, 184, 0.3); }
.wealth-practice__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.wealth-practice__title { margin: 0; font-size: 0.95rem; font-weight: 600; color: var(--wealth-card-text); }
.wealth-practice__toggle { display: inline-flex; align-items: center; gap: 4px; padding: 4px 12px; border-radius: 999px; border: 1px solid var(--wealth-card-link-border); background: var(--wealth-card-link-bg); color: var(--wealth-card-link-text); font-size: 0.78rem; font-weight: 600; cursor: pointer; transition: background 0.2s ease, color 0.2s ease; }
.wealth-practice__toggle.is-open { background: rgba(56, 189, 248, 0.24); color: var(--wealth-card-text); }
.wealth-practice__toggle:focus-visible { outline: 2px solid rgba(56, 189, 248, 0.65); outline-offset: 2px; }
.wealth-practice__activity { margin: 0; font-weight: 600; color: var(--wealth-card-text); }
.wealth-practice__list { margin: 0; padding-left: 20px; display: grid; gap: 10px; list-style: decimal; color: var(--wealth-card-text); }
.wealth-practice__steps { margin: 6px 0 0; padding-left: 18px; display: grid; gap: 6px; list-style: disc; color: var(--wealth-card-practice-secondary); }
.wealth-practice__fallback { margin: 0; font-size: 0.92rem; line-height: 1.6; color: var(--wealth-card-fallback); white-space: pre-wrap; }
.wealth-practice__summary { margin: 0; font-size: 0.9rem; line-height: 1.55; color: var(--wealth-card-text); white-space: pre-wrap; }
.wealth-practice__details { margin: 12px 0 0; padding-top: 12px; border-top: 1px solid var(--wealth-card-practice-divider); display: grid; gap: 10px; }
.wealth-practice__details[hidden] { display: none; }
.wealth-risk { margin: 0; padding: 12px 16px; border-radius: 14px; border: 1px solid var(--wealth-card-risk-border); background: var(--wealth-card-risk-bg); color: var(--wealth-card-risk-text); font-size: 0.9rem; line-height: 1.55; display: flex; gap: 8px; align-items: flex-start; }
.wealth-references { display: grid; gap: 10px; }
.wealth-references[data-audio="true"] { gap: 6px; }
.wealth-references[data-audio="true"] audio { width: 100%; }
.wealth-references__label { margin: 0; font-size: 0.9rem; font-weight: 600; color: var(--wealth-card-text); }
.wealth-links { display: flex; flex-wrap: wrap; gap: 10px; font-size: 0.9rem; }
.wealth-link__text { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--wealth-card-link-border); background: var(--wealth-card-link-bg); color: var(--wealth-card-link-text); text-decoration: none; }
.wealth-list { display: grid; gap: 18px; margin-top: 18px; }
.wealth-list-item { padding: 20px; border-radius: 16px; border: 1px solid var(--wealth-list-border); background: var(--wealth-list-bg); box-shadow: var(--wealth-list-shadow); display: grid; gap: 12px; color: var(--wealth-card-text); }
.wealth-load-more { padding: 10px 18px; border-radius: 999px; border: 1px solid var(--wealth-load-border); background: var(--wealth-card-load-bg); color: var(--wealth-card-load-text); font-weight: 600; cursor: pointer; }
.wealth-load-more:disabled { opacity: 0.6; cursor: not-allowed; }
.wealth-audio-status { font-size: 0.9rem; color: var(--wealth-audio-status); }
.wealth-pulse-group { border-radius: 18px; border: 1px solid var(--wealth-card-pulse-border); background: var(--wealth-card-pulse-bg); overflow: hidden; box-shadow: 0 18px 44px -30px rgba(37, 99, 235, 0.22); }
.wealth-pulse-group details { border-bottom: 1px solid rgba(148, 163, 184, 0.25); }
.wealth-pulse-group summary { cursor: pointer; padding: 18px 22px; font-weight: 600; font-size: 1rem; display: flex; justify-content: space-between; align-items: center; color: var(--wealth-card-pulse-title); }
.wealth-pulse-item { padding: 0 22px 22px; display: grid; gap: 10px; color: var(--wealth-card-text); }
.wealth-pulse-header { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: flex-start; }
.wealth-pulse-title { margin: 0; font-size: 1.05rem; font-weight: 600; color: var(--wealth-card-pulse-title); }
.wealth-pulse-meta { display: flex; flex-wrap: wrap; gap: 8px; font-size: 0.78rem; color: var(--wealth-card-pulse-meta); }
.wealth-pulse-meta-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; border: 1px solid rgba(96, 165, 250, 0.3); background: rgba(191, 219, 254, 0.6); color: var(--wealth-card-pulse-meta); text-decoration: none; }
.wealth-pulse-meta-badge--degraded { border-color: rgba(248, 113, 113, 0.35); background: rgba(248, 113, 113, 0.15); color: #b91c1c; }
.wealth-pulse-time { display: inline-flex; align-items: center; gap: 4px; color: var(--wealth-card-muted); }
.wealth-pulse-facts { margin: 0; font-size: 0.95rem; line-height: 1.6; color: var(--wealth-card-text); }
.wealth-pulse-impact { margin: 0; font-size: 0.95rem; line-height: 1.6; color: var(--wealth-card-text); }
.wealth-legal-note { margin: 0; font-size: 0.82rem; color: var(--wealth-card-muted); }
	`;
	document.head.appendChild(style);

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

function getStatusHost(section) {
	if (section === "daily") return dailyStatusEl || dailyContainer;
	if (section === "pulse") return pulseStatusEl || pulseContainer;
	return null;
}

function renderNotice(section, message) {
	const host = getStatusHost(section);
	if (!host) return;
	let banner = host.querySelector(".wealth-notice");
	if (!banner) {
		banner = document.createElement("div");
		banner.className = "wealth-notice";
		host.append(banner);
	}
	banner.hidden = !message;
	if (message) {
		banner.textContent = message;
	}
}

function clearStatus(section) {
	const host = getStatusHost(section);
	if (!host) return;
	const banner = host.querySelector(".wealth-notice");
	if (banner) banner.remove();
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
			renderNotice(cacheName, t("wealth_cache_notice", "已加载缓存数据，稍后请刷新重试。"));
			return cached;
		}
		throw error;
	}
}

function pickLang(value, order = getLanguageOrder()) {
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

function pickList(value, order = getLanguageOrder()) {
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
	for (const lang of getLanguageOrder()) {
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

function resolvePracticeText(value, lang) {
	if (!value) return "";
	if (typeof value === "string") return value.trim();
	if (typeof value === "object") {
		if (lang) {
			const direct = value[lang];
			if (typeof direct === "string" && direct.trim()) return direct.trim();
		}
		return pickLang(value);
	}
	return "";
}

function createActivitiesList(activities, { limitItems = 3, limitSteps = 6 } = {}) {
	const list = document.createElement("ol");
	list.className = "wealth-practice__list";
	activities.slice(0, limitItems).forEach((activity, index) => {
		const li = document.createElement("li");
		const heading = document.createElement("p");
		heading.className = "wealth-practice__activity";
		heading.textContent = activity.title
			|| t("wealth_practice_item_label", "练习 {index}", { index: index + 1 });
		li.append(heading);
		if (Array.isArray(activity.steps) && activity.steps.length) {
			const steps = document.createElement("ul");
			steps.className = "wealth-practice__steps";
			activity.steps.slice(0, limitSteps).forEach((step) => {
				const item = document.createElement("li");
				item.textContent = step;
				steps.append(item);
			});
			li.append(steps);
		}
		list.append(li);
	});
	return list;
}

function collectReferences(entry) {
	const collected = [];
	const metaSources = Array.isArray(entry?.meta?.sources) ? entry.meta.sources : [];
	metaSources.forEach((source, index) => {
		if (!source || typeof source !== "object") return;
		const label =
			pickLang(source.title) ||
			pickLang(source.name) ||
			source.url ||
			t("wealth_reference_default", "参考 {index}", { index: index + 1 });
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
					collected.push({
						label: t("wealth_reference_default", "参考 {index}", { index: index + 1 }),
						url: text,
					});
				} else {
					collected.push({ label: text, url: "" });
				}
				return;
			}
			if (typeof item === "object") {
				const label =
					pickLang(item.title) ||
					pickLang(item.name) ||
					item.url ||
					t("wealth_reference_default", "参考 {index}", { index: index + 1 });
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
	const languageOrder = getLanguageOrder();
	const docLang = (languageOrder && languageOrder.length ? languageOrder[0] : "zh") || "zh";
	if (typeof meta.difficulty_label === "string" && meta.difficulty_label.trim()) {
		parts.push(t("wealth_meta_difficulty", "难度：{value}", { value: meta.difficulty_label.trim() }));
	}
	if (!compact && typeof meta.learning_path === "string" && meta.learning_path.trim()) {
		parts.push(meta.learning_path.trim());
	}
	if (compact) {
		const preview = resolvePracticeText(meta.practice_preview, docLang);
		if (preview && (docLang === "zh" || !CJK_PATTERN.test(preview))) {
			parts.push(preview);
		}
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

function parseMarkdown(text) {
	if (!text) return "";
	let safeText = String(text)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
	safeText = safeText.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
	safeText = safeText.replace(/\n/g, "<br>");
	return safeText;
}

function appendMultiline(target, text) {
	if (!target) return;
	const str = typeof text === "string" ? text : text == null ? "" : String(text);
	if (!str) return;
	target.innerHTML = parseMarkdown(str);
}

// Trim helper to remove leading bullets or numbering from summary snippets.
function normalizeSummary(text) {
	if (!text) return "";
	const value = String(text).trim();
	const cleaned = value.replace(/^[\s\u2022\-–—]*(?:\d+[\.、)\-\s]+|[①②③④⑤⑥⑦⑧⑨⑩][\.、\s]+)?/, "");
	return cleaned.trim();
}

function renderPractice(entry, { compact = false } = {}) {
	const activities = pickPracticeActivities(entry);
	const hasActivities = Array.isArray(activities) && activities.length > 0;
	const languageOrder = getLanguageOrder();
	const docLang = (languageOrder && languageOrder.length ? languageOrder[0] : "zh") || "zh";
	const previewRaw = resolvePracticeText(entry?.meta?.practice_preview, docLang);
	const preview = previewRaw && (docLang === "zh" || !CJK_PATTERN.test(previewRaw)) ? previewRaw : "";
	const fallback = resolvePracticeText(entry?.practice, docLang);
	if (!hasActivities && !preview && !fallback) return null;

	const block = document.createElement("div");
	block.className = `wealth-practice${compact ? " wealth-practice--history" : ""}`;

	const header = document.createElement("div");
	header.className = "wealth-practice__header";
	const title = document.createElement("p");
	title.className = "wealth-practice__title";
	title.textContent = compact
		? t("wealth_practice_compact_title", "练习提要")
		: t("wealth_practice_title", "今日练习");
	header.append(title);
	block.append(header);

	if (!compact) {
		if (hasActivities) {
			block.append(createActivitiesList(activities));
			return block;
		}
		const text = preview || fallback;
		if (text) {
			const paragraph = document.createElement("p");
			paragraph.className = "wealth-practice__fallback";
			appendMultiline(paragraph, text);
			block.append(paragraph);
		}
		return block;
	}

	let summary = "";
	// When activities exist, avoid using long or list-styled previews as the collapsed summary.
	const previewLooksLikeList = /(^|\n)\s*(?:\d+|[①②③④⑤⑥⑦⑧⑨⑩])[\.。、]/.test(preview) || preview.split(/\n+/).length > 1;
	const previewIsTooLong = preview.length > 160;
	if (preview && !(hasActivities && (previewLooksLikeList || previewIsTooLong))) {
		summary = preview;
	}
	if (!summary && hasActivities) {
		const seed = activities[0];
		summary = seed?.title || (Array.isArray(seed?.steps) ? seed.steps[0] : "") || "";
	}
	if (!summary && fallback && (docLang === "zh" || !CJK_PATTERN.test(fallback))) {
		const firstLine = fallback.split(/\n+/)[0] || fallback;
		summary = firstLine;
	}

	const detailContainer = document.createElement("div");
	detailContainer.className = "wealth-practice__details";
	detailContainer.hidden = true;
	let detailHasContent = false;

	if (hasActivities) {
		detailContainer.append(createActivitiesList(activities));
		detailHasContent = true;
	}

	let detailText = "";
	if (!hasActivities && fallback && (!summary || fallback !== summary)) {
		detailText = fallback;
	} else if (!hasActivities && preview && preview !== summary) {
		detailText = preview;
	}

	if (detailText) {
		const paragraph = document.createElement("p");
		paragraph.className = "wealth-practice__fallback";
		appendMultiline(paragraph, detailText);
		detailContainer.append(paragraph);
		detailHasContent = true;
	}

	const summaryText = normalizeSummary(summary);
	if (summaryText) {
		const summaryParagraph = document.createElement("p");
		summaryParagraph.className = "wealth-practice__summary";
		appendMultiline(summaryParagraph, summaryText);
		block.append(summaryParagraph);
	}

	if (detailHasContent) {
		const expandLabel = t("wealth_practice_expand", "展开");
		const collapseLabel = t("wealth_practice_collapse", "收起");
		const toggle = document.createElement("button");
		toggle.type = "button";
		toggle.className = "wealth-practice__toggle";
		const detailsId = `wealth-practice-details-${Math.random().toString(36).slice(2, 10)}`;
		detailContainer.id = detailsId;
		toggle.setAttribute("aria-controls", detailsId);
		const setExpanded = (expanded) => {
			if (expanded) {
				detailContainer.hidden = false;
				detailContainer.removeAttribute("hidden");
			} else {
				detailContainer.hidden = true;
				detailContainer.setAttribute("hidden", "");
			}
			toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
			toggle.textContent = expanded ? collapseLabel : expandLabel;
			toggle.classList.toggle("is-open", expanded);
		};
		setExpanded(false);
		toggle.addEventListener("click", () => {
			setExpanded(detailContainer.hidden);
		});
		header.append(toggle);
		block.append(detailContainer);
	} else if (!summary && fallback) {
		const paragraph = document.createElement("p");
		paragraph.className = "wealth-practice__fallback";
		appendMultiline(paragraph, fallback);
		block.append(paragraph);
	}

	return block;
}

function renderRisk(entry) {
	const text = pickLang(entry.risk_notes) || pickLang(entry?.meta?.risk_notes);
	if (!text) return null;
	const box = document.createElement("div");
	box.className = "wealth-risk";
	const label = document.createElement("strong");
	label.textContent = t("wealth_risk_label", "风险提示");
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
	label.textContent = t("wealth_references_label", "参考资料");
	block.append(label);
	const list = document.createElement("div");
	list.className = "wealth-links";
		references.forEach((ref, index) => {
			const fallbackLabel = t("wealth_reference_default", "参考 {index}", { index: index + 1 });
			if (ref.url) {
			const anchor = document.createElement("a");
			anchor.href = ref.url;
			anchor.target = "_blank";
			anchor.rel = "noopener";
			anchor.className = "wealth-link__text";
				anchor.textContent = ref.label || fallbackLabel;
			list.append(anchor);
		} else {
			const span = document.createElement("span");
			span.className = "wealth-link__text";
				span.textContent = ref.label || fallbackLabel;
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
// --- Audio player (server-generated TTS) ---
async function fetchDailyAudioManifest(dateStr) {
	try {
		const url = `/data/ai/wealth/${dateStr}/manifest.json?ts=${Date.now()}`;
		const resp = await fetch(url, { cache: "no-store" });
		if (!resp.ok) return null;
		return await resp.json();
	} catch (e) {
		return null;
	}
}

async function fetchSegmentsIndex(dateStr, lang) {
	try {
		const url = `/data/ai/wealth/${dateStr}/segments.${lang}/_index.json?ts=${Date.now()}`;
		const resp = await fetch(url, { cache: "no-store" });
		if (!resp.ok) return null;
		const data = await resp.json();
		if (data && Array.isArray(data.segments) && data.segments.length) return data.segments;
		return null;
	} catch (e) {
		return null;
	}
}

function createAudioPlayer(src, label) {
	if (!src) return null;
	const wrap = document.createElement("div");
	wrap.className = "wealth-references";
	wrap.dataset.audio = "true";
	const p = document.createElement("p");
	p.className = "wealth-references__label";
	const resolvedLabel = label || t("wealth_audio_label_default", "播放");
	p.textContent = resolvedLabel;
	const audio = document.createElement("audio");
	audio.controls = true;
	audio.preload = "none";
	audio.src = src;
	wrap.append(p);
	wrap.append(audio);
	return wrap;
}

function createSequentialAudioPlayer(segments, label) {
	if (!Array.isArray(segments) || !segments.length) return null;
	const wrap = document.createElement("div");
	wrap.className = "wealth-references";
	wrap.dataset.audio = "true";
	const p = document.createElement("p");
	p.className = "wealth-references__label";
	const resolvedLabel = label || t("wealth_audio_label_default", "播放");
	p.textContent = resolvedLabel;

	const audio = document.createElement("audio");
	audio.controls = true;
	audio.preload = "none";
	const status = document.createElement("span");
	status.className = "wealth-audio-status";

	let idx = 0;

	function updateStatus(position) {
		status.textContent = `${position + 1} / ${segments.length}`;
	}

	function setSrc(newIndex, autoplay = false) {
		idx = newIndex;
		if (idx < 0) idx = 0;
		if (idx >= segments.length) idx = 0;
		audio.src = segments[idx];
		try {
			audio.load();
		} catch (error) {
			// no-op
		}
		updateStatus(idx);
		if (autoplay) {
			const playPromise = audio.play();
			if (playPromise && typeof playPromise.then === "function") {
				playPromise.catch(() => {});
			}
		}
	}

	audio.addEventListener("play", () => {
		if (!audio.src) {
			setSrc(idx, false);
		}
	});

	audio.addEventListener("ended", () => {
		if (idx + 1 < segments.length) {
			setSrc(idx + 1, true);
		} else {
			setSrc(0, false);
		}
	});

	wrap.append(p);
	wrap.append(audio);
	wrap.append(status);
	setSrc(0, false);
	return wrap;
}

function mountAudio(card, slot, player) {
	if (!player) return;
	const canReplace = slot && typeof slot.replaceWith === "function";
	if (canReplace) {
		try {
			slot.replaceWith(player);
			return;
		} catch (error) {
			// fall back below
		}
	}
	if (slot && slot.parentNode) {
		slot.parentNode.replaceChild(player, slot);
		return;
	}
	if (card) {
		card.append(player);
	}
}

function attachAudioToCard(card, entry, dateStr, slot) {
	if (!card || !dateStr) {
		if (slot && slot.isConnected) slot.remove();
		return;
	}
	if (card.querySelector('[data-audio="true"]')) {
		if (slot && slot.isConnected) slot.remove();
		return;
	}
	if (card.dataset.audioLoading === dateStr) {
		if (slot && slot.isConnected) slot.remove();
		return;
	}
	const languageOrder = getLanguageOrder();
	const primaryDocLang = (languageOrder && languageOrder.length ? languageOrder[0] : "zh") || "zh";
	const normalizedDocLang = primaryDocLang.toLowerCase();
	const docLangBase = normalizedDocLang.split(/[-_]/)[0] || normalizedDocLang;
	const docLangAlias = normalizedDocLang.replace(/-/g, "_");
	const langCandidates = [];
	const pushCandidate = (value) => {
		if (!value) return;
		const key = value.toLowerCase();
		if (!langCandidates.includes(key)) {
			langCandidates.push(key);
		}
	};
	pushCandidate(normalizedDocLang);
	if (docLangAlias !== normalizedDocLang) pushCandidate(docLangAlias);
	if (docLangBase !== normalizedDocLang) pushCandidate(docLangBase);

	card.dataset.audioLoading = dateStr;
	fetchDailyAudioManifest(dateStr).then(async (manifest) => {
		if (!manifest) return;
		const allowedTopics = Array.isArray(manifest.topic_ids) && manifest.topic_ids.length
			? manifest.topic_ids
			: (typeof manifest.primary_topic_id === "string" ? [manifest.primary_topic_id] : null);
		if (allowedTopics && entry?.topic_id && !allowedTopics.includes(entry.topic_id)) {
			return;
		}
		const labelMap = { zh: "朗读音频", en: "Audio narration", es: "Narración" };
		for (const langKey of langCandidates) {
			const src = manifest[langKey];
			if (!src) continue;
			const labelKey = langKey.slice(0, 2) || langKey;
			let player = null;
			if (typeof src === "string") {
				const segList = await fetchSegmentsIndex(dateStr, labelKey);
				if (segList && segList.length) {
					player = createSequentialAudioPlayer(segList, labelMap[labelKey] || labelMap.en);
				} else {
					player = createAudioPlayer(src, labelMap[labelKey] || labelMap.en);
				}
			} else if (src && typeof src === "object") {
				if (Array.isArray(src.segments) && src.segments.length) {
					player = createSequentialAudioPlayer(src.segments, labelMap[labelKey] || labelMap.en);
				} else if (typeof src.file === "string") {
					player = createAudioPlayer(src.file, labelMap[labelKey] || labelMap.en);
				}
			}
			if (player) {
				mountAudio(card, slot, player);
				return;
			}
		}
	}).catch(() => {
		// ignore fetch errors; UI remains without audio
	}).finally(() => {
		if (card.dataset.audioLoading === dateStr) {
			delete card.dataset.audioLoading;
		}
		if (slot && slot.isConnected) {
			slot.remove();
		}
	});
}

function createDailyCard(entry) {
	const card = document.createElement("article");
	card.className = "wealth-daily-card";
	card.setAttribute("tabindex", "0");

	const header = document.createElement("div");
	header.className = "wealth-daily-meta";

	const date = document.createElement("span");
	date.textContent = entry.date || pickLang(entry.display_date) || t("wealth_today_digest", "今日纪要");
	header.append(date);

	header.append(createBadge(t("wealth_badge_today", "今日主题"), "wealth-badge wealth-badge--fresh"));

	if (entry.degraded) {
		header.append(createBadge(t("wealth_badge_degraded_detail", "降级：沿用上一条内容"), "wealth-badge wealth-badge--degraded"));
	}

	card.append(header);

	const tags = renderTags(entry.meta || {});
	if (tags) card.append(tags);

	const metaLine = renderMetaLine(entry);
	if (metaLine) card.append(metaLine);

	const title = document.createElement("h3");
	title.textContent =
		pickLang(entry.topic) ||
		pickLang(entry.title) ||
		t("wealth_topic_fallback", "今日主题");
	card.append(title);

	const dateStr = entry.date || "";
	let audioSlot = null;
	if (dateStr) {
		audioSlot = document.createElement("div");
		audioSlot.dataset.audioSlot = "true";
		card.append(audioSlot);
	}

	const summary = document.createElement("p");
	const fullSummary = pickLang(entry.summary) || t("wealth_summary_placeholder", "暂无摘要，稍后再试。");
	const firstParagraph = fullSummary.split(/\n+/)[0];
	summary.innerHTML = parseMarkdown(firstParagraph);
	card.append(summary);

	if (audioSlot) {
		attachAudioToCard(card, entry, dateStr, audioSlot);
	}

	const points = pickList(entry.key_points);
	if (points.length) {
		const list = document.createElement("ul");
		list.className = "wealth-points";
		points.slice(0, 5).forEach((point) => {
			const li = document.createElement("li");
			li.innerHTML = parseMarkdown(point);
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

function collectTimelineTags(entry) {
	const tags = [];
	const meta = entry?.meta || {};
	const difficultyLabel = typeof meta.difficulty_label === "string" ? meta.difficulty_label.trim() : "";
	const difficultyValue = meta.difficulty ?? meta.level;
	const theme = meta.theme || meta.category || meta.track;
	if (difficultyLabel) {
		tags.push(difficultyLabel);
	} else if (typeof difficultyValue === "string" && /\D/.test(difficultyValue)) {
		tags.push(difficultyValue.trim());
	}
	if (theme) tags.push(theme);
	if (entry.degraded) tags.push(t("wealth_badge_degraded", "沿用"));
	return tags.slice(0, 2);
}

function createTimelineCard(entry, index) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "wealth-track-card";
	button.dataset.index = index;
	button.setAttribute("aria-pressed", "false");

	const metaRow = document.createElement("div");
	metaRow.className = "wealth-track-meta";
	const dateLabel = document.createElement("span");
	dateLabel.textContent = entry.date || pickLang(entry.display_date) || t("wealth_today_digest", "今日纪要");
	metaRow.append(dateLabel);
	const badgeLabel = document.createElement("span");
	badgeLabel.textContent = entry.meta?.difficulty || entry.meta?.level || t("wealth_track_level", "常规");
	metaRow.append(badgeLabel);
	button.append(metaRow);

	const title = document.createElement("p");
	title.className = "wealth-track-title";
	title.textContent = pickLang(entry.topic) || pickLang(entry.title) || t("wealth_topic_fallback", "今日主题");
	button.append(title);

	const summary = document.createElement("p");
	summary.className = "wealth-track-summary";
	const preview = pickLang(entry.summary) || t("wealth_summary_placeholder", "暂无摘要，稍后再试。");
	const summaryText = normalizeSummary(preview);
	summary.innerHTML = parseMarkdown(summaryText);
	button.append(summary);

	const tagsRow = document.createElement("div");
	tagsRow.className = "wealth-track-tags";
	collectTimelineTags(entry).forEach((label) => {
		const chip = document.createElement("span");
		chip.className = "wealth-track-tag";
		chip.textContent = label;
		tagsRow.append(chip);
	});
	if (tagsRow.childElementCount) {
		button.append(tagsRow);
	}

	const hint = document.createElement("div");
	hint.className = "wealth-track-hint";
	const hintLabel = document.createElement("span");
	hintLabel.textContent = t("wealth_timeline_hint", "点击查看详情");
	hint.append(hintLabel);
	const hintIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	hintIcon.setAttribute("viewBox", "0 0 24 24");
	hintIcon.setAttribute("aria-hidden", "true");
	const hintPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
	hintPath.setAttribute("d", "M7 12h10m0 0-4-4m4 4-4 4");
	hintPath.setAttribute("fill", "none");
	hintPath.setAttribute("stroke", "currentColor");
	hintPath.setAttribute("stroke-width", "1.8");
	hintPath.setAttribute("stroke-linecap", "round");
	hintPath.setAttribute("stroke-linejoin", "round");
	hintIcon.append(hintPath);
	hint.append(hintIcon);
	button.append(hint);

	button.addEventListener("click", () => setActiveLesson(index, { openModal: true }));
	return button;
}


function openLessonModal(entry) {
	if (!lessonModal || !lessonModalBody) return;
	lessonModalBody.innerHTML = "";
	lessonModalBody.append(createDailyCard(entry));
	lessonModal.dataset.open = "true";
	lessonModal.removeAttribute("aria-hidden");
	document.body.classList.add("wealth-modal-open");
}

function closeLessonModal() {
	if (!lessonModal || !lessonModalBody) return;
	lessonModal.dataset.open = "false";
	lessonModal.setAttribute("aria-hidden", "true");
	lessonModalBody.innerHTML = "";
	document.body.classList.remove("wealth-modal-open");
}

function renderDaily(data) {
	__wealth_last_daily = data;
	if (!dailyContainer) return;
	clearStatus("daily");
	renderTimeline(Array.isArray(data) ? data : []);
}

function flattenPulseGroups(groups) {
	const rows = [];
	(groups || []).forEach((group) => {
		if (!group) return;
		const stamp = group.date || pickLang(group.title) || "";
		const items = Array.isArray(group.items) ? group.items : [];
		items.forEach((item) => {
			if (!item) return;
			rows.push({
				...item,
				__bucket: stamp,
				__bucketLabel: pickLang(group.title) || group.title || stamp,
			});
		});
	});
	return rows;
}

function describePulseCategory(key) {
	const normalized = (key || "").toLowerCase();
	switch (normalized) {
		case "global":
			return t("wealth_pulse_category_global", "全球");
		case "china":
			return t("wealth_pulse_category_china", "中国");
		case "macro":
			return t("wealth_pulse_category_macro", "宏观");
		case "ai":
			return t("wealth_pulse_category_ai", "AI 与金融");
	}
	return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : t("wealth_pulse_category_general", "综合");
}

function buildPulseCategories(items) {
	const counts = new Map();
	items.forEach((item) => {
		const key = (item.category || "general").toLowerCase() || "general";
		counts.set(key, (counts.get(key) || 0) + 1);
	});
	const categories = [{ value: "all", label: t("wealth_pulse_filter_all", "全部"), count: items.length }];
	for (const [value, count] of counts.entries()) {
		categories.push({ value, label: describePulseCategory(value), count });
	}
	return categories;
}

function renderPulseTabs() {
	if (!pulseTabsEl) return;
	pulseTabsEl.innerHTML = "";
	pulseState.categories.forEach((category) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "wealth-tab";
		button.dataset.value = category.value;
		button.textContent = `${category.label} (${category.count})`;
		if (category.value === pulseState.filter) {
			button.classList.add("is-active");
		}
		button.addEventListener("click", () => {
			if (pulseState.filter === category.value) return;
			pulseState.filter = category.value;
			pulseState.page = 1;
			renderPulseTabs();
			renderPulseGrid();
		});
		pulseTabsEl.append(button);
	});
}

function renderPulseGrid() {
	if (!pulseGridEl) return;
	const filtered = getFilteredPulseItems();
	const visible = filtered.slice(0, pulseState.page * PULSE_PAGE_LIMIT);
	pulseGridEl.innerHTML = "";
	if (!visible.length) {
		const empty = document.createElement("p");
		empty.className = "wealth-empty";
		empty.textContent = t("wealth_pulse_empty", "暂无市场快讯，稍后再试。");
		pulseGridEl.append(empty);
	} else {
		visible.forEach((item, index) => pulseGridEl.append(createPulseCard(item, index)));
	}
	if (pulseMoreBtn) {
		const allShown = visible.length >= filtered.length;
		pulseMoreBtn.hidden = allShown;
		pulseMoreBtn.disabled = allShown;
	}
}

function getFilteredPulseItems() {
	if (pulseState.filter === "all") return pulseState.items;
	return pulseState.items.filter((item) => {
		const key = (item.category || "general").toLowerCase() || "general";
		return key === pulseState.filter;
	});
}

function createPulseCard(item, visibleIndex = 0) {
	const card = document.createElement("article");
	card.className = "wealth-pulse-card";

	const meta = document.createElement("div");
	meta.className = "wealth-pulse-card__meta";
	if (item.__bucket) {
		const badge = document.createElement("span");
		badge.textContent = item.__bucket;
		meta.append(badge);
	}
	const catLabel = describePulseCategory(item.category);
	if (catLabel) {
		const badge = document.createElement("span");
		badge.textContent = catLabel;
		meta.append(badge);
	}
	if (item.source) {
		const badge = document.createElement("span");
		badge.textContent = item.source;
		meta.append(badge);
	}
	if (meta.childElementCount) {
		card.append(meta);
	}

	const title = document.createElement("h5");
	title.className = "wealth-pulse-card__title";
	title.textContent = pickLang(item.title) || pickLang(item.headline) || t("wealth_pulse_item_title", "市场快讯");
	card.append(title);

	const summary = document.createElement("p");
	summary.className = "wealth-pulse-card__impact";
	summary.textContent = pickLang(item.facts) || pickLang(item.summary) || t("wealth_pulse_facts_fallback", "暂无事实摘要。");
	card.append(summary);

	const impactText = pickLang(item.impact_one_liner) || pickLang(item.impact) || "";
	if (impactText) {
		const impact = document.createElement("p");
		impact.className = "wealth-pulse-card__impact";
		impact.textContent = impactText;
		card.append(impact);
	}

	const links = Array.isArray(item.links) ? item.links.filter((href) => isHttpUrl(href)) : [];
	if (links.length) {
		const primary = links[0];
		const anchor = document.createElement("a");
		anchor.href = primary;
		anchor.target = "_blank";
		anchor.rel = "noopener";
		anchor.className = "wealth-link__text wealth-pulse-link";
		anchor.textContent = t("wealth_pulse_link_label", "延伸阅读 {index}", { index: visibleIndex + 1 });
		card.append(anchor);
	}

	return card;
}

function renderTimeline(entries) {
	dailyState.items = Array.isArray(entries) ? entries : [];
	if (!dailyState.items.length) {
		if (dailyTrackEl) {
			dailyTrackEl.innerHTML = "";
			const empty = document.createElement("p");
			empty.className = "wealth-empty";
			empty.textContent = t("wealth_daily_empty", "暂未加载到课程内容，稍后再试。");
			dailyTrackEl.append(empty);
		}
		updateTimelinePagination(0, 0);
		visibleTimelineCards = [];
		return;
	}
	const targetIndex = Math.min(
		Math.max(typeof dailyState.activeIndex === "number" ? dailyState.activeIndex : 0, 0),
		dailyState.items.length - 1,
	);
	dailyState.page = Math.floor(targetIndex / TRACK_PAGE_SIZE);
	renderTimelinePage(dailyState.page);
	setActiveLesson(targetIndex);
}

function setActiveLesson(index, options = {}) {
	const { openModal = false } = options;
	if (!dailyState.items.length) return;
	const clamped = Math.max(0, Math.min(index, dailyState.items.length - 1));
	dailyState.activeIndex = clamped;
	const entry = dailyState.items[clamped];
	const targetPage = Math.floor(clamped / TRACK_PAGE_SIZE);
	if (targetPage !== dailyState.page) {
		renderTimelinePage(targetPage);
	}
	if (dailyActiveLabel) {
		dailyActiveLabel.textContent = entry.date || pickLang(entry.topic) || t("wealth_today_digest", "今日纪要");
	}
	updateActiveCardStyles();
	if (openModal) {
		openLessonModal(entry);
	}
}

function renderTimelinePage(page = dailyState.page) {
	if (!dailyTrackEl) {
		visibleTimelineCards = [];
		return;
	}
	const totalItems = dailyState.items.length;
	const totalPages = totalItems ? Math.ceil(totalItems / TRACK_PAGE_SIZE) : 0;
	const clampedPage = totalPages ? Math.max(0, Math.min(page, totalPages - 1)) : 0;
	dailyState.page = clampedPage;
	dailyTrackEl.innerHTML = "";
	visibleTimelineCards = [];
	if (!totalItems) {
		const empty = document.createElement("p");
		empty.className = "wealth-empty";
		empty.textContent = t("wealth_daily_empty", "暂未加载到课程内容，稍后再试。");
		dailyTrackEl.append(empty);
		updateTimelinePagination(0, 0);
		return;
	}
	const start = clampedPage * TRACK_PAGE_SIZE;
	const slice = dailyState.items.slice(start, start + TRACK_PAGE_SIZE);
	slice.forEach((entry, offset) => {
		const card = createTimelineCard(entry, start + offset);
		dailyTrackEl.append(card);
		visibleTimelineCards.push(card);
	});
	updateTimelinePagination(totalPages, totalItems);
	updateActiveCardStyles();
}

function updateTimelinePagination(totalPages, totalItems) {
	const hasPages = totalItems && totalPages;
	const current = hasPages ? dailyState.page + 1 : 0;
	if (dailyPrevBtn) dailyPrevBtn.disabled = !hasPages || dailyState.page === 0;
	if (dailyNextBtn) dailyNextBtn.disabled = !hasPages || dailyState.page >= totalPages - 1;
	const messages = hasPages
		? {
			zh: `第 ${current} / ${totalPages} 页`,
			en: `Page ${current} / ${totalPages}`,
			es: `Página ${current} / ${totalPages}`,
		}
		: { zh: "", en: "", es: "" };
	if (dailyPageContainer) {
		dailyPageContainer.hidden = !hasPages;
	}
	Object.entries(dailyPageLabels).forEach(([lang, el]) => {
		if (!el) return;
		el.textContent = messages[lang] || "";
		el.hidden = !messages[lang];
	});
}

function updateActiveCardStyles() {
	visibleTimelineCards.forEach((card) => {
		const indexValue = Number(card.dataset.index);
		const isActive = indexValue === dailyState.activeIndex;
		card.classList.toggle("is-active", isActive);
		card.setAttribute("aria-pressed", String(isActive));
	});
}

function changeTimelinePage(direction) {
	if (!dailyState.items.length) return;
	const totalPages = Math.ceil(dailyState.items.length / TRACK_PAGE_SIZE);
	if (!totalPages) return;
	const nextPage = Math.max(0, Math.min(dailyState.page + direction, totalPages - 1));
	if (nextPage === dailyState.page) return;
	renderTimelinePage(nextPage);
	const nextIndex = Math.min(nextPage * TRACK_PAGE_SIZE, dailyState.items.length - 1);
	setActiveLesson(nextIndex);
}

function renderPulse(data) {
	__wealth_last_pulse = data;
	if (!pulseContainer) return;
	clearStatus("pulse");
	if (!Array.isArray(data) || !data.length) {
		if (pulseGridEl) {
			pulseGridEl.innerHTML = "";
			const empty = document.createElement("p");
			empty.className = "wealth-empty";
			empty.textContent = t("wealth_pulse_empty", "暂无市场快讯，稍后再试。");
			pulseGridEl.append(empty);
		}
		if (pulseMoreBtn) {
			pulseMoreBtn.hidden = true;
			pulseMoreBtn.disabled = true;
		}
		if (pulseTabsEl) {
			pulseTabsEl.innerHTML = "";
		}
		return;
	}

	const rows = flattenPulseGroups(data.slice(0, 18));
	pulseState.items = rows;
	pulseState.categories = buildPulseCategories(rows);
	pulseState.filter = pulseState.categories[0]?.value || "all";
	pulseState.page = 1;
	renderPulseTabs();
	renderPulseGrid();
}

if (dailyPrevBtn) dailyPrevBtn.addEventListener("click", () => changeTimelinePage(-1));
if (dailyNextBtn) dailyNextBtn.addEventListener("click", () => changeTimelinePage(1));
if (lessonModalClosers.length) {
	lessonModalClosers.forEach((btn) => btn.addEventListener("click", closeLessonModal));
}
if (lessonModal) {
	lessonModal.addEventListener("click", (event) => {
		if (event.target === lessonModal) {
			closeLessonModal();
		}
	});
}
document.addEventListener("keydown", (event) => {
	if (event.key === "Escape" && lessonModal?.dataset.open === "true") {
		closeLessonModal();
	}
});
if (pulseMoreBtn) {
	pulseMoreBtn.addEventListener("click", () => {
		pulseState.page += 1;
		renderPulseGrid();
	});
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
		} else if (dailyTrackEl) {
			dailyTrackEl.innerHTML = "";
			const message = document.createElement("p");
			message.className = "wealth-empty";
			message.textContent = t("wealth_daily_error", "未能加载课程数据，请稍后刷新。");
			dailyTrackEl.append(message);
		}
		if (fallbackPulse) {
			renderPulse(fallbackPulse);
		} else if (pulseGridEl) {
			pulseGridEl.innerHTML = "";
			const message = document.createElement("p");
			message.className = "wealth-empty";
			message.textContent = t("wealth_pulse_error", "未能加载市场快讯，请稍后刷新。");
			pulseGridEl.append(message);
		}
	}
}

init();

// Re-render on language change: watch <html lang="...">
try {
	const root = document.documentElement;
	if (root && typeof MutationObserver !== "undefined") {
		const mo = new MutationObserver(() => {
			if (__wealth_last_daily) renderDaily(__wealth_last_daily);
			if (__wealth_last_pulse) renderPulse(__wealth_last_pulse);
		});
		mo.observe(root, { attributes: true, attributeFilter: ["lang"] });
	} else if ("onlanguagechange" in window) {
		window.addEventListener("languagechange", () => {
			if (__wealth_last_daily) renderDaily(__wealth_last_daily);
			if (__wealth_last_pulse) renderPulse(__wealth_last_pulse);
		});
	}
} catch (e) {
	// no-op
}
