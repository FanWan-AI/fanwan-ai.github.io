// Cloudflare Worker: DeepSeek Chat proxy with SSE passthrough, CORS, and a light rate limit
// How it works
// - POST /chat: forwards JSON body to DeepSeek chat completions with stream: true and returns text/event-stream
// - GET /health: simple health endpoint
// - OPTIONS /chat: CORS preflight
// Env (Secrets):
//   DEEPSEEK_API_KEY   -> required, your DeepSeek API key (Bearer)
// Env (Vars - wrangler.toml [vars]):
//   UPSTREAM_URL       -> default "https://api.deepseek.com/chat/completions" (or vendor-compatible endpoint)
//   DEFAULT_MODEL      -> default "deepseek-reasoner" (override to your chosen model)
//   ALLOWED_ORIGINS    -> comma-separated list of allowed origins for CORS (e.g., "https://fanwan-ai.github.io,https://yourdomain.com")
//   ALLOW_DEV_ORIGINS  -> set to "1" to allow localhost/private-network origins while debugging
//   MAX_TOKENS         -> optional cap for max_tokens (e.g., "2048")
//   DEBUG              -> set to "1" for basic request logging (not for production)

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const origin = request.headers.get('Origin') || '';
      const method = request.method.toUpperCase();
      const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';

      // Basic router
      if (url.pathname === '/health') {
        return json({ ok: true, time: new Date().toISOString() }, 200, corsHeaders(env, origin));
      }

      if (url.pathname === '/chat') {
        if (method === 'OPTIONS') {
          return new Response(null, { status: 204, headers: preflightHeaders(env, origin) });
        }
        if (method !== 'POST') {
          return json({ error: 'Method Not Allowed' }, 405, corsHeaders(env, origin));
        }

        // CORS origin check
        if (!isOriginAllowed(env, origin)) {
          return json({ error: 'CORS: Origin not allowed' }, 403, corsHeaders(env, origin, true));
        }

        // Simple per-IP rate limit (best-effort, per-instance)
        const limited = await rateLimit(ip, env);
        if (limited) {
          return json({ error: 'Too Many Requests' }, 429, corsHeaders(env, origin));
        }

        // Validate and normalize body
        let payload;
        try {
          payload = await request.json();
        } catch (e) {
          return json({ error: 'Invalid JSON body' }, 400, corsHeaders(env, origin));
        }

        const upstreamUrl = env.UPSTREAM_URL || 'https://api.deepseek.com/chat/completions';
        const model = (payload && payload.model) || env.DEFAULT_MODEL || 'deepseek-reasoner';
        const temperature = clampNumber(payload?.temperature, 0, 1, 0.7);
        const maxTokensCap = env.MAX_TOKENS ? parseInt(env.MAX_TOKENS, 10) : undefined;
        const maxTokens = clampNumber(payload?.max_tokens, 1, maxTokensCap || 4096, Math.min(payload?.max_tokens || 1024, maxTokensCap || 4096));

        const messages = Array.isArray(payload?.messages) ? payload.messages : [];
        if (messages.length === 0) {
          return json({ error: 'messages[] is required' }, 400, corsHeaders(env, origin));
        }

        const upstreamBody = {
          ...payload,
          model,
          temperature,
          max_tokens: maxTokens,
          stream: true,
        };

        // Remove client-provided api key if any
        if (upstreamBody.api_key) delete upstreamBody.api_key;

        if (!env.DEEPSEEK_API_KEY) {
          return json({ error: 'Server misconfigured: missing DEEPSEEK_API_KEY' }, 500, corsHeaders(env, origin));
        }

        if (env.DEBUG === '1') console.log('Proxying to', upstreamUrl, 'model=', model);

        const upstreamResp = await fetch(upstreamUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
          },
          body: JSON.stringify(upstreamBody),
        });

        if (!upstreamResp.ok) {
          const text = await upstreamResp.text();
          if (env.DEBUG === '1') console.log('Upstream error', upstreamResp.status, text);
          let payload = null;
          try {
            payload = text ? JSON.parse(text) : null;
          } catch (_) {
            payload = null;
          }
          const errorPayload = payload && payload.error ? payload : {
            error: {
              message: payload && typeof payload === 'object' && payload.message ? payload.message : (text || 'Upstream error'),
              code: payload && typeof payload === 'object' && payload.code ? payload.code : 'upstream_error',
              status: upstreamResp.status
            }
          };
          return json(errorPayload, upstreamResp.status, corsHeaders(env, origin));
        }

        // Pass-through SSE stream
        const headers = corsHeaders(env, origin);
        headers.set('Content-Type', 'text/event-stream; charset=utf-8');
        headers.set('Cache-Control', 'no-cache, no-transform');
        headers.set('Connection', 'keep-alive');
        headers.set('X-Accel-Buffering', 'no');
        return new Response(upstreamResp.body, { status: 200, headers });
      }

      return json({ error: 'Not Found' }, 404, corsHeaders(env, request.headers.get('Origin') || ''));
    } catch (err) {
      return new Response('Internal Error', { status: 500 });
    }
  }
}

// --- helpers ---
function json(data, status = 200, headers = new Headers()) {
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { status, headers });
}

function corsHeaders(env, origin, forceBlock = false) {
  const h = new Headers();
  const allowed = isOriginAllowed(env, origin);
  if (allowed && !forceBlock) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Vary', 'Origin');
    h.set('Access-Control-Allow-Credentials', 'true');
    h.set('Access-Control-Expose-Headers', 'Content-Type');
  } else {
    // Return a restrictive CORS by default (no wildcard)
    h.set('Vary', 'Origin');
  }
  return h;
}

function preflightHeaders(env, origin) {
  const h = corsHeaders(env, origin);
  if (isOriginAllowed(env, origin)) {
    h.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    h.set('Access-Control-Max-Age', '86400');
  }
  return h;
}

function isOriginAllowed(env, origin) {
  const incoming = normalizeOrigin(origin);
  if (!incoming) {
    return false;
  }
  const list = (env.ALLOWED_ORIGINS || '').split(',').map(s => normalizeOrigin(s)).filter(Boolean);
  if (list.includes(incoming)) {
    return true;
  }
  if (env.ALLOW_DEV_ORIGINS === '1' && isDevOrigin(incoming)) {
    return true;
  }
  return false;
}

function normalizeOrigin(value) {
  if (!value) {
    return '';
  }
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch (_) {
    return String(value).trim().replace(/\/+$/, '');
  }
}

function isDevOrigin(origin) {
  try {
    const url = new URL(origin);
    const protocol = url.protocol;
    if (protocol !== 'http:' && protocol !== 'https:') {
      return false;
    }
    const hostname = url.hostname || '';
    if (!hostname) {
      return false;
    }
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
      return true;
    }
    if (hostname.endsWith('.local')) {
      return true;
    }
    if (hostname.startsWith('10.') || hostname.startsWith('192.168.')) {
      return true;
    }
    if (hostname.startsWith('172.')) {
      const parts = hostname.split('.');
      if (parts.length >= 2) {
        const second = parseInt(parts[1], 10);
        if (!Number.isNaN(second) && second >= 16 && second <= 31) {
          return true;
        }
      }
    }
    return false;
  } catch (_) {
    return false;
  }
}

// Best-effort in-memory sliding window per instance
// For production-grade limits, prefer Cloudflare Rate Limiting Rules or Durable Objects
const RATE_MAP = new Map(); // key -> { windowStart, count }
const WINDOW_MS = 60_000;  // 1 minute
const LIMIT = 20;          // 20 requests/minute per IP (per instance)

async function rateLimit(ip, env) {
  const now = Date.now();
  const rec = RATE_MAP.get(ip) || { windowStart: now, count: 0 };
  if (now - rec.windowStart > WINDOW_MS) {
    rec.windowStart = now;
    rec.count = 0;
  }
  rec.count += 1;
  RATE_MAP.set(ip, rec);
  return rec.count > LIMIT;
}

function clampNumber(n, min, max, fallback) {
  const x = typeof n === 'number' && !Number.isNaN(n) ? n : fallback;
  if (typeof x !== 'number') return fallback;
  if (typeof min === 'number' && x < min) return min;
  if (typeof max === 'number' && x > max) return max;
  return x;
}
