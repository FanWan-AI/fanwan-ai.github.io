/*
 * Cloudflare Worker proxy for DeepSeek API
 *
 * This Worker exposes an OpenAI‑compatible chat endpoint that forwards
 * requests to the DeepSeek API. It supports both streaming (SSE)
 * and non‑streaming responses and implements basic CORS handling.
 *
 * Environment variables (set via Cloudflare dashboard > Workers & Pages >
 * Settings > Variables and Secrets):
 *
 *   DEEPSEEK_API_KEY  – Your DeepSeek API token (secret).
 *   ALLOWED_ORIGINS   – Comma‑separated list of origins allowed to call this
 *                        proxy (e.g. "https://fanwan-ai.github.io"). Use
 *                        "*" to allow all origins (not recommended).
 *   UPSTREAM_URL      – Optional override for the DeepSeek API base URL. The
 *                        default is "https://api.deepseek.com/chat/completions".
 *
 * The proxy listens on the relative path "/v1/chat/completions" to mimic
 * the OpenAI API schema used by the front‑end. You can change this path by
 * adjusting the `match` check below, but remember to update your front‑end
 * accordingly.
 */

export default {
  /**
   * Fetch handler for all incoming HTTP requests.
   *
   * @param {Request} request Incoming request from client
   * @param {Object} env      Environment bindings (DEEPSEEK_API_KEY, ALLOWED_ORIGINS, UPSTREAM_URL)
   * @param {Object} ctx      Execution context (unused)
   */
  async fetch(request, env, ctx) {
    // Prepare CORS headers based on allowed origins.
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
    const requestOrigin = request.headers.get('Origin') || '';
    const allowOrigin = allowed.includes('*') || allowed.includes(requestOrigin) ? requestOrigin : '';
    const cors = {
      'Access-Control-Allow-Origin': allowOrigin || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    };

    // Respond to CORS preflight requests.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // Only allow POST requests to the chat completions endpoint.
    const url = new URL(request.url);
    if (request.method !== 'POST' || !url.pathname.endsWith('/v1/chat/completions')) {
      return new Response('Not Found', { status: 404, headers: { ...cors, 'Content-Type': 'text/plain' } });
    }

    // DeepSeek API configuration.
    const apiKey = env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return new Response('Server misconfigured: missing DEEPSEEK_API_KEY', { status: 500, headers: { ...cors, 'Content-Type': 'text/plain' } });
    }
    const upstream = env.UPSTREAM_URL || 'https://api.deepseek.com/chat/completions';

    // Parse client payload.
    let payload;
    try {
      payload = await request.json();
    } catch (err) {
      return new Response('Invalid JSON body', { status: 400, headers: { ...cors, 'Content-Type': 'text/plain' } });
    }

    // Default model and streaming flag if not provided.
    if (!payload || typeof payload !== 'object') {
      payload = {};
    }
    if (!payload.model) {
      payload.model = 'deepseek-chat';
    }
    // Ensure stream is a boolean. DeepSeek supports `stream: true` for SSE.
    if (payload.stream === undefined) {
      payload.stream = true;
    }

    // Forward the request to DeepSeek.
    const upstreamHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };
    let upstreamResponse;
    try {
      upstreamResponse = await fetch(upstream, {
        method: 'POST',
        headers: upstreamHeaders,
        body: JSON.stringify(payload)
      });
    } catch (err) {
      return new Response('Error contacting DeepSeek API', { status: 502, headers: { ...cors, 'Content-Type': 'text/plain' } });
    }

    // Propagate status and stream the body directly to the client.
    const contentType = upstreamResponse.headers.get('content-type') || 'application/json';
    const responseHeaders = { ...cors, 'Content-Type': contentType };
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders
    });
  }
};