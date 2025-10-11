#!/usr/bin/env node
/* Fetch trending/open-source GitHub repos and return normalized items. */
import fs from 'fs';
import path from 'path';
import { debug, info, warn } from './log.js';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data', 'ai', 'modelswatch');

const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
// Total number of repositories to fetch (increase default to 80 to broaden intake)
const GH_TOTAL_LIMIT = parseInt(
  process.env.MODELSWATCH_GH_LIMIT || process.env.MODELSWATCH_GH_PER_PAGE || '80',
  10
) || 80;
// Page size can be customised separately; fall back to total limit when unset (cap 100)
const GH_PAGE_SIZE_RAW = parseInt(
  process.env.MODELSWATCH_GH_PAGE_SIZE || process.env.MODELSWATCH_GH_PER_PAGE || String(GH_TOTAL_LIMIT),
  10
);
const GH_PER_PAGE = Math.max(1, Math.min(GH_PAGE_SIZE_RAW || GH_TOTAL_LIMIT, 100));
// Allow raising pages/items via env to explore deeper result sets (GitHub caps to first 1000 results)
const GH_MAX_PAGES = Math.max(1, parseInt(process.env.MODELSWATCH_GH_MAX_PAGES || '10', 10) || 10);
const GH_MAX_ITEMS = Math.max(1, parseInt(process.env.MODELSWATCH_GH_MAX_ITEMS || '400', 10) || 400);
// Query shaping knobs
const GH_SINCE_DAYS = Math.max(1, parseInt(process.env.MODELSWATCH_GH_SINCE_DAYS || '365', 10) || 365);
const GH_SORT = String(process.env.MODELSWATCH_GH_SORT || 'stars').toLowerCase(); // 'stars' | 'updated' | 'created'
const GH_MIN_STARS = Math.max(0, parseInt(process.env.MODELSWATCH_GH_MIN_STARS || (GH_SORT==='stars' ? '500' : GH_SORT==='updated' ? '50' : '10'), 10) || 0);

function iso(d) { return new Date(d).toISOString(); }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function gh(url, etag) {
  const headers = { 'Accept': 'application/vnd.github+json' };
  if (GH_TOKEN) headers.Authorization = `Bearer ${GH_TOKEN}`;
  if (etag) headers['If-None-Match'] = etag;
  const res = await fetch(url, { headers });
  if (res.status === 304) return { status: 304 };
  if (!res.ok) throw new Error('GitHub API failed ' + res.status);
  const data = await res.json();
  return { status: 200, data, etag: res.headers.get('etag') };
}

function ensureDirs(){ fs.mkdirSync(DATA_DIR, {recursive:true}); }
function readJSON(p){ try{ return JSON.parse(fs.readFileSync(p,'utf8')); }catch{return null} }
function writeJSON(p, obj){ fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8'); }

function scoreRepo(r){
  const stars = r.stargazers_count||0;
  const forks = r.forks_count||0;
  const updated = Date.parse(r.pushed_at||r.updated_at||r.created_at||Date.now());
  const recency = Math.max(0, 1 - (Date.now()-updated)/(1000*3600*24*30)); // 30d freshness
  return stars*1 + forks*0.2 + recency*100;
}

function mapGithubRepo(r){
  if (!r || !r.full_name) return null;
  return {
    id: r.full_name,
    source: 'github',
    name: r.name,
    url: r.html_url,
    license: (r.license && r.license.spdx_id && r.license.spdx_id !== 'NOASSERTION') ? r.license.spdx_id : 'N/A',
    lang: r.language || 'N/A',
    tags: Array.isArray(r.topics) ? r.topics : [],
    categories: { capabilities: [], scenes: [], lifecycle: [] },
    stats: {
      stars: r.stargazers_count || 0,
      forks: r.forks_count || 0,
      issues: r.open_issues_count || 0
    },
    score: 0,
    timeline: { t: [], stars: [], downloads: [] },
    summary: r.description || '',
    updated_at: r.updated_at || r.pushed_at || r.created_at || iso(Date.now()),
  };
}

function coerceRepoSlug(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('github:')) {
    return trimmed.slice('github:'.length);
  }
  return trimmed;
}

async function fetchTargetRepo(slug) {
  try {
    const res = await gh(`https://api.github.com/repos/${slug}`);
    if (!res || res.status !== 200 || !res.data) return null;
    return mapGithubRepo(res.data);
  } catch (err) {
    warn('GitHub targeted fetch failed for %s: %s', slug, err?.message || err);
    return null;
  }
}

export async function fetchGithubTop(options = {}){
  ensureDirs();
  // Search top repos updated in last 365 days, with license, many stars
  const since = (new Date(Date.now()-GH_SINCE_DAYS*86400000)).toISOString().slice(0,10);
  // Build query based on strategy; keep it simple to avoid 422 errors
  // For 'created' we bias toward newly created repos; for others, use pushed date
  const dateField = GH_SORT === 'created' ? 'created' : 'pushed';
  const q1 = encodeURIComponent(`stars:>${GH_MIN_STARS} ${dateField}:>=${since}`);
  // Support requesting more than 100 items by paginating when MODELSWATCH_GH_PER_PAGE > 100
  const baseLimit = GH_TOTAL_LIMIT;
  let desired = baseLimit;
  if (Number.isFinite(options.limit)) {
    desired = Math.max(1, Math.round(options.limit));
  } else if (Number.isFinite(options.limitMultiplier)) {
    desired = Math.max(1, Math.round(baseLimit * options.limitMultiplier));
  }
  desired = Math.min(desired, options.maxLimit ? Math.max(1, Math.round(options.maxLimit)) : GH_MAX_ITEMS);
  desired = Math.max(baseLimit, desired);
  const perPage = GH_PER_PAGE; // <= 100
  const pages = Math.max(1, Math.ceil(desired / perPage));
  // GitHub Search API only returns up to the first 1000 results (10 pages of 100)
  const effectivePages = Math.min(pages, GH_MAX_PAGES);
  const cacheFile = path.join(DATA_DIR, '.gh.search.etag');
  const lastOut = path.join(DATA_DIR, 'top_github.json');
  let etag=null; try{ etag=fs.readFileSync(cacheFile,'utf8'); }catch{}
  const pageEtagsPath = path.join(DATA_DIR, '.gh.page.etags.json');
  let pageEtags = {}; try{ pageEtags = JSON.parse(fs.readFileSync(pageEtagsPath,'utf8')); }catch{}
  let allItems = [];
  let res;
  for (let p = 1; p <= effectivePages; p++) {
    const sortParam = (GH_SORT === 'updated' || GH_SORT === 'created') ? GH_SORT : 'stars';
    const url = `https://api.github.com/search/repositories?q=${q1}&sort=${sortParam}&order=desc&per_page=${perPage}&page=${p}`;
    try{
      // Use per-page ETag when available
      const useEtag = pageEtags[String(p)] || (p === 1 ? etag : null);
      res = await gh(url, useEtag);
    }catch(e){
      // On failure, try a relaxed fallback for the whole fetch (single attempt)
      if (p === 1) {
        try{
          const q2 = encodeURIComponent(`stars:>${Math.max(0, Math.floor(GH_MIN_STARS/2))} ${dateField}:>=${since}`);
          const url2 = `https://api.github.com/search/repositories?q=${q2}&sort=${sortParam}&order=desc&per_page=${perPage}&page=${p}`;
          res = await gh(url2, null);
        }catch(e2){
          throw e2;
        }
      } else {
        // If a subsequent page fails, break and reuse what we have
        break;
      }
    }

    if (res && res.status === 304) {
      debug(`GitHub search page ${p} not modified (304)`);
      // Reuse prior items for this page from lastOut when possible; otherwise skip page
      try{
        const prev = readJSON(lastOut);
        if(prev && Array.isArray(prev.items)){
          const start = (p-1)*perPage;
          const slice = prev.items.slice(start, start+perPage);
          if (slice.length) {
            allItems = allItems.concat(slice);
            continue;
          }
        }
      }catch{}
      continue; // page unchanged but we couldn't restore; move on
    }

    if (res && res.data && Array.isArray(res.data.items)) {
      allItems = allItems.concat(res.data.items);
    }

    // Save etags
    if (p === 1 && res && res.etag) fs.writeFileSync(cacheFile, res.etag, 'utf8');
    if (res && res.etag) {
      pageEtags[String(p)] = res.etag;
      try{ fs.writeFileSync(pageEtagsPath, JSON.stringify(pageEtags, null, 2), 'utf8'); }catch{}
    }

    // Be polite to GitHub API between pages
    if (p < pages) await sleep(500);
  }

  const items = (allItems||[])
    .filter(r=>r.license && r.license.spdx_id && r.license.spdx_id!=='NOASSERTION')
    .slice(0, desired)
    .map(mapGithubRepo)
    .filter(Boolean);

  const repoIdSet = new Set(items.map((it) => it.id));
  const targeted = Array.isArray(options.targetedRepos) ? options.targetedRepos : [];
  if (targeted.length) {
    const limitedTargets = targeted.slice(0, options.targetedLimit || 12);
    for (const target of limitedTargets) {
      const slug = coerceRepoSlug(target);
      if (!slug || repoIdSet.has(slug)) continue;
      const repo = await fetchTargetRepo(slug);
      if (repo && repo.license && repo.license !== 'N/A') {
        repoIdSet.add(repo.id);
        items.push(repo);
        await sleep(200);
      }
    }
  }

  items.forEach((it)=>{
    it.score = scoreRepo({
      stargazers_count: it.stats.stars,
      forks_count: it.stats.forks,
      pushed_at: it.updated_at
    });
  });

  // Persist normalized snapshot for later reuse and page-level restore
  try { writeJSON(lastOut, { items }); } catch {}
  return items;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchGithubTop().then(items=>{
    info('GitHub items:', items.length);
  }).catch(e=>{ console.error(e); process.exit(1); });
}
