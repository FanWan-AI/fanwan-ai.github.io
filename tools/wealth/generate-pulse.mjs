import path from "path";
import process from "process";

import {
  DATA_DIR,
  PULSE,
  PULSE_ARCH,
  SCHEMAS,
  backoff,
  readJSON,
  rollWindowAndArchive,
  sleep,
  today,
  validateWithSchema,
  writeJSON
} from "./util.mjs";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");
const maxRetries = dryRun ? 0 : 2;

function normalizeFacts(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch (error) {
      console.warn("Failed to parse NEWS_FACTS", error.message);
    }
  }
  return [];
}

async function loadFacts() {
  const fromEnv = normalizeFacts(process.env.NEWS_FACTS);
  if (fromEnv.length) return fromEnv;

  const factsPath = process.env.NEWS_FACTS_PATH;
  if (factsPath) {
    try {
      const abs = path.resolve(root, factsPath);
      const data = await readJSON(abs, []);
      if (Array.isArray(data)) return data;
    } catch (error) {
      console.warn(`Failed to read facts from ${factsPath}: ${error.message}`);
    }
  }

  return [];
}

function buildPrompt(facts) {
  const serialized = JSON.stringify(facts, null, 2);
  return `You are an economic news editor writing neutral market pulse summaries. Convert the provided structured facts into impact-aware briefs.

Rules:
- Output JSON only with a top-level array of items.
- Each item must include title, source, facts.zh, facts.en, impact_one_liner.zh, impact_one_liner.en, time_utc when available, and at least one link when provided.
- Facts should stay faithful to the supplied material; do not invent data.
- Impact lines explain potential economic implications in one sentence, using conditional language.
- Avoid trading advice, certainty, or hype.
- Language tone: factual, calm, educational.

Facts input:
${serialized}
`;
}

async function callLLM(prompt) {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error("Missing LLM_API_KEY environment variable");
  }
  const baseURL = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.LLM_MODEL || "gpt-4o-mini";

  const response = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are a precise assistant returning valid JSON only."
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

function parseItems(raw) {
  let content = raw.trim();
  if (content.startsWith("{")) {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed.items)) {
      return parsed.items;
    }
    if (Array.isArray(parsed)) {
      return parsed;
    }
    throw new Error("Pulse response missing items array");
  }
  if (content.startsWith("[")) {
    return JSON.parse(content);
  }
  if (content.startsWith("```")) {
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match) {
      return parseItems(match[1]);
    }
  }
  throw new Error("Unsupported response format");
}

function sanitizeItem(item) {
  const ensureLang = (obj) => {
    if (!obj || typeof obj !== "object") return { zh: "", en: "" };
    if (!obj.zh) obj.zh = obj.en || "";
    if (!obj.en) obj.en = obj.zh || "";
    if (obj.es && !obj.es.trim()) delete obj.es;
    return obj;
  };

  const links = Array.isArray(item.links) ? item.links.filter(Boolean).slice(0, 5) : [];
  return {
    title: item.title?.trim() || "市场动态更新",
    source: item.source?.trim() || "待更新来源",
    time_utc: item.time_utc,
    facts: ensureLang(item.facts),
    impact_one_liner: ensureLang(item.impact_one_liner),
    links
  };
}

async function generatePulseEntry(facts) {
  if (!facts.length) {
    return null;
  }

  if (dryRun) {
    return {
      date: today(),
      items: facts.slice(0, 5).map((fact) => sanitizeItem({
        title: fact.title || "市场动态",
        source: fact.source || "示例来源",
        time_utc: fact.time_utc,
        facts: {
          zh: fact.snippet || "示例事实，需替换为真实输入。"
        },
        impact_one_liner: {
          zh: "可能影响市场情绪，请结合宏观环境综合判断。"
        },
        links: fact.links || (fact.link ? [fact.link] : [])
      }))
    };
  }

  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const prompt = buildPrompt(facts);
      const raw = await callLLM(prompt);
      const items = parseItems(raw).map(sanitizeItem).slice(0, 8);
      return {
        date: today(),
        items
      };
    } catch (error) {
      lastError = error;
      console.warn(`Pulse attempt ${attempt + 1} failed: ${error.message}`);
      if (attempt < maxRetries) {
        await sleep(backoff(attempt));
      }
    }
  }

  console.error("Pulse generation failed", lastError);
  return null;
}

async function main() {
  const facts = await loadFacts();
  if (!facts.length) {
    console.log("No reliable facts provided, skipping pulse update.");
    return;
  }

  const entry = await generatePulseEntry(facts);
  if (!entry || !entry.items.length) {
    console.log("Pulse entry not generated, skipping update.");
    return;
  }

  if (dryRun) {
    console.log(JSON.stringify(entry, null, 2));
    return;
  }

  const history = await readJSON(path.resolve(root, PULSE), []);
  const filtered = history.filter((item) => item.date !== entry.date);
  const updated = [entry, ...filtered].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const trimmed = await rollWindowAndArchive(
    updated,
    30,
    path.resolve(root, PULSE_ARCH)
  );
  await writeJSON(path.resolve(root, PULSE), trimmed);

  const { valid, errors } = await validateWithSchema(
    path.resolve(root, PULSE),
    path.resolve(root, `${SCHEMAS}/pulse.schema.json`)
  );

  if (!valid) {
    console.error("Pulse schema validation failed", errors);
    process.exitCode = 1;
    return;
  }

  console.log(`Generated pulse entry with ${entry.items.length} items for ${entry.date}`);
}

main().catch((error) => {
  console.error("Pulse generation failed", error);
  process.exitCode = 1;
});
