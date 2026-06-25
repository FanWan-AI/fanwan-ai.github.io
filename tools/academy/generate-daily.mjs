import path from "path";
import process from "process";
import { promises as fs } from "fs";
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
import { validateLessonQualityV3 } from "./validate.mjs";
import {
  buildLessonBlueprintPrompt,
  buildLessonContentPrompt,
  buildLessonCritiquePrompt,
  buildLessonRevisionPrompt,
  buildStarterPrompt,
  buildPracticePrompt,
  PROMPT_VERSION,
  BLUEPRINT_RESPONSE_FORMAT,
  LESSON_RESPONSE_FORMAT,
  CRITIQUE_RESPONSE_FORMAT,
  PRACTICE_RESPONSE_FORMAT,
  buildCodeAddendumPrompt,
  CODE_RESPONSE_FORMAT
} from "./prompts/index.mjs";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");
const maxRetries = dryRun ? 0 : 2;
const HISTORY_LIMIT = Infinity;
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

/**
 * A mapping of academy topics to recommended reference URLs. Many LLMs tend to
 * fabricate case studies and performance metrics when no guidance is provided.
 * By specifying authoritative sources here we provide the model with a clear
 * starting point for citations.  The keys should match the Chinese topic
 * names defined in topics.json / better_topics.json.  Add additional entries
 * as new topics are introduced.  If a topic is not present in this map, the
 * lesson generator will fall back to any reference_hints defined on the topic
 * itself.  URLs should point to publicly accessible papers, textbooks, blog
 * posts or datasets that genuinely support the lesson narrative.
 */
const DEFAULT_REFERENCE_HINTS = {
  "什么是人工智能？定义与历史": [
    "https://aima.cs.berkeley.edu/",
    "https://sitn.hms.harvard.edu/flash/2017/history-artificial-intelligence/",
    "https://en.wikipedia.org/wiki/Turing_test"
  ],
  "人工智能在日常生活中的应用": [
    "https://emerj.com/ai-glossary-terms/what-is-artificial-intelligence/",
    "https://www.nature.com/articles/d41586-019-03228-6"
  ],
  "机器学习基础：监督与无监督学习": [
    "https://scikit-learn.org/stable/tutorial/index.html",
    "https://en.wikipedia.org/wiki/Supervised_learning",
    "https://en.wikipedia.org/wiki/Unsupervised_learning"
  ],
  "深度学习与神经网络原理": [
    "https://www.deeplearningbook.org/",
    "https://cs231n.stanford.edu/"
  ],
  "生成式AI与扩散模型": [
    "https://ai.googleblog.com/2023/05/generative-ai-tools-and-news.html",
    "https://arxiv.org/abs/2011.13456"
  ]
};

async function loadArchivedIds() {
  const archiveDir = path.resolve(root, DAILY_ARCH);
  try {
    const files = await fs.readdir(archiveDir);
    const ids = new Set();
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = path.join(archiveDir, file);
      const content = await readJSON(filePath, []);
      if (Array.isArray(content)) {
        for (const lesson of content) {
          if (lesson && lesson.id) {
             const key = lesson.id.replace(/^\d{4}-\d{2}-\d{2}-/, "") || lesson.id;
             ids.add(key);
          }
        }
      }
    }
    return ids;
  } catch (error) {
    if (error.code === "ENOENT") return new Set();
    console.warn("Failed to load archive:", error);
    return new Set();
  }
}

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
          baseId = `lesson-${hashObject(topic.topic).slice(0, 8)}`;
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
          // Prefer explicit reference_hints on the topic; otherwise use defaults
          referenceHints: (Array.isArray(topic.reference_hints) && topic.reference_hints.length)
            ? topic.reference_hints
            : (DEFAULT_REFERENCE_HINTS[topic.topic] || []),
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
    // 默认不指定 preferredMetrics，让模型自由发挥或依据章节自行引入适当的性能指标
    preferredMetrics: [],
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

function pickCandidate(candidates, lessons, archivedIds) {
  if (!candidates.length) return null;
  const summary = summarizeHistory(lessons);
  // Strictly follow the order in topics.json (candidates array)
  // Find the first candidate that has not been generated yet
  for (const candidate of candidates) {
    if (!summary.has(candidate.id) && (!archivedIds || !archivedIds.has(candidate.id))) {
      return candidate;
    }
  }
  // If all topics are covered, return null
  console.warn("All topics have been covered. No new candidate found.");
  return null;
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
  const model = process.env.LLM_MODEL || process.env.OPENAI_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

  const rawMaxTokens = Number(
    process.env.LLM_MAX_TOKENS ||
      process.env.OPENAI_MAX_TOKENS ||
      process.env.DEEPSEEK_MAX_TOKENS ||
      process.env.DEEPSEEK_MAX_OUTPUT ||
      process.env.DEEPSEEK_MAX_INPUT ||
      0
  );
  // DeepSeek range is [1, 8192]; clamp to avoid 400 errors when upstream vars are oversized.
  const maxTokens = Number.isFinite(rawMaxTokens)
    ? Math.max(0, Math.min(rawMaxTokens, 8192))
    : 0;

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
        ...(maxTokens > 0 ? { max_tokens: maxTokens } : {}),
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

const SUMMARY_BANNED_PATTERNS = [
  /学习前/g,
  /学习后/g,
  /before learning/gi,
  /after learning/gi
];

function collectSummarySignals(blueprint) {
  const sections = Array.isArray(blueprint?.sections) ? blueprint.sections : [];
  const focus = sections
    .map((section) => extractText(section?.title))
    .filter(Boolean)
    .slice(0, 3);
  const dataset = sections
    .map((section) => extractText(section?.worked_example?.dataset))
    .find((value) => value && value.length >= 2);
  const caseOrg = sections
    .map((section) => extractText(section?.case?.org))
    .find((value) => value && value.length >= 2);
  const metric = sections
    .flatMap((section) => (Array.isArray(section?.metrics) ? section.metrics : []))
    .map((entry) => extractText(entry))
    .find((value) => value && value.length >= 2);
  const tool = sections
    .flatMap((section) => (Array.isArray(section?.tools) ? section.tools : []))
    .map((entry) => extractText(entry?.name || entry?.title))
    .find((value) => value && value.length >= 2);
  return { focus, dataset, caseOrg, metric, tool };
}

function buildStructuredSummary(candidate, blueprint) {
  const title = candidate.title || "本课程";
  const category = candidate.category || "AI 场景";
  const theme = extractText(blueprint?.theme_summary);
  const { focus, dataset, caseOrg, metric, tool } = collectSummarySignals(blueprint);
  const zhFocus = focus.length ? focus.join("、") : "概念、算法与应用";
  const enFocus = focus.length ? focus.join(", ") : "concepts, algorithms, and applications";
  const zhAnchor = theme ? theme.replace(/。+$/g, "") : `${title} 是 ${category} 的关键方法`;
  const zhSentence1 = `${zhAnchor}，课程围绕 ${category} 中的可执行路径展开。`;
  const zhParts = [`内容串联 ${zhFocus}，梳理定义、推导与迁移步骤`];
  if (dataset) {
    zhParts.push(`以 ${dataset} worked example 讲解数据与验证指标`);
  } else if (caseOrg) {
    zhParts.push(`结合 ${caseOrg} 案例说明落地要点`);
  }
  if (metric) {
    zhParts.push(`提示如何跟踪 ${metric} 等质量信号`);
  }
  if (tool) {
    zhParts.push(`补充 ${tool} 等工具使用策略`);
  }
  const zhSentence2 = `${zhParts.join("，")}。`;
  const zh = `${zhSentence1}${zhSentence2}`;

  const enSentence1 = `${title} is positioned for ${category} initiatives, clarifying why the capability emerged and which operating gaps it closes.`;
  const enParts = [`It threads ${enFocus} to translate theory into executable steps`];
  if (dataset) {
    enParts.push(`uses the ${dataset} worked example to show data prep and validation`);
  } else if (caseOrg) {
    enParts.push(`grounds the narrative in the ${caseOrg} case study`);
  }
  if (metric) {
    enParts.push(`calls out metrics such as ${metric}`);
  }
  if (tool) {
    enParts.push(`references tooling like ${tool}`);
  }
  const enSentence2 = `${enParts.join(", ")}.`;
  const en = `${enSentence1} ${enSentence2}`;

  return ensureI18n({ zh, en }, title);
}

function summaryIsWeak(summary) {
  if (!summary || typeof summary !== "object") {
    return true;
  }
  const zh = extractText(summary.zh);
  const en = extractText(summary.en);
  if (!zh || !en) {
    return true;
  }
  const zhLength = zh.length;
  const enWords = en.split(/\s+/).filter(Boolean).length;
  return zhLength < 35 || enWords < 30;
}

function summaryHasBannedFraming(summary) {
  if (!summary || typeof summary !== "object") {
    return false;
  }
  const zh = extractText(summary.zh);
  const en = extractText(summary.en);
  return SUMMARY_BANNED_PATTERNS.some((pattern) => (zh && pattern.test(zh)) || (en && pattern.test(en)));
}

function sanitizeSummaryValue(summary, candidate, blueprint) {
  if (!summary || typeof summary !== "object") {
    return buildStructuredSummary(candidate, blueprint);
  }
  if (summaryHasBannedFraming(summary) || summaryIsWeak(summary)) {
    return buildStructuredSummary(candidate, blueprint);
  }
  return summary;
}

function formatContextPrefix(source, dataAsset, lang) {
  const parts = [];
  if (source) {
    parts.push(lang === "en" ? `Source: ${source}` : `来自：${source}`);
  }
  if (dataAsset) {
    parts.push(lang === "en" ? `Data: ${dataAsset}` : `数据：${dataAsset}`);
  }
  if (!parts.length) {
    return "";
  }
  const joined = parts.join(" · ");
  return `【${joined}】`;
}

function attachQuestionContext(question, sourceSection, dataAsset) {
  if (!sourceSection && !dataAsset) {
    return ensureI18n(question, "请解释这个概念");
  }
  const next = ensureI18n(question, "请解释这个概念");
  const zhPrefix = formatContextPrefix(sourceSection, dataAsset, "zh");
  const enPrefix = formatContextPrefix(sourceSection, dataAsset, "en");
  if (zhPrefix) {
    next.zh = `${zhPrefix}${next.zh || next.en || ""}`;
  }
  if (enPrefix) {
    next.en = `${enPrefix}${next.en || next.zh || ""}`;
  }
  return next;
}

function appendRubricHint(explain, rubric) {
  const note = typeof rubric === "string" ? rubric.trim() : "";
  if (!note) {
    return explain;
  }
  const base = ensureI18n(explain, note);
  const zhNote = `评分提示：${note}`;
  const enNote = `Scoring note: ${note}`;
  base.zh = base.zh ? `${base.zh}\n${zhNote}` : zhNote;
  base.en = base.en ? `${base.en}\n${enNote}` : enNote;
  return base;
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
  const sectionPrefix = `${topic} · `;
  const exampleAsset = candidate.learningObjectives?.[0] || "课程 worked example";
  return [
    {
      type: "mcq",
      source_section: `${sectionPrefix}结构总览`,
      data_asset: "课程大纲",
      question: {
        zh: `在设计《${topic}》的课程结构时，下列哪种顺序最能帮助读者从概念到应用逐层理解？`,
        en: `When outlining "${topic}", which sequence best helps readers progress from concepts to applications?`
      },
      options: [
        "概念与定义 → 理论与算法 → Worked example → 应用与趋势",
        "直接列公式 → 给出练习 → 最后再解释概念",
        "只讲历史 → 只列参考文献 → 不展示示例",
        "先贴代码 → 略过背景 → 简单总结"
      ],
      answer: 0,
      explain: {
        zh: "博客式课程需要自上而下铺陈：先建立概念，再阐明原理，随后通过示例与应用巩固。",
        en: "A blog-style lesson works best when it builds concepts, explains theory, walks through an example, then discusses applications."
      },
      rubric: "选择能够形成定义→理论→示例→应用闭环的顺序。"
    },
    {
      type: "multi",
      source_section: `${sectionPrefix}worked example`,
      data_asset: `${exampleAsset} 数据/代码`,
      question: {
        zh: `在复现《${topic}》的 worked example 时，以下哪些动作有助于保证结果可复现？（多选）`,
        en: `While reproducing the worked example in "${topic}", which actions improve reproducibility? (Select all that apply)`
      },
      options: [
        "列出输入数据字段与来源",
        "仅口头描述处理步骤",
        "逐行解释代码或公式逻辑",
        "记录关键输出指标及其含义"
      ],
      answer: [0, 2, 3],
      explain: {
        zh: "要可复现，必须交代输入、解释处理过程并汇报输出；只口头概述无法为读者提供足够细节。",
        en: "Reproducibility requires disclosing inputs, explaining each processing step, and logging the outputs; a vague verbal description is insufficient."
      },
      rubric: "选中所有强调输入、处理、输出完整链路的选项。"
    },
    {
      type: "input",
      source_section: `${sectionPrefix}应用延伸`,
      data_asset: "个人项目场景",
      question: {
        zh: `请描述你所在场景如何迁移《${topic}》中的一个定义或方法：写出场景背景、要重用的步骤以及验证结果的指标。`,
        en: `Describe how you would transfer one definition or method from "${topic}" into your context: outline the scenario, the reused steps, and the metric you would check.`
      },
      answer: "plan",
      explain: {
        zh: "高分答案会明确场景、连接课程步骤，并指出验证成效的客观指标。",
        en: "Full-credit responses name the scenario, map course steps to it, and note the objective metric used for validation."
      },
      rubric: "需包含场景、迁移步骤、验证指标三要素。"
    },
    {
      type: "mcq",
      source_section: `${sectionPrefix}参考资料`,
      data_asset: "课程引用文献",
      question: {
        zh: `当引用文献支撑《${topic}》中的观点时，以下哪一做法能强化可信度？`,
        en: `When citing a reference to support a claim in "${topic}", which action strengthens credibility?`
      },
      options: [
        "指出文献的年份、作者/机构并提炼与本节的关系",
        "只在文末集中列出所有链接，不在正文说明",
        "引用尚未发表的私有数据但不给出处",
        "用营销口吻概括文献而不提研究方法"
      ],
      answer: 0,
      explain: {
        zh: "透明说明文献来源与章节关联，有助于读者追溯证据；其余做法都会削弱可信度。",
        en: "Naming the publication details and tying them to the section lets readers verify the evidence; the other approaches reduce trust."
      },
      rubric: "选择能够清楚说明出处与课程观点关系的选项。"
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

function finalizePracticeEntry(entry, candidate) {
  const sourceSection = typeof entry.source_section === "string" ? entry.source_section.trim() : "";
  const dataAsset = typeof entry.data_asset === "string" ? entry.data_asset.trim() : "";
  const rubric = typeof entry.rubric === "string" ? entry.rubric.trim() : "";
  const question = attachQuestionContext(entry.question, sourceSection, dataAsset);
  const explain = appendRubricHint(entry.explain, rubric);
  const cleaned = {
    type: entry.type,
    question,
    answer: entry.answer,
    explain
  };
  if (Array.isArray(entry.options) && entry.options.length) {
    cleaned.options = entry.options;
  }
  return ensureExplain(cleaned, candidate);
}

function ensurePracticeCoverage(entries, candidate) {
  const fallbackPool = buildPracticeFallbacks(candidate);
  const maxLength = 5;
  const targetLength = 4;
  const requiredTypes = ["mcq", "multi", "input"];
  const cloneEntry = (entry) => JSON.parse(JSON.stringify(entry));
  const countType = (list, type) => list.filter((item) => item.type === type).length;
  const entryKey = (entry) => {
    if (!entry) return "";
    const question = entry.question?.zh || entry.question?.en || entry.prompt || entry.title;
    const text = extractText(question);
    return text ? `${entry.type}:${text}` : "";
  };

  let practice = [];
  const seenKeys = new Set();

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry) return;
    const key = entryKey(entry);
    if (key && seenKeys.has(key)) {
      return;
    }
    if (key) {
      seenKeys.add(key);
    }
    practice.push(entry);
  });

  const dropRedundant = () => {
    if (practice.length < maxLength) return;
    for (let i = practice.length - 1; i >= 0; i -= 1) {
      const candidateEntry = practice[i];
      const typeCount = countType(practice, candidateEntry.type);
      if (typeCount > 1) {
        const key = entryKey(candidateEntry);
        if (key) {
          seenKeys.delete(key);
        }
        practice.splice(i, 1);
        if (practice.length < maxLength) return;
      }
    }
    if (practice.length >= maxLength) {
      const removed = practice.pop();
      const key = entryKey(removed);
      if (key) {
        seenKeys.delete(key);
      }
    }
  };

  const appendEntry = (entry) => {
    if (!entry) return;
    const prepared = cloneEntry(entry);
    const key = entryKey(prepared);
    if (key && seenKeys.has(key)) {
      return;
    }
    if (practice.length >= maxLength) {
      dropRedundant();
    }
    practice.push(prepared);
    if (key) {
      seenKeys.add(key);
    }
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

  return practice.map((entry) => finalizePracticeEntry(entry, candidate));
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
      const sourceSection = typeof entry.source_section === "string" ? entry.source_section.trim() : "";
      if (sourceSection) {
        payload.source_section = sourceSection;
      }
      const dataAsset = typeof entry.data_asset === "string" ? entry.data_asset.trim() : "";
      if (dataAsset) {
        payload.data_asset = dataAsset;
      }
      const rubric = typeof entry.rubric === "string" ? entry.rubric.trim() : "";
      if (rubric) {
        payload.rubric = rubric;
      }
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

function collectBlueprintReferences(blueprint) {
  if (!blueprint || typeof blueprint !== "object") return [];
  const pool = [];
  const append = (entry) => {
    if (!entry || typeof entry !== "object") return;
    const url = typeof entry.url === "string" ? entry.url.trim() : undefined;
    if (!url || isPlaceholderUrl(url)) return;
    pool.push({
      title: extractText(entry.title || entry.label || entry.note),
      url,
      publisher: entry.publisher || entry.org || entry.organization || entry.source,
      year: entry.year || entry.date || entry.published || entry.publication_year || entry.release_year
    });
  };
  if (Array.isArray(blueprint.references)) {
    blueprint.references.forEach(append);
  }
  if (Array.isArray(blueprint.reference_pool)) {
    blueprint.reference_pool.forEach(append);
  }
  return pool;
}

function formatReferenceEntry(source, candidate) {
  if (!source || !source.url) return null;
  const title = source.title || candidate.title || "Reference";
  const publisher = source.publisher || "未注明机构";
  const year = source.year || "n.d.";
  const zhLabel = `${title}（${publisher}，${year}）`;
  const enLabel = `${title} (${publisher}, ${year})`;
  return {
    label: ensureI18n({ zh: zhLabel, en: enLabel }, title),
    url: source.url
  };
}

function matchBlueprintReference(entry, pool) {
  if (!entry || !pool.length) return null;
  const url = typeof entry.url === "string" ? entry.url.trim() : undefined;
  if (url) {
    const matchedByUrl = pool.find((item) => item.url.toLowerCase() === url.toLowerCase());
    if (matchedByUrl) return matchedByUrl;
  }
  const labelText = extractText(entry.label?.zh || entry.label?.en || entry.title);
  if (labelText) {
    const normalized = labelText.toLowerCase();
    const matchedByTitle = pool.find((item) => (item.title || "").toLowerCase() === normalized);
    if (matchedByTitle) return matchedByTitle;
  }
  return null;
}

function normalizeReferences(referencesRaw, candidate, blueprint) {
  const pool = collectBlueprintReferences(blueprint);
  const placeholderEntry = {
    label: ensureI18n(
      { zh: "暂无公开参考（Internal insight）", en: "Internal insight only" },
      candidate.title
    )
  };
  const normalized = [];
  const used = new Set();
  const pushReference = (source) => {
    if (!source || used.has(source.url)) return;
    const formatted = formatReferenceEntry(source, candidate);
    if (formatted) {
      normalized.push(formatted);
      used.add(source.url);
    }
  };

  if (Array.isArray(referencesRaw)) {
    referencesRaw.forEach((ref) => {
      const matched = matchBlueprintReference(ref, pool);
      if (matched) {
        pushReference(matched);
      }
    });
  }

  if (!normalized.length && pool.length) {
    pool.slice(0, 2).forEach((item) => pushReference(item));
  }

  if (!normalized.length) {
    const hinted = typeof candidate.referenceHints?.[0] === "string" ? candidate.referenceHints[0] : undefined;
    if (hinted && !isPlaceholderUrl(hinted)) {
      normalized.push({
        label: ensureI18n(
          { zh: `${candidate.title} 延伸阅读`, en: `${candidate.title} reference` },
          candidate.title
        ),
        url: hinted
      });
    }
  }

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
  if (Array.isArray(clone.practice)) {
    const pseudoCandidate = { title: fallbackTitle || lesson?.title?.zh || lesson?.title?.en || lesson?.title || "lesson" };
    clone.practice = clone.practice.map((entry) => finalizePracticeEntry(entry || {}, pseudoCandidate));
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

function coerceLesson(candidate, lesson, date, learnerProfile, toneProfile, blueprint) {
  const title = ensureI18n(lesson.title, candidate.title);
  const summaryValue = ensureI18n(lesson.summary, `${candidate.title} 概要`);
  const summary = sanitizeSummaryValue(summaryValue, candidate, blueprint);
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
  const references = normalizeReferences(lesson.references, candidate, blueprint);
  let idBase = candidate.id;
  if (!idBase) {
    idBase = slugify(candidate.title).replace(/^-+|[^a-z0-9-]|-+$/g, "");
    if (!idBase) {
      idBase = `lesson-${hashObject(candidate.title).slice(0, 8)}`;
    }
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

async function generatePracticeSuite({ candidate, learnerProfile, blueprint, lesson }) {
  const sanitizedLesson = sanitizeLessonEntry(lesson) || lesson;
  const messages = buildPracticePrompt({
    candidate,
    learnerProfile,
    blueprint,
    lesson: sanitizedLesson
  });
  const responseFormats = [PRACTICE_RESPONSE_FORMAT, { type: "json_object" }, null];
  let lastError = null;
  for (const format of responseFormats) {
    try {
      const raw = await callLLM({ messages, temperature: 0.35, responseFormat: format });
      const parsed = parseJSON(raw);
      const collection = Array.isArray(parsed)
        ? parsed
        : parsed?.practice || parsed?.items || parsed?.data || [];
      return normalizePractice(collection, candidate);
    } catch (error) {
      lastError = error;
    }
  }
  console.warn("Practice generation failed, using fallback", lastError?.message || "unknown error");
  return normalizePractice([], candidate);
}

function appendCodeAddendum(html, blocks, langKey) {
  if (typeof html !== "string" || !Array.isArray(blocks) || !blocks.length) return html;
  const rendered = blocks
    .map((block) => {
      const content = block?.[langKey];
      if (!content || typeof content !== "string") return null;
      const title = typeof block?.title === "string" ? block.title : "代码与实操";
      return `<section class="code-addendum"><h4>${title}</h4>${content.trim()}</section>`;
    })
    .filter(Boolean)
    .join("\n");
  if (!rendered) return html;
  return `${html}\n${rendered}`;
}

async function generateCodeAddendum({ candidate, learnerProfile, blueprint, lesson }) {
  const sanitizedLesson = sanitizeLessonEntry(lesson) || lesson;
  const messages = buildCodeAddendumPrompt({
    candidate,
    learnerProfile,
    blueprint,
    lesson: sanitizedLesson
  });
  const responseFormats = [CODE_RESPONSE_FORMAT, { type: "json_object" }, null];
  let lastError = null;
  for (const format of responseFormats) {
    try {
      const raw = await callLLM({ messages, temperature: 0.3, responseFormat: format });
      const parsed = parseJSON(raw);
      const list = Array.isArray(parsed) ? parsed : parsed?.code_blocks || parsed?.items || [];
      if (Array.isArray(list) && list.length) return list;
    } catch (error) {
      lastError = error;
    }
  }
  console.warn("Code addendum generation failed", lastError?.message || "unknown error");
  return [];
}

const TRANSLATION_SYSTEM = "You are a bilingual localization editor for AI Daily Academy. Translate Chinese source text into natural, domain-accurate English while preserving HTML tags, numbers, metrics, and proper nouns.";

const TRANSLATION_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "lessonTranslations",
    schema: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["id", "en"],
        properties: {
          id: { type: "string" },
          en: { type: "string" }
        },
        additionalProperties: false
      }
    }
  }
};

const HAN_REGEX = /[\u3400-\u9fff]/;
const ASCII_LETTER_REGEX = /[a-z]/i;

function needsEnglishRewrite(zhValue, enValue) {
  const zh = typeof zhValue === "string" ? zhValue.trim() : "";
  if (!zh) return false;
  const en = typeof enValue === "string" ? enValue.trim() : "";
  if (!en) return true;
  if (en === zh) return true;
  if (HAN_REGEX.test(en) && !ASCII_LETTER_REGEX.test(en)) return true;
  if (en.length <= 8 && zh.length >= 12) return true;
  return false;
}

function collectTranslationRequests(lesson) {
  const requests = [];
  const register = (id, bundle, preserveHtml = false) => {
    if (!bundle || typeof bundle !== "object") return;
    const zh = typeof bundle.zh === "string" ? bundle.zh.trim() : "";
    const en = typeof bundle.en === "string" ? bundle.en.trim() : "";
    if (!zh || !needsEnglishRewrite(zh, en)) return;
    requests.push({
      id,
      zh,
      preserveHtml,
      apply: (text) => {
        bundle.en = text;
      }
    });
  };

  register("title", lesson.title);
  register("summary", lesson.summary);
  register("content", lesson.content, true);
  if (Array.isArray(lesson.practice)) {
    lesson.practice.forEach((entry, index) => {
      if (entry && typeof entry === "object") {
        register(`practice_question_${index}`, entry.question);
        register(`practice_explain_${index}`, entry.explain);
      }
    });
  }
  return requests;
}

async function enforceTranslations({ lesson, candidate }) {
  const requests = collectTranslationRequests(lesson);
  if (!requests.length) {
    return;
  }
  const payload = requests.map((item) => ({ id: item.id, zh: item.zh, preserve_html: item.preserveHtml }));
  const userContent = `主题：${candidate.title}\n请将下列中文文本翻译成自然英文；若 preserve_html=true，务必保留 HTML 标签结构，只替换文字内容。\n输入：\n${JSON.stringify(payload, null, 2)}\n\n输出：仅返回 JSON 数组，元素包含 id 与 en 字段。`;
  const messages = [
    { role: "system", content: TRANSLATION_SYSTEM },
    { role: "user", content: userContent }
  ];
  const responseFormats = [TRANSLATION_RESPONSE_FORMAT, { type: "json_object" }, null];
  let lastError = null;
  for (const format of responseFormats) {
    try {
      const raw = await callLLM({ messages, temperature: 0.2, responseFormat: format });
      const parsed = parseJSON(raw);
      const list = Array.isArray(parsed) ? parsed : parsed?.translations || [];
      const map = new Map();
      list.forEach((item) => {
        if (item && typeof item === "object" && typeof item.id === "string" && typeof item.en === "string") {
          map.set(item.id, item.en.trim());
        }
      });
      requests.forEach((request) => {
        const text = map.get(request.id);
        if (text) {
          request.apply(text);
        }
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  console.warn("Translation enforcement skipped", lastError?.message || "unknown error");
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
    }, date, learnerProfile, toneProfile, null);
    applyMetaDefaults(lesson, candidateProfile, learnerProfile, toneProfile);
    lesson.meta.starter_questions = fallbackStarterQuestions(candidateProfile);
    return lesson;
  }
  const blueprint = await generateBlueprint(candidateProfile, learnerProfile, toneProfile, history);
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const contentMessages = buildLessonContentPrompt({
        candidate: candidateProfile,
        learnerProfile,
        toneProfile,
        blueprint,
        recentLessons: history
      });
      const contentRaw = await callLLM({ messages: contentMessages, responseFormat: LESSON_RESPONSE_FORMAT });
      const contentParsed = parseJSON(contentRaw);
      let lessonDraft = coerceLesson(candidateProfile, contentParsed, date, learnerProfile, toneProfile, blueprint);
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
          lessonDraft = coerceLesson(candidateProfile, revision, date, learnerProfile, toneProfile, blueprint);
        } catch (revisionError) {
          console.warn("Using pre-critique lesson due to revision error", revisionError.message);
        }
      }

      // V3 Validation Loop
      for (let v3Attempt = 0; v3Attempt < 2; v3Attempt++) {
        const v3Result = validateLessonQualityV3(lessonDraft);
        if (v3Result.valid) break;

        console.warn(`V3 Validation failed (attempt ${v3Attempt + 1}):`, v3Result.errors);

        const hardCritique = {
          revision_required: true,
          scorecard: {},
          issues: v3Result.errors.map((e) => ({ severity: "high", area: "validation", note: e, action: "Fix violation" })),
          directives: v3Result.errors,
          practice_expectations: {}
        };

        try {
          const revision = await reviseLessonDraft({
            candidate: candidateProfile,
            learnerProfile,
            toneProfile,
            blueprint,
            lesson: sanitizeLessonEntry(lessonDraft),
            critique: hardCritique,
            recentLessons: history
          });
          lessonDraft = coerceLesson(candidateProfile, revision, date, learnerProfile, toneProfile, blueprint);
        } catch (e) {
          console.warn("V3 revision error", e);
          break;
        }
      }

      // V3 Prompt Update: Code is now generated within the content phase (max 2 blocks).
      // We skip the separate code addendum phase to avoid exceeding the code budget.
      /*
      const codeBlocks = await generateCodeAddendum({
        candidate: candidateProfile,
        learnerProfile,
        blueprint,
        lesson: lessonDraft
      });
      if (lessonDraft?.content) {
        if (lessonDraft.content.zh) {
          lessonDraft.content.zh = appendCodeAddendum(lessonDraft.content.zh, codeBlocks, "zh");
        }
        if (lessonDraft.content.en) {
          lessonDraft.content.en = appendCodeAddendum(lessonDraft.content.en, codeBlocks, "en");
        }
      }
      */
      
      applyMetaDefaults(lessonDraft, candidateProfile, learnerProfile, toneProfile);
      const starterQuestions = await generateStarterQuestions(lessonDraft, candidateProfile, learnerProfile);
      lessonDraft.meta.starter_questions = starterQuestions;
      const practiceSuite = await generatePracticeSuite({
        candidate: candidateProfile,
        learnerProfile,
        blueprint,
        lesson: lessonDraft
      });
      lessonDraft.practice = practiceSuite;
      await enforceTranslations({ lesson: lessonDraft, candidate: candidateProfile });
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
  const [topicsRaw, historyDoc, archivedIds] = await Promise.all([
    readJSON(path.resolve(root, TOPICS), []),
    loadHistory(),
    loadArchivedIds()
  ]);
  const lessons = sanitizeLessons(historyDoc.lessons || []);
  const topics = flattenTopics(topicsRaw);
  if (!topics.length) {
    throw new Error("No academy topics available");
  }
  const candidate = pickCandidate(topics, lessons, archivedIds);
  if (!candidate) {
    console.log("No new topics available to generate.");
    return;
  }
  const lesson = await generateLesson(candidate, lessons);
    const merged = uniqueBy([lesson, ...lessons], (entry) => {
      const titleText = extractText(entry?.title?.zh || entry?.title?.en || entry?.title || "");
      const titleSlug = slugify(titleText).replace(/^-+|[^a-z0-9-]|-+$/g, "");
      const fallbackSlug = (titleText || "").toLowerCase().replace(/\s+/g, "-") || "untitled";
      const key = `${entry?.date || ""}-${titleSlug || fallbackSlug}`;
      return key || entry?.id || `${entry?.date}-${entry?.title?.zh}`;
    });
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
