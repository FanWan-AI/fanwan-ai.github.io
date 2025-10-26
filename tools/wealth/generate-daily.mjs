import path from "path";
import process from "process";

import {
  DATA_DIR,
  DAILY,
  DAILY_ARCH,
  SCHEMAS,
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

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");
const maxRetries = dryRun ? 0 : 2;
const cooldownDays = 60;
const FALLBACK_KEYWORDS = [
  "预算",
  "复利",
  "通胀",
  "风险",
  "储蓄"
];

function daysBetween(dateA, dateB) {
  const diff = new Date(dateA).getTime() - new Date(dateB).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function flattenTopics(levels) {
  const items = [];
  for (const level of levels) {
    const levelLabel = level.level;
    const categories = level.categories || [];
    for (const category of categories) {
      const categoryName = category.category;
      const topics = category.topics || [];
      for (const topic of topics) {
        let baseId = topic.id || slugify(topic.topic || "");
        if (!baseId && Array.isArray(topic.keywords) && topic.keywords.length) {
          baseId = slugify(topic.keywords[0]);
        }
        if (!baseId) {
          baseId = `topic-${hashObject({
            level: levelLabel,
            category: categoryName,
            topic: topic.topic
          }).slice(0, 12)}`;
        }
        items.push({
          id: baseId,
          title: topic.topic,
          level: levelLabel,
          category: categoryName,
          difficulty: topic.difficulty ?? category.difficulty ?? 1,
          order: topic.order ?? category.recommended_order ?? 0,
          related: topic.related_topics || [],
          tags: topic.tags || topic.keywords || [],
          source: topic
        });
      }
    }
  }
  return items;
}

function summarizeHistory(history) {
  const map = new Map();
  history.forEach((entry) => {
    if (!entry || !entry.date) return;
    const key = entry.topic_id || slugify(entry.topic?.zh || entry.topic?.en || "");
    if (!key) return;
    const last = map.get(key);
    if (!last || entry.date > last) {
      map.set(key, entry.date);
    }
  });
  return map;
}

function recentCategories(history, count) {
  return history
    .slice(0, count)
    .map((entry) => entry.meta?.category)
    .filter(Boolean);
}

function scoreCandidate(candidate, history, summary) {
  const todayStr = today();
  const lastUsed = summary.get(candidate.id);
  const progressScore = lastUsed ? 0.3 : 1;
  const recent = history.slice(0, 7);
  const categoryCount = recent.filter((entry) => entry.meta?.category === candidate.category).length;
  const coverageScore = 1 - Math.min(categoryCount / 7, 1);
  const lastPair = history.slice(0, 2).map((entry) => entry.meta?.related || []);
  const recentRelated = new Set(lastPair.flat());
  const relationScore = candidate.related.some((item) => recentRelated.has(item)) ? 1 : 0.4;
  const lastCategory = history[0]?.meta?.category;
  const diversityScore = lastCategory && lastCategory !== candidate.category ? 1 : 0.4;

  let cooldownPenalty = 0;
  if (lastUsed) {
    const delta = daysBetween(todayStr, lastUsed);
    cooldownPenalty = delta < cooldownDays ? -10 : 0;
  }

  const difficultyGap = Math.abs((history[0]?.meta?.difficulty ?? candidate.difficulty) - candidate.difficulty);
  const difficultyPenalty = difficultyGap > 1 ? -2 : 0;

  const total = progressScore * 0.5 + coverageScore * 0.2 + relationScore * 0.2 + diversityScore * 0.1 + cooldownPenalty + difficultyPenalty;
  return total;
}

function pickCandidate(candidates, history) {
  if (!candidates.length) return null;
  const summary = summarizeHistory(history);
  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, history, summary)
    }))
    .filter((entry) => entry.score > -5);

  if (!scored.length) {
    return null;
  }

  scored.sort((a, b) => b.score - a.score);
  const topScore = scored[0].score;
  const topGroup = scored.filter((entry) => topScore - entry.score < 0.15);
  return topGroup[Math.floor(Math.random() * topGroup.length)].candidate;
}

function fallbackCandidate(candidates) {
  for (const keyword of FALLBACK_KEYWORDS) {
    const match = candidates.find((item) => item.title?.includes(keyword));
    if (match) return match;
  }
  return candidates[0] || null;
}

function buildPrompt(candidate) {
  return `You are a bilingual financial literacy mentor creating daily lessons for beginners. Produce concise, actionable guidance.

Constraints:
- Output strict JSON only. No commentary.
- Provide fields: topic, summary, key_points, practice, sources.
- Each field must be an object with zh and en strings. If a field is not available in English, mirror zh value.
- key_points should have 3 to 5 bullet strings (arrays) per language.
- Mention risks, uncertainty, and avoid investment advice.
- Tone: encouraging, factual, practical.

Topic context (Chinese): ${candidate.title}
Related: ${candidate.related.join(", ") || "无"}
Level: ${candidate.level || "N/A"}
Category: ${candidate.category || "N/A"}
Audience: Financial beginners seeking easy wins.
`; }

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
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are a meticulous assistant that only replies with valid JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM request failed: ${response.status} ${text}`);
  }

  const body = await response.json();
  const message = body.choices?.[0]?.message?.content;
  if (!message) {
    throw new Error("LLM response missing content");
  }
  return message.trim();
}

function parseLesson(raw) {
  if (!raw) throw new Error("Empty response");
  let content = raw.trim();
  if (content.startsWith("```")) {
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match) {
      content = match[1];
    }
  }
  const lesson = JSON.parse(content);
  return lesson;
}

function coerceLesson(candidate, lesson, date) {
  const ensureLang = (obj) => {
    if (!obj || typeof obj !== "object") return { zh: "" };
    if (!obj.zh) {
      const fallback = obj.en || obj.es || "";
      obj.zh = fallback;
    }
    if (!obj.en) {
      obj.en = obj.zh;
    }
    if (obj.es && !obj.es.trim()) {
      delete obj.es;
    }
    return obj;
  };

  const ensureArray = (obj) => {
    for (const key of ["zh", "en", "es"]) {
      if (obj[key]) {
        obj[key] = Array.isArray(obj[key]) ? obj[key] : [obj[key]].filter(Boolean);
      }
    }
    return obj;
  };

  const result = {
    date,
    topic_id: candidate.id,
    topic: ensureLang(lesson.topic || { zh: candidate.title, en: candidate.title }),
    summary: ensureLang(lesson.summary),
    key_points: ensureArray(ensureLang(lesson.key_points || {})),
    practice: ensureLang(lesson.practice),
    sources: Array.isArray(lesson.sources) ? lesson.sources.slice(0, 6) : [],
    degraded: false,
    meta: {
      category: candidate.category,
      difficulty: candidate.difficulty,
      level: candidate.level,
      related: candidate.related,
      hash: hashObject({ date, id: candidate.id })
    }
  };

  if (!result.summary.zh) {
    result.summary.zh = `学习主题：${candidate.title}`;
  }
  if (!result.summary.en) {
    result.summary.en = result.summary.zh;
  }

  if (!result.practice || !result.practice.zh) {
    result.practice = ensureLang({
      zh: "结合今日主题写下一个可执行的小步骤，并记录感受。",
      en: "Write down one actionable step related to today's topic and note the takeaway."
    });
  }

  if (!result.sources.length) {
    result.sources = [`${candidate.title} 背景材料`];
  }

  return result;
}

function mockLesson(candidate, date) {
  return {
    date,
    topic_id: candidate.id,
    topic: {
      zh: candidate.title,
      en: candidate.title
    },
    summary: {
      zh: `${candidate.title}：理解概念并结合自身情况评估。`
    },
    key_points: {
      zh: [
        "概念：用自己的话解释含义",
        "行动：列出三条与你生活相关的影响",
        "风险：明确收益与不确定性"
      ]
    },
    practice: {
      zh: "写下今天可以完成的一个小动作，帮助你应用该概念。"
    },
    sources: [`${candidate.title} 入门指南`],
    degraded: false,
    meta: {
      category: candidate.category,
      difficulty: candidate.difficulty,
      level: candidate.level,
      related: candidate.related
    }
  };
}

function cloneDegraded(entry, date) {
  const clone = JSON.parse(JSON.stringify(entry));
  clone.date = date;
  clone.degraded = true;
  clone.meta = { ...(clone.meta || {}), degradedFrom: entry.date };
  return clone;
}

async function generateLesson(candidate, history) {
  const date = today();
  if (dryRun) {
    return mockLesson(candidate, date);
  }

  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const prompt = buildPrompt(candidate);
      const raw = await callLLM(prompt);
      const lesson = parseLesson(raw);
      return coerceLesson(candidate, lesson, date);
    } catch (error) {
      lastError = error;
      const delay = backoff(attempt);
      console.warn(`Attempt ${attempt + 1} failed: ${error.message}`);
      if (attempt < maxRetries) {
        await sleep(delay);
      }
    }
  }

  console.error("Failed to generate lesson after retries", lastError);
  if (history.length) {
    return cloneDegraded(history[0], date);
  }

  // No history to degrade from, produce mock placeholder marked degraded.
  const placeholder = mockLesson(candidate, date);
  placeholder.degraded = true;
  return placeholder;
}

async function main() {
  const [topicsRaw, history] = await Promise.all([
    readJSON(path.resolve(root, `${DATA_DIR}/topics.json`), []),
    readJSON(path.resolve(root, DAILY), [])
  ]);

  const topics = flattenTopics(topicsRaw);
  if (!topics.length) {
    throw new Error("No topics available in topics.json");
  }

  const candidate = pickCandidate(topics, history) || fallbackCandidate(topics);
  if (!candidate) {
    throw new Error("Unable to select candidate topic");
  }

  const lesson = await generateLesson(candidate, history);
  lesson.topic_id = lesson.topic_id || candidate.id;
  lesson.topic = lesson.topic || { zh: candidate.title, en: candidate.title };

  if (dryRun) {
    console.log(JSON.stringify(lesson, null, 2));
    return;
  }

  const updated = [lesson, ...history].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const trimmed = await rollWindowAndArchive(
    updated,
    60,
    path.resolve(root, DAILY_ARCH)
  );
  await writeJSON(path.resolve(root, DAILY), trimmed);
  const { valid, errors } = await validateWithSchema(
    path.resolve(root, DAILY),
    path.resolve(root, `${SCHEMAS}/finance-daily.schema.json`)
  );
  if (!valid) {
    console.error("Generated lesson failed schema validation", errors);
    process.exitCode = 1;
    return;
  }
  console.log(`Generated lesson for ${lesson.date}: ${lesson.topic.zh}`);
}

main().catch((error) => {
  console.error("Daily generation failed", error);
  process.exitCode = 1;
});
