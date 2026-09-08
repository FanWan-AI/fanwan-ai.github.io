import { DEFAULT_RETRIES } from "./constants.mjs";
import { StartupError } from "./errors.mjs";
import { parseJsonText, redactError, sleep } from "./utils.mjs";

function config() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new StartupError("DEEPSEEK_API_KEY is required for production generation", "MISSING_API_KEY");
  return {
    apiKey,
    // DeepSeek's OpenAI-compatible base URL is /; callers may set /v1 or another compatible prefix.
    baseUrl: (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/u, ""),
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    timeoutMs: Math.max(5_000, Math.min(300_000, Number(process.env.DEEPSEEK_TIMEOUT_MS || 180_000))),
    retries: Math.max(0, Math.min(3, Number(process.env.DEEPSEEK_RETRIES ?? DEFAULT_RETRIES)))
  };
}

function jsonMode() { return { type: "json_object" }; }

function schemaInstruction(schemaName, schema) {
  return `\nReturn only one valid JSON object; do not use Markdown, code fences or a wrapper key. ${schemaName} is the contract name, NOT an object key. Follow this JSON Schema exactly:\n${JSON.stringify(schema)}`;
}

async function request(url, body, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new StartupError(`DeepSeek HTTP ${response.status}`, "LLM_HTTP", { status: response.status, body: text.slice(0, 500) });
      error.retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
      if (response.status === 401) error.retryable = false;
      throw error;
    }
    try { return JSON.parse(text); } catch { throw new StartupError("DeepSeek returned invalid JSON", "LLM_RESPONSE"); }
  } catch (error) {
    if (error.name === "AbortError") {
      const timeout = new StartupError("DeepSeek request timed out", "LLM_TIMEOUT");
      timeout.retryable = true;
      throw timeout;
    }
    if (error instanceof TypeError && /fetch failed/i.test(error.message)) error.retryable = true;
    throw error;
  } finally { clearTimeout(timer); }
}

async function withRetries(operation, retries) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try { return await operation(); } catch (error) {
      lastError = error;
      if (attempt >= retries || error.retryable !== true) break;
      await sleep(Math.min(5_000, 400 * 2 ** attempt));
    }
  }
  throw lastError;
}

function contentFromCompletion(payload) {
  const choice = payload?.choices?.[0];
  const finishReason = choice?.finish_reason;
  if (finishReason === "length") throw new StartupError("DeepSeek JSON output was truncated (finish_reason=length)", "LLM_TRUNCATED");
  if (finishReason && finishReason !== "stop") throw new StartupError(`DeepSeek completion ended with ${finishReason}`, "LLM_RESPONSE");
  const text = choice?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new StartupError("DeepSeek Chat Completions payload has no content", "LLM_RESPONSE");
  return text;
}

export async function callStructured({ system, user, schemaName, schema, verify = false }) {
  const { apiKey, baseUrl, model, timeoutMs, retries } = config();
  const messages = [
    { role: "system", content: `${system}${schemaInstruction(schemaName, schema)}` },
    { role: "user", content: user }
  ];
  try {
    const payload = await withRetries(() => request(`${baseUrl}/chat/completions`, {
      model,
      temperature: 0.1,
      max_tokens: verify ? 8_192 : 16_384,
      thinking: { type: verify ? "enabled" : "disabled" },
      ...(verify ? { reasoning_effort: "low" } : {}),
      response_format: jsonMode(),
      messages
    }, apiKey, timeoutMs), retries);
    if (process.env.STARTUP_LOG_USAGE === "1") console.log(`[startup] ${schemaName}: input=${payload.usage?.prompt_tokens ?? "?"}, output=${payload.usage?.completion_tokens ?? "?"}`);
    const result = parseJsonText(contentFromCompletion(payload));
    return result && Object.keys(result).length === 1 && Object.hasOwn(result, schemaName) ? result[schemaName] : result;
  } catch (error) {
    throw new StartupError(redactError(error, apiKey), error.code || "LLM_ERROR", error.details);
  }
}

export function hasApiKey() { return Boolean(process.env.DEEPSEEK_API_KEY); }
