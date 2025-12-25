import path from "path";
import process from "process";

import {
  DAILY,
  SCHEMAS,
  TOPICS,
  readJSON,
  validateWithSchema
} from "./util.mjs";

const root = process.cwd();
const toAbs = (p) => path.resolve(root, p);
const DAILY_SCHEMA = `${SCHEMAS}/daily.schema.json`;
const TOPIC_SCHEMA = `${SCHEMAS}/topics.schema.json`;
const LESSON_LIMIT = 90;

async function run() {
  const errors = [];
  const { valid, errors: schemaErrors } = await validateWithSchema(toAbs(DAILY), toAbs(DAILY_SCHEMA));
  if (!valid) {
    errors.push({ name: "academy-daily", type: "schema", details: schemaErrors });
  } else {
    const doc = await readJSON(toAbs(DAILY), { lessons: [] });
    const lessons = Array.isArray(doc.lessons) ? doc.lessons : [];
    if (lessons.length > LESSON_LIMIT) {
      errors.push({ name: "academy-daily", type: "limit", details: [`${lessons.length} lessons > limit ${LESSON_LIMIT}`] });
    }

    // Code Budget Validator: Ensure no lesson has > 2 code blocks per language
    // Only enforce for lessons generated on or after 2025-12-16 (V3 prompt rollout)
    for (const lesson of lessons) {
      if (lesson.date >= "2025-12-16" && lesson.content) {
        for (const lang of ["zh", "en"]) {
          if (typeof lesson.content[lang] === "string") {
            const codeBlocks = (lesson.content[lang].match(/<pre><code>/g) || []).length;
            if (codeBlocks > 2) {
              errors.push({
                name: "academy-daily",
                type: "code-budget",
                details: [`Lesson ${lesson.id} (${lang}) has ${codeBlocks} code blocks (limit 2)`]
              });
            }
          }
        }
      }
    }
  }

  try {
    const topicSchema = await readJSON(toAbs(TOPIC_SCHEMA), null);
    if (topicSchema) {
      const { valid: topicsValid, errors: topicErrors } = await validateWithSchema(toAbs(TOPICS), toAbs(TOPIC_SCHEMA));
      if (!topicsValid) {
        errors.push({ name: "academy-topics", type: "schema", details: topicErrors });
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  if (errors.length) {
    for (const issue of errors) {
      console.error(`✗ ${issue.name} (${issue.type})`);
      (issue.details || []).forEach((detail) => console.error(`  - ${typeof detail === "string" ? detail : JSON.stringify(detail)}`));
    }
    process.exitCode = 1;
    return;
  }

  console.log("✓ Academy data validated");
}

if (process.argv[1].endsWith("validate.mjs")) {
  run().catch((error) => {
    console.error("Unexpected academy validation failure", error);
    process.exitCode = 1;
  });
}

export function validateLessonQualityV3(lesson) {
  const errors = [];

  // 1. EN Pure (No Chinese characters in en fields)
  const enStrings = [];
  function collectEn(obj) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach(collectEn);
      return;
    }
    for (const key in obj) {
      if (key === "en" && typeof obj[key] === "string") {
        enStrings.push({ path: key, value: obj[key] });
      } else {
        collectEn(obj[key]);
      }
    }
  }
  collectEn(lesson);

  for (const item of enStrings) {
    if (/[\u4e00-\u9fff]/.test(item.value)) {
      errors.push(`Bilingual purity violation: Chinese characters found in EN field: "${item.value.slice(0, 20)}..."`);
    }
  }

  // 2. Code Block Budget & 3. No External I/O
  const zhContent = lesson.content?.zh || "";
  const zhCodeBlocks = (zhContent.match(/<pre><code>[\s\S]*?<\/code><\/pre>/g) || []);
  
  if (zhCodeBlocks.length > 2) {
    errors.push(`Code block budget exceeded: ${zhCodeBlocks.length} blocks found (max 2)`);
  }
  if (zhCodeBlocks.length < 1) {
    errors.push(`Code block budget underflow: ${zhCodeBlocks.length} blocks found (min 1)`);
  }

  for (const block of zhCodeBlocks) {
    const code = block.replace(/<\/?pre>|<\/?code>/g, "");
    if (/read_csv|open\(|requests\.|wget|curl/.test(code)) {
      errors.push(`Forbidden I/O detected in code block: read_csv/open/requests`);
    }
  }

  // 4. Math Formulas
  const mathCount = (zhContent.match(/\\\[|\\\(/g) || []).length;
  if (mathCount < 3) {
    errors.push(`Math density insufficient: ${mathCount} formulas found (min 3)`);
  }

  // 5. Citation Closure
  const citations = [];
  // Match （来源：Title） or (Source: Title)
  for (const m of zhContent.matchAll(/（来源：(.*?)）/g)) {
     const parts = m[1].split(/[，,]/);
     citations.push(parts[0].trim());
  }
  for (const m of zhContent.matchAll(/\(Source: (.*?)\)/g)) {
     const parts = m[1].split(/[,]/);
     citations.push(parts[0].trim());
  }

  const refTitles = new Set();
  if (Array.isArray(lesson.references)) {
    lesson.references.forEach((ref) => {
      if (ref.title) refTitles.add(normalizeTitle(ref.title));
    });
  }

  for (const cited of citations) {
    if (!refTitles.has(normalizeTitle(cited))) {
      errors.push(`Citation not found in references: "${cited}"`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function normalizeTitle(t) {
  return t.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, "");
}
