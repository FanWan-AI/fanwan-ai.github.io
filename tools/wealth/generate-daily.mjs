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
const cooldownDays = 45;
const FALLBACK_KEYWORDS = [
  "预算",
  "复利",
  "通胀",
  "风险",
  "储蓄"
];

const DIFFICULTY_LABELS = {
  1: "入门",
  2: "基础",
  3: "进阶",
  4: "高级",
  5: "专家"
};

// --- Prompts & Personas ---

const PERSONA = `You are a world-class financial educator and wealth manager (a fusion of Ray Dalio, Morgan Housel, and Richard Feynman). Your goal is to produce deep, insightful, and actionable financial content that respects the reader's intelligence. You despise generic advice. You love mental models, first principles, and historical context.`;

function buildBlueprintPrompt(candidate) {
  const related = candidate.related.join(", ") || "None";
  return `Design a high-quality daily financial lesson blueprint on: "${candidate.title}".

Context:
- Level: ${candidate.level || "General"}
- Category: ${candidate.category || "Finance"}
- Related Topics: ${related}

Your Task:
Create a structural blueprint for a "Mini-Blog Post" style lesson.
Return strict JSON with the following fields:
1. "hook": A surprising analogy, historical anecdote, or counter-intuitive fact to grab attention immediately. (e.g., "Compound interest isn't math; it's biology.")
2. "core_concept": The technical definition explained simply using First Principles.
3. "why_it_matters": The urgent relevance to personal wealth *right now*. Why should the reader care today?
4. "key_insights": 3 distinct, non-obvious insights or "Mental Models". Avoid cliches. (e.g., instead of "Diversify", use "Diversification is admitting you don't know the future".)
5. "actionable_practice": 3 specific micro-actions or thought experiments. (e.g., "Calculate your X", "Check your Y", "Simulate Z").
6. "shadow_side": When does this concept fail? What are the hidden risks or psychological traps?
7. "references": 2-3 authoritative sources (books, papers, reputable sites) with URLs.

Output JSON only.`;
}

function buildDraftPrompt(candidate, blueprint) {
  return `You are the Author. Write the full bilingual lesson content based on this Blueprint.

Blueprint:
${JSON.stringify(blueprint, null, 2)}

Requirements:
- Return strict JSON with fields: "topic", "summary", "key_points", "practice", "risk_notes", "sources".
- **topic**: Object with "zh" and "en" strings.
- **summary**: Object with "zh" and "en" strings. This is the core "Blog Post". Combine the Hook, Core Concept, and Why It Matters into a cohesive, engaging narrative (300-450 words). Use Markdown formatting (bolding key terms).
- **key_points**: Object with "zh" and "en" keys. Each key must hold an **Array of 3-4 strings**. Each string is a "Mental Model" or insight.
- **practice**: Object with "zh" and "en" keys. Each key must hold an **Array of 3 objects**. Each object has "title" (string) and "steps" (Array of strings).
- **risk_notes**: Object with "zh" and "en" strings.
- **sources**: Array of objects { title: {zh, en}, url }.

Tone: Professional yet accessible, authoritative, data-driven.
Output JSON only.`;
}

function buildCritiquePrompt(draft) {
  return `You are the Ruthless Editor. Critique this financial lesson draft.

Draft:
${JSON.stringify(draft, null, 2)}

Identify 3 specific weaknesses:
1. Is the "summary" too dry, generic, or short? Does it lack a strong narrative voice?
2. Are the "key_points" trivial? (e.g., "Save money is good" vs "Savings rate matters more than investment return").
3. Is the "practice" actionable?

Return strict JSON: { "critique": "string", "score": number (0-10) }`;
}

function buildRevisePrompt(draft, critique) {
  return `You are the Author. Revise the draft to address the Editor's critique. Make it World-Class.

Critique: "${critique.critique}"
Score: ${critique.score}/10

Original Draft:
${JSON.stringify(draft, null, 2)}

Instructions:
- If the score is < 9, rewrite the weak sections significantly.
- Ensure the "summary" is a compelling read (Mini-Blog).
- Ensure "key_points" are deep insights.
- Keep the JSON structure exactly the same.

Return strict JSON only.`;
}

// --- Helper Functions ---

function mapDifficultyLabel(value) {
  if (typeof value !== "number") return "";
  const rounded = Math.max(1, Math.min(5, Math.round(value)));
  return DIFFICULTY_LABELS[rounded] || "";
}

function splitSteps(text) {
  if (!text) return [];
  return text
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*(?:\d+\.|[-*\u2022])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

function normalizePractice(raw) {
  if (!raw || typeof raw !== "object") return {};
  const languages = ["zh", "en", "es"];
  const result = {};
  for (const lang of languages) {
    const value = raw[lang];
    if (!value) continue;
    let items = [];
    if (Array.isArray(value)) {
      items = value;
    } else if (typeof value === "object") {
      if (Array.isArray(value.items)) {
        items = value.items;
      } else if (Array.isArray(value.activities)) {
        items = value.activities;
      }
    }
    if (!items.length) continue;
    const normalized = items
      .map((item, index) => {
        if (!item) return null;
        if (typeof item === "string") {
          const steps = splitSteps(item);
          if (!steps.length) return null;
          return {
            title: `练习 ${index + 1}`,
            steps
          };
        }
        if (typeof item === "object") {
          const title = (item.title || item.name || item.heading || `练习 ${index + 1}`).toString().trim();
          let steps = [];
          if (Array.isArray(item.steps)) {
            steps = item.steps.map((step) => (step ? step.toString().trim() : ""));
          } else if (Array.isArray(item.actions)) {
            steps = item.actions.map((step) => (step ? step.toString().trim() : ""));
          } else if (typeof item.detail === "string") {
            steps = splitSteps(item.detail);
          } else if (typeof item.description === "string") {
            steps = splitSteps(item.description);
          } else if (typeof item.summary === "string") {
            steps = splitSteps(item.summary);
          }
          const filtered = steps.filter(Boolean).slice(0, 6);
          if (!filtered.length) return null;
          return {
            title: title || `练习 ${index + 1}`,
            steps: filtered
          };
        }
        return null;
      })
      .filter((item) => item && Array.isArray(item.steps) && item.steps.length)
      .slice(0, 3);
    if (normalized.length) {
      result[lang] = normalized;
    }
  }
  return result;
}

function formatPracticeText(structured) {
  const languages = ["zh", "en", "es"];
  const formatted = {};
  for (const lang of languages) {
    const activities = structured[lang];
    if (!activities || !activities.length) continue;
    const lines = [];
    activities.forEach((activity, index) => {
      const title = activity.title?.trim();
      if (activities.length > 1 || activity.steps.length > 1) {
        lines.push(`${index + 1}. ${title || "练习"}`.trim());
      } else if (title) {
        lines.push(title);
      }
      activity.steps.forEach((step) => {
        const clean = step.trim();
        if (clean) {
          lines.push(`   - ${clean}`);
        }
      });
      lines.push("");
    });
    formatted[lang] = lines.join("\n").trim();
  }
  return formatted;
}

function normalizeSources(raw) {
  if (!Array.isArray(raw)) {
    return { structured: [], display: [] };
  }

  const structured = [];
  const display = [];

  for (const entry of raw) {
    if (!entry) continue;
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const structuredEntry = { title: { zh: trimmed, en: trimmed } };
      if (/^https?:\/\//i.test(trimmed)) {
        structuredEntry.url = trimmed;
      }
      structured.push(structuredEntry);
      display.push(trimmed);
      continue;
    }
    if (typeof entry === "object") {
      const rawTitle = entry.title;
      let zh = "";
      let en = "";
      let es = "";
      if (typeof rawTitle === "string") {
        zh = rawTitle.trim();
        en = zh;
      } else if (rawTitle && typeof rawTitle === "object") {
        zh = typeof rawTitle.zh === "string" ? rawTitle.zh.trim() : "";
        en = typeof rawTitle.en === "string" ? rawTitle.en.trim() : "";
        es = typeof rawTitle.es === "string" ? rawTitle.es.trim() : "";
      }
  const rawUrl = typeof entry.url === "string" ? entry.url.trim() : (typeof entry.link === "string" ? entry.link.trim() : "");
  const url = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : "";
      const note = typeof entry.note === "string" ? entry.note.trim() : "";
      const language = typeof entry.language === "string" ? entry.language.trim() : "";
      const titleZh = zh || en || es || "参考资料";
      const titleEn = en || zh || es || "Reference";
      const titleEs = es || "";
      const structuredEntry = {
        title: { zh: titleZh, en: titleEn }
      };
      if (url) {
        structuredEntry.url = url;
      }
      if (titleEs) {
        structuredEntry.title.es = titleEs;
      }
      if (note) {
        structuredEntry.note = note;
      }
      if (language) {
        structuredEntry.language = language;
      }
      structured.push(structuredEntry);
      const parts = [titleEn || titleZh];
      if (url) {
        parts.push(url);
      }
      if (note) {
        parts.push(note);
      }
      display.push(parts.filter(Boolean).join(" | "));
    }
  }

  return {
    structured: structured.slice(0, 6),
    display: display.slice(0, 6)
  };
}

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
      temperature: 0.4, // Slightly higher for creativity
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: PERSONA + "\nYou are a meticulous assistant that only replies with valid JSON."
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

function parseJSON(raw) {
  if (!raw) throw new Error("Empty response");
  let content = raw.trim();
  if (content.startsWith("```")) {
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match) {
      content = match[1];
    }
  }
  return JSON.parse(content);
}

function coerceLesson(candidate, lesson, date) {
  const ensureLang = (obj, fallbackValue = "") => {
    if (!obj || typeof obj !== "object") {
      return { zh: fallbackValue, en: fallbackValue };
    }
    const normalized = {};
    for (const key of ["zh", "en", "es"]) {
      const raw = obj[key];
      if (raw === undefined || raw === null) continue;
      if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (trimmed) {
          normalized[key] = trimmed;
        }
      } else if (Array.isArray(raw) || typeof raw === "object") {
        normalized[key] = raw;
      }
    }
    if (!normalized.zh) {
      const fallback = typeof obj.en === "string" ? obj.en.trim() : "";
      const secondary = typeof obj.es === "string" ? obj.es.trim() : "";
      normalized.zh = fallback || secondary || fallbackValue;
    }
    if (!normalized.en) {
      normalized.en = normalized.zh || fallbackValue;
    }
    if (normalized.es && typeof normalized.es === "string" && !normalized.es.trim()) {
      delete normalized.es;
    }
    return normalized;
  };

  const ensureArray = (obj) => {
    const mapped = {};
    for (const key of ["zh", "en", "es"]) {
      const raw = obj[key];
      if (raw === undefined || raw === null) continue;
      if (Array.isArray(raw)) {
        const cleaned = raw
          .map((item) => (typeof item === "string" ? item.trim() : item))
          .filter((item) => (typeof item === "string" ? item.length > 0 : Boolean(item)))
          .slice(0, 5);
        if (cleaned.length) {
          mapped[key] = cleaned;
        }
      } else if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (trimmed) {
          mapped[key] = [trimmed];
        }
      }
    }
    return mapped;
  };

  const topic = ensureLang(lesson.topic || { zh: candidate.title, en: candidate.title });
  const summary = ensureLang(lesson.summary || {});
  const keyPoints = ensureArray(ensureLang(lesson.key_points || {}));

  let structuredPractice = normalizePractice(lesson.practice || {});
  const fallbackPracticeStructure = {
    zh: [
      {
        title: "记录与反思",
        steps: [
          "写下今日主题与你的生活的一个联系",
          "描述你可以尝试的一个行动步骤",
          "一周后复盘结果并记录心得"
        ]
      }
    ],
    en: [
      {
        title: "Reflect and Act",
        steps: [
          "Note one link between today's topic and your life",
          "Define a step you can try this week",
          "Review the outcome after seven days and capture your insight"
        ]
      }
    ]
  };

  structuredPractice = {
    ...structuredPractice,
    zh: Array.isArray(structuredPractice.zh) && structuredPractice.zh.length ? structuredPractice.zh : fallbackPracticeStructure.zh,
    en: Array.isArray(structuredPractice.en) && structuredPractice.en.length ? structuredPractice.en : fallbackPracticeStructure.en,
    es: Array.isArray(structuredPractice.es) && structuredPractice.es.length ? structuredPractice.es : structuredPractice.es
  };

  const formattedPractice = formatPracticeText(structuredPractice);
  const practiceRaw = ensureLang(lesson.practice || {});
  const practice = {};
  const fallbackPractice = {
    zh: structuredPractice.zh,
    en: structuredPractice.en
  };

  for (const key of ["zh", "en", "es"]) {
    if (formattedPractice[key]) {
      practice[key] = formattedPractice[key];
    } else if (Array.isArray(structuredPractice[key]) && structuredPractice[key].length) {
      practice[key] = formatPracticeText({ [key]: structuredPractice[key] })[key];
    } else if (typeof practiceRaw[key] === "string") {
      practice[key] = practiceRaw[key].trim();
    }
  }
  if (!practice.zh) {
    practice.zh = formatPracticeText({ zh: fallbackPractice.zh })?.zh || fallbackPractice.zh.map((item, index) => {
      const steps = item.steps.map((step) => `   - ${step}`).join("\n");
      return `${index + 1}. ${item.title}\n${steps}`;
    }).join("\n");
  }
  if (!practice.en) {
    practice.en = formatPracticeText({ en: fallbackPractice.en })?.en || fallbackPractice.en.map((item, index) => {
      const steps = item.steps.map((step) => `   - ${step}`).join("\n");
      return `${index + 1}. ${item.title}\n${steps}`;
    }).join("\n");
  }

  let { structured: structuredSources, display: displaySources } = normalizeSources(lesson.sources || []);
  const ensureDisplay = (entries) => entries.map((item) => {
    const title = item.title?.en || item.title?.zh || "Reference";
    return [title, item.url, item.note].filter(Boolean).join(" | ");
  });

  if (!structuredSources.length) {
    structuredSources = [
      {
        title: {
          zh: `${candidate.title} 背景材料`,
          en: `${candidate.title} background reading`
        }
      },
      {
        title: {
          zh: `${candidate.category || "理财"} 入门指南`,
          en: `${candidate.category || "Finance"} primer`
        }
      }
    ];
    displaySources = ensureDisplay(structuredSources);
  } else if (structuredSources.length === 1) {
    structuredSources.push({
      title: {
        zh: `${candidate.category || "理财"} 延伸阅读`,
        en: `${candidate.category || "Finance"} further reading`
      }
    });
    displaySources = ensureDisplay(structuredSources);
  } else if (!displaySources.length) {
    displaySources = ensureDisplay(structuredSources);
  }

  displaySources = displaySources.filter((item) => typeof item === "string" && item.trim()).slice(0, 6);
  structuredSources = structuredSources.slice(0, 6);

  const riskNotes = ensureLang(lesson.risk_notes || {});
  if (!riskNotes.zh || !riskNotes.zh.trim()) {
    riskNotes.zh = "不同经济周期和个人目标会改变结果，请结合自身风险承受能力谨慎行事。";
  }
  if (!riskNotes.en || !riskNotes.en.trim()) {
    riskNotes.en = "Market conditions and personal goals can shift outcomes. Reflect on your own risk tolerance before acting.";
  }

  const lessonTags = Array.isArray(lesson.tags) ? lesson.tags : [];
  const extraKeywords = Array.isArray(lesson.keywords) ? lesson.keywords : [];
  const tags = Array.from(new Set([...(candidate.tags || []), ...lessonTags, ...extraKeywords]
    .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
    .filter(Boolean))).slice(0, 10);

  const practicePreviewSource = structuredPractice.zh || structuredPractice.en || [];
  const practicePreview = practicePreviewSource.length
    ? [practicePreviewSource[0].title, practicePreviewSource[0].steps?.[0]]
        .filter(Boolean)
        .join(" · ")
    : "";

  const result = {
    date,
    topic_id: candidate.id,
    topic,
    summary,
    key_points: keyPoints,
    practice,
    sources: displaySources,
    risk_notes: riskNotes,
    degraded: false,
    meta: {
      category: candidate.category,
      difficulty: candidate.difficulty,
      level: candidate.level,
      related: candidate.related,
      tags: candidate.tags || [],
      learning_path: `${candidate.level || ""} · ${candidate.category || ""}`.trim().replace(/^ ·\s*/, ""),
      difficulty_label: mapDifficultyLabel(candidate.difficulty),
      practice: structuredPractice,
      practice_preview: practicePreview,
      sources: structuredSources,
      hash: hashObject({ date, id: candidate.id }),
      risk_notes: riskNotes
    }
  };
  return result;
}

function cloneDegraded(entry, date) {
  const clone = JSON.parse(JSON.stringify(entry));
  clone.date = date;
  clone.degraded = true;
  clone.meta = { ...(clone.meta || {}), degradedFrom: entry.date };
  if (!clone.risk_notes || typeof clone.risk_notes !== "object") {
    clone.risk_notes = {
      zh: "该内容为临时沿用，请结合当日市场信息审慎参考。",
      en: "This is a temporary carry-over. Cross-check with current market information before acting."
    };
  } else {
    if (!clone.risk_notes.zh) {
      clone.risk_notes.zh = "该内容为临时沿用，请结合当日市场信息审慎参考。";
    }
    if (!clone.risk_notes.en) {
      clone.risk_notes.en = "This is a temporary carry-over. Cross-check with current market information before acting.";
    }
  }
  clone.meta.risk_notes = clone.meta.risk_notes || clone.risk_notes;
  return clone;
}

async function generateLesson(candidate, history) {
  const date = today();
  if (dryRun) {
    // For dry run, we still want to test the pipeline if possible, or just return a mock.
    // Let's try to run the pipeline but not save.
    console.log("Starting Dry Run Pipeline...");
  }

  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      // 1. Blueprint
      console.log(`[Attempt ${attempt + 1}] Generating Blueprint for: ${candidate.title}...`);
      const blueprintPrompt = buildBlueprintPrompt(candidate);
      const blueprintRaw = await callLLM(blueprintPrompt);
      const blueprint = parseJSON(blueprintRaw);

      // 2. Draft
      console.log(`[Attempt ${attempt + 1}] Generating Draft...`);
      const draftPrompt = buildDraftPrompt(candidate, blueprint);
      const draftRaw = await callLLM(draftPrompt);
      const draft = parseJSON(draftRaw);

      // 3. Critique
      console.log(`[Attempt ${attempt + 1}] Critiquing Draft...`);
      const critiquePrompt = buildCritiquePrompt(draft);
      const critiqueRaw = await callLLM(critiquePrompt);
      const critique = parseJSON(critiqueRaw);
      console.log(`  > Critique Score: ${critique.score}/10`);
      console.log(`  > Feedback: ${critique.critique}`);

      // 4. Revise (if needed)
      let finalLesson = draft;
      if (critique.score < 9) {
        console.log(`[Attempt ${attempt + 1}] Revising Draft...`);
        const revisePrompt = buildRevisePrompt(draft, critique);
        const revisedRaw = await callLLM(revisePrompt);
        finalLesson = parseJSON(revisedRaw);
      } else {
        console.log(`[Attempt ${attempt + 1}] Draft accepted without revision.`);
      }

      return coerceLesson(candidate, finalLesson, date);

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
  // (Mock function removed for brevity, returning null will cause failure downstream or we can throw)
  throw new Error("Generation failed and no history available.");
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
