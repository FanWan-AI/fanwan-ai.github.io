const PATHS = {
  daily: "/data/ai/startup/opportunities/latest.json",
  cases: "/data/ai/startup/cases/index.json"
};
const CACHE_PREFIX = "fanwan-ai-startup:v1:";

const UI = {
  zh: {
    heroEyebrow: "AI VENTURE INTELLIGENCE",
    heroTitle: "发现 AI 商机，读懂创业成败。",
    heroLede: "每天筛出值得验证的 AI 商机；每周拆开一家公司的增长逻辑、关键取舍与隐性风险。",
    dailyLabel: "日报", dailyCadence: "每日最多 10 条",
    caseLabel: "解剖", caseCadence: "每周 1 个案例",
    evidenceLabel: "证据", evidenceCadence: "关键结论可追溯",
    heroCaption: "从噪声中识别可验证信号",
    opportunityTab: "AI 创业机会日报", opportunityTabHint: "值得尝试的商业机会",
    caseTab: "AI 创业案例解剖", caseTabHint: "理解增长背后的选择与代价",
    loading: "内容加载中…", ready: "", partial: "部分数据更新失败，已显示最近一期内容", error: "今日内容暂不可用，请稍后再试",
    edition: "本期观察", opportunities: "本期精选", sources: "参考来源", verified: "更新于",
    topSignals: "重点机会", otherSignals: "其他值得观察", otherHint: "留意变化，先从小实验开始",
    customer: "谁会买", pain: "正在付出的代价", whyNow: "为什么是现在", aiFit: "AI 的必要性", msp: "最小可售产品", businessModel: "商业模式", risk: "最可能失败", falsify: "最快证伪",
    evidence: "查看证据与来源", evidenceBoundary: "本节证据边界", confidence: "置信度", sourceFallback: "原始来源",
    noDailyTitle: "今日暂无新机会", noDailyBody: "下一期内容更新后会在这里出现。",
    caseEyebrow: "WEEKLY CASE ANATOMY", caseHeading: "读懂一家公司的关键选择。", caseIntro: "围绕一个关键决策，拆解增长逻辑、适用边界和下一步可执行实验。",
    latestCase: "最新案例", readCase: "阅读全文", minutes: "分钟", casesEmpty: "新案例准备中", casesEmptyBody: "下一篇案例完成后会在这里发布。",
    verdict: "核心判断", centralQuestion: "中心问题", timeline: "关键时间线", copy: "可以抄什么", avoid: "不要抄什么", experiment: "下一步实验", unknowns: "仍然未知", sourcesTitle: "来源与证据", back: "返回案例列表", copyLink: "复制链接", copied: "链接已复制", companyClaim: "公司自述", fact: "事实", inference: "编辑推断", unknown: "未知"
  },
  en: {
    heroEyebrow: "AI VENTURE INTELLIGENCE",
    heroTitle: "Discover AI opportunities. Understand what makes ventures work.",
    heroLede: "A daily shortlist of AI opportunities worth testing, plus one weekly case that exposes the choices and risks beneath the growth story.",
    dailyLabel: "Daily", dailyCadence: "Up to 10 signals",
    caseLabel: "Anatomy", caseCadence: "One case weekly",
    evidenceLabel: "Evidence", evidenceCadence: "Claims trace to sources",
    heroCaption: "Turning noise into testable signals",
    opportunityTab: "AI Opportunity Daily", opportunityTabHint: "Business opportunities worth exploring",
    caseTab: "AI Venture Case Anatomy", caseTabHint: "The choices and costs behind growth",
    loading: "Loading the latest edition…", ready: "", partial: "Some data could not refresh; showing the latest available edition", error: "Today’s edition is temporarily unavailable. Please try again later.",
    edition: "In this edition", opportunities: "Selected", sources: "Sources", verified: "Updated",
    topSignals: "Featured opportunities", otherSignals: "More to watch", otherHint: "Watch the changes. Start with a small experiment.",
    customer: "Buyer", pain: "Costly pain", whyNow: "Why now", aiFit: "Why AI", msp: "Smallest sellable product", businessModel: "Business model", risk: "Failure mode", falsify: "Fastest falsification",
    evidence: "Evidence and sources", evidenceBoundary: "Evidence boundary", confidence: "Confidence", sourceFallback: "Original source",
    noDailyTitle: "No new opportunity today", noDailyBody: "The next edition will appear here when it is ready.",
    caseEyebrow: "WEEKLY CASE ANATOMY", caseHeading: "Understand the choices behind a company.", caseIntro: "Each case follows one pivotal decision and explains the growth logic, limits, and next practical experiment.",
    latestCase: "Latest case", readCase: "Read case", minutes: "min", casesEmpty: "A new case is in progress", casesEmptyBody: "The next completed case will appear here.",
    verdict: "Verdict", centralQuestion: "Central question", timeline: "Timeline", copy: "What to copy", avoid: "What not to copy", experiment: "Next experiment", unknowns: "Still unknown", sourcesTitle: "Sources and evidence", back: "Back to cases", copyLink: "Copy link", copied: "Link copied", companyClaim: "Company claim", fact: "Fact", inference: "Editorial inference", unknown: "Unknown"
  },
  es: {
    heroEyebrow: "INTELIGENCIA PARA EMPRENDER CON IA",
    heroTitle: "Descubre oportunidades de IA y aprende de negocios reales.",
    heroLede: "Una selección diaria de oportunidades de IA que merecen validarse y un caso semanal que revela decisiones, ventajas y riesgos.",
    dailyLabel: "Diario", dailyCadence: "Hasta 10 señales",
    caseLabel: "Anatomía", caseCadence: "Un caso semanal",
    evidenceLabel: "Evidencia", evidenceCadence: "Conclusiones rastreables",
    heroCaption: "Convertir ruido en señales comprobables",
    opportunityTab: "Oportunidades IA del día", opportunityTabHint: "Oportunidades comerciales para explorar",
    caseTab: "Anatomía de casos IA", caseTabHint: "Decisiones y costes detrás del crecimiento",
    loading: "Cargando la última edición…", ready: "", partial: "Algunos datos no se actualizaron; mostramos la última edición disponible", error: "La edición de hoy no está disponible. Inténtalo de nuevo más tarde.",
    edition: "En esta edición", opportunities: "Elegidas", sources: "Fuentes", verified: "Actualizado",
    topSignals: "Oportunidades destacadas", otherSignals: "Otras señales", otherHint: "Observa los cambios y empieza con una prueba pequeña.",
    customer: "Comprador", pain: "Problema costoso", whyNow: "Por qué ahora", aiFit: "Por qué IA", msp: "Producto mínimo vendible", businessModel: "Modelo de negocio", risk: "Riesgo principal", falsify: "Prueba de refutación",
    evidence: "Evidencia y fuentes", evidenceBoundary: "Límite de la evidencia", confidence: "Confianza", sourceFallback: "Fuente original",
    noDailyTitle: "Hoy no hay una oportunidad nueva", noDailyBody: "La próxima edición aparecerá aquí cuando esté lista.",
    caseEyebrow: "ANATOMÍA SEMANAL", caseHeading: "Entiende las decisiones de una empresa.", caseIntro: "Cada caso sigue una decisión clave y explica la lógica de crecimiento, sus límites y el siguiente experimento práctico.",
    latestCase: "Último caso", readCase: "Leer caso", minutes: "min", casesEmpty: "Hay un nuevo caso en preparación", casesEmptyBody: "El próximo caso aparecerá aquí cuando esté terminado.",
    verdict: "Veredicto", centralQuestion: "Pregunta central", timeline: "Cronología", copy: "Qué copiar", avoid: "Qué no copiar", experiment: "Siguiente experimento", unknowns: "Aún desconocido", sourcesTitle: "Fuentes y evidencia", back: "Volver a casos", copyLink: "Copiar enlace", copied: "Enlace copiado", companyClaim: "Afirmación empresarial", fact: "Hecho", inference: "Inferencia editorial", unknown: "Desconocido"
  }
};

const STORY_TYPE_LABELS = {
  zh: { growth: "增长飞轮", pivotal_decision: "关键决策", failure: "失败复盘", business_model: "商业模式", technical_commercialization: "技术商业化", comparison: "对照案例" },
  en: { growth: "Growth flywheel", pivotal_decision: "Pivotal decision", failure: "Failure post-mortem", business_model: "Business model", technical_commercialization: "Tech commercialization", comparison: "Comparison case" },
  es: { growth: "Flywheel de crecimiento", pivotal_decision: "Decisión clave", failure: "Autopsia de fracaso", business_model: "Modelo de negocio", technical_commercialization: "Comercialización técnica", comparison: "Caso comparativo" }
};

const state = { daily: null, cases: null, detail: null, view: "opportunities", failures: 0, cacheFallbacks: 0 };

function lang() {
  let raw = document.documentElement.lang || "zh";
  try { raw = localStorage.getItem("lang") || raw; } catch { /* Private mode may block storage. */ }
  return Object.hasOwn(UI, raw) ? raw : "zh";
}

function t(key) {
  const active = UI[lang()] || UI.zh;
  if (Object.hasOwn(active, key)) return active[key];
  return Object.hasOwn(UI.zh, key) ? UI.zh[key] : key;
}

function localize(value, fallback = "") {
  if (value == null) return fallback;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") return String(value[lang()] || value.zh || value.en || value.es || fallback);
  return fallback;
}

function storyTypeLabel(value) {
  if (value == null) return "";
  const labels = STORY_TYPE_LABELS[lang()];
  return labels && Object.hasOwn(labels, value) ? labels[value] : value;
}

function append(parent, child) {
  if (child == null || child === false) return;
  if (Array.isArray(child)) child.forEach(item => append(parent, item));
  else if (child instanceof Node) parent.append(child);
  else parent.append(document.createTextNode(String(child)));
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = String(value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  children.forEach(child => append(node, child));
  return node;
}

function asList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(v => localize(v));
  const item = localize(value);
  return item ? [item] : [];
}

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(`${value}`.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  const locale = lang() === "zh" ? "zh-CN" : lang() === "es" ? "es-ES" : "en-GB";
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(parsed);
}

function sourceMap(sources = []) {
  return new Map(sources.map(source => [source.id, source]));
}

function safeExternalLink(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    return /^https?:$/.test(parsed.protocol) ? parsed.href : "";
  } catch { return ""; }
}

function safeCasePath(path) {
  if (typeof path !== "string") return "";
  if (/^cases\/[a-z0-9][a-z0-9-]*\.json$/.test(path)) return `/data/ai/startup/${path}`;
  return /^\/data\/ai\/startup\/cases\/[a-z0-9][a-z0-9-]*\.json$/.test(path) ? path : "";
}

async function fetchJSON(path, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, { cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    const type = response.headers.get("content-type") || "";
    if (!type.includes("json")) throw new Error(`${path}: unexpected content type`);
    return await response.json();
  } finally { clearTimeout(timeout); }
}

function validPayload(path, value) {
  if (!value || typeof value !== "object") return false;
  const text = v => typeof v === "string" ? v.trim().length > 0 : v && typeof v === "object" && typeof v.zh === "string" && v.zh.trim().length > 0;
  const sourcesValid = Array.isArray(value.sources) && value.sources.every(s => s && typeof s.id === "string" && safeExternalLink(s.url));
  const dateValid = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v));
  if (path === PATHS.daily) return value.kind === "startup_opportunity_daily" && dateValid(value.date) && text(value.headline) && sourcesValid && Array.isArray(value.opportunities) && value.opportunities.length <= 10 && value.opportunities.every(o => o && text(o.title) && text(o.customer) && text(o.pain) && Array.isArray(o.evidence));
  if (path === PATHS.cases) return value.kind === "startup_case_index" && Array.isArray(value.cases) && value.cases.every(c => c && text(c.title) && /^[a-z0-9][a-z0-9-]*$/.test(c.slug) && safeCasePath(c.case_path || `/data/ai/startup/cases/${c.slug}.json`));
  return value.kind === "startup_case_analysis" && value.status === "published" && path.endsWith(`/${value.slug}.json`) && text(value.title) && sourcesValid && Array.isArray(value.sections) && value.sections.length > 0 && value.sections.every(s => s && text(s.heading) && Array.isArray(s.paragraphs));
}

async function fetchJSONWithCache(path) {
  try {
    const data = await fetchJSON(path);
    if (!validPayload(path, data)) throw new Error(`${path}: invalid startup payload`);
    try { localStorage.setItem(`${CACHE_PREFIX}${path}`, JSON.stringify(data)); } catch { /* Storage is optional. */ }
    return { data, stale: false };
  } catch (error) {
    try {
      const cached = JSON.parse(localStorage.getItem(`${CACHE_PREFIX}${path}`) || "null");
      if (validPayload(path, cached)) return { data: cached, stale: true, error };
    } catch { /* Ignore corrupt or unavailable storage. */ }
    throw error;
  }
}

function applyShellTranslations() {
  document.querySelectorAll("[data-su-i18n]").forEach(node => {
    const key = node.dataset.suI18n;
    if (UI[lang()]?.[key]) node.textContent = UI[lang()][key];
  });
  const title = lang() === "zh" ? "AI 创业 · 机会日报与案例解剖" : lang() === "es" ? "Emprendimiento IA · Oportunidades y casos" : "AI Venture · Opportunities and cases";
  document.title = title;
  const status = document.getElementById("startup-status")?.dataset.state;
  if (status) setStatus(status, status);
}

function setStatus(status, key) {
  const root = document.getElementById("startup-status");
  if (!root) return;
  root.hidden = status === "ready";
  root.dataset.state = status;
  const label = root.querySelector("span:last-child");
  if (label) label.textContent = t(key);
}

function definition(label, value) {
  return el("div", {}, el("dt", { text: label }), el("dd", { text: localize(value, "—") }));
}

function analysisSection(label, content, isList = false) {
  const section = el("section", {}, el("h4", { class: "analysis-label", text: label }));
  if (isList) {
    const items = asList(content);
    section.append(el("ul", {}, ...items.map(item => el("li", { text: item }))));
  } else section.append(el("p", { text: localize(content, "—") }));
  return section;
}

function evidenceDrawer(opportunity, sources) {
  const lookup = sourceMap(sources);
  const list = el("ul", { class: "evidence-list" });
  const evidence = Array.isArray(opportunity.evidence) ? opportunity.evidence : [];
  evidence.forEach(item => {
    const sourceLinks = (item.source_ids || []).map(id => lookup.get(id)).filter(Boolean);
    const li = el("li", {}, el("strong", { text: `${localize(item.claim)} ` }));
    if (item.confidence) li.append(el("span", { class: "evidence-level", text: `${t("confidence")}: ${item.confidence}` }));
    sourceLinks.forEach((source, index) => {
      const url = safeExternalLink(source.url);
      if (!url) return;
      li.append(document.createTextNode(index === 0 ? " · " : " / "));
      li.append(el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: localize(source.title, source.publisher || t("sourceFallback")) }));
    });
    list.append(li);
  });
  if (!list.children.length) list.append(el("li", { text: t("error") }));
  return el("div", { class: "evidence-drawer" }, el("details", {}, el("summary", { text: t("evidence") }), list));
}

function opportunityCard(opportunity, sources) {
  const failures = asList(opportunity.failure_modes || opportunity.risks);
  return el("article", { class: "opportunity-card" },
    el("div", { class: "opportunity-card__top" },
      el("span", { class: "opportunity-rank", text: `NO. ${String(opportunity.rank || 0).padStart(2, "0")}` })
    ),
    el("h3", { text: localize(opportunity.title) }),
    el("p", { class: "opportunity-card__verdict", text: localize(opportunity.verdict || opportunity.one_liner) }),
    el("dl", { class: "opportunity-core" },
      definition(t("customer"), opportunity.customer),
      definition(t("pain"), opportunity.pain)
    ),
    el("div", { class: "opportunity-analysis" },
      analysisSection(t("whyNow"), opportunity.why_now, true),
      analysisSection(t("aiFit"), opportunity.ai_advantage || opportunity.ai_fit),
      analysisSection(t("msp"), opportunity.smallest_sellable_product || opportunity.mvp),
      analysisSection(t("risk"), failures, true),
      analysisSection(t("falsify"), opportunity.falsification_test),
      analysisSection(t("businessModel"), opportunity.business_model)
    ),
    evidenceDrawer(opportunity, sources)
  );
}

function briefCard(opportunity, sources) {
  const risk = asList(opportunity.failure_modes || opportunity.risks)[0] || "—";
  return el("article", { class: "brief-card" },
    el("div", { class: "brief-card__top" },
      el("span", { class: "opportunity-rank", text: `NO. ${String(opportunity.rank || 0).padStart(2, "0")}` })
    ),
    el("h4", { text: localize(opportunity.title) }),
    el("p", { text: localize(opportunity.verdict || opportunity.one_liner) }),
    el("p", { class: "brief-card__test" }, el("strong", { text: `${t("risk")}: ` }), risk),
    el("p", { class: "brief-card__test" }, el("strong", { text: `${t("falsify")}: ` }), localize(opportunity.falsification_test, "—")),
    evidenceDrawer(opportunity, sources)
  );
}

function renderDaily() {
  const root = document.getElementById("opportunity-root");
  if (!root) return;
  root.replaceChildren();
  const daily = state.daily;
  const opportunities = Array.isArray(daily?.opportunities) ? daily.opportunities : [];
  document.getElementById("startup-edition-date").textContent = formatDate(daily?.date);
  if (!daily || !opportunities.length) {
    root.append(el("div", { class: "startup-empty" }, el("h2", { text: t("noDailyTitle") }), el("p", { text: t("noDailyBody") })));
    return;
  }
  const sources = Array.isArray(daily.sources) ? daily.sources : [];
  const deep = opportunities.filter((item, index) => item.depth === "deep" || index < 3).slice(0, 3);
  const brief = opportunities.filter(item => !deep.includes(item));
  const verifiedAt = daily.quality?.verified_at || daily.generated_at;
  const head = el("div", { class: "edition-head" },
    el("div", {},
      el("p", { class: "edition-head__label", text: `${t("edition")} · ${formatDate(daily.date)}` }),
      el("h2", { text: localize(daily.headline || daily.title, t("topSignals")) }),
      el("p", { class: "edition-head__note", text: localize(daily.editorial_note) })
    ),
    el("dl", { class: "edition-head__facts" },
      el("div", {}, el("dt", { text: t("opportunities") }), el("dd", { text: opportunities.length })),
      el("div", {}, el("dt", { text: t("sources") }), el("dd", { text: sources.length }))
    )
  );
  const lead = el("div", { class: "opportunity-lead-grid" }, ...deep.map(item => opportunityCard(item, sources)));
  root.append(head, lead);
  if (brief.length) {
    root.append(el("section", { class: "brief-section" },
      el("div", { class: "brief-section__head" }, el("h3", { text: t("otherSignals") }), el("span", { text: t("otherHint") })),
      el("div", { class: "brief-grid" }, ...brief.map(item => briefCard(item, sources)))
    ));
  }
  root.append(el("p", { class: "startup-status", text: `${t("verified")}: ${formatDate(verifiedAt)}` }));
}

function caseButton(item) {
  return el("button", { class: "case-open", type: "button", text: t("readCase"), onClick: () => openCase(item) });
}

function caseCard(item) {
  return el("article", { class: "case-card" },
    el("div", { class: "case-card__meta" }, el("span", { class: "case-type", text: storyTypeLabel(item.story_type) }), el("time", { datetime: item.published_at, text: formatDate(item.published_at) })),
    el("h3", { text: localize(item.title) }),
    el("p", { text: localize(item.dek || item.verdict) }),
    caseButton(item)
  );
}

function renderCaseIndex() {
  const root = document.getElementById("case-root");
  if (!root) return;
  root.replaceChildren();
  const items = Array.isArray(state.cases?.cases) ? state.cases.cases.filter(item => item.status !== "draft") : [];
  root.append(el("header", { class: "case-index-head" },
    el("p", { class: "startup-kicker", text: t("caseEyebrow") }),
    el("h2", { text: t("caseHeading") }),
    el("p", { text: t("caseIntro") })
  ));
  if (!items.length) {
    root.append(el("div", { class: "startup-empty" }, el("h2", { text: t("casesEmpty") }), el("p", { text: t("casesEmptyBody") })));
    return;
  }
  const [feature, ...rest] = items;
  root.append(el("article", { class: "case-feature" },
    el("div", { class: "case-feature__visual" }, el("img", { src: "../assets/ai-startup/ai-startup-cover.webp", alt: "", width: 1280, height: 719, loading: "lazy" })),
    el("div", { class: "case-feature__copy" },
      el("div", { class: "case-card__meta" }, el("span", { class: "case-type", text: t("latestCase") }), el("span", { text: `${feature.read_minutes || 8} ${t("minutes")}` })),
      el("h3", { text: localize(feature.title) }),
      el("p", { text: localize(feature.dek) }),
      el("p", { class: "case-verdict-short", text: localize(feature.verdict) }),
      caseButton(feature)
    )
  ));
  if (rest.length) root.append(el("div", { class: "case-grid" }, ...rest.map(caseCard)));
}

function claimTags(section) {
  const evidenceKinds = (section.evidence_labels || []).map(item => item.label);
  const kinds = [...new Set((evidenceKinds.length ? evidenceKinds : section.claim_types || []).filter(Boolean))];
  const labels = { fact: t("fact"), company_claim: t("companyClaim"), inference: t("inference"), editorial_inference: t("inference"), unknown: t("unknown") };
  if (!kinds.length) return null;
  return el("div", { class: "claim-notes" }, ...kinds.map(kind => el("span", { class: "claim-tag", text: labels[kind] || kind })));
}

function claimEvidence(section, sources) {
  const entries = Array.isArray(section.evidence_labels) ? section.evidence_labels : [];
  if (!entries.length) return null;
  const lookup = sourceMap(sources);
  const labels = { fact: t("fact"), company_claim: t("companyClaim"), editorial_inference: t("inference"), unknown: t("unknown") };
  return el("details", { class: "claim-evidence" },
    el("summary", { text: t("sources") }),
    ...entries.map(entry => {
      const row = el("div", { class: "claim-evidence__row" },
        el("span", { class: `claim-tag claim-tag--${entry.label || "unknown"}`, text: labels[entry.label] || entry.label }),
        el("p", { text: localize(entry.text) })
      );
      const links = (entry.source_ids || []).map(id => lookup.get(id)).filter(Boolean).map(source => {
        const url = safeExternalLink(source.url);
        return url ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: localize(source.title, source.publisher) }) : null;
      }).filter(Boolean);
      if (links.length) row.append(el("div", { class: "claim-evidence__sources" }, ...links));
      return row;
    })
  );
}

function renderCaseDetail(detail) {
  const root = document.getElementById("case-root");
  root.replaceChildren();
  const sources = Array.isArray(detail.sources) ? detail.sources : [];
  const sections = Array.isArray(detail.sections) ? detail.sections : [];
  const actionRow = el("div", { class: "case-detail__actions" },
    el("button", { class: "case-back", type: "button", text: t("back"), onClick: closeCase }),
    el("button", { class: "copy-link", type: "button", text: t("copyLink"), onClick: async event => {
      const button = event.currentTarget;
      try { await navigator.clipboard.writeText(window.location.href); button.textContent = t("copied"); }
      catch { button.textContent = window.location.href; }
    }})
  );
  const masthead = el("header", { class: "case-masthead" },
    el("div", { class: "case-masthead__meta" },
      el("span", { class: "case-type", text: storyTypeLabel(detail.story_type) }),
      el("time", { datetime: detail.published_at, text: formatDate(detail.published_at) }),
      el("span", { text: `${detail.read_minutes || 8} ${t("minutes")}` })
    ),
    el("h2", { text: localize(detail.title), tabindex: "-1" }),
    el("p", { class: "case-masthead__dek", text: localize(detail.dek) }),
    el("div", { class: "case-verdict" }, el("span", { text: t("verdict") }), el("p", { text: localize(detail.verdict) })),
    el("p", { class: "case-central-question" }, el("strong", { text: `${t("centralQuestion")}: ` }), localize(detail.central_question))
  );
  const timeline = Array.isArray(detail.timeline) && detail.timeline.length
    ? el("div", { class: "case-timeline", "aria-label": t("timeline") }, ...detail.timeline.map(item => el("article", { class: "case-timeline__item" }, el("time", { text: item.date }), el("p", { text: localize(item.event) }))))
    : null;
  const body = sections.map((section, index) => el("section", { class: "case-section" },
    el("span", { class: "case-section__number", text: String(index + 1).padStart(2, "0") }),
    el("h3", { text: localize(section.heading) }),
    section.thesis ? el("p", { class: "case-section__thesis", text: localize(section.thesis) }) : null,
    el("div", { class: "case-section__body" }, ...asList(section.paragraphs || section.body).map(paragraph => el("p", { text: paragraph }))),
    claimEvidence(section, sources)
  ));
  const unknowns = asList(detail.unknowns);
  const lessons = el("div", { class: "case-lessons" },
    el("section", {}, el("h3", { text: t("copy") }), el("ul", {}, ...asList(detail.copy).map(item => el("li", { text: item })))),
    el("section", {}, el("h3", { text: t("avoid") }), el("ul", {}, ...asList(detail.avoid).map(item => el("li", { text: item })))),
    unknowns.length ? el("section", {}, el("h3", { text: t("unknowns") }), el("ul", {}, ...unknowns.map(item => el("li", { text: item })))) : null,
    el("section", { class: "case-experiment" }, el("h3", { text: t("experiment") }), el("p", { text: localize(detail.next_experiment) }))
  );
  const sourceList = el("ol", {}, ...sources.map(source => {
    const url = safeExternalLink(source.url);
    const label = `${localize(source.title, source.publisher)}${source.publisher ? ` — ${source.publisher}` : ""}`;
    return el("li", {}, url ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: label }) : label, source.published_at ? ` · ${formatDate(source.published_at)}` : "");
  }));
  root.append(el("article", { class: "case-detail" }, actionRow, masthead, timeline, ...body, lessons, el("section", { class: "source-block" }, el("h3", { text: t("sourcesTitle") }), sourceList)));
  root.querySelector("h2")?.focus?.();
}

let caseRequest = 0;
async function openCase(item, { updateHistory = true, scroll = true } = {}) {
  const request = ++caseRequest;
  const path = safeCasePath(item.case_path || `/data/ai/startup/cases/${item.slug}.json`);
  if (!path) { setStatus("error", "error"); return; }
  setStatus("loading", "loading");
  try {
    const loaded = await fetchJSONWithCache(path);
    if (request !== caseRequest) return false;
    state.detail = loaded.data;
    if (updateHistory) {
      const url = new URL(window.location.href);
      url.searchParams.set("case", item.slug);
      url.hash = "cases";
      history.pushState({ case: item.slug }, "", url);
    }
    selectView("cases", false);
    renderCaseDetail(state.detail);
    setStatus(loaded.stale ? "partial" : "ready", loaded.stale ? "partial" : "ready");
    if (scroll) document.getElementById("case-root")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  } catch (error) {
    if (request !== caseRequest) return false;
    console.error("[ai-startup] case load failed", error);
    setStatus("error", "error");
    return false;
  }
}

function closeCase() {
  caseRequest += 1;
  state.detail = null;
  const url = new URL(window.location.href);
  url.searchParams.delete("case");
  url.hash = "cases";
  history.pushState({}, "", url);
  renderCaseIndex();
  document.getElementById("case-root")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function selectView(view, updateURL = true) {
  state.view = view === "cases" ? "cases" : "opportunities";
  document.querySelectorAll(".startup-tab").forEach(tab => {
    const active = tab.dataset.view === state.view;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  document.getElementById("panel-opportunities").hidden = state.view !== "opportunities";
  document.getElementById("panel-cases").hidden = state.view !== "cases";
  if (updateURL) {
    caseRequest += 1;
    const url = new URL(window.location.href);
    if (state.view !== "cases") url.searchParams.delete("case");
    else if (state.detail) url.searchParams.set("case", state.detail.slug);
    url.hash = state.view;
    history.pushState({}, "", url);
  }
}

function bindTabs() {
  const tabs = [...document.querySelectorAll(".startup-tab")];
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      if (tab.dataset.view === "cases" && state.detail) renderCaseDetail(state.detail);
      else if (tab.dataset.view === "cases") renderCaseIndex();
      selectView(tab.dataset.view);
    });
    tab.addEventListener("keydown", event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
      tabs[(index + direction + tabs.length) % tabs.length].focus();
    });
  });
}

async function openInitialCase() {
  const slug = new URL(window.location.href).searchParams.get("case");
  if (!slug || !state.cases) return false;
  const match = (state.cases.cases || []).find(item => item.slug === slug && item.status !== "draft");
  if (!match) return false;
  return openCase(match, { updateHistory: false, scroll: false });
}

async function init() {
  applyShellTranslations();
  bindTabs();
  const requestedView = window.location.hash === "#cases" || new URL(window.location.href).searchParams.has("case") ? "cases" : "opportunities";
  selectView(requestedView, false);
  const results = await Promise.allSettled([fetchJSONWithCache(PATHS.daily), fetchJSONWithCache(PATHS.cases)]);
  if (results[0].status === "fulfilled") { state.daily = results[0].value.data; if (results[0].value.stale) state.cacheFallbacks += 1; }
  else { state.failures += 1; console.error("[ai-startup] daily load failed", results[0].reason); }
  if (results[1].status === "fulfilled") { state.cases = results[1].value.data; if (results[1].value.stale) state.cacheFallbacks += 1; }
  else { state.failures += 1; console.error("[ai-startup] case index load failed", results[1].reason); }
  renderDaily();
  renderCaseIndex();
  const requestedCaseOpened = await openInitialCase();
  if (new URL(window.location.href).searchParams.has("case") && !requestedCaseOpened) state.failures += 1;
  const partial = state.failures < 2 && (state.failures > 0 || state.cacheFallbacks > 0);
  setStatus(state.failures >= 2 ? "error" : partial ? "partial" : "ready", state.failures >= 2 ? "error" : partial ? "partial" : "ready");
  document.documentElement.removeAttribute("data-lang-loading");
}

window.addEventListener("language-changed", () => {
  applyShellTranslations();
  renderDaily();
  if (state.detail) renderCaseDetail(state.detail); else renderCaseIndex();
});

window.addEventListener("popstate", async () => {
  caseRequest += 1;
  const view = window.location.hash === "#cases" ? "cases" : "opportunities";
  selectView(view, false);
  const slug = new URL(window.location.href).searchParams.get("case");
  if (view === "cases" && slug) {
    const match = (state.cases?.cases || []).find(item => item.slug === slug && item.status !== "draft");
    if (match && state.detail?.slug !== slug) await openCase(match, { updateHistory: false, scroll: false });
    else if (state.detail?.slug === slug) renderCaseDetail(state.detail);
  } else if (view === "cases") {
    state.detail = null;
    renderCaseIndex();
  }
});

document.addEventListener("DOMContentLoaded", init, { once: true });
setTimeout(() => document.documentElement.removeAttribute("data-lang-loading"), 2500);
