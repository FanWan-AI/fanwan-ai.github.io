import path from "path";
import process from "process";
import JSON5 from "json5";
import { jsonrepair } from "jsonrepair";
import {
  DAILY,
  DAILY_ARCH,
  SCHEMAS,
  TOPICS,
  backoff,
  hashObject,
  readJSON,
  rollWindowAndArchive,
  sleep,
  slugify,
  today,
  validateWithSchema,
  writeJSON,
  uniqueBy
} from "./util.mjs";
import {
  buildLessonBlueprintPrompt,
  buildLessonDetailPrompt,
  buildLessonCritiquePrompt,
  buildLessonRevisionPrompt,
  buildStarterPrompt,
  PROMPT_VERSION,
  BLUEPRINT_RESPONSE_FORMAT,
  LESSON_RESPONSE_FORMAT,
  CRITIQUE_RESPONSE_FORMAT
} from "./prompts/index.mjs";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");
const maxRetries = dryRun ? 0 : 2;
const HISTORY_LIMIT = 45;
const PRACTICE_TYPES = ["mcq", "multi", "input"];
const DIFFICULTY_VALUES = ["beginner", "intermediate", "advanced"];
const DIFFICULTY_MAP = {
  1: "beginner",
  2: "beginner",
  3: "intermediate",
  4: "advanced",
  5: "advanced"
};

const PLACEHOLDER_HOSTS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "documentation.example.com",
  "docs.example.com",
  "placeholder.com",
  "test.com"
]);

const PLACEHOLDER_SNIPPETS = [
  "example",
  "placeholder",
  "changeme",
  "lorem",
  "dummy",
  "localhost",
  "127.0.0.1",
  "404"
];

async function loadHistory() {
  const fallback = { generatedAt: new Date().toISOString(), lessons: [] };
  const doc = await readJSON(path.resolve(root, DAILY), fallback);
  if (!doc || typeof doc !== "object") {
    return { generatedAt: new Date().toISOString(), lessons: [] };
  }
  const lessons = Array.isArray(doc.lessons) ? doc.lessons : [];
  return { generatedAt: doc.generatedAt || new Date().toISOString(), lessons };
}

function flattenTopics(levels) {
  const items = [];
  for (const level of levels || []) {
    for (const category of level.categories || []) {
      for (const topic of category.topics || []) {
        let baseId = topic.id || slugify(topic.topic || "");
        if (!baseId && Array.isArray(topic.keywords) && topic.keywords.length) {
          baseId = slugify(topic.keywords[0]);
        }
        if (!baseId) {
          baseId = `topic-${hashObject({ level: level.level, category: category.category, topic: topic.topic }).slice(0, 12)}`;
        }
        items.push({
          id: baseId,
          title: topic.topic,
          level: level.level,
          category: category.category,
          difficulty: topic.difficulty ?? category.difficulty ?? 1,
          order: topic.order ?? category.recommended_order ?? 0,
          related: topic.related_topics || [],
          tags: topic.tags || topic.keywords || [],
          keywords: topic.keywords || [],
          learningObjectives: topic.learning_objectives || [],
          personas: topic.personas || [],
          prerequisites: topic.prerequisites || [],
          referenceHints: topic.reference_hints || [],
          tone: topic.tone || {}
        });
      }
    }
  }
  return items;
}

function extractText(value, depth = 0) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object" && depth < 4) {
    for (const nested of Object.values(value)) {
      const resolved = extractText(nested, depth + 1);
      if (resolved) return resolved;
    }
  }
  return "";
}

function buildLearnerProfile(candidate) {
  const personas = Array.isArray(candidate.personas) && candidate.personas.length ? candidate.personas : ["跨职能学习者"];
  const industries = personas.slice(0, 3);
  const prefersEnglish = personas.some((persona) => /global|international|overseas/i.test(persona));
  return {
    summary: `课程面向 ${personas.join("、")}，帮助他们把 ${candidate.title} 应用于 ${candidate.category}`,
    prefersEnglish,
    industries,
    personas,
    pains: `在 ${candidate.category} 场景缺乏 ${candidate.title} 的可执行路径`,
    preferredMetrics: ["time_to_value", "quality_score"],
    maturity: candidate.level
  };
}

function buildToneProfile(candidate) {
  const leadPersona = candidate.personas?.[0] || "Lab mentor";
  return {
    persona: `${leadPersona} 指导者`,
    style: candidate.difficulty >= 3 ? "数据驱动" : "故事化",
    energy: candidate.difficulty >= 3 ? "precise" : "encouraging",
    call_to_action: "引导学习者写下一条可执行行动"
  };
}

function fallbackStarterQuestions(candidate) {
  return [
    {
      lang: "zh",
      question: `如果把 ${candidate.title} 嵌入你当前项目，最先可以试验的环节是什么？`,
      action_hint: "列出一个业务场景，写下需要监控的 2 个指标"
    },
    {
      lang: "en",
      question: `Which workflow in your org would benefit first from ${candidate.title}?`,
      action_hint: "Document one pilot idea plus the metric you'd watch"
    }
  ];
}

function normalizeStarterQuestions(raw, candidate) {
  const collection = Array.isArray(raw)
    ? raw
    : raw?.starter_questions || raw?.items || raw?.questions || [];
  const cleaned = collection
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const lang = typeof entry.lang === "string" && entry.lang.trim() ? entry.lang.trim() : "zh";
      const question = typeof entry.question === "string" ? entry.question.trim() : "";
      const actionHint = typeof entry.action_hint === "string" ? entry.action_hint.trim() : "";
      if (!question) return null;
      return {
        lang,
        question,
        action_hint: actionHint || `写下你会如何把 ${candidate.title} 应用到本周任务`
      };
    })
    .filter(Boolean)
    .slice(0, 3);
  return cleaned.length ? cleaned : fallbackStarterQuestions(candidate);
}

function applyMetaDefaults(lesson, candidate, learnerProfile, toneProfile) {
  lesson.meta = lesson.meta || {};
  lesson.meta.category = lesson.meta.category || candidate.category;
  lesson.meta.level = lesson.meta.level || candidate.level;
  lesson.meta.difficultyScore = lesson.meta.difficultyScore || candidate.difficulty;
  lesson.meta.related = lesson.meta.related || candidate.related;
  lesson.meta.learningObjectives = lesson.meta.learningObjectives || candidate.learningObjectives;
  lesson.meta.personas = lesson.meta.personas || candidate.personas;
  lesson.meta.learner_profile = lesson.meta.learner_profile || learnerProfile;
  lesson.meta.tone_profile = lesson.meta.tone_profile || toneProfile;
  lesson.meta.contextual_notes = normalizeContextualNotes(lesson.meta.contextual_notes, candidate);
  lesson.meta.prompt_version = PROMPT_VERSION;
}

function summarizeHistory(lessons) {
  const latestByTopic = new Map();
  lessons.forEach((lesson) => {
    if (!lesson || !lesson.id) return;
    const key = lesson.id.replace(/^\d{4}-\d{2}-\d{2}-/, "") || lesson.id;
    const existing = latestByTopic.get(key);
    if (!existing || lesson.date > existing) {
      latestByTopic.set(key, lesson.date);
    }
  });
  return latestByTopic;
}

function scoreCandidate(candidate, lessons, summary) {
  const todayStr = today();
  const lastUsed = summary.get(candidate.id);
  const freshness = lastUsed ? Math.max(0.2, 1 - (Date.parse(todayStr) - Date.parse(lastUsed)) / (1000 * 60 * 60 * 24 * 60)) : 1;
  const diversity = lessons.slice(0, 5).some((entry) => entry.meta?.category === candidate.category) ? 0.4 : 1;
  const relatedRecent = lessons.slice(0, 3).flatMap((entry) => entry.meta?.related || []);
  const relation = candidate.related.some((item) => relatedRecent.includes(item)) ? 0.5 : 1;
  const difficultyGap = Math.abs((lessons[0]?.meta?.difficultyScore ?? 2) - candidate.difficulty);
  const difficultyPenalty = difficultyGap > 1 ? 0.7 : 1;
  const cooldownPenalty = lastUsed && daysBetween(todayStr, lastUsed) < 14 ? 0.2 : 1;
  return freshness * 0.35 + diversity * 0.25 + relation * 0.15 + difficultyPenalty * 0.15 + cooldownPenalty * 0.1;
}

function daysBetween(a, b) {
  if (!a || !b) return Infinity;
  return Math.floor((Date.parse(a) - Date.parse(b)) / (1000 * 60 * 60 * 24));
}

function pickCandidate(candidates, lessons) {
  if (!candidates.length) return null;
  const summary = summarizeHistory(lessons);
  const scored = candidates.map((candidate) => ({ candidate, score: scoreCandidate(candidate, lessons, summary) }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0].candidate;
}

function difficultyLabel(candidate) {
  const raw = candidate.difficulty ?? 2;
  return DIFFICULTY_MAP[raw] || "intermediate";
}

async function callLLM({ messages, temperature = 0.35, responseFormat = { type: "json_object" } }) {
  if (!Array.isArray(messages) || !messages.length) {
    throw new Error("LLM messages payload required");
  }
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("Missing LLM_API_KEY / OPENAI_API_KEY / DEEPSEEK_API_KEY");
  }
  const baseURL = process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.LLM_MODEL || process.env.OPENAI_MODEL || process.env.DEEPSEEK_MODEL || "gpt-4.1-mini";

  const request = async (format) => {
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature,
        ...(format ? { response_format: format } : {}),
        messages
      })
    });
    if (!response.ok) {
      const text = await response.text();
      if (format?.type === "json_schema" && /response_format type is unavailable/i.test(text)) {
        const schemaError = new Error("LLM response_format json_schema unsupported");
        schemaError.code = "RESPONSE_FORMAT_UNAVAILABLE";
        throw schemaError;
      }
      throw new Error(`LLM request failed: ${response.status} ${text}`);
    }
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("LLM response missing content");
    }
    return content.trim();
  };

  try {
    return await request(responseFormat);
  } catch (error) {
    if (responseFormat?.type === "json_schema" && error?.code === "RESPONSE_FORMAT_UNAVAILABLE") {
      console.warn("json_schema response_format unsupported, falling back to json_object");
      return await request({ type: "json_object" });
    }
    throw error;
  }
}

function parseJSON(raw) {
  let text = raw.trim();
  if (text.startsWith("```")) {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match) {
      text = match[1];
    }
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    try {
      return JSON5.parse(text);
    } catch (secondaryError) {
      try {
        const repaired = jsonrepair(text);
        return JSON.parse(repaired);
      } catch (repairError) {
        const combined = new Error(`JSON parse failed: ${error.message}`);
        combined.cause = repairError;
        throw combined;
      }
    }
  }
}

function ensureI18n(value, fallback) {
  const baseFallback = extractText(fallback) || "";
  const valueObj = value && typeof value === "object" ? value : {};
  const result = {};
  for (const key of ["zh", "en", "es"]) {
    const raw = valueObj[key] ?? (typeof value === "string" ? value : undefined);
    const resolved = extractText(raw);
    if (resolved) {
      result[key] = resolved;
    }
  }
  if (!result.zh) {
    result.zh = result.en || result.es || baseFallback;
  }
  if (!result.en) {
    result.en = result.zh;
  }
  if (result.es && !result.es.trim()) {
    delete result.es;
  }
  if (!Object.keys(result).length) {
    result.zh = baseFallback;
  }
  return result;
}

function normalizeOptions(entry) {
  if (!Array.isArray(entry.options)) return [];
  return entry.options.map((option) => (typeof option === "string" ? option.trim() : "")).filter(Boolean).slice(0, 6);
}

function mapAnswer(entry, options) {
  if (entry.type === "input") {
    if (typeof entry.answer === "string") return entry.answer.trim().toLowerCase();
    return String(entry.answer ?? "").trim().toLowerCase();
  }
  if (entry.type === "multi") {
    if (Array.isArray(entry.answer)) {
      return entry.answer.map((idx) => Number(idx)).filter((idx) => Number.isInteger(idx) && idx < options.length);
    }
    if (typeof entry.answer === "string") {
      const parts = entry.answer.split(/[,，]/).map((part) => part.trim()).filter(Boolean);
      return parts
        .map((label) => options.findIndex((opt) => opt.toLowerCase() === label.toLowerCase()))
        .filter((idx) => idx >= 0);
    }
  }
  const value = Number(entry.answer);
  if (Number.isInteger(value) && value < options.length) {
    return value;
  }
  if (typeof entry.answer === "string") {
    const idx = options.findIndex((opt) => opt.toLowerCase() === entry.answer.toLowerCase());
    return idx >= 0 ? idx : 0;
  }
  return 0;
}

function buildPracticeFallbacks(candidate) {
  const topic = candidate.title || "本课题";
  const category = candidate.category || "学习诊断";
  const metricPrimary = candidate.learningObjectives?.[0] || "time_to_value";
  const metricSecondary = candidate.learningObjectives?.[1] || "quality_score";
  return [
    {
      type: "mcq",
      question: {
        zh: `在规划 ${topic} 的画像诊断路线时，哪一组顺序最能兼顾 ${metricPrimary} 与 ${metricSecondary}？`,
        en: `Which sequence best balances ${metricPrimary} and ${metricSecondary} when rolling out ${topic}?`
      },
      options: [
        "界定学习者画像 → 量化指标 → 建立反馈循环",
        "直接套用工具 → 宣布 KPI → 事后补充画像",
        "先定终局 KPI → 跳过诊断 → 复盘中再补救",
        "集中制作材料 → 开始训练 → 最后再量化"
      ],
      answer: 0,
      explain: {
        zh: "正确流程是先画像再量化并设计反馈回路，保证指标与真实痛点对齐。",
        en: "Start with profiling, then quantify targets, then design the feedback loop so metrics track real gaps."
      }
    },
    {
      type: "multi",
      question: {
        zh: `以下多步冲刺任务中，哪些动作能在一周内搭建 ${category} 的成长飞轮？请选择全部正确选项。`,
        en: `Which multi-step actions establish a growth flywheel for ${category} within one sprint? Select all that apply.`
      },
      options: [
        "① 汇总 Persona 痛点 ② 绘制技能雷达 ③ 用质量评分验证", 
        "① 复制他人方案 ② 缩短周期 ③ 跳过评估",
        "① 定义 time_to_value 阈值 ② 共创行动清单 ③ 约定复盘节奏",
        "① 把素材发群里 ② 等待反馈 ③ 下次再补"
      ],
      answer: [0, 2],
      explain: {
        zh: "飞轮需要画像+量化+反馈的闭环，单向广播或跳过评估都无法沉淀经验。",
        en: "A flywheel requires profile + quantified targets + scheduled feedback; broadcast-only steps fail to loop learning."
      }
    },
    {
      type: "input",
      question: {
        zh: `请完成以下三步并提交摘要：1）记录一位关键 Persona 的 baseline，2）量化 ${metricPrimary} 与 ${metricSecondary} 目标，3）设计 2 周内的反馈触点。`,
        en: `Complete these three steps and share a short brief: 1) capture one persona's baseline, 2) quantify ${metricPrimary} and ${metricSecondary}, 3) design the feedback touchpoints for the next 2 weeks.`
      },
      answer: "plan",
      explain: {
        zh: "评分标准：是否覆盖画像、指标、反馈三要素，并给出可执行时间表。",
        en: "Rubric: include persona profile, both metrics, and a concrete timeline for feedback loops."
      }
    },
    {
      type: "mcq",
      question: {
        zh: `若要把 ${topic} 的诊断结果嵌入 OKR，哪项量化表达最合理？`,
        en: `Which KPI expression best embeds ${topic} diagnostics into your OKRs?`
      },
      options: [
        `学习效率 = (${metricPrimary} 提升幅度) / 周数`,
        `参与人次 × 预算`,
        `工具数量 ÷ 团队人数`,
        `复盘次数 - 会议时长`
      ],
      answer: 0,
      explain: {
        zh: "KPI 需关联效率/质量指标，单看投入或次数无法证明成效。",
        en: "An OKR-aligned KPI ties outcomes to efficiency/quality, not raw participation or meeting counts."
      }
    }
  ];
}

function ensureExplain(entry, candidate) {
  if (entry.explain && typeof entry.explain === "object" && Object.keys(entry.explain).length) {
    return entry;
  }
  entry.explain = ensureI18n(entry.explain, {
    zh: `${candidate.title} 练习解析：对照指标确认答案。`,
    en: `${candidate.title} rationale: connect decisions back to metrics.`
  });
  return entry;
}

function ensurePracticeCoverage(entries, candidate) {
  let practice = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const fallbackPool = buildPracticeFallbacks(candidate);
  const maxLength = 5;
  const targetLength = 4;
  const requiredTypes = ["mcq", "multi", "input"];

  const cloneEntry = (entry) => JSON.parse(JSON.stringify(entry));
  const countType = (list, type) => list.filter((item) => item.type === type).length;

  const dropRedundant = () => {
    if (practice.length < maxLength) return;
    for (let i = practice.length - 1; i >= 0; i -= 1) {
      const candidateEntry = practice[i];
      const typeCount = countType(practice, candidateEntry.type);
      if (typeCount > 1) {
        practice.splice(i, 1);
        if (practice.length < maxLength) return;
      }
    }
    if (practice.length >= maxLength) {
      practice.pop();
    }
  };

  const appendEntry = (entry) => {
    if (!entry) return;
    if (practice.length >= maxLength) {
      dropRedundant();
    }
    practice.push(cloneEntry(entry));
  };

  requiredTypes.forEach((type) => {
    if (!practice.some((entry) => entry.type === type)) {
      const fallback = fallbackPool.find((item) => item.type === type) || fallbackPool[0];
      appendEntry(fallback);
    }
  });

  let cycleIndex = 0;
  while (practice.length < targetLength) {
    appendEntry(fallbackPool[cycleIndex % fallbackPool.length]);
    cycleIndex += 1;
  }

  if (practice.length > maxLength) {
    practice = practice.slice(0, maxLength);
  }

  return practice.map((entry) => ensureExplain(entry, candidate));
}

function normalizePractice(practiceRaw, candidate) {
  const entries = Array.isArray(practiceRaw) ? practiceRaw : [];
  const coerced = entries
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const type = PRACTICE_TYPES.includes(entry.type) ? entry.type : PRACTICE_TYPES[index % PRACTICE_TYPES.length];
      const questionSource = entry.question ?? entry.prompt ?? entry.title;
      const question = ensureI18n(questionSource, "请解释这个概念");
      const questionText = extractText(question);
      if (!questionText) {
        return null;
      }
      const options = normalizeOptions(entry);
      if (type !== "input") {
        const minOptions = type === "multi" ? 3 : 2;
        if (options.length < minOptions) {
          return null;
        }
      }
      let answer = mapAnswer({ ...entry, type }, options);
      if (type === "multi") {
        if (!Array.isArray(answer) || !answer.length) {
          answer = [0];
        }
      } else if (type === "mcq" && !Number.isInteger(answer)) {
        answer = 0;
      }
      const explain = entry.explain ? ensureI18n(entry.explain) : undefined;
      const payload = { type, question, answer, explain };
      if (options.length) {
        payload.options = options;
      }
      return payload;
    })
    .filter(Boolean);
  return ensurePracticeCoverage(coerced, candidate);
}

function isPlaceholderUrl(url) {
  if (!url || typeof url !== "string") return true;
  const normalized = url.trim();
  if (!/^https?:\/\//i.test(normalized)) {
    return true;
  }
  try {
    const parsed = new URL(normalized);
    if (PLACEHOLDER_HOSTS.has(parsed.hostname.toLowerCase())) {
      return true;
    }
    return PLACEHOLDER_SNIPPETS.some((snippet) => normalized.toLowerCase().includes(snippet));
  } catch (error) {
    return true;
  }
}

function normalizeReferences(referencesRaw, candidate) {
  const fallbackLabel = ensureI18n(
    { zh: `${candidate.title} 延伸阅读`, en: `${candidate.title} reference` },
    candidate.title
  );
  const placeholderEntry = {
    label: ensureI18n(
      { zh: "暂无公开参考（Internal insight）", en: "Internal insight only" },
      candidate.title
    )
  };
  if (!Array.isArray(referencesRaw) || !referencesRaw.length) {
    const hinted = typeof candidate.referenceHints?.[0] === "string" ? candidate.referenceHints[0] : undefined;
    if (hinted && !isPlaceholderUrl(hinted)) {
      return [
        {
          label: fallbackLabel,
          url: hinted
        }
      ];
    }
    return [placeholderEntry];
  }
  const normalized = referencesRaw
    .map((ref) => {
      if (!ref || typeof ref !== "object") return null;
      const label = ensureI18n(ref.label, ref.title || candidate.title);
      const url = typeof ref.url === "string" ? ref.url.trim() : undefined;
      if (!url || isPlaceholderUrl(url)) {
        return null;
      }
      return { label, url };
    })
    .filter(Boolean)
    .slice(0, 6);
  return normalized.length ? normalized : [placeholderEntry];
}

function sanitizeReferenceLabels(references, fallbackTitle) {
  if (!Array.isArray(references)) return references;
  return references
    .map((ref) => {
      if (!ref || typeof ref !== "object") return null;
      const label = ensureI18n(ref.label, fallbackTitle);
      const url = typeof ref.url === "string" ? ref.url.trim() : ref.url;
      return { ...ref, label, url };
    })
    .filter(Boolean);
}

function sanitizeLessonEntry(lesson) {
  if (!lesson || typeof lesson !== "object") return null;
  const clone = { ...lesson };
  const fallbackTitle = extractText(clone.title?.zh || clone.title?.en || clone.title || clone.id);
  if (clone.references) {
    clone.references = sanitizeReferenceLabels(clone.references, fallbackTitle);
  }
  return clone;
}

function sanitizeLessons(lessons) {
  return (lessons || []).map((lesson) => sanitizeLessonEntry(lesson)).filter(Boolean);
}

function normalizeContextualNotes(notes, candidate) {
  const fallback = {
    why_now: `当前阶段掌握 ${candidate.title} 可帮助团队在 ${candidate.category} 上做出可复用的实践。`,
    best_for: `适合 ${candidate.personas?.join("、") || "跨职能团队"}，需要快速吸收 ${candidate.level} 主题。`,
    visual_hint: "使用要点列表 + 流程箭头展示流转。"
  };
  if (!notes || typeof notes !== "object") {
    return fallback;
  }
  const normalized = { ...fallback };
  for (const key of ["why_now", "best_for", "visual_hint"]) {
    if (typeof notes[key] === "string" && notes[key].trim()) {
      normalized[key] = notes[key].trim();
    }
  }
  return normalized;
}

function coerceLesson(candidate, lesson, date, learnerProfile, toneProfile) {
  const title = ensureI18n(lesson.title, candidate.title);
  const summary = ensureI18n(lesson.summary, `${candidate.title} 概要`);
  const content = ensureI18n(lesson.content, `<p>${summary.zh}</p>`);
  const tags = Array.from(new Set([...(lesson.tags || []), ...(candidate.tags || []), ...(candidate.keywords || [])]))
    .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
    .filter(Boolean)
    .slice(0, 8);
  const difficulty = DIFFICULTY_VALUES.includes(lesson.difficulty) ? lesson.difficulty : difficultyLabel(candidate);
  const practice = normalizePractice(lesson.practice, candidate);
  if (!practice.length) {
    practice.push({
      type: "input",
      question: { zh: "用一句话总结今天的重点", en: "Summarize the key insight" },
      answer: "alignment"
    });
  }
  const references = normalizeReferences(lesson.references, candidate);
  let idBase = slugify(candidate.title).replace(/^-+|[^a-z0-9-]|-+$/g, "");
  if (!idBase) {
    idBase = `lesson-${hashObject(candidate.title).slice(0, 8)}`;
  }
  const id = `${date}-${idBase}`;
  const audio = {
    zh: `/assets/audio/daily/${id}-zh.mp3`
  };
  const contextualNotes = normalizeContextualNotes(lesson.meta?.contextual_notes, candidate);
  return {
    id,
    date,
    title,
    summary,
    difficulty,
    tags,
    content,
    practice,
    references,
    audio,
    meta: {
      category: candidate.category,
      level: candidate.level,
      difficultyScore: candidate.difficulty,
      related: candidate.related,
      learningObjectives: candidate.learningObjectives,
      personas: candidate.personas,
      contextual_notes: contextualNotes,
      tone_profile: toneProfile,
      learner_profile: learnerProfile,
      prompt_version: PROMPT_VERSION
    }
  };
}

function degradeLesson(previous, date) {
  const clone = JSON.parse(JSON.stringify(previous));
  let degradedSlug = slugify(clone.title?.zh || clone.title?.en || "lesson").replace(/^-+|[^a-z0-9-]|-+$/g, "");
  if (!degradedSlug) {
    degradedSlug = `lesson-${hashObject(clone.title).slice(0, 8)}`;
  }
  clone.id = `${date}-${degradedSlug}`;
  clone.date = date;
  if (clone.practice?.length) {
    clone.practice = clone.practice.slice(0, 2);
  }
  return clone;
}

async function generateStarterQuestions(lesson, candidate, learnerProfile) {
  const summary = lesson.summary?.zh || lesson.summary?.en || "";
  const messages = buildStarterPrompt({
    candidate,
    learnerProfile,
    lessonSummary: summary
  });
  const responseFormats = [
    {
      type: "json_schema",
      json_schema: {
        name: "starterQuestions",
        schema: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: {
            type: "object",
            required: ["lang", "question"],
            properties: {
              lang: { type: "string" },
              question: { type: "string" },
              action_hint: { type: "string" }
            },
            additionalProperties: false
          }
        }
      }
    },
    { type: "json_object" },
    null
  ];
  let lastError = null;
  for (const format of responseFormats) {
    try {
      const raw = await callLLM({ messages, temperature: 0.45, responseFormat: format });
      const parsed = parseJSON(raw);
      return normalizeStarterQuestions(parsed, candidate);
    } catch (error) {
      lastError = error;
    }
  }
  console.warn("Starter question generation failed, using fallback", lastError?.message || "unknown error");
  return fallbackStarterQuestions(candidate);
}

async function critiqueLessonDraft({ candidate, learnerProfile, blueprint, lesson }) {
  try {
    const messages = buildLessonCritiquePrompt({ candidate, learnerProfile, blueprint, lesson });
    const raw = await callLLM({ messages, temperature: 0.2, responseFormat: CRITIQUE_RESPONSE_FORMAT });
    return parseJSON(raw);
  } catch (error) {
    console.warn("Lesson critique failed", error.message);
    return null;
  }
}

async function reviseLessonDraft({ candidate, learnerProfile, toneProfile, blueprint, lesson, critique, recentLessons }) {
  try {
    const messages = buildLessonRevisionPrompt({
      candidate,
      learnerProfile,
      toneProfile,
      blueprint,
      lesson,
      critique,
      recentLessons
    });
    const raw = await callLLM({ messages, responseFormat: LESSON_RESPONSE_FORMAT });
    return parseJSON(raw);
  } catch (error) {
    console.warn("Lesson revision failed", error.message);
    throw error;
  }
}

function fallbackBlueprint(candidate, learnerProfile) {
  const metrics = (learnerProfile?.preferredMetrics && learnerProfile.preferredMetrics.length
    ? learnerProfile.preferredMetrics
    : ["time_to_value", "quality_score"]).slice(0, 2);
  return {
    sections: [
      {
        id: "diagnose",
        title: `${candidate.title} 诊断基线`,
        angle: "识别 Persona 能力边界",
        key_questions: ["哪些技能阻塞了交付？", "当前 baseline 来自哪里？"],
        case: {
          title: "产品经理 Onboarding",
          scene: "新 PM 需要 2 周完成 AI 工具熟悉",
          outcome: "用技能雷达把 time_to_value 缩短 35%"
        },
        metrics,
        tools: [
          { name: "Skill Radar", url: "https://www.atlassian.com/blog/teamwork/skill-matrix", usage: "绘制学习者画像" }
        ],
        steps: [
          "收集画像数据（访谈 + 问卷）",
          "量化 time_to_value / quality_score 基线",
          "共识诊断报告"
        ]
      },
      {
        id: "case",
        title: "案例飞轮",
        angle: "如何把诊断转成成长飞轮",
        key_questions: ["反馈节奏如何设定？", "案例指标如何量化？"],
        case: {
          title: "高校教师弥补 AI 伦理缺口",
          scene: "课堂前 4 周建立伦理模块",
          outcome: "quality_score 提升 22%"
        },
        metrics,
        tools: [
          { name: "Growth Flywheel Canvas", url: "https://www.productplan.com/glossary/growth-flywheel/", usage: "规划 诊断→学习→反馈" }
        ],
        steps: ["把诊断映射到飞轮节点", "设置 1/4 周复盘", "沉淀模板"]
      },
      {
        id: "toolkit",
        title: "工具与指标",
        angle: "组合技能雷达 + 指标看板",
        key_questions: ["哪些数据源最可靠？", "如何把指标嵌入日常？"],
        case: {
          title: "AI 学习小组",
          scene: "跨职能 6 人协作",
          outcome: "time_to_value 由 4 周降到 10 天"
        },
        metrics,
        tools: [
          { name: "Notion Skill Matrix 模板", url: "https://www.notion.so/templates/skill-matrix", usage: "集中记录诊断结果" },
          { name: "敬请期待模板", url: "敬请期待", usage: "即将发布的诊断画布" }
        ],
        steps: ["定义指标字段", "接入自动提醒", "用仪表盘跟踪"]
      },
      {
        id: "action",
        title: "实践计划",
        angle: "两周冲刺把画像落地",
        key_questions: ["优先级如何排序？", "如何确认收效？"],
        case: {
          title: "高校工作坊",
          scene: "学生需把诊断融入课程设计",
          outcome: "课程满意度 +15%"
        },
        metrics,
        tools: [
          { name: "Sprint Checklist", url: "敬请期待", usage: "列出多步执行清单" }
        ],
        steps: ["锁定 Persona", "列出 3 步行动", "设置 Demo/复盘"]
      }
    ],
    practice_suite: [
      {
        type: "mcq",
        prompt: "验证诊断 - 量化 - 反馈的正确顺序",
        steps: ["回顾基线", "匹配指标", "选择正确顺序"],
        options: [
          "画像 → 指标 → 反馈",
          "直接执行 → 复盘 → 再诊断",
          "定 KPI → 跳过诊断 → 执行",
          "堆素材 → 培训 → 量化"
        ],
        answer: 0,
        explain: "画像在前，指标在中，反馈在后。"
      },
      {
        type: "multi",
        prompt: "挑选能撑起成长飞轮的多步行动",
        steps: ["辨识 Persona", "绘制雷达", "约定复盘"],
        options: [
          "画像+雷达+评分",
          "复制他人方案",
          "设定指标+清单+节奏",
          "一次性培训"
        ],
        answer: [0, 2],
        explain: "需要画像/指标/反馈三位一体。"
      },
      {
        type: "input",
        prompt: "写出两周实践计划",
        steps: ["列 Persona", "量化指标", "规划反馈"],
        answer: "plan",
        explain: "必须明确角色、指标、触点。"
      }
    ],
    reference_pool: [
      { title: "AI in Education: Profiling and Diagnostics", url: "https://arxiv.org/abs/2105.12345", note: "学习者画像方法" },
      { title: "Growth Flywheel Model Guide", url: "https://www.productplan.com/glossary/growth-flywheel/", note: "设计成长飞轮" },
      { title: "Skill Matrix Practices", url: "https://www.atlassian.com/blog/teamwork/skill-matrix", note: "技能雷达范式" }
    ],
    toolkit: [
      { name: "Skill Radar 模板", url: "https://www.notion.so/templates/skill-matrix", usage: "收集 baseline" },
      { name: "成长飞轮 Canvas", url: "https://www.productplan.com/glossary/growth-flywheel/", usage: "规划诊断-学习-反馈" },
      { name: "Sprint Checklist", url: "敬请期待", usage: "即将上线的执行清单" }
    ],
    contextual_hooks: {
      why_now: `团队正需要 ${candidate.category} 的可复用实践来托底 ${candidate.level} 主题。`,
      best_for: `${candidate.personas?.join("、") || "跨职能学习者"} 想要在 2 周内看到指标提升。`,
      visual_hint: "用分栏对比 画像→指标→反馈 的闭环。"
    }
  };
}

async function generateBlueprint(candidate, learnerProfile, toneProfile, history) {
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const messages = buildLessonBlueprintPrompt({
        candidate,
        learnerProfile,
        toneProfile,
        recentLessons: history
      });
      const raw = await callLLM({ messages, responseFormat: BLUEPRINT_RESPONSE_FORMAT });
      const parsed = parseJSON(raw);
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.sections)) {
        throw new Error("Blueprint missing sections");
      }
      return parsed;
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = backoff(attempt);
        console.warn(`Blueprint attempt ${attempt + 1} failed: ${error.message}. Retrying in ${delay}ms`);
        await sleep(delay);
      }
    }
  }
  console.error("Falling back to canned blueprint", lastError?.message);
  return fallbackBlueprint(candidate, learnerProfile);
}

async function generateLesson(candidate, history) {
  const date = today();
  const learnerProfile = buildLearnerProfile(candidate);
  const toneProfile = buildToneProfile(candidate);
  const candidateProfile = { ...candidate, difficultyLabel: difficultyLabel(candidate) };
  if (dryRun) {
    const lesson = coerceLesson(candidateProfile, {
      title: { zh: candidate.title, en: candidate.title },
      summary: { zh: `${candidate.title} 概念回顾`, en: `${candidate.title} recap` },
      content: {
        zh: `<p>${candidate.title} 的背景和意义。</p><p>结合业务案例理解。</p>`
      },
      practice: [
        {
          type: "mcq",
          question: { zh: `${candidate.title} 的核心作用是？` },
          options: ["对齐", "推理", "路由", "压缩"],
          answer: 0
        }
      ]
    }, date, learnerProfile, toneProfile);
    applyMetaDefaults(lesson, candidateProfile, learnerProfile, toneProfile);
    lesson.meta.starter_questions = fallbackStarterQuestions(candidateProfile);
    return lesson;
  }
  const blueprint = await generateBlueprint(candidateProfile, learnerProfile, toneProfile, history);
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const messages = buildLessonDetailPrompt({
        candidate: candidateProfile,
        learnerProfile,
        toneProfile,
        blueprint,
        recentLessons: history
      });
      const raw = await callLLM({ messages, responseFormat: LESSON_RESPONSE_FORMAT });
      const parsed = parseJSON(raw);
      let lessonDraft = coerceLesson(candidateProfile, parsed, date, learnerProfile, toneProfile);
      const critique = await critiqueLessonDraft({
        candidate: candidateProfile,
        learnerProfile,
        blueprint,
        lesson: sanitizeLessonEntry(lessonDraft)
      });
      if (critique?.revision_required !== false && (critique?.issues?.length || critique?.directives?.length)) {
        try {
          const revision = await reviseLessonDraft({
            candidate: candidateProfile,
            learnerProfile,
            toneProfile,
            blueprint,
            lesson: sanitizeLessonEntry(lessonDraft),
            critique,
            recentLessons: history
          });
          lessonDraft = coerceLesson(candidateProfile, revision, date, learnerProfile, toneProfile);
        } catch (revisionError) {
          console.warn("Using pre-critique lesson due to revision error", revisionError.message);
        }
      }
      applyMetaDefaults(lessonDraft, candidateProfile, learnerProfile, toneProfile);
      const starterQuestions = await generateStarterQuestions(lessonDraft, candidateProfile, learnerProfile);
      lessonDraft.meta.starter_questions = starterQuestions;
      return lessonDraft;
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = backoff(attempt);
        console.warn(`LLM attempt ${attempt + 1} failed: ${error.message}. Retrying in ${delay}ms`);
        await sleep(delay);
      }
    }
  }
  console.error("Falling back to degraded lesson", lastError?.message);
  if (history.length) {
    const fallback = degradeLesson(history[0], date);
    applyMetaDefaults(fallback, candidateProfile, learnerProfile, toneProfile);
    fallback.meta.starter_questions = fallback.meta.starter_questions || fallbackStarterQuestions(candidateProfile);
    return fallback;
  }
  throw lastError;
}

async function main() {
  const [topicsRaw, historyDoc] = await Promise.all([
    readJSON(path.resolve(root, TOPICS), []),
    loadHistory()
  ]);
  const lessons = sanitizeLessons(historyDoc.lessons || []);
  const topics = flattenTopics(topicsRaw);
  if (!topics.length) {
    throw new Error("No academy topics available");
  }
  const candidate = pickCandidate(topics, lessons) || topics[0];
  const lesson = await generateLesson(candidate, lessons);
    const merged = uniqueBy([lesson, ...lessons], (entry) => entry?.id || `${entry?.date}-${entry?.title?.zh}`);
    const sorted = merged.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const normalized = {
      generatedAt: new Date().toISOString(),
      lessons: await rollWindowAndArchive(
        sorted,
        HISTORY_LIMIT,
        path.resolve(root, DAILY_ARCH)
      )
    };
  if (dryRun) {
    console.log(JSON.stringify(normalized.lessons[0], null, 2));
    return;
  }
  await writeJSON(path.resolve(root, DAILY), normalized);
  const schemaPath = path.resolve(root, `${SCHEMAS}/daily.schema.json`);
  const { valid, errors } = await validateWithSchema(path.resolve(root, DAILY), schemaPath);
  if (!valid) {
    console.error("Academy lesson failed schema validation", errors);
    process.exitCode = 1;
    return;
  }
  console.log(`Generated academy lesson for ${lesson.date}: ${lesson.title.zh}`);
}

main().catch((error) => {
  console.error("Academy daily generation failed", error);
  process.exitCode = 1;
});
