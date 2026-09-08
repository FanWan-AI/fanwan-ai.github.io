import { DEFAULT_MAX_BYTES, DEFAULT_RETRIES, DEFAULT_TIMEOUT_MS } from "./constants.mjs";
import { StartupError } from "./errors.mjs";
import { assertPublicUrl } from "./url-security.mjs";
import { sleep } from "./utils.mjs";

function retryable(status) { return status === 408 || status === 425 || status === 429 || status >= 500; }

const DEFAULT_HEADERS = {
  "user-agent": "fanwan-ai-startup-research/1.0 (+https://fanwan-ai.github.io)",
  accept: "text/html,application/rss+xml,application/xml,text/plain;q=0.8,*/*;q=0.2"
};
const CREDENTIAL_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key", "api-key", "x-subscription-token"]);

function headersForRequest(headers, credentialsAllowed) {
  const result = new Headers(headers);
  if (!credentialsAllowed) for (const name of CREDENTIAL_HEADERS) result.delete(name);
  return result;
}

export async function fetchText(rawUrl, options = {}) {
  const url = await assertPublicUrl(rawUrl, { resolveDns: options.resolveDns ?? true });
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const requestHeaders = new Headers(DEFAULT_HEADERS);
  for (const [name, value] of new Headers(options.headers || {})) requestHeaders.set(name, value);
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let currentUrl = url;
      let credentialsAllowed = true;
      let response;
      for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
        response = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: headersForRequest(requestHeaders, credentialsAllowed)
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get("location");
        if (!location || redirectCount === 3) throw new StartupError("Too many or invalid source redirects", "HTTP_REDIRECT");
        const nextUrl = await assertPublicUrl(new URL(location, currentUrl).toString(), { resolveDns: options.resolveDns ?? true });
        if (new URL(nextUrl).origin !== new URL(currentUrl).origin) credentialsAllowed = false;
        currentUrl = nextUrl;
      }
      if (!response.ok) {
        const error = new StartupError(`HTTP ${response.status} for source`, "HTTP_ERROR");
        if (!retryable(response.status) || attempt >= retries) throw error;
        lastError = error;
      } else {
        const declared = Number(response.headers.get("content-length") || 0);
        if (declared > maxBytes) throw new StartupError("Source exceeds byte limit", "BYTE_LIMIT");
        const reader = response.body?.getReader();
        if (!reader) return await response.text();
        const chunks = [];
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) { await reader.cancel(); throw new StartupError("Source exceeds byte limit", "BYTE_LIMIT"); }
          chunks.push(value);
        }
        return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
      }
    } catch (error) {
      lastError = error.name === "AbortError" ? new StartupError("Source request timed out", "TIMEOUT") : error;
      if (attempt >= retries || (lastError.code && !["TIMEOUT", "HTTP_ERROR"].includes(lastError.code))) throw lastError;
    } finally { clearTimeout(timer); }
    await sleep(Math.min(4_000, 250 * 2 ** attempt));
  }
  throw lastError || new StartupError("Source request failed", "HTTP_ERROR");
}
