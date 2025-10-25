// Cloudflare Worker: OpenAI Chat proxy with SSE passthrough, CORS, and light rate limiting
// Routes
//   POST /chat   -> forwards Chat Completions-style payloads to OpenAI, returns text/event-stream
//   GET  /health -> simple health probe
// Required env secrets:
//   OPENAI_API_KEY        -> Bearer token for OpenAI (do not prefix with "Bearer"; worker will handle it)
// Optional env vars (wrangler.toml [vars]):
//   OPENAI_BASE_URL       -> default "https://api.openai.com/v1/chat/completions"
//   DEFAULT_MODEL         -> default "gpt-5"
//   ALLOWED_ORIGINS       -> comma-separated allow list for CORS (e.g. "https://fanwan-ai.github.io")
//   ALLOW_DEV_ORIGINS     -> set to "1" to allow localhost/private-network origins (dev only)
//   MAX_TOKENS            -> optional server-side cap for max_tokens / max_completion_tokens
//   OPENAI_ORG            -> optional organisation header
//   OPENAI_PROJECT        -> optional project header
//   OPENAI_EXTRA_HEADERS  -> optional JSON string of additional headers (e.g. beta flags)
//   DEBUG                 -> set to "1" to log basic debugging info (avoid in production)

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const origin = request.headers.get('Origin') || '';
      const method = request.method.toUpperCase();
      const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';

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

        if (!isOriginAllowed(env, origin)) {
          return json({ error: 'CORS: Origin not allowed' }, 403, corsHeaders(env, origin, true));
        }

        const limited = await rateLimit(ip, env);
        if (limited) {
          return json({ error: 'Too Many Requests' }, 429, corsHeaders(env, origin));
        }

        let payload;
        try {
          payload = await request.json();
        } catch (err) {
          return json({ error: 'Invalid JSON body' }, 400, corsHeaders(env, origin));
        }

        const upstreamUrl = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions').trim();
        const model = (payload && payload.model) || env.DEFAULT_MODEL || 'gpt-5';
        const temperature = clampNumber(payload?.temperature, 0, 2, 0.7);
        const maxTokensCap = env.MAX_TOKENS ? parseInt(env.MAX_TOKENS, 10) : undefined;
        const requestedMaxTokens = payload?.max_tokens ?? payload?.max_completion_tokens;
        const maxTokens = clampNumber(requestedMaxTokens, 1, maxTokensCap || undefined, payload?.max_tokens || payload?.max_completion_tokens || 1024);

        const messages = Array.isArray(payload?.messages) ? payload.messages : [];
        if (messages.length === 0) {
          return json({ error: 'messages[] is required' }, 400, corsHeaders(env, origin));
        }

        const upstreamBody = {
          ...payload,
          model,
          temperature,
          stream: payload?.stream !== false,
        };

        if (maxTokensCap) {
          upstreamBody.max_tokens = maxTokens;
          upstreamBody.max_completion_tokens = maxTokens;
        } else if (requestedMaxTokens != null) {
          upstreamBody.max_tokens = maxTokens;
          upstreamBody.max_completion_tokens = maxTokens;
        }

        if (payload && Object.prototype.hasOwnProperty.call(payload, 'api_key')) {
          delete upstreamBody.api_key;
        }

        if (!env.OPENAI_API_KEY) {
          return json({ error: 'Server misconfigured: missing OPENAI_API_KEY' }, 500, corsHeaders(env, origin));
        }

        if (env.DEBUG === '1') {
          console.log('Proxying OpenAI request', { model, origin });
        }

        const headers = buildUpstreamHeaders(env);

        const upstreamResp = await fetch(upstreamUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(upstreamBody),
        });

        if (!upstreamResp.ok) {
          const text = await upstreamResp.text();
          if (env.DEBUG === '1') {
            console.log('OpenAI upstream error', upstreamResp.status, text.slice(0, 500));
          }
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

        const cors = corsHeaders(env, origin);
        cors.set('Content-Type', 'text/event-stream; charset=utf-8');
        cors.set('Cache-Control', 'no-cache, no-transform');
        cors.set('Connection', 'keep-alive');
        cors.set('X-Accel-Buffering', 'no');
        return new Response(upstreamResp.body, { status: 200, headers: cors });
      }

      return json({ error: 'Not Found' }, 404, corsHeaders(env, origin));
    } catch (error) {
      return new Response('Internal Error', { status: 500 });
    }
  }
};

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
  const allowList = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(item => normalizeOrigin(item))
    .filter(Boolean);
  if (allowList.includes(incoming)) {
    return true;
  }
  if (env.ALLOW_DEV_ORIGINS === '1' && isDevOrigin(incoming)) {
    return true;
  }
  if (env.DEBUG === '1') {
    console.log('CORS block', {
      origin,
      normalized: incoming,
      allowList,  
      allowDevOrigins: env.ALLOW_DEV_ORIGINS === '1'
    });
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

const RATE_MAP = new Map();
const WINDOW_MS = 60_000;
const LIMIT = 20;

async function rateLimit(ip, env) {
  const now = Date.now();
  const entry = RATE_MAP.get(ip) || { windowStart: now, count: 0 };
  if (now - entry.windowStart > WINDOW_MS) {
    entry.windowStart = now;
    entry.count = 0;
  }
  entry.count += 1;
  RATE_MAP.set(ip, entry);
  return entry.count > LIMIT;
}

function clampNumber(n, min, max, fallback) {
  const parsed = typeof n === 'number' && !Number.isNaN(n) ? n : fallback;
  if (typeof parsed !== 'number') return fallback;
  if (typeof min === 'number' && parsed < min) return min;
  if (typeof max === 'number' && parsed > max) return max;
  return parsed;
}

function buildUpstreamHeaders(env) {
  const headers = new Headers();
  const apiKey = (env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY missing');
  }
  const bearer = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
  headers.set('Authorization', bearer);
  headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'text/event-stream');

  const org = (env.OPENAI_ORG || '').trim();
  if (org) {
    headers.set('OpenAI-Organization', org);
  }
  const project = (env.OPENAI_PROJECT || '').trim();
  if (project) {
    headers.set('OpenAI-Project', project);
  }

  if (env.OPENAI_EXTRA_HEADERS) {
    try {
      const extra = JSON.parse(env.OPENAI_EXTRA_HEADERS);
      if (extra && typeof extra === 'object') {
        Object.keys(extra).forEach(key => {
          const value = extra[key];
          if (value != null) {
            headers.set(key, String(value));
          }
        });
      }
    } catch (err) {
      if (env.DEBUG === '1') {
        console.warn('OPENAI_EXTRA_HEADERS parse error', err);
      }
    }
  }

  return headers;
}
