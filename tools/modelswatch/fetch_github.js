#!/usr/bin/env node
/* Fetch trending/open-source GitHub repos and return normalized items. */
import fs from 'fs';
import path from 'path';
import { debug, info } from './log.js';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data', 'ai', 'modelswatch');

const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''; 
// Configurable per-page value (can be set via GitHub repository Variables)
const GH_PER_PAGE = parseInt(process.env.MODELSWATCH_GH_PER_PAGE || '140', 10) || 140;
// GitHub API enforces a maximum per_page of 100; clamp to avoid errors
const GH_PER_PAGE_CLAMPED = Math.min(GH_PER_PAGE, 100);

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

export async function fetchGithubTop(){
  ensureDirs();
  // Search top repos updated in last 365 days, with license, many stars
  const since = (new Date(Date.now()-365*86400000)).toISOString().slice(0,10);
  // Simpler query to avoid 422: remove license OR filters
  const q1 = encodeURIComponent(`stars:>500 pushed:>=${since}`);
  // Support requesting more than 100 items by paginating when MODELSWATCH_GH_PER_PAGE > 100
  const desired = GH_PER_PAGE;
  const perPage = GH_PER_PAGE_CLAMPED; // <= 100
  const pages = Math.max(1, Math.ceil(desired / perPage));
  // GitHub Search API only returns up to the first 1000 results (10 pages of 100)
  const MAX_GH_PAGES = 10;
  const effectivePages = Math.min(pages, MAX_GH_PAGES);
  const cacheFile = path.join(DATA_DIR, '.gh.search.etag');
  const lastOut = path.join(DATA_DIR, 'top_github.json');
  let etag=null; try{ etag=fs.readFileSync(cacheFile,'utf8'); }catch{}
  let allItems = [];
  let res;
  for (let p = 1; p <= effectivePages; p++) {
    const url = `https://api.github.com/search/repositories?q=${q1}&sort=stars&order=desc&per_page=${perPage}&page=${p}`;
    try{
      // Only use etag optimization when fetching the first page and only a single page is requested
      const useEtag = (pages === 1 && etag);
      res = await gh(url, useEtag ? etag : null);
    }catch(e){
      // On failure, try a relaxed fallback for the whole fetch (single attempt)
      if (p === 1) {
        try{
          const q2 = encodeURIComponent(`stars:>200 pushed:>=${since}`);
          const url2 = `https://api.github.com/search/repositories?q=${q2}&sort=stars&order=desc&per_page=${perPage}&page=${p}`;
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
      debug('GitHub search not modified (304)');
      try{ const prev = readJSON(lastOut); if(prev && Array.isArray(prev.items)) return prev.items; }catch{}
      return [];
    }

    if (res && res.data && Array.isArray(res.data.items)) {
      allItems = allItems.concat(res.data.items);
    }

    // Save etag from first page only (best-effort)
    if (p === 1 && res && res.etag) fs.writeFileSync(cacheFile, res.etag, 'utf8');

    // Be polite to GitHub API between pages
    if (p < pages) await sleep(500);
  }

  const items = (allItems||[]).filter(r=>r.license && r.license.spdx_id && r.license.spdx_id!=='NOASSERTION').map(r=>({
    id: r.full_name,
    source: 'github',
    name: r.name,
    url: r.html_url,
    license: (r.license&&r.license.spdx_id)||'N/A',
    lang: r.language||'N/A',
    tags: r.topics||[],
    categories: { capabilities: [], scenes: [], lifecycle: [] },
    stats: {
      stars: r.stargazers_count||0,
      forks: r.forks_count||0,
      issues: r.open_issues_count||0
    },
    score: 0,
    timeline: { t: [], stars: [], downloads: [] },
    summary: r.description||'',
    updated_at: r.updated_at||r.pushed_at||r.created_at||iso(Date.now()),
  }));

  // Score baseline now; 7d delta filled later by score.js using snapshots
  items.forEach(it=>{ it.score = scoreRepo({ stargazers_count: it.stats.stars, forks_count: it.stats.forks, pushed_at: it.updated_at }); });

  return items;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchGithubTop().then(items=>{
    info('GitHub items:', items.length);
  }).catch(e=>{ console.error(e); process.exit(1); });
}
