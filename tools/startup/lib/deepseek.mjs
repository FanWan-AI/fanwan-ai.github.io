import { DEFAULT_RETRIES } from "./constants.mjs";
import { StartupError } from "./errors.mjs";
import { parseJsonText, redactError, sleep } from "./utils.mjs";

const RESPONSE_UNSUPPORTED = /(?:not found|unsupported|unknown|invalid).*(?:responses|response_format|json_schema)|(?:responses|response_format|json_schema).*(?:not found|unsupported|unknown|invalid)/iu;

function config() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new StartupError("DEEPSEEK_API_KEY is required for production generation", "MISSING_API_KEY");
  return {
    apiKey,
    baseUrl: (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(/\/+$/u, ""),
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    timeoutMs: Math.max(5_000, Math.min(60_000, Number(process.env.DEEPSEEK_TIMEOUT_MS || 30_000))),
    retries: Math.max(0, Math.min(3, Number(process.env.DEEPSEEK_RETRIES ?? DEFAULT_RETRIES)))
  };
}

function schemaFormat(name, schema) {
  return { type: "json_schema", json_schema: { name, strict: true, schema } };
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const chunks = [];
  for (const output of payload?.output || []) for (const content of output?.content || []) {
    if (typeof content?.text === "string") chunks.push(content.text);
    else if (content?.json) chunks.push(JSON.stringify(content.json));
  }
  return chunks.join("\n").trim();
}

async function request(url, body, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "POST", signal: controller.signal, headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) });
    const text = await response.text();
    if (!response.ok) {
      const error = new StartupError(`DeepSeek HTTP ${response.status}`, "LLM_HTTP", { status: response.status, body: text.slice(0, 500) });
      error.unsupported = [400, 404, 405, 415, 422].includes(response.status) || RESPONSE_UNSUPPORTED.test(text);
      error.retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
      throw error;
    }
    try { return JSON.parse(text); } catch { throw new StartupError("DeepSeek returned invalid JSON", "LLM_RESPONSE"); }
  } catch (error) {
    if (error.name === "AbortError") throw new StartupError("DeepSeek request timed out", "LLM_TIMEOUT");
    throw error;
  } finally { clearTimeout(timer); }
}

async function withRetries(operation, retries) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try { return await operation(); } catch (error) {
      lastError = error;
      if (attempt >= retries || error.unsupported || error.retryable === false) break;
      await sleep(Math.min(5_000, 400 * 2 ** attempt));
    }
  }
  throw lastError;
}

export async function callStructured({ system, user, schemaName, schema, useWebSearch = false }) {
  const { apiKey, baseUrl, model, timeoutMs, retries } = config();
  const input = [{ role: "system", content: system }, { role: "user", content: user }];
  try {
    const payload = await withRetries(() => request(`${baseUrl}/responses`, {
      model, input, temperature: 0.1, max_output_tokens: 8_192,
      ...(useWebSearch ? { tools: [{ type: "web_search" }] } : {}),
      text: { format: schemaFormat(schemaName, schema) }
    }, apiKey, timeoutMs), retries);
    const text = extractResponseText(payload);
    if (!text) throw new StartupError("DeepSeek Responses payload has no text", "LLM_RESPONSE");
    return parseJsonText(text);
  } catch (responsesError) {
    if (!(responsesError.unsupported || responsesError.code === "LLM_RESPONSE" || responsesError.code === "LLM_HTTP")) throw new StartupError(redactError(responsesError), responsesError.code || "LLM_ERROR");
    let payload;
    try {
      payload = await withRetries(() => request(`${baseUrl}/chat/completions`, {
        model, temperature: 0.1, max_tokens: 8_192,
        response_format: schemaFormat(schemaName, schema), messages: input
      }, apiKey, timeoutMs), retries);
    } catch (chatError) {
      if (!chatError.unsupported) throw new StartupError(redactError(chatError), chatError.code || "LLM_ERROR");
      payload = await withRetries(() => request(`${baseUrl}/chat/completions`, {
        model, temperature: 0.1, max_tokens: 8_192,
        response_format: { type: "json_object" }, messages: input
      }, apiKey, timeoutMs), retries);
    }
    const text = payload.choices?.[0]?.message?.content;
    if (!text) throw new StartupError("DeepSeek Chat Completions payload has no content", "LLM_RESPONSE");
    return parseJsonText(text);
  }
}

export function hasApiKey() { return Boolean(process.env.DEEPSEEK_API_KEY); }
