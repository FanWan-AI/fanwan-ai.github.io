const DAILY_URL = "/data/ai/daily-academy/daily.json";
const CACHE_KEY_DAILY = "academy_daily_v1";
const CACHE_TTL = 1000 * 60 * 60; // 1 hour cache
const PROGRESS_KEY = "academy_progress_v1";
const NOTE_KEY = "academy_note_v1";
const NOTE_STATUS_TIMEOUT = 2600;
const PAGE_SIZE = 5;
const XP_PER_LESSON = 15;
const MIN_PASS_RATE = 0.6;
const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js";
const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v0.24.1/full/";
const UNSUPPORTED_MODULES = [/^torch$/i, /^tensorflow$/i, /^imblearn$/i, /^mlxtend$/i];
const PYODIDE_PACKAGES = {
  numpy: "numpy",
  np: "numpy",
  pandas: "pandas",
  scipy: "scipy",
  sklearn: "scikit-learn",
  "scikit-learn": "scikit-learn",
  matplotlib: "matplotlib",
  "matplotlib.pyplot": "matplotlib",
};

const dailyRoot = document.querySelector('[data-role="daily-root"]');
if (!dailyRoot) {
  console.warn("academy.js loaded outside of academy page");
}

const statusEl = document.querySelector('[data-role="daily-status"]');
const prevBtn = document.querySelector('[data-role="daily-prev"]');
const nextBtn = document.querySelector('[data-role="daily-next"]');
const pageLabels = {
  zh: document.querySelector('[data-role="daily-page-label-zh"]'),
  en: document.querySelector('[data-role="daily-page-label-en"]'),
  es: document.querySelector('[data-role="daily-page-label-es"]'),
};
const paginationHost = document.querySelector('[data-role="daily-pagination"]');
const statusState = { type: "loading", extra: null, timestamp: null };

const modal = document.getElementById("academy-modal");
const modalBody = modal?.querySelector('[data-role="modal-body"]');
const modalTitle = modal?.querySelector("#academy-modal-title");
const modalClosers = modal ? Array.from(modal.querySelectorAll('[data-role="modal-close"]')) : [];

const progressEls = {
  completed: document.querySelector('[data-role="stat-completed"]'),
  streak: document.querySelector('[data-role="stat-streak"]'),
  xp: document.querySelector('[data-role="stat-xp"]'),
  badges: document.querySelector('[data-role="badge-list"]'),
  heatmap: document.querySelector('[data-role="progress-heatmap"]'),
  exportBtn: document.querySelector('[data-role="export-progress"]'),
  clearBtn: document.querySelector('[data-role="clear-progress"]'),
};

const filterEls = {
  search: document.querySelector('[data-role="filter-search"]'),
  difficulty: document.querySelector('[data-role="filter-difficulty"]'),
  topic: document.querySelector('[data-role="filter-topic"]'),
  reset: document.querySelector('[data-role="filter-reset"]'),
  personalize: document.querySelector('[data-role="filter-personalize"]'),
};

const noteEls = {
  field: document.querySelector('[data-role="note-field"]'),
  saveBtn: document.querySelector('[data-role="note-save"]'),
  status: document.querySelector('[data-role="note-status"]'),
};

const recommendationHost = document.querySelector('[data-role="recommendations"]');

const state = {
  lessons: [],
  filtered: [],
  page: 0,
  pageSize: PAGE_SIZE,
  loading: false,
  generatedAt: null,
  filters: {
    query: "",
    difficulty: "all",
    topic: "all",
    personalize: false,
  },
};

const modalState = {
  entry: null,
  mode: "detail",
};

let progressState = loadProgress();
let noteStatusTimer = null;
let expandedLessonId = null;
let pyodideReady = null;
const loadedPackages = new Set();

if (dailyRoot) {
  bootstrap();
}

function bootstrap() {
  bindPagination();
  bindProgressActions();
  bindFilters();
  bindNotes();
  bindModal();
  bindLanguageChange();
  renderProgress();
  fetchLessons();
}

function bindPagination() {
  if (prevBtn) prevBtn.addEventListener("click", () => changePage(-1));
  if (nextBtn) nextBtn.addEventListener("click", () => changePage(1));
}

function bindProgressActions() {
  if (progressEls.exportBtn) {
    progressEls.exportBtn.addEventListener("click", exportProgress);
  }
  if (progressEls.clearBtn) {
    progressEls.clearBtn.addEventListener("click", clearProgress);
  }
}

function bindFilters() {
  if (filterEls.search) {
    filterEls.search.addEventListener("input", (event) => {
      updateFilters({ query: event.target.value || "" });
    });
  }
  if (filterEls.difficulty) {
    filterEls.difficulty.addEventListener("change", (event) => {
      updateFilters({ difficulty: event.target.value || "all" });
    });
  }
  if (filterEls.topic) {
    filterEls.topic.addEventListener("change", (event) => {
      updateFilters({ topic: event.target.value || "all" });
    });
  }
  if (filterEls.reset) {
    filterEls.reset.addEventListener("click", () => resetFilters());
  }
  if (filterEls.personalize) {
    filterEls.personalize.addEventListener("click", () => togglePersonalize());
  }
}

function bindNotes() {
  if (!noteEls.field) return;
  noteEls.field.value = loadNote();
  if (noteEls.saveBtn) {
    noteEls.saveBtn.addEventListener("click", () => saveNote(noteEls.field.value));
  }
}

function loadNote() {
  try {
    return localStorage.getItem(NOTE_KEY) || "";
  } catch {
    return "";
  }
}

function saveNote(value) {
  try {
    localStorage.setItem(NOTE_KEY, value || "");
    showNoteStatus(t("academy_note_saved", "Note saved"));
  } catch (error) {
    console.warn("Unable to save note", error);
    showNoteStatus(t("academy_note_error", "Unable to save"));
  }
}

function showNoteStatus(message) {
  if (!noteEls.status) return;
  noteEls.status.textContent = message;
  if (noteStatusTimer) {
    clearTimeout(noteStatusTimer);
  }
  noteStatusTimer = setTimeout(() => {
    noteEls.status.textContent = "";
  }, NOTE_STATUS_TIMEOUT);
}

function updateFilters(patch) {
  state.filters = { ...state.filters, ...patch };
  applyFilters();
}

function resetFilters() {
  state.filters = {
    query: "",
    difficulty: "all",
    topic: "all",
    personalize: false,
  };
  if (filterEls.search) filterEls.search.value = "";
  if (filterEls.difficulty) filterEls.difficulty.value = "all";
  if (filterEls.topic) filterEls.topic.value = "all";
  updatePersonalizeButton();
  applyFilters();
}

function togglePersonalize() {
  state.filters.personalize = !state.filters.personalize;
  updatePersonalizeButton();
  applyFilters();
}

function updatePersonalizeButton() {
  if (!filterEls.personalize) return;
  filterEls.personalize.dataset.active = state.filters.personalize ? "true" : "false";
}

function bindModal() {
  if (!modal) return;
  modalClosers.forEach((btn) => {
    btn.addEventListener("click", closeModal);
  });
  modal.addEventListener("click", (event) => {
    if (event.target?.dataset?.role === "modal-close") {
      closeModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal?.dataset?.open === "true") {
      closeModal();
    }
  });
}

function bindLanguageChange() {
  window.addEventListener("language-changed", () => {
    if (statusState.type) {
      renderStatus(statusState.type, statusState.extra, statusState.timestamp);
    }
    renderProgress();
    renderLessons();
    updatePagination();
    if (modalState.entry && modal?.dataset?.open === "true") {
      renderModal(modalState.entry, modalState.mode);
    }
  });
}

async function fetchLessons() {
  state.loading = true;
  renderStatus("loading");
  try {
    const payload = await loadDailyData();
    const lessons = normalizeLessons(payload);
    state.lessons = lessons;
    state.generatedAt = payload?.generatedAt || payload?.updatedAt || null;
    state.page = 0;
    populateTopicOptions(lessons);
    if (!lessons.length) {
      state.filtered = [];
      renderEmptyList();
      togglePagination(false);
      renderStatus("empty");
      updateRecommendations();
    } else {
      state.filtered = lessons.slice();
      applyFilters({ silent: true });
      renderStatus("success", state.filtered.length, state.generatedAt);
    }
  } catch (error) {
    console.error("Failed to load academy lessons", error);
    renderStatus("error", error);
  } finally {
    state.loading = false;
  }
}

function renderStatus(type, extra, timestamp) {
  if (!statusEl) return;
  statusState.type = type;
  statusState.extra = extra;
  statusState.timestamp = timestamp || null;
  if (type === "loading") {
    statusEl.textContent = t("academy_loading", "Loading today's lessons...");
    return;
  }
  if (type === "empty") {
    statusEl.textContent = t("academy_list_empty", "No lessons available yet. Please check back soon.");
    return;
  }
  if (type === "error") {
    const message = extra instanceof Error ? extra.message : t("academy_error_generic", "Failed to load lessons. Please try again later.");
    statusEl.textContent = `${t("academy_error_prefix", "Failed to load:")} ${message}`;
    return;
  }
  if (type === "success") {
    statusEl.textContent = "";
  }
}

function renderEmptyList() {
  dailyRoot.innerHTML = `<p class="academy-status">${t("academy_list_empty", "No lessons available yet. Please check back soon.")}</p>`;
}

function changePage(step) {
  const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
  state.page = Math.min(Math.max(0, state.page + step), totalPages - 1);
  renderLessons();
  updatePagination();
}

function renderLessons() {
  if (!dailyRoot) return;
  dailyRoot.replaceChildren();
  const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
  state.page = Math.min(state.page, totalPages - 1);
  const start = state.page * state.pageSize;
  const items = state.filtered.slice(start, start + state.pageSize);
  if (!items.length) {
    renderEmptyList();
    togglePagination(false);
    return;
  }
  const fragment = document.createDocumentFragment();
  const totalCount = state.filtered.length;
  items.forEach((entry, index) => {
    fragment.appendChild(renderLessonCard(entry, start + index, totalCount));
  });
  dailyRoot.appendChild(fragment);
  togglePagination(true);
  restoreAccordionState();
}

function renderLessonCard(entry, absoluteIndex, totalCount) {
  const item = document.createElement("li");
  item.className = "curriculum-item";
  item.dataset.lessonId = entry.id;
  item.dataset.open = "false";

  const header = document.createElement("button");
  header.type = "button";
  header.className = "curriculum-head";
  header.setAttribute("aria-expanded", "false");

  const info = document.createElement("div");
  info.className = "curriculum-head__info";
  const unit = document.createElement("p");
  unit.className = "curriculum-unit";
  unit.textContent = formatUnitLabel(absoluteIndex, totalCount, entry);
  const title = document.createElement("h3");
  title.textContent = pickLang(entry.title) || t("academy_default_title", "Untitled lesson");
  info.append(unit, title);

  const meta = document.createElement("div");
  meta.className = "curriculum-head__meta";
  if (entry.difficulty) meta.appendChild(createPill(formatDifficulty(entry.difficulty)));
  if (progressState.completed[entry.id]) {
    meta.appendChild(createPill(t("academy_status_completed", "已完成"), true));
  }

  const chevron = document.createElement("span");
  chevron.className = "curriculum-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  meta.appendChild(chevron);

  header.append(info, meta);

  const body = document.createElement("div");
  body.className = "curriculum-body";
  body.hidden = true;

  const summary = document.createElement("p");
  summary.className = "curriculum-summary";
  summary.textContent = pickLang(entry.summary) || pickLang(entry.subtitle) || t("academy_default_summary", "Lesson summary coming soon.");
  body.appendChild(summary);

  const highlights = renderLessonHighlights(entry);
  if (highlights) body.appendChild(highlights);

  const coverage = renderLessonTags(entry);
  if (coverage) body.appendChild(coverage);

  const metrics = renderLessonMetrics(entry);
  if (metrics) body.appendChild(metrics);

  const resources = document.createElement("div");
  resources.className = "curriculum-resources";
  const referencesEl = renderReferences(entry);
  if (referencesEl) resources.appendChild(referencesEl);
  if (resources.children.length) body.appendChild(resources);

  const actions = document.createElement("div");
  actions.className = "curriculum-actions";
  actions.appendChild(createButton(
    "academy_detail_cta",
    "开始学习",
    () => openModal("detail", entry),
    true
  ));
  if (Array.isArray(entry.practice) && entry.practice.length) {
    actions.appendChild(createButton(
      "academy_practice_cta",
      "开始答题",
      () => openModal("practice", entry)
    ));
  }
  body.appendChild(actions);

  item.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest(".curriculum-head")) return;
    toggleCurriculumItem(item);
  });

  item.append(header, body);
  return item;
}

function restoreAccordionState() {
  if (!dailyRoot) return;
  collapseCurrentAccordion();
  if (!expandedLessonId) return;
  const safeId = typeof expandedLessonId === "string" && window.CSS?.escape
    ? CSS.escape(expandedLessonId)
    : expandedLessonId;
  if (!safeId) return;
  const target = dailyRoot.querySelector(`[data-lesson-id="${safeId}"]`);
  if (target) {
    openCurriculumItem(target);
  }
}

function collapseCurrentAccordion() {
  if (!dailyRoot) return;
  const openItems = dailyRoot.querySelectorAll('.curriculum-item[data-open="true"]');
  openItems.forEach((node) => collapseCurriculumItem(node));
}

function toggleCurriculumItem(item) {
  if (!item) return;
  if (item.dataset.open === "true") {
    collapseCurriculumItem(item);
    expandedLessonId = null;
  } else {
    collapseCurrentAccordion();
    openCurriculumItem(item);
  }
}

function openCurriculumItem(item) {
  if (!item) return;
  const body = item.querySelector(".curriculum-body");
  const header = item.querySelector(".curriculum-head");
  if (body) body.hidden = false;
  if (header) header.setAttribute("aria-expanded", "true");
  item.dataset.open = "true";
  expandedLessonId = item.dataset.lessonId || null;
}

function collapseCurriculumItem(item) {
  if (!item) return;
  const body = item.querySelector(".curriculum-body");
  const header = item.querySelector(".curriculum-head");
  if (body) body.hidden = true;
  if (header) header.setAttribute("aria-expanded", "false");
  item.dataset.open = "false";
}

function renderLessonHighlights(entry) {
  const items = [];
  if (entry.theme) {
    items.push(`${t("academy_highlight_theme", "Theme")} · ${entry.theme}`);
  }
  if (Array.isArray(entry.tags) && entry.tags.length) {
    items.push(`${t("academy_highlight_tags", "Tags")} · ${entry.tags.slice(0, 3).join(" / ")}`);
  }
  if (Array.isArray(entry.practice) && entry.practice.length) {
    items.push(t("academy_highlight_practice", "Includes {count} exercises", { count: entry.practice.length }));
  }
  if (!items.length) return null;
  const list = document.createElement("ul");
  list.className = "curriculum-highlights";
  items.forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    list.appendChild(li);
  });
  return list;
}

function renderLessonMetrics(entry) {
  const metrics = [];
  const practiceCount = Array.isArray(entry.practice) ? entry.practice.length : 0;
  const referenceCount = Array.isArray(entry.references) ? entry.references.length : 0;

  if (practiceCount) {
    metrics.push(createMetric(
      t("academy_metric_practice", "Practice count"),
      t("academy_metric_practice_value", "{count} problems", { count: practiceCount })
    ));
  }

  if (referenceCount) {
    metrics.push(createMetric(
      t("academy_metric_references", "References"),
      t("academy_metric_references_value", "{count} links", { count: referenceCount })
    ));
  }

  if (entry.date) {
    metrics.push(createMetric(
      t("academy_metric_updated", "Updated"),
      formatDate(entry.date)
    ));
  }

  if (!metrics.length) return null;
  const container = document.createElement("div");
  container.className = "curriculum-metrics";
  metrics.forEach((metric) => container.appendChild(metric));
  return container;
}

function renderLessonTags(entry) {
  if (!Array.isArray(entry.tags) || !entry.tags.length) return null;
  const block = document.createElement("div");
  block.className = "curriculum-tags";
  const label = document.createElement("p");
  label.className = "curriculum-tags__label";
  label.textContent = t("academy_tags_label", "Covered tags");
  block.appendChild(label);
  const list = document.createElement("div");
  list.className = "curriculum-tags__list";
  entry.tags.slice(0, 6).forEach((tag) => {
    if (!tag) return;
    list.appendChild(createPill(tag, true));
  });
  block.appendChild(list);
  return block;
}

function renderModal(entry, mode) {
  if (!modalBody) return;
  modalBody.replaceChildren();

  const lessonTitle = pickLang(entry.title) || t("academy_default_title", "Untitled lesson");
  if (modalTitle) {
    modalTitle.textContent = t("academy_modal_details_heading", "Details: {title}", { title: lessonTitle });
  }

  if (mode === "detail") {
    const audioBlock = renderAudio(entry);
    if (audioBlock) {
      audioBlock.classList.add("academy-modal-audio");
      modalBody.appendChild(audioBlock);
    }

    const subtitle = document.createElement("p");
    subtitle.className = "academy-status";
    subtitle.textContent = pickLang(entry.summary) || pickLang(entry.subtitle) || "";
    modalBody.appendChild(subtitle);

    const content = document.createElement("div");
    content.className = "academy-modal__content";
    const html = pickLang(entry.content);
    if (html) {
      content.innerHTML = html;
      enhanceCodeBlocks(content);
    } else {
      const fallback = document.createElement("p");
      fallback.textContent = t("academy_detail_placeholder", "Full lesson content is still being prepared.");
      content.appendChild(fallback);
    }
    modalBody.appendChild(content);
  }

  if (mode === "practice") {
    const intro = document.createElement("p");
    intro.className = "academy-status";
    intro.textContent = t("academy_practice_intro", "Answer the questions below for instant feedback.");
    modalBody.appendChild(intro);
  }

  if (mode === "practice" && Array.isArray(entry.practice) && entry.practice.length) {
    modalBody.appendChild(renderPractice(entry));
  }

  refreshMath(modalBody);
}

function enhanceCodeBlocks(container) {
  const blocks = container.querySelectorAll("pre code");
  if (!blocks.length) return;
  blocks.forEach((codeEl) => {
    const source = codeEl.textContent || "";
    const pre = codeEl.parentElement;
    if (!pre) return;

    const wrapper = document.createElement("div");
    wrapper.className = "code-runner";

    const toolbar = document.createElement("div");
    toolbar.className = "code-runner__toolbar";
    const runBtn = document.createElement("button");
    runBtn.type = "button";
    runBtn.className = "code-runner__btn";
    runBtn.textContent = t("academy_runner_run", "运行代码");
    const label = document.createElement("span");
    label.textContent = t("academy_runner_label", "Python code");
    const colabBtn = document.createElement("a");
    colabBtn.className = "code-runner__btn code-runner__btn--ghost";
    colabBtn.target = "_blank";
    colabBtn.rel = "noreferrer";
    colabBtn.textContent = t("academy_runner_colab", "在 Colab 打开");
    colabBtn.href = buildColabLink(source);
    const { blocked } = resolvePackages(source);
    if (blocked) {
      runBtn.disabled = true;
      runBtn.title = t(
        "academy_runner_blocked",
        "当前浏览器运行时未包含 {module}，请改用简化示例或在本地/Colab 运行。",
        { module: blocked }
      );
      toolbar.append(runBtn, colabBtn, label);
    } else {
      colabBtn.hidden = true;
      toolbar.append(runBtn, label);
    }

    const codeBlock = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = source;
    codeBlock.appendChild(code);

    const output = document.createElement("pre");
    output.className = "code-runner__output";
    output.textContent = t("academy_runner_output_placeholder", "输出将在此显示");

    wrapper.append(toolbar, codeBlock, output);
    pre.replaceWith(wrapper);

    runBtn.addEventListener("click", () => runPythonSnippet(source, output, runBtn));
  });
}

async function ensurePyodide() {
  if (pyodideReady) return pyodideReady;
  pyodideReady = new Promise((resolve, reject) => {
    if (window.loadPyodide) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = PYODIDE_CDN;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Pyodide script failed to load"));
    document.head.appendChild(script);
  }).then(() => window.loadPyodide({ indexURL: PYODIDE_INDEX_URL }));
  return pyodideReady;
}

async function runPythonSnippet(code, outputEl, btn) {
  if (!outputEl) return;
  const safeBtn = btn || null;
  if (safeBtn) safeBtn.disabled = true;
  outputEl.dataset.state = "running";
  outputEl.textContent = t("academy_runner_loading", "正在加载 Python 运行时...");
  try {
    const { blocked, toLoad } = resolvePackages(code);
    if (blocked) {
      outputEl.textContent = t(
        "academy_runner_blocked",
        "当前浏览器运行时未包含 {module}，请改用简化示例或在本地/Colab 运行。",
        { module: blocked }
      );
      return;
    }
    const pyodide = await ensurePyodide();
    if (toLoad.length) {
      outputEl.textContent = t("academy_runner_loading_pkgs", "正在加载依赖包：{list}", { list: toLoad.join(", ") });
      for (const pkg of toLoad) {
        try {
          await pyodide.loadPackage(pkg);
          loadedPackages.add(pkg);
        } catch (err) {
          outputEl.textContent = `${t("academy_runner_pkg_failed", "加载依赖失败")}: ${pkg}`;
          throw err;
        }
      }
      outputEl.textContent = t("academy_runner_loaded", "依赖已加载，开始运行代码...");
    }
    const prelude = buildPrelude(code);
    let stdout = "";
    let stderr = "";
    const appendOut = (chunk) => { stdout += chunk; };
    const appendErr = (chunk) => { stderr += chunk; };
    const prevStdout = pyodide.setStdout({ batched: appendOut });
    const prevStderr = pyodide.setStderr({ batched: appendErr });
    try {
      await pyodide.runPythonAsync(prelude + code);
    } finally {
      pyodide.setStdout(prevStdout);
      pyodide.setStderr(prevStderr);
    }
    const hasOut = stdout.trim().length > 0;
    const hasErr = stderr.trim().length > 0;
    if (hasOut && hasErr) {
      outputEl.textContent = `stdout:\n${stdout}\n\nstderr:\n${stderr}`;
    } else if (hasErr) {
      outputEl.textContent = `stderr:\n${stderr}`;
    } else if (hasOut) {
      outputEl.textContent = stdout;
    } else {
      outputEl.textContent = t("academy_runner_no_output", "代码已运行，无输出");
    }
  } catch (error) {
    const hint = deriveErrorHint(error);
    outputEl.textContent = `${t("academy_runner_failed", "运行失败")}: ${error.message || error}${hint ? `\n${hint}` : ""}`;
  } finally {
    outputEl.dataset.state = "idle";
    if (safeBtn) safeBtn.disabled = false;
  }
}

function deriveErrorHint(error) {
  if (!error) return "";
  const msg = String(error.message || error || "");
  if (/NameError: name '(.+)' is not defined/.test(msg)) {
    return t(
      "academy_runner_hint_data",
      "提示：请在代码中提供示例数据，或将该示例改为使用内置随机/示例数据以便在浏览器运行。"
    );
  }
  if (/ModuleNotFoundError: No module named '(.+)'/.test(msg)) {
    return t(
      "academy_runner_hint_pkg",
      "提示：该依赖未包含在浏览器运行时，如需运行请改用简化示例或在本地/Colab。"
    );
  }
  return "";
}

function findUnsupportedModule(code = "") {
  const lines = String(code).split(/\n+/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("import") && !trimmed.startsWith("from")) continue;
    const match = trimmed.match(/^(?:from|import)\s+([\w\.]+)/);
    const mod = match && match[1] ? match[1].split(".")[0] : null;
    if (!mod) continue;
    if (UNSUPPORTED_MODULES.some((regex) => regex.test(mod))) {
      return mod;
    }
  }
  return null;
}

function resolvePackages(code = "") {
  const toLoad = [];
  const blocked = findUnsupportedModule(code);
  if (blocked) return { blocked, toLoad };

  const imports = extractImports(code);
  imports.forEach((mod) => {
    const base = mod.split(".")[0];
    const mapped = PYODIDE_PACKAGES[mod] || PYODIDE_PACKAGES[base];
    if (mapped && !loadedPackages.has(mapped)) {
      toLoad.push(mapped);
    }
  });

  return { blocked: null, toLoad: Array.from(new Set(toLoad)) };
}

function buildPrelude(code = "") {
  const lines = [];
  if (code.includes("normal_data") && !/normal_data\s*=/.test(code)) {
    lines.push("import numpy as np");
    lines.push("np.random.seed(0)");
    lines.push("normal_data = np.random.rand(200, 41)");
    lines.push("X_test = np.random.rand(30, 41)");
  }
  return lines.length ? lines.join("\n") + "\n" : "";
}

function buildColabLink(code = "") {
  const blob = new Blob([code], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  // Colab cannot open blob URL directly; fallback to generic entry
  // Encourage copy; this button is mainly a hint/CTA.
  return "https://colab.research.google.com/";
}

function extractImports(code = "") {
  const results = [];
  const lines = String(code).split(/\n+/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("import ")) {
      // import a, b as c
      const rest = line.replace(/^import\s+/, "");
      rest.split(",").forEach((segment) => {
        const name = segment.trim().split(/\s+as\s+/i)[0];
        if (name) results.push(name);
      });
    } else if (line.startsWith("from ")) {
      const match = line.match(/^from\s+([\w\.]+)/);
      if (match && match[1]) results.push(match[1]);
    }
  }
  return results;
}

function createMetric(label, value) {
  const block = document.createElement("div");
  block.className = "curriculum-metric";
  const span = document.createElement("span");
  span.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = value;
  block.append(span, strong);
  return block;
}

function createPill(text, ghost = false) {
  const pill = document.createElement("span");
  pill.className = ghost ? "curriculum-pill curriculum-pill--ghost" : "curriculum-pill";
  pill.textContent = text;
  return pill;
}

function formatUnitLabel(position, totalCount, entry) {
  const total = Number(totalCount) || 0;
  const index = Number(position) || 0;
  const unit = total > 0 ? total - index : index + 1;
  const unitLabel = t("academy_unit_label", "第 {unit} 单元", { unit });
  const dateLabel = formatDate(entry.date);
  return `${unitLabel} · ${dateLabel}`;
}

function createButton(key, fallback, handler, primary = false) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = primary ? "academy-btn academy-btn--primary" : "academy-btn";
  btn.textContent = t(key, fallback);
  btn.addEventListener("click", handler);
  return btn;
}

function renderAudio(entry) {
  const audioUrl = pickAudio(entry.audio);
  if (!audioUrl) return null;
  const wrapper = document.createElement("div");
  wrapper.className = "academy-audio";
  wrapper.hidden = true;
  const label = document.createElement("p");
  label.className = "academy-status";
  label.textContent = t("academy_audio_instructions", "可在下方播放音频讲解");
  const audio = document.createElement("audio");
  audio.controls = true;
  audio.preload = "metadata";
  audio.src = audioUrl;
  audio.setAttribute("aria-label", t("academy_audio_label", "播放音频"));
  audio.addEventListener("loadeddata", () => {
    wrapper.hidden = false;
  });
  audio.addEventListener("error", () => {
    wrapper.remove();
  });
  wrapper.append(label, audio);
  return wrapper;
}

function toggleAudio(container) {
  const audio = container.querySelector("audio");
  if (!audio) return;
  if (audio.paused) {
    audio.play().catch((error) => console.warn("Audio playback failed", error));
  } else {
    audio.pause();
  }
}

function renderReferences(entry) {
  if (!Array.isArray(entry.references) || !entry.references.length) return null;
  const wrapper = document.createElement("div");
  wrapper.className = "academy-references";
  const label = document.createElement("p");
  label.className = "academy-status";
  label.textContent = t("academy_reference_label", "参考资料");
  wrapper.appendChild(label);
  const list = document.createElement("div");
  list.className = "academy-links";
  entry.references.slice(0, 6).forEach((ref) => {
    if (!ref || !ref.url) return;
    const link = document.createElement("a");
    link.href = ref.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.className = "academy-btn";
    link.textContent = pickLang(ref.label) || ref.url;
    list.appendChild(link);
  });
  wrapper.appendChild(list);
  return wrapper;
}

function updatePagination() {
  const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
  const current = Math.min(state.page + 1, totalPages);
  if (prevBtn) prevBtn.disabled = current <= 1;
  if (nextBtn) nextBtn.disabled = current >= totalPages;
  updatePaginationLabels(current, totalPages);
}

function togglePagination(show) {
  if (!paginationHost) return;
  paginationHost.hidden = !show;
}

function updatePaginationLabels(current, total) {
  if (pageLabels.zh) pageLabels.zh.textContent = `第 ${current}/${total} 页`;
  if (pageLabels.en) pageLabels.en.textContent = `Page ${current} of ${total}`;
  if (pageLabels.es) pageLabels.es.textContent = `Página ${current} de ${total}`;
}

function populateTopicOptions(lessons) {
  if (!filterEls.topic) return;
  const tags = new Set();
  lessons.forEach((lesson) => {
    lesson.tags.forEach((tag) => tags.add(tag));
  });
  const options = ["all", ...Array.from(tags).sort((a, b) => a.localeCompare(b))];
  filterEls.topic.replaceChildren();
  options.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value === "all" ? t("academy_filter_topic_all", "全部标签") : value;
    filterEls.topic.appendChild(option);
  });
}

function applyFilters({ silent = false } = {}) {
  const { query, difficulty, topic, personalize } = state.filters;
  const normalizedQuery = (query || "").trim().toLowerCase();
  const selectedTopic = topic && topic !== "all" ? topic.toLowerCase() : null;
  state.filtered = state.lessons.filter((lesson) => {
    if (difficulty !== "all" && lesson.difficulty !== difficulty) return false;
    if (selectedTopic && !lesson.tags.some((tag) => tag.toLowerCase() === selectedTopic)) return false;
    if (normalizedQuery) {
      const haystack = [
        pickLang(lesson.title),
        pickLang(lesson.summary),
        pickLang(lesson.subtitle),
        lesson.tags.join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(normalizedQuery)) return false;
    }
    return true;
  });

  sortLessonsForPersonalization(state.filtered);

  state.page = 0;
  if (!state.filtered.length) {
    renderEmptyList();
    togglePagination(false);
  } else {
    renderLessons();
    updatePagination();
  }
  if (!silent) {
    renderStatus("success", state.filtered.length, state.generatedAt);
  }
  updateRecommendations();
}

function updateRecommendations() {
  if (!recommendationHost) return;
  recommendationHost.replaceChildren();
  if (!state.filtered.length) {
    const empty = document.createElement("div");
    empty.className = "recommendation-card";
    empty.textContent = t("academy_reco_empty", "暂无推荐，调整筛选试试。");
    recommendationHost.appendChild(empty);
    return;
  }
  const shortlist = state.filtered.slice(0, 3);
  shortlist.forEach((lesson) => {
    const card = document.createElement("div");
    card.className = "recommendation-card";
    const title = document.createElement("strong");
    title.textContent = pickLang(lesson.title) || lesson.id;
    const meta = document.createElement("span");
    const status = progressState.completed[lesson.id]
      ? t("academy_reco_done", "已完成")
      : formatDifficulty(lesson.difficulty);
    meta.textContent = `${formatDate(lesson.date)} · ${status}`;
    card.append(title, meta);
    recommendationHost.appendChild(card);
  });
}

function openModal(mode, entry) {
  if (!modal || !modalBody) return;
  modalState.entry = entry;
  modalState.mode = mode;
  modal.dataset.open = "true";
  modal.setAttribute("aria-hidden", "false");
  renderModal(entry, mode);
}

function closeModal() {
  if (!modal) return;
  modal.dataset.open = "false";
  modal.setAttribute("aria-hidden", "true");
  modalState.entry = null;
}

function renderPractice(entry) {
  const container = document.createElement("section");
  container.className = "academy-practice";
  const heading = document.createElement("h4");
  heading.textContent = t("academy_practice_title", "Start quiz");
  container.appendChild(heading);

  const form = document.createElement("form");
  form.dataset.practiceForm = "true";
  form.className = "academy-practice__form";
  form.addEventListener("submit", (event) => handlePracticeSubmit(event, entry));

  entry.practice.forEach((question, index) => {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "academy-practice__item";

    const legend = document.createElement("legend");
    legend.textContent = t("academy_practice_problem_label", "Question {index}", { index: index + 1 });
    fieldset.appendChild(legend);

    const prompt = document.createElement("p");
    prompt.className = "academy-practice__prompt";
    prompt.textContent = pickLang(question.question) || t("academy_practice_question", "Practice question");
    fieldset.appendChild(prompt);

    const name = `q-${index}`;
    if (question.type === "multi" && Array.isArray(question.options)) {
      question.options.forEach((option, optIndex) => {
        const label = document.createElement("label");
        label.className = "academy-practice__option";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.name = name;
        input.value = String(optIndex);
        label.appendChild(input);
        label.appendChild(document.createTextNode(option));
        fieldset.appendChild(label);
      });
    } else if (Array.isArray(question.options)) {
      question.options.forEach((option, optIndex) => {
        const label = document.createElement("label");
        label.className = "academy-practice__option";
        const input = document.createElement("input");
        input.type = "radio";
        input.name = name;
        input.value = String(optIndex);
        label.appendChild(input);
        label.appendChild(document.createTextNode(option));
        fieldset.appendChild(label);
      });
    } else {
      const input = document.createElement("input");
      input.type = "text";
      input.name = name;
      input.placeholder = t("academy_practice_input_placeholder", "Enter your answer");
      fieldset.appendChild(input);
    }

    const feedback = document.createElement("p");
    feedback.className = "academy-practice__feedback";
    feedback.dataset.feedbackFor = name;
    feedback.hidden = true;
    fieldset.appendChild(feedback);

    form.appendChild(fieldset);
  });

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "academy-btn academy-btn--primary";
  submit.textContent = t("academy_practice_submit", "Submit answers");
  form.appendChild(submit);

  const note = document.createElement("p");
  note.className = "academy-status";
  note.dataset.role = "practice-summary";
  note.textContent = "";
  container.append(form, note);
  refreshMath(container);
  return container;
}

function handlePracticeSubmit(event, entry) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;
  const summary = form.parentElement?.querySelector('[data-role="practice-summary"]');
  const note = summary instanceof HTMLElement ? summary : null;
  const formData = new FormData(form);
  const result = gradePractice(entry.practice, formData);
  updatePracticeFeedback(form, result);
  if (note) {
    const score = Math.round((result.correct / result.total) * 100);
    if (result.isPass) {
      note.textContent = t("academy_practice_correct", "Great job—you nailed every question!");
      markLessonCompleted(entry, result.correct);
    } else {
      note.textContent = t("academy_practice_incorrect", "Not quite. Review the hints and try again.");
    }
    note.dataset.score = String(score);
  }
}

function updatePracticeFeedback(form, results) {
  results.detail.forEach((item) => {
    const feedback = form.querySelector(`[data-feedback-for="${item.name}"]`);
    if (!feedback) return;
    feedback.hidden = false;
    feedback.textContent = item.correct
      ? t("academy_practice_feedback_correct", "Correct")
      : `${t("academy_practice_feedback_incorrect", "Correct answer:")} ${item.answerText}`;
  });
}

function gradePractice(questions, formData) {
  const detail = [];
  let correct = 0;
  questions.forEach((question, index) => {
    const name = `q-${index}`;
    const correctAnswer = question.answer;
    let isCorrect = false;
    let answerText = formatAnswer(question);
    if (question.type === "multi") {
      const values = formData.getAll(name).map(Number).sort();
      const expected = Array.isArray(correctAnswer)
        ? correctAnswer.map(Number).sort()
        : [];
      isCorrect = values.length === expected.length && values.every((val, idx) => val === expected[idx]);
    } else if (Array.isArray(question.options)) {
      const raw = formData.get(name);
      if (raw === null) {
        isCorrect = false;
      } else {
        const value = Number(raw);
        isCorrect = !Number.isNaN(value) && Number(correctAnswer) === value;
      }
    } else {
      const raw = formData.get(name);
      const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
      if (typeof correctAnswer === "string") {
        isCorrect = value === correctAnswer.trim().toLowerCase();
      }
    }
    if (isCorrect) correct += 1;
    detail.push({ name, correct: isCorrect, answerText });
  });
  const total = questions.length || 1;
  return { detail, correct, total, isPass: correct / total >= MIN_PASS_RATE };
}

function formatAnswer(question) {
  if (Array.isArray(question.options)) {
    if (Array.isArray(question.answer)) {
      return question.answer.map((idx) => question.options[idx]).filter(Boolean).join(", ");
    }
    return question.options[question.answer] ?? "";
  }
  return typeof question.answer === "string" ? question.answer : "";
}

function markLessonCompleted(entry, correctCount) {
  if (!entry?.id) return;
  if (!progressState.completed[entry.id]) {
    progressState.completed[entry.id] = {
      completedAt: Date.now(),
      lessonDate: entry.date || null,
      correct: correctCount,
      completedOn: currentDateString(),
    };
    progressState.xp += XP_PER_LESSON;
    updateStreak();
    syncBadges();
    saveProgress();
    renderProgress();
    sortLessonsForPersonalization(state.filtered);
    renderLessons();
    updatePagination();
  }
}

function sortLessonsForPersonalization(list) {
  if (!state.filters.personalize || !Array.isArray(list) || !list.length) return list;
  if (!Object.keys(progressState.completed).length) return list;
  list.sort((a, b) => {
    const aCompleted = Boolean(progressState.completed[a.id]);
    const bCompleted = Boolean(progressState.completed[b.id]);
    if (aCompleted === bCompleted) return 0;
    return aCompleted ? 1 : -1;
  });
  return list;
}

function updateStreak() {
  const today = currentDateString();
  const last = progressState.lastCompletedDate;
  if (!last) {
    progressState.streak = 1;
  } else {
    const diff = dayDiff(last, today);
    if (diff === 0) {
      // same day, keep streak
    } else if (diff === 1) {
      progressState.streak += 1;
    } else {
      progressState.streak = 1;
    }
  }
  progressState.lastCompletedDate = today;
}

function renderProgress() {
  const completedCount = Object.keys(progressState.completed).length;
  if (progressEls.completed) progressEls.completed.textContent = completedCount;
  if (progressEls.streak) progressEls.streak.textContent = progressState.streak || 0;
  if (progressEls.xp) progressEls.xp.textContent = progressState.xp || 0;
  renderBadges();
  renderHeatmap();
}

function renderBadges() {
  const host = progressEls.badges;
  if (!host) return;
  host.replaceChildren();
  const badges = getBadgeDisplay();
  const earned = badges.filter((badge) => badge.earned);
  const list = earned.length ? badges : badges.slice(0, 1);
  list.forEach((badge) => {
    const item = document.createElement("div");
    item.className = "academy-badge-item";
    item.textContent = `${badge.label} · ${badge.description}`;
    if (!badge.earned) {
      item.style.opacity = "0.65";
    }
    host.appendChild(item);
  });
}

function renderHeatmap() {
  const host = progressEls.heatmap;
  if (!host) return;
  host.replaceChildren();
  const days = collectHeatmapData();
  const grid = document.createElement("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(7, minmax(0, 1fr))";
  grid.style.gap = "6px";
  days.forEach((day) => {
    const cell = document.createElement("span");
    cell.style.display = "block";
    cell.style.borderRadius = "8px";
    cell.style.paddingTop = "100%";
    cell.style.position = "relative";
    cell.style.background = `rgba(79, 70, 229, ${day.score})`;
    cell.title = `${day.date} · ${day.count ? t("academy_heatmap_done", "已完成") : t("academy_heatmap_empty", "无学习记录")}`;
    grid.appendChild(cell);
  });
  host.appendChild(grid);
}

function refreshMath(target) {
  if (typeof window.renderMathInElement !== "function") return;
  const root = target || document.body;
  try {
    window.renderMathInElement(root, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\(", right: "\\)", display: false },
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
    });
  } catch (error) {
    console.warn("Math rendering failed", error);
  }
}

function collectHeatmapData() {
  const map = {};
  Object.values(progressState.completed).forEach((record) => {
    const date = record.completedOn || currentDateString(record.completedAt);
    map[date] = (map[date] || 0) + 1;
  });
  const days = [];
  for (let i = 27; i >= 0; i -= 1) {
    const date = dateOffsetString(-i);
    const count = map[date] || 0;
    days.push({
      date,
      count,
      score: count ? 0.45 + Math.min(0.4, count * 0.1) : 0.12,
    });
  }
  return days;
}

function getBadgeDisplay() {
  const stats = {
    completed: Object.keys(progressState.completed).length,
    streak: progressState.streak || 0,
    xp: progressState.xp || 0,
  };
  const definitions = [
    {
      id: "starter",
      label: t("academy_badge_starter", "连续学习起步"),
      description: t("academy_badge_starter_desc", "完成首个课程"),
      earned: stats.completed >= 1,
    },
    {
      id: "streak",
      label: t("academy_badge_streak", "稳步前进"),
      description: t("academy_badge_streak_desc", "连续学习 3 天"),
      earned: stats.streak >= 3,
    },
    {
      id: "pro",
      label: t("academy_badge_pro", "高阶进阶"),
      description: t("academy_badge_pro_desc", "累计 150 XP"),
      earned: stats.xp >= 150,
    },
  ];
  return definitions.map((badge) => {
    const stored = progressState.badges?.[badge.id];
    return {
      ...badge,
      earned: Boolean(stored || badge.earned),
    };
  });
}

function syncBadges() {
  if (!progressState.badges) progressState.badges = {};
  getBadgeDisplay().forEach((badge) => {
    if (badge.earned && !progressState.badges[badge.id]) {
      progressState.badges[badge.id] = { earnedAt: Date.now() };
    }
  });
}

function exportProgress() {
  const payload = JSON.stringify(progressState, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `academy-progress-${currentDateString()}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function clearProgress() {
  if (!confirm(t("academy_clear_progress_confirm", "确定要清除本地学习记录吗？"))) return;
  progressState = defaultProgress();
  saveProgress();
  renderProgress();
}

function loadDailyData() {
  return fetchWithCache(DAILY_URL, CACHE_KEY_DAILY);
}

async function fetchWithCache(url, key) {
  try {
    const response = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    setCache(key, data);
    return data;
  } catch (error) {
    const cached = getCache(key);
    if (cached) {
      renderStatus("success", (Array.isArray(cached) ? cached : cached?.lessons)?.length);
      return cached;
    }
    throw error;
  }
}

/**
 * Normalizes upstream JSON into hydrated lesson objects for rendering/filtering.
 */
function normalizeLessons(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.lessons)
      ? payload.lessons
      : [];
  return list
    .map((entry, index) => ({
      id: entry.id || `${entry.date || "lesson"}-${index}`,
      date: entry.date || entry.publishedAt || "",
      title: entry.title || entry.name,
      subtitle: entry.subtitle,
      summary: entry.summary,
      content: entry.content,
      practice: Array.isArray(entry.practice) ? entry.practice : [],
      references: Array.isArray(entry.references) ? entry.references : [],
      tags: Array.isArray(entry.tags) ? entry.tags : [],
      difficulty: entry.difficulty || entry.level || "",
      theme: entry.theme || "",
      audio: entry.audio || null,
    }))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

function pickAudio(audio) {
  if (typeof audio === "string") return audio;
  if (!audio || typeof audio !== "object") return "";
  const order = getLanguageOrder();
  for (const lang of order) {
    if (audio[lang]) return audio[lang];
  }
  return Object.values(audio)[0] || "";
}

function pickLang(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.find(Boolean) || "";
  if (typeof value === "object") {
    const order = getLanguageOrder();
    for (const lang of order) {
      const candidate = value[lang];
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
    const fallback = Object.values(value).find((entry) => typeof entry === "string" && entry.trim());
    if (fallback) return fallback;
  }
  return "";
}

function getLanguageOrder() {
  const docLang = document.documentElement?.lang || "zh";
  const base = docLang.toLowerCase().split("-")[0];
  if (base === "en") return ["en", "zh", "es"];
  if (base === "es") return ["es", "en", "zh"];
  return ["zh", "en", "es"];
}

function formatDifficulty(value) {
  const map = {
    beginner: t("academy_difficulty_beginner", "入门"),
    intermediate: t("academy_difficulty_intermediate", "进阶"),
    advanced: t("academy_difficulty_advanced", "高阶"),
  };
  return map[value] || value || t("academy_difficulty_default", "通用");
}

function formatDate(value) {
  if (!value) return t("academy_date_unknown", "日期待定");
  return value;
}

function formatTimestamp(value) {
  if (!value) return "";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  } catch {
    return value;
  }
}

function t(key, fallback, replacements) {
  const tables = window.translations || {};
  const order = getLanguageOrder();
  for (const lang of order) {
    const group = tables[lang];
    if (group && typeof group[key] === "string") {
      return applyTemplate(group[key], replacements);
    }
  }
  return applyTemplate(fallback || "", replacements);
}

function applyTemplate(template, replacements) {
  if (!template) return "";
  if (!replacements) return template;
  return template.replace(/\{(\w+)\}/g, (match, token) => {
    if (token in replacements) {
      return replacements[token];
    }
    return match;
  });
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return defaultProgress();
    const parsed = JSON.parse(raw);
    return {
      ...defaultProgress(),
      ...parsed,
      completed: parsed.completed || {},
      badges: parsed.badges || {},
    };
  } catch {
    return defaultProgress();
  }
}

function defaultProgress() {
  return {
    completed: {},
    xp: 0,
    streak: 0,
    lastCompletedDate: null,
    badges: {},
  };
}

function saveProgress() {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progressState));
  } catch (error) {
    console.warn("Unable to persist academy progress", error);
  }
}

function getCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== "object") return null;
    if (Date.now() - payload.timestamp > CACHE_TTL) {
      localStorage.removeItem(key);
      return null;
    }
    return payload.data;
  } catch {
    return null;
  }
}

function setCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), data }));
  } catch (error) {
    console.warn("Unable to cache academy data", error);
  }
}

function clearCache(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

function clearProgressCache() {
  clearCache(PROGRESS_KEY);
}

function currentDateString(source) {
  if (!source) {
    return new Date().toISOString().slice(0, 10);
  }
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function dateOffsetString(delta) {
  const date = new Date();
  date.setDate(date.getDate() + delta);
  return date.toISOString().slice(0, 10);
}

function dayDiff(prev, next) {
  const prevDate = new Date(prev);
  const nextDate = new Date(next);
  const ms = nextDate - prevDate;
  return Math.round(ms / (24 * 60 * 60 * 1000));
}
