import path from "path";
import process from "process";
import { promises as fs } from "fs";

import {
  DATA_DIR,
  DAILY,
  DAILY_ARCH,
  backoff,
  readJSON,
  rollWindowAndArchive,
  sleep,
  today,
  writeJSON
} from "./util.mjs";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");
const maxRetries = dryRun ? 0 : 2;

// New constants
const TOPIC_FILE = path.resolve(root, DATA_DIR, "business_ecno_topic.json");
const PROMPT_FILE = path.resolve(root, "tools/wealth/business_econ.txt");

async function callLLM(prompt, systemPrompt) {
  const apiKey = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("Missing LLM_API_KEY or DEEPSEEK_API_KEY environment variable");
  }
  const baseURL = process.env.LLM_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
  const model = process.env.LLM_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat";

  const isReasoner = model.includes("reasoner");
  
  // DeepSeek V3/R1 recommends higher temperatures (1.0-1.5) compared to other models.
  // 0.0 for Coding, 1.3 for General Conversation, 1.5 for Creative Writing.
  // We use 1.3 to balance creative lesson writing with structured JSON output.
  const bodyPayload = {
    model,
    temperature: 1.3,
    messages: [
      {
        role: "system",
        content: systemPrompt || "You are a helpful assistant that outputs JSON."
      },
      {
        role: "user",
        content: prompt
      }
    ]
  };

  // Reasoner models (like DeepSeek R1) often output <think> blocks and don't support json_object enforcement well
  // or need more token budget.
  if (!isReasoner) {
    bodyPayload.response_format = { type: "json_object" };
  } else {
    // Give it plenty of room for reasoning + JSON
    // DeepSeek Reasoner supports up to 64K output tokens
    bodyPayload.max_tokens = 60000; 
  }

  const response = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(bodyPayload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM request failed: ${response.status} ${text}`);
  }

  const body = await response.json();
  
  if (body.choices?.[0]?.finish_reason === "length") {
    console.warn("Warning: LLM generation truncated (finish_reason='length'). Output may be incomplete.");
  }

  const message = body.choices?.[0]?.message?.content;
  if (!message) {
    throw new Error("LLM response missing content");
  }
  return message.trim();
}

function parseJSON(raw) {
  if (!raw) throw new Error("Empty response");
  let content = raw.trim();

  // Strip <think>...</think> blocks from reasoning models
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  if (content.startsWith("```")) {
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match) {
      content = match[1];
    }
  }
  return JSON.parse(content);
}

async function getNextLesson(topicData, history) {
  const allLessons = [];
  for (const mod of topicData.modules) {
    for (const lesson of mod.lessons) {
      allLessons.push({
        ...lesson,
        module_title: mod.module_title,
        module_id: mod.module_id
      });
    }
  }

  if (!history || history.length === 0) {
    return allLessons[0];
  }

  // Sort history by date descending
  const sortedHistory = [...history].sort((a, b) => b.date.localeCompare(a.date));
  const lastEntry = sortedHistory[0];
  const lastId = lastEntry.meta?.lesson_id;

  if (!lastId) {
    // Fallback: if no lesson_id, assume we start over or try to match title?
    // Let's start over for safety if the schema changed significantly.
    return allLessons[0];
  }

  const lastIndex = allLessons.findIndex(l => l.lesson_id === lastId);
  if (lastIndex === -1 || lastIndex === allLessons.length - 1) {
    return null; // Done
  }
  
  return allLessons[lastIndex + 1];
}

async function generateLesson(lesson, topicData) {
  const date = today();
  const promptTemplate = await fs.readFile(PROMPT_FILE, "utf8");
  
  const inputContext = {
    course_meta: topicData.course_meta,
    generation_contract: topicData.generation_contract,
    module: {
      module_id: lesson.module_id,
      module_title: lesson.module_title
    },
    lesson: {
      title: lesson.title,
      theme: lesson.theme,
      key_concepts: lesson.key_concepts,
      learning_outcomes: lesson.learning_outcomes,
      business_case_seed: lesson.business_case_seed,
      micro_exercise: lesson.micro_exercise,
      deliverable: lesson.deliverable
    }
  };

  const prompt = `
Input Data:
${JSON.stringify(inputContext, null, 2)}

Instructions:
1. Generate the lesson content based on the "System Persona" and "Input Data".
2. The output MUST be a valid JSON object.
3. The JSON structure must be:
{
  "topic": { "zh": "Lesson Title", "en": "English Title" },
  "summary": { 
    "zh": "A compelling summary (Opening Scene + Map) in Markdown", 
    "en": "English translation of summary" 
  },
  "markdown_content": { 
    "zh": "The FULL lesson content (Opening, Map, Core Concepts, etc.) in Markdown",
    "en": "The FULL lesson content in English"
  },
  "key_points": { 
    "zh": ["Key Insight 1", "Key Insight 2", "Key Insight 3"], 
    "en": ["English Insight 1", "English Insight 2", "English Insight 3"] 
  },
  "practice": {
    "zh": [ { "title": "Exercise Title", "steps": ["Step 1", "Step 2"] } ],
    "en": [ { "title": "English Title", "steps": ["Step 1", "Step 2"] } ]
  },
  "risk_notes": {
    "zh": "Common pitfalls or risks",
    "en": "English translation"
  }
}
`;

  console.log(`Generating lesson: ${lesson.title}...`);
  
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const raw = await callLLM(prompt, promptTemplate);
      const data = parseJSON(raw);
      
      // Construct final entry
      return {
        date,
        topic_id: lesson.lesson_id,
        topic: data.topic,
        summary: data.summary,
        markdown_content: data.markdown_content,
        key_points: data.key_points,
        practice: data.practice,
        risk_notes: data.risk_notes,
        meta: {
          lesson_id: lesson.lesson_id,
          module_id: lesson.module_id,
          category: "Business & Economics",
          difficulty: 1, // Default or map from lesson
          tags: lesson.key_concepts || []
        }
      };
    } catch (e) {
      console.warn(`Attempt ${attempt + 1} failed: ${e.message}`);
      lastError = e;
      await sleep(backoff(attempt));
    }
  }
  throw lastError;
}

async function main() {
  const [topicData, history] = await Promise.all([
    readJSON(TOPIC_FILE, {}),
    readJSON(path.resolve(root, DAILY), [])
  ]);

  if (!topicData.modules) {
    throw new Error("Invalid topic data: missing modules");
  }

  const nextLesson = await getNextLesson(topicData, history);
  if (!nextLesson) {
    console.log("All lessons generated or no next lesson found.");
    return;
  }

  const lessonEntry = await generateLesson(nextLesson, topicData);

  if (dryRun) {
    console.log(JSON.stringify(lessonEntry, null, 2));
    return;
  }

  const updated = [lessonEntry, ...history].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  
  const trimmed = await rollWindowAndArchive(
    updated,
    60,
    path.resolve(root, DAILY_ARCH)
  );
  
  await writeJSON(path.resolve(root, DAILY), trimmed);
  console.log(`Successfully generated and saved lesson: ${lessonEntry.topic.zh}`);
}

main().catch((error) => {
  console.error("Daily generation failed", error);
  process.exitCode = 1;
});
