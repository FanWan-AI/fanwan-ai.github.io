const DAILY_URL = "/data/ai/daily-academy/daily.json";
const CACHE_KEY_DAILY = "academy_daily_v1";
const CACHE_TTL = 1000 * 60 * 60; // 1 hour cache
const PROGRESS_KEY = "academy_progress_v1";
const PAGE_SIZE = 3;
const XP_PER_LESSON = 15;
const MIN_PASS_RATE = 0.6;

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

const modal = document.getElementById("academy-modal");
const modalBody = modal?.querySelector('[data-role="modal-body"]');
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

const state = {
  lessons: [],
  page: 0,
  pageSize: PAGE_SIZE,
  loading: false,
};

const modalState = {
  entry: null,
  mode: "detail",
};

let progressState = loadProgress();

if (dailyRoot) {
  bootstrap();
}

function bootstrap() {
  bindPagination();
  bindProgressActions();
  bindModal();
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

async function fetchLessons() {
  state.loading = true;
  renderStatus("loading");
  try {
    const payload = await loadDailyData();
    const lessons = normalizeLessons(payload);
    state.lessons = lessons;
    state.page = 0;
    if (!lessons.length) {
      renderEmptyList();
      renderStatus("empty");
    } else {
      renderLessons();
      updatePagination();
      renderStatus("success", lessons.length, payload?.generatedAt);
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
  if (type === "loading") {
    statusEl.textContent = t("academy_loading", "正在加载今日课程...");
    return;
  }
  if (type === "empty") {
    statusEl.textContent = t("academy_list_empty", "暂未找到课程，稍后再试。");
    return;
  }
  if (type === "error") {
    const message = extra instanceof Error ? extra.message : t("academy_error_generic", "加载失败，请稍后再试。");
    statusEl.textContent = `${t("academy_error_prefix", "加载失败：")} ${message}`;
    return;
  }
  if (type === "success") {
    const count = Number(extra) || 0;
    const dateText = timestamp ? formatTimestamp(timestamp) : "";
    statusEl.textContent = dateText
      ? t("academy_status_loaded_ts", "已加载 {count} 条课程 · 更新于 {time}", { count, time: dateText })
      : t("academy_status_loaded", "已加载 {count} 条课程", { count });
  }
}

function renderEmptyList() {
  dailyRoot.innerHTML = `<p class="academy-status">${t("academy_list_empty", "暂未找到课程，稍后再试。")}</p>`;
}

function changePage(step) {
  const totalPages = Math.max(1, Math.ceil(state.lessons.length / state.pageSize));
  state.page = Math.min(Math.max(0, state.page + step), totalPages - 1);
  renderLessons();
  updatePagination();
}

function renderLessons() {
  dailyRoot.replaceChildren();
  const totalPages = Math.max(1, Math.ceil(state.lessons.length / state.pageSize));
  state.page = Math.min(state.page, totalPages - 1);
  const start = state.page * state.pageSize;
  const items = state.lessons.slice(start, start + state.pageSize);
  if (!items.length) {
    renderEmptyList();
    togglePagination(false);
    return;
  }
  const fragment = document.createDocumentFragment();
  items.forEach((entry) => {
    fragment.appendChild(renderLessonCard(entry));
  });
  dailyRoot.appendChild(fragment);
  togglePagination(true);
}

function renderLessonCard(entry) {
  const card = document.createElement("article");
  card.className = "academy-track-card";
  card.dataset.lessonId = entry.id;

  const meta = document.createElement("div");
  meta.className = "academy-track-card__meta";
  const dateSpan = document.createElement("span");
  dateSpan.textContent = formatDate(entry.date);
  meta.appendChild(dateSpan);
  if (entry.difficulty) {
    const difficulty = document.createElement("span");
    difficulty.textContent = formatDifficulty(entry.difficulty);
    meta.appendChild(difficulty);
  }

  const title = document.createElement("h3");
  title.className = "academy-track-card__title";
  title.textContent = pickLang(entry.title) || t("academy_default_title", "未命名课程");

  const summary = document.createElement("p");
  summary.className = "academy-track-card__summary";
  summary.textContent = pickLang(entry.summary) || pickLang(entry.subtitle) || t("academy_default_summary", "敬请期待课程摘要。");

  const tagList = document.createElement("div");
  tagList.className = "academy-track-card__tags";
  entry.tags.slice(0, 6).forEach((tag) => {
    const tagEl = document.createElement("span");
    tagEl.className = "academy-tag";
    tagEl.textContent = tag;
    tagList.appendChild(tagEl);
  });
  if (!entry.tags.length && entry.theme) {
    const tagEl = document.createElement("span");
    tagEl.className = "academy-tag";
    tagEl.textContent = entry.theme;
    tagList.appendChild(tagEl);
  }

  const referencesEl = renderReferences(entry);
  const audioEl = renderAudio(entry);

  const controls = document.createElement("div");
  controls.className = "academy-track-card__controls";

  if (audioEl) {
    controls.appendChild(createButton(
      "academy_audio_label",
      "播放音频",
      () => toggleAudio(audioEl)
    ));
  }

  controls.appendChild(createButton(
    "academy_detail_cta",
    "查看详情",
    () => openModal("detail", entry)
  ));

  if (Array.isArray(entry.practice) && entry.practice.length) {
    controls.appendChild(createButton(
      "academy_practice_cta",
      "开始练习",
      () => openModal("practice", entry),
      true
    ));
  }

  card.append(meta, title, summary, tagList);
  if (audioEl) card.appendChild(audioEl);
  if (referencesEl) card.appendChild(referencesEl);
  card.appendChild(controls);
  return card;
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
  const label = document.createElement("p");
  label.className = "academy-status";
  label.textContent = t("academy_audio_instructions", "可在下方播放音频讲解");
  const audio = document.createElement("audio");
  audio.controls = true;
  audio.preload = "none";
  audio.src = audioUrl;
  audio.setAttribute("aria-label", t("academy_audio_label", "播放音频"));
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
  const totalPages = Math.max(1, Math.ceil(state.lessons.length / state.pageSize));
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

function renderModal(entry, mode) {
  if (!modalBody) return;
  modalBody.replaceChildren();
  const title = document.createElement("h3");
  title.textContent = pickLang(entry.title) || t("academy_default_title", "未命名课程");
  const subtitle = document.createElement("p");
  subtitle.className = "academy-status";
  subtitle.textContent = pickLang(entry.summary) || pickLang(entry.subtitle) || "";
  modalBody.append(title, subtitle);

  const content = document.createElement("div");
  content.className = "academy-modal__content";
  const html = pickLang(entry.content);
  if (html) {
    content.innerHTML = html;
  } else {
    const fallback = document.createElement("p");
    fallback.textContent = t("academy_detail_placeholder", "详细内容即将上线。");
    content.appendChild(fallback);
  }
  modalBody.appendChild(content);

  if (mode === "practice" && Array.isArray(entry.practice) && entry.practice.length) {
    modalBody.appendChild(renderPractice(entry));
  }
}

function renderPractice(entry) {
  const container = document.createElement("section");
  container.className = "academy-practice";
  const heading = document.createElement("h4");
  heading.textContent = t("academy_practice_title", "练习");
  container.appendChild(heading);
  const form = document.createElement("form");
  form.dataset.practiceForm = "true";
  form.addEventListener("submit", (event) => handlePracticeSubmit(event, entry));
  entry.practice.forEach((question, index) => {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "academy-practice__item";
    const legend = document.createElement("legend");
    legend.textContent = `${index + 1}. ${pickLang(question.question) || t("academy_practice_question", "练习题")}`;
    fieldset.appendChild(legend);
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
      input.placeholder = t("academy_practice_input_placeholder", "请输入答案");
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
  submit.textContent = t("academy_practice_submit", "提交答案");
  form.appendChild(submit);
  const note = document.createElement("p");
  note.className = "academy-status";
  note.dataset.role = "practice-summary";
  container.append(form, note);
  return container;
}

function handlePracticeSubmit(event, entry) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const results = gradePractice(entry.practice, data);
  updatePracticeFeedback(form, results);
  const summary = form.parentElement?.querySelector('[data-role="practice-summary"]');
  if (summary) {
    summary.textContent = results.isPass
      ? t("academy_practice_correct", "全部答对，太棒了！")
      : t("academy_practice_incorrect", "再试一次，查看提示。");
    summary.textContent += ` ${t("academy_practice_score", "得分：{score}", { score: `${results.correct}/${results.total}` })}`;
  }
  if (results.isPass) {
    markLessonCompleted(entry, results.correct);
  }
}

function updatePracticeFeedback(form, results) {
  results.detail.forEach((item) => {
    const feedback = form.querySelector(`[data-feedback-for="${item.name}"]`);
    if (!feedback) return;
    feedback.hidden = false;
    feedback.textContent = item.correct
      ? t("academy_practice_feedback_correct", "回答正确")
      : `${t("academy_practice_feedback_incorrect", "正确答案：")} ${item.answerText}`;
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
      const value = Number(formData.get(name));
      isCorrect = Number(correctAnswer) === value;
    } else {
      const value = String(formData.get(name) || "").trim().toLowerCase();
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
  }
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
