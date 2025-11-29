import path from "path";
import process from "process";
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
  writeJSON
} from "./util.mjs";
import { buildLessonDetailPrompt, buildStarterPrompt, PROMPT_VERSION } from "./prompts/index.mjs";

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
  const response = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature,
      ...(responseFormat ? { response_format: responseFormat } : {}),
      messages
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM request failed: ${response.status} ${text}`);
  }
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM response missing content");
  }
  return content.trim();
}

function parseJSON(raw) {
  let text = raw.trim();
  if (text.startsWith("```")) {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match) {
      text = match[1];
    }
  }
  return JSON.parse(text);
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

function normalizePractice(practiceRaw) {
  if (!Array.isArray(practiceRaw)) return [];
  const coerced = practiceRaw.map((entry, index) => {
    if (!entry || typeof entry !== "object") return null;
    const type = PRACTICE_TYPES.includes(entry.type) ? entry.type : PRACTICE_TYPES[index % PRACTICE_TYPES.length];
    const question = ensureI18n(entry.question, "请解释这个概念");
    const options = normalizeOptions(entry);
    let answer = mapAnswer({ ...entry, type }, options);
    if (type === "multi" && (!Array.isArray(answer) || !answer.length)) {
      answer = [0];
    }
    const explain = entry.explain ? ensureI18n(entry.explain) : undefined;
    return { type, question, options: options.length ? options : undefined, answer, explain };
  }).filter(Boolean);
  return coerced.slice(0, 4);
}

function normalizeReferences(referencesRaw, candidate) {
  const fallbackLabel = ensureI18n(
    { zh: `${candidate.title} 延伸阅读`, en: `${candidate.title} reference` },
    candidate.title
  );
  if (!Array.isArray(referencesRaw) || !referencesRaw.length) {
    return [
      {
        label: fallbackLabel,
        url: candidate.referenceHints?.[0]
      }
    ];
  }
  return referencesRaw
    .map((ref) => {
      if (!ref || typeof ref !== "object") return null;
      const label = ensureI18n(ref.label, ref.title || candidate.title);
      const url = typeof ref.url === "string" ? ref.url.trim() : undefined;
      return { label, url };
    })
    .filter(Boolean)
    .slice(0, 6);
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
  const practice = normalizePractice(lesson.practice);
  if (!practice.length) {
    practice.push({
      type: "input",
      question: { zh: "用一句话总结今天的重点", en: "Summarize the key insight" },
      answer: "alignment"
    });
  }
  const references = normalizeReferences(lesson.references, candidate);
  const idBase = slugify(candidate.title).replace(/^-+|[^a-z0-9-]|-+$/g, "");
  const id = lesson.id || `${date}-${idBase || "lesson"}`;
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
  clone.id = `${date}-${slugify(clone.title?.zh || clone.title?.en || "lesson")}`;
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
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const messages = buildLessonDetailPrompt({
        candidate: candidateProfile,
        learnerProfile,
        toneProfile,
        recentLessons: history
      });
      const raw = await callLLM({ messages });
      const parsed = parseJSON(raw);
      const lesson = coerceLesson(candidateProfile, parsed, date, learnerProfile, toneProfile);
      applyMetaDefaults(lesson, candidateProfile, learnerProfile, toneProfile);
      const starterQuestions = await generateStarterQuestions(lesson, candidateProfile, learnerProfile);
      lesson.meta.starter_questions = starterQuestions;
      return lesson;
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
  const normalized = {
    generatedAt: new Date().toISOString(),
    lessons: await rollWindowAndArchive(
      [lesson, ...lessons].sort((a, b) => (b.date || "").localeCompare(a.date || "")),
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
