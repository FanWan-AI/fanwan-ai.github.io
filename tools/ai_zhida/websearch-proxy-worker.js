// Cloudflare Worker: Web search proxy for Brave Search API
// Routes:
//   POST /search  -> forwards query to Brave Search, normalizes results
//   OPTIONS /search -> CORS preflight
//   GET /health  -> health check
//
// Required env:
//   BRAVE_API_KEY        Brave Search API subscription token
// Optional env:
//   UPSTREAM_URL         Override Brave endpoint (default https://api.search.brave.com/res/v1/web/search)
//   ALLOWED_ORIGINS      Comma-separated list of allowed origins
//   ALLOW_DEV_ORIGINS    Set to "1" to allow localhost/private network origins
//   DEFAULT_REGION       Default region (e.g., "wt-wt")
//   DEFAULT_FRESHNESS    Default freshness window (day|week|month)
//   MAX_RESULTS          Hard limit for results (default 10)
//   DEBUG                Set to "1" for basic logging

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const origin = request.headers.get('Origin') || '';
      const method = request.method.toUpperCase();

      if (url.pathname === '/health') {
        return json({ ok: true, time: new Date().toISOString() }, 200, corsHeaders(env, origin));
      }

      if (url.pathname === '/search') {
        if (method === 'OPTIONS') {
          return new Response(null, { status: 204, headers: preflightHeaders(env, origin) });
        }
        if (method !== 'POST') {
          return json({ error: 'Method Not Allowed' }, 405, corsHeaders(env, origin));
        }
        if (!isOriginAllowed(env, origin)) {
          return json({ error: 'Origin not allowed' }, 403, corsHeaders(env, origin, true));
        }
        let payload;
        try {
          payload = await request.json();
        } catch (_) {
          return json({ error: 'Invalid JSON body' }, 400, corsHeaders(env, origin));
        }
        const query = typeof payload.query === 'string' ? payload.query.trim() : '';
        if (!query) {
          return json({ error: 'query is required' }, 400, corsHeaders(env, origin));
        }

        const maxResultsEnv = env.MAX_RESULTS ? parseInt(env.MAX_RESULTS, 10) : 10;
        const maxResults = clampNumber(payload.maxResults, 1, maxResultsEnv, Math.min(6, maxResultsEnv));
        const freshness = sanitizeFreshness(payload.freshness || env.DEFAULT_FRESHNESS || '');
        const region = sanitizeRegion(payload.region || env.DEFAULT_REGION || '');

        if (!env.BRAVE_API_KEY) {
          return json({ error: 'Missing BRAVE_API_KEY' }, 500, corsHeaders(env, origin));
        }

        const upstream = new URL(env.UPSTREAM_URL || 'https://api.search.brave.com/res/v1/web/search');
        upstream.searchParams.set('q', query);
        upstream.searchParams.set('count', String(maxResults));
        if (freshness) upstream.searchParams.set('freshness', freshness);
        if (region) upstream.searchParams.set('country', region);
        if (payload.safeSearch != null) upstream.searchParams.set('safesearch', String(payload.safeSearch));
        if (payload.searchLang) upstream.searchParams.set('search_lang', String(payload.searchLang));

        const upstreamResp = await fetch(upstream.toString(), {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'X-Subscription-Token': env.BRAVE_API_KEY,
            'User-Agent': 'fanwan-ai-websearch-proxy/1.0'
          },
          cf: { cacheTtl: 0 }
        });

        if (!upstreamResp.ok) {
          const detail = await safeReadText(upstreamResp);
          if (env.DEBUG === '1') {
            console.log('Brave upstream error', upstreamResp.status, detail);
          }
          return json({ error: 'Upstream error', status: upstreamResp.status, detail }, upstreamResp.status, corsHeaders(env, origin));
        }

        const data = await upstreamResp.json();
        const normalized = normalizeBraveResults(data, maxResults);
        const responseBody = {
          ok: true,
          query,
          results: normalized.results,
          total: normalized.total,
          took: normalized.took,
          region: region || null,
          freshness: freshness || null
        };
        return json(responseBody, 200, corsHeaders(env, origin));
      }

      return json({ error: 'Not Found' }, 404, corsHeaders(env, origin));
    } catch (error) {
      if (env && env.DEBUG === '1') {
        console.error('websearch-proxy error', error);
      }
      return json({ error: 'Internal Error' }, 500, new Headers({ 'Content-Type': 'application/json' }));
    }
  }
};

function normalizeBraveResults(data, maxResults) {
  const webResults = data && data.web && Array.isArray(data.web.results) ? data.web.results : [];
  const results = [];
  const limit = clampNumber(maxResults, 1, 10, 6);
  for (let i = 0; i < webResults.length && results.length < limit; i += 1) {
    const item = webResults[i];
    if (!item || !item.url || !/^https?:/i.test(item.url)) {
      continue;
    }
    results.push({
      title: item.title || '',
      url: item.url,
      snippet: cleanSnippet(item.description || item.snippet || ''),
      source: item.meta_url && item.meta_url.hostname ? item.meta_url.hostname : '',
      publishedAt: item.age && item.age.iso8601 ? item.age.iso8601 : null,
      score: typeof item.score === 'number' ? item.score : null,
      language: item.language || null
    });
  }
  return {
    results,
    total: data && data.web && typeof data.web.total === 'number' ? data.web.total : null,
    took: data && data.query && data.query.timings ? data.query.timings.request || null : null
  };
}

function cleanSnippet(value) {
  if (!value) {
    return '';
  }
  return String(value).replace(/\s+/g, ' ').trim();
}

function json(data, status, headers = new Headers()) {
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { status, headers });
}

async function safeReadText(response) {
  try {
    return await response.text();
  } catch (_) {
    return '';
  }
}

function corsHeaders(env, origin, forceBlock = false) {
  const headers = new Headers();
  const allowed = isOriginAllowed(env, origin);
  if (allowed && !forceBlock) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  } else {
    headers.set('Vary', 'Origin');
  }
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Expose-Headers', 'Content-Type');
  return headers;
}

function preflightHeaders(env, origin) {
  const headers = corsHeaders(env, origin);
  if (isOriginAllowed(env, origin)) {
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Max-Age', '86400');
  }
  return headers;
}

function isOriginAllowed(env, origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return false;
  }
  const list = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(item => normalizeOrigin(item))
    .filter(Boolean);
  if (list.includes(normalized)) {
    return true;
  }
  if (env.ALLOW_DEV_ORIGINS === '1' && isDevOrigin(normalized)) {
    return true;
  }
  return false;
}

function normalizeOrigin(value) {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (_) {
    return String(value).trim().replace(/\/*$/, '');
  }
}

function isDevOrigin(origin) {
  try {
    const { hostname, protocol } = new URL(origin);
    if (!protocol || (protocol !== 'http:' && protocol !== 'https:')) {
      return false;
    }
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
      return true;
    }
    if (hostname.endsWith('.local')) {
      return true;
    }
    if (hostname.startsWith('192.168.') || hostname.startsWith('10.')) {
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

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  const clamped = Math.min(Math.max(num, min), max);
  return clamped;
}

function sanitizeFreshness(value) {
  const token = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!token) return '';
  if (token === 'day' || token === 'week' || token === 'month') {
    return token;
  }
  return '';
}

function sanitizeRegion(value) {
  const token = typeof value === 'string' ? value.trim() : '';
  if (!token) return '';
  return token.slice(0, 5);
}
