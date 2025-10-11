#!/usr/bin/env node
/* Fetch popular public HF models via REST (no auth required for public). */
import fs from 'fs';
import path from 'path';
import { info, debug, warn } from './log.js';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data', 'ai', 'modelswatch');
const ITEMS_DIR = path.join(DATA_DIR, 'items');

function ensureDirs(){ fs.mkdirSync(DATA_DIR, {recursive:true}); fs.mkdirSync(ITEMS_DIR, {recursive:true}); }
function writeJSON(p, obj){ fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8'); }

const HF_TOKEN = process.env.HF_TOKEN || '';
// Base page size used if no explicit limit provided by caller
const HF_FETCH_LIMIT = parseInt(process.env.MODELSWATCH_HF_LIMIT || '40', 10) || 40;
const HF_PAGE_SIZE = parseInt(process.env.MODELSWATCH_HF_PAGE_SIZE || '100', 10) || 100;
const HF_MAX_PAGES = parseInt(process.env.MODELSWATCH_HF_MAX_PAGES || '8', 10) || 8;
const HF_MAX_ITEMS = parseInt(process.env.MODELSWATCH_HF_MAX_ITEMS || '400', 10) || 400;

let headerLogged = false;
function buildHeaders({ log = true } = {}) {
  const headers = { 'User-Agent': 'modelswatch/1.0' };
  if (HF_TOKEN) {
    headers.Authorization = `Bearer ${HF_TOKEN}`;
    if (log && !headerLogged) {
      debug('Using HF_TOKEN for authenticated request');
    }
  } else if (log && !headerLogged) {
    debug('No HF_TOKEN provided; using anonymous request');
  }
  if (log) headerLogged = true;
  return headers;
}

function parseLinkHeader(linkHeader) {
  // Parses RFC 5988 Link header into a map of rel=>url
  // e.g., <https://huggingface.co/api/models?cursor=abc&limit=50>; rel="next"
  const out = {};
  if (!linkHeader || typeof linkHeader !== 'string') return out;
  const parts = linkHeader.split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match) {
      out[match[2]] = match[1];
    }
  }
  return out;
}

async function hfListPaginated({ desired, pageSize = HF_PAGE_SIZE, maxPages = HF_MAX_PAGES } = {}){
  const headers = buildHeaders({ log: true });
  const collected = [];
  let url = `https://huggingface.co/api/models?sort=downloads&direction=-1&limit=${pageSize}`;
  let pages = 0;
  const seen = new Set();
  while (url && pages < maxPages && collected.length < desired) {
    let res;
    try {
      res = await fetch(url, { headers });
    } catch(e){
      warn('HF list network error', e.message);
      if (collected.length) break; // return partial results if we have some
      throw e;
    }
    if (!res.ok) {
      warn('HF list failed status %s on page %d', res.status, pages+1);
      if (collected.length) break; // return partial results if we have some
      throw new Error('HF list failed ' + res.status);
    }
    let pageItems = [];
    try {
      pageItems = await res.json();
    } catch (e) {
      warn('HF list JSON parse error on page %d: %s', pages+1, e.message || e);
      if (collected.length) break;
      throw e;
    }
    for (const m of pageItems) {
      const id = m && m.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      collected.push(m);
      if (collected.length >= desired) break;
    }
    pages += 1;
    if (collected.length >= desired) break;
    const link = res.headers.get('link') || res.headers.get('Link');
    const links = parseLinkHeader(link);
    url = links.next || null;
    if (!url) break;
    // Ensure we don't accidentally change page size when following next
    if (!/limit=/.test(url)) {
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}limit=${pageSize}`;
    }
  }
  return collected;
}

function mapModel(m){
  const downloads = m.downloads || 0;
  const likes = m.likes || 0;
  return {
    id: m.id,
    source: 'hf',
    name: m.id.split('/').pop(),
    url: `https://huggingface.co/${m.id}`,
    license: m.license || 'N/A',
    lang: 'N/A',
    tags: m.tags || [],
    categories: { capabilities: [], scenes: [], lifecycle: [] },
    stats: {
      // Canonical cumulative fields (Phase 1 schema)
      downloads_total: downloads,
      likes_total: likes
      // NOTE: Removed pseudo fields hf_downloads_7d / hf_likes (were misleading totals masquerading as 7d). Front-end now normalizes.
    },
    score: 0,
    timeline: { t: [], stars: [], downloads: [] },
    summary: m.cardData?.summary || m.description || '',
    updated_at: m.lastModified || m.lastModifiedAt || new Date().toISOString(),
  };
}

function scoreModel(it){
  const dl = it.stats.downloads_total || 0;
  const likes = it.stats.likes_total || 0;
  return dl*0.002 + likes*0.5;
}

async function fetchTargetModel(id) {
  const headers = buildHeaders({ log: false });
  try {
    const res = await fetch(`https://huggingface.co/api/models/${encodeURIComponent(id)}`, { headers });
    if (!res.ok) {
      warn('HF targeted fetch failed status %s for %s', res.status, id);
      return null;
    }
    const data = await res.json();
    if (!data || data.gated) {
      return null;
    }
    return mapModel(data);
  } catch (err) {
    warn('HF targeted fetch error for %s: %s', id, err?.message || err);
    return null;
  }
}

export async function fetchHFTop(options = {}){
  ensureDirs();
  const cachePath = path.join(DATA_DIR, 'top_hf.json');
  const now = Date.now();
  const MAX_AGE_MS = parseInt(process.env.HF_CACHE_MAX_AGE_MS || '21600000', 10); // default 6h
  const preferCache = !Array.isArray(options.targetedModels) || options.targetedModels.length === 0;
  // Determine desired item count up-front so pagination can honor it
  const baseLimit = HF_FETCH_LIMIT;
  let desired = baseLimit;
  if (Number.isFinite(options.limit)) {
    desired = Math.max(1, Math.round(options.limit));
  } else if (Number.isFinite(options.limitMultiplier)) {
    desired = Math.max(1, Math.round(baseLimit * options.limitMultiplier));
  }
  desired = Math.min(desired, options.maxLimit ? Math.max(1, Math.round(options.maxLimit)) : HF_MAX_ITEMS);
  desired = Math.max(baseLimit, desired);

  let arr = [];
  if (preferCache) {
    try {
      const stat = fs.statSync(cachePath);
      if (stat && (now - stat.mtimeMs) < MAX_AGE_MS) {
        const prev = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        if (prev && Array.isArray(prev.items_raw) && prev.items_raw.length >= desired) {
          arr = prev.items_raw;
        }
      }
    } catch {}
  }
  try {
    if (!arr.length) {
      arr = await hfListPaginated({ desired, pageSize: HF_PAGE_SIZE, maxPages: HF_MAX_PAGES });
      // Save lightweight daily cache for reuse when targets=0
      try { fs.writeFileSync(cachePath, JSON.stringify({ items_raw: arr }, null, 2), 'utf8'); } catch {}
    }
  } catch(e){
    // Reuse last top file if available
    try {
      const prev = JSON.parse(fs.readFileSync(cachePath,'utf8'));
      if(prev && Array.isArray(prev.items_raw)) {
        return prev.items_raw
          .filter(m => !m.gated)
          .slice(0, desired)
          .map(mapModel)
          .filter(Boolean);
      }
    } catch{}
    return [];
  }

  const items = (arr||[])
    .filter(m => !m.gated)
    .slice(0, desired)
    .map(mapModel)
    .filter(Boolean);

  const seen = new Set(items.map((it) => it.id));
  const targeted = Array.isArray(options.targetedModels) ? options.targetedModels : [];
  if (targeted.length) {
    const limitedTargets = targeted.slice(0, options.targetedLimit || 20);
    for (const modelId of limitedTargets) {
      if (!modelId || seen.has(modelId)) continue;
      const model = await fetchTargetModel(modelId);
      if (model) {
        seen.add(model.id);
        items.push(model);
      }
    }
  }

  items.forEach(it=>{ it.score = scoreModel(it); });
  // Keep a mirrored "top_hf.json" with normalized items for quick reuse by other tools
  try { writeJSON(cachePath, { items_raw: arr, items }); } catch {}
  return items;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchHFTop().then(items=>{
    info('HF items:', items.length);
  }).catch(e=>{ console.error(e); process.exit(1); });
}
