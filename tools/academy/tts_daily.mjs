import path from "path";
import process from "process";
import { fileURLToPath } from "url";
import { Buffer } from "buffer";
import { promises as fs } from "fs";
import {
  DAILY,
  ensureDir,
  readJSON,
  writeJSON
} from "./util.mjs";

const root = process.cwd();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv = process.argv.slice(2)) {
  return argv.reduce(
    (acc, arg) => {
      if (arg.startsWith("--id=")) {
        acc.id = arg.split("=")[1];
      }
      if (arg.startsWith("--lang=")) {
        acc.lang = arg.split("=")[1];
      }
      return acc;
    },
    { lang: "zh" }
  );
}

function selectLesson(doc, id) {
  const lessons = Array.isArray(doc?.lessons) ? doc.lessons : [];
  if (!lessons.length) {
    throw new Error("No academy lessons found in daily.json");
  }
  if (!id) {
    return lessons[0];
  }
  const match = lessons.find((lesson) => lesson.id === id);
  if (!match) {
    throw new Error(`Lesson with id ${id} not found`);
  }
  return match;
}

function stripHtml(value) {
  if (!value) return "";
  return value
    .replace(/<\/?p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSpeechText(lesson, lang = "zh") {
  const title = lesson.title?.[lang] || lesson.title?.zh || lesson.title?.en || lesson.id;
  const summary = stripHtml(lesson.summary?.[lang] || lesson.summary?.zh || lesson.summary?.en || "");
  const content = stripHtml(lesson.content?.[lang] || lesson.content?.zh || lesson.content?.en || "");
  const practice = Array.isArray(lesson.practice)
    ? lesson.practice
        .map((entry, index) => {
          const question = entry.question?.[lang] || entry.question?.zh || entry.question?.en;
          if (!question) return null;
          return `${index + 1}. ${question}`;
        })
        .filter(Boolean)
        .join(" ")
    : "";
  const combined = [title, summary, content, practice].filter(Boolean).join("\n");
  return combined.slice(0, Number(process.env.TTS_MAX_CHARS || 3000));
}

function resolveAudioPath(lesson, lang = "zh") {
  if (!lesson.audio) {
    lesson.audio = {};
  }
  if (!lesson.audio[lang]) {
    lesson.audio[lang] = `/assets/audio/daily/${lesson.id}-${lang}.mp3`;
  }
  return lesson.audio[lang];
}

async function synthesizeWithDashScope(text, lang = "zh") {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error("DASHSCOPE_API_KEY is required for TTS");
  }
  const endpoint = process.env.DASHSCOPE_TTS_ENDPOINT || "https://dashscope.aliyuncs.com/api/v1/services/tts/text-to-speech";
  const langKey = String(lang || "zh").toLowerCase();
  const defaultVoice = langKey.startsWith("en") ? "Alex" : "Cherry";
  const voice =
    process.env.DASHSCOPE_TTS_VOICE ||
    process.env.TTS_VOICE ||
    process.env.voice ||
    defaultVoice;
  const format = process.env.TTS_AUDIO_FORMAT || "mp3";
  const model = process.env.DASHSCOPE_TTS_MODEL || "qwen3-tts-flash";
  const sampleRate = Number(process.env.TTS_SAMPLE_RATE || 48000);
  const payload = {
    model,
    input: { text },
    parameters: {
      format,
      sample_rate: sampleRate,
      voice
    }
  };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`DashScope TTS failed: ${response.status} ${detail}`);
  }
  const data = await response.json();
  const audioBase64 =
    data?.output?.audio?.data ||
    data?.output?.audio ||
    data?.audio?.data ||
    data?.audio ||
    data?.data?.audio;
  if (!audioBase64) {
    throw new Error("DashScope TTS response missing audio payload");
  }
  return Buffer.from(audioBase64, "base64");
}

async function writeAudio(buffer, relativePath) {
  const absPath = path.resolve(root, relativePath.startsWith("/") ? `.${relativePath}` : relativePath);
  const dir = path.dirname(absPath);
  await ensureDir(dir);
  await fs.writeFile(absPath, buffer);
  return absPath;
}

async function updateDailyDocument(doc, lesson) {
  const lessons = Array.isArray(doc.lessons) ? doc.lessons : [];
  const next = lessons.map((entry) => (entry.id === lesson.id ? lesson : entry));
  const updated = { ...doc, lessons: next };
  const dailyPath = path.resolve(root, DAILY);
  await writeJSON(dailyPath, updated);
}

async function main() {
  const args = parseArgs();
  const dailyPath = path.resolve(root, DAILY);
  const doc = await readJSON(dailyPath, { lessons: [] });
  const lesson = selectLesson(doc, args.id);
  const lang = args.lang || "zh";
  const speechText = buildSpeechText(lesson, lang);
  if (!speechText) {
    throw new Error("Nothing to synthesize; lesson text empty");
  }
  console.log(`Synthesizing TTS for lesson ${lesson.id} (${lang})`);
  const audioBuffer = await synthesizeWithDashScope(speechText, lang);
  const relativePath = resolveAudioPath(lesson, lang);
  await writeAudio(audioBuffer, relativePath);
  await updateDailyDocument(doc, lesson);
  console.log(`Saved audio to ${relativePath}`);
}

main().catch((error) => {
  console.error("Academy TTS generation failed", error);
  process.exitCode = 1;
});
