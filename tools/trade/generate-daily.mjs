import path from "path";
import process from "process";
import { promises as fs } from "fs";
import {
  DATA_DIR,
  DAILY,
  DAILY_ARCH,
  TOPICS,
  backoff,
  readJSON,
  rollWindowAndArchive,
  sleep,
  today,
  writeJSON
} from "./util.mjs";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");

async function callLLM(prompt) {
  const apiKey = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("Missing LLM_API_KEY");
  const baseURL = process.env.LLM_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
  const model = process.env.LLM_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat";

  const response = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) throw new Error(`LLM failed: ${response.status}`);
  const body = await response.json();
  return body.choices?.[0]?.message?.content || "";
}

function flattenTopics(raw) {
    const list = [];
    raw.forEach(level => {
        level.categories.forEach(cat => {
            cat.topics.forEach(topic => {
                if (topic.topic) {
                    list.push({
                        ...topic,
                        category: cat.category,
                        level_name: level.level
                    });
                }
            });
        });
    });
    return list;
}

function pickCandidate(topics, history) {
    const usedTitles = new Set(history.map(h => {
        const t = h.topic?.zh || h.topic?.en || "";
        return t.trim();
    }));
    
    // Find first unused topic
    for (const t of topics) {
        if (!usedTitles.has(t.topic.trim())) {
            return t;
        }
    }
    return null; // All used
}

function parseLesson(text, candidate) {
    const sections = {};
    const regex = /### 模块 (\d+)：(.*?)\n([\s\S]*?)(?=### 模块|$)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        sections[match[1]] = match[3].trim();
    }

    const sectionKeys = Object.keys(sections);
    console.log(`Parsed sections: ${sectionKeys.join(", ")}`);
    if (sectionKeys.length < 3) {
        console.warn("Warning: Few sections parsed. LLM output might be malformed.");
    }

    // Topic
    const meta = sections['0'] || "";
    const titleMatch = meta.match(/章节标题[：:]\s*(.*)/);
    const title = titleMatch ? titleMatch[1].trim() : candidate.topic;
    
    // Summary (Module 1 + 2)
    // Use Module 1 (Opening) for the card summary
    const mod1 = sections['1'] || "";
    // Take the first paragraph that is not empty
    const summaryText = mod1.split('\n').find(l => l.trim().length > 10) || "今日外贸课";

    return {
        date: today(),
        topic: { zh: title, en: title },
        summary: { zh: summaryText, en: summaryText },
        markdown_content: { zh: text, en: text }, // Store full text
        meta: {
            difficulty: candidate.difficulty,
            category: candidate.category
        }
    };
}

async function main() {
    const [topicsRaw, history] = await Promise.all([
        readJSON(path.resolve(root, TOPICS), []),
        readJSON(path.resolve(root, DAILY), [])
    ]);

    const topics = flattenTopics(topicsRaw);
    if (!topics.length) throw new Error("No topics found");

    const candidate = pickCandidate(topics, history);
    if (!candidate) {
        console.log("All topics covered!");
        return;
    }

    console.log(`Generating lesson for: ${candidate.topic}`);

    // Read prompt template
    const promptPath = path.resolve(root, "tools/trade/trade_lesson_prompt.txt");
    let promptTemplate = await fs.readFile(promptPath, "utf8");
    
    // Split generation into two parts to avoid truncation
    console.log("  > Generating Part 1 (Modules 0-4)...");
    const promptPart1 = `
Current Topic: ${candidate.topic}
Category: ${candidate.category}
Difficulty: ${candidate.difficulty}
Related Topics: ${(candidate.related_topics || []).join(", ")}
Keywords: ${(candidate.keywords || []).join(", ")}

${promptTemplate}

【特别指令】
本次只输出 **模块 0 到 模块 4** 的内容。
请在 **模块 4** 结束后立即停止输出。
`;

    const textPart1 = await callLLM(promptPart1);
    
    console.log("  > Generating Part 2 (Modules 5-7)...");
    const promptPart2 = `
Current Topic: ${candidate.topic}
Category: ${candidate.category}
Difficulty: ${candidate.difficulty}

${promptTemplate}

【特别指令】
你已经完成了模块 0-4 的撰写。
现在请继续撰写 **模块 5 到 模块 7** 的内容。
请直接从 **### 模块 5：实战演练场** 开始输出。
不要重复前面的内容。
`;

    const textPart2 = await callLLM(promptPart2);
    
    const fullText = textPart1 + "\n\n" + textPart2;
    const lesson = parseLesson(fullText, candidate);

    if (dryRun) {
        console.log(JSON.stringify(lesson, null, 2));
        return;
    }

    const updated = [lesson, ...history].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const trimmed = await rollWindowAndArchive(updated, 60, path.resolve(root, DAILY_ARCH));
    
    const destPath = path.resolve(root, DAILY);
    console.log(`Writing ${trimmed.length} items to ${destPath}...`);
    await writeJSON(destPath, trimmed);
    console.log(`Successfully generated and saved lesson: ${lesson.topic.zh}`);
}

main().catch(e => {
    console.error("Fatal error in generate-daily:", e);
    process.exit(1);
});
