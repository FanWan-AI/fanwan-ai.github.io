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

async function fetchTrendingRepos() {
  const trendingRepos = [];
  try {
    info('[fetch_github] scraping github trending...');
    const res = await fetch('https://github.com/trending', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) {
      warn('[fetch_github] failed to fetch trending page: ' + res.status);
      return [];
    }
    const html = await res.text();
    // Look for <article class="Box-row"> which contains the repo info
    const articleRegex = /<article class="Box-row">([\s\S]*?)<\/article>/g;
    const matches = [...html.matchAll(articleRegex)];
    
    for (const match of matches) {
        const content = match[1];
        // Look for the specific h2 link which is the repo title
        // <h2 class="h3 lh-condensed"> <a href="/owner/repo">
        const titleMatch = content.match(/<h2[^>]*>\s*<a[^>]*href="\/([^"/]+)\/([^"/]+)"/);
        
        if (titleMatch) {
            const owner = titleMatch[1];
            const repo = titleMatch[2];
            // Double check it's not a system link
            if (owner !== 'login' && owner !== 'search' && owner !== 'sponsors' && owner !== 'features') {
                trendingRepos.push(`${owner}/${repo}`);
            }
        }
    }
    info(`[fetch_github] found ${trendingRepos.length} trending repos`);
  } catch (err) {
    warn('[fetch_github] failed to scrape trending: ' + err.message);
  }
  return trendingRepos;
}

export async function fetchGithubTop(options = {}){
  ensureDirs();
  
  const baseLimit = GH_TOTAL_LIMIT;
  let desired = baseLimit;
  if (Number.isFinite(options.limit)) {
    desired = Math.max(1, Math.round(options.limit));
  } else if (Number.isFinite(options.limitMultiplier)) {
    desired = Math.max(1, Math.round(baseLimit * options.limitMultiplier));
  }
  desired = Math.min(desired, options.maxLimit ? Math.max(1, Math.round(options.maxLimit)) : GH_MAX_ITEMS);
  desired = Math.max(baseLimit, desired);

  // Define strategies to broaden discovery
  const strategies = [
    {
      name: 'top_stars',
      q: `stars:>${GH_MIN_STARS} pushed:>=${iso(Date.now() - 365*86400000).slice(0,10)}`,
      sort: 'stars',
      pages: 2 // Top 200
    },
    {
      name: 'trending_new',
      q: `stars:>50 created:>=${iso(Date.now() - 30*86400000).slice(0,10)}`,
      sort: 'stars',
      pages: 2 // Top 200 new
    },
    {
      name: 'active_recent',
      q: `stars:>200 pushed:>=${iso(Date.now() - 7*86400000).slice(0,10)}`,
      sort: 'updated',
      pages: 2 // Top 200 recently updated
    },
    {
      name: 'high_forks',
      q: `forks:>50 created:>=${iso(Date.now() - 90*86400000).slice(0,10)}`,
      sort: 'forks',
      pages: 1 // Top 100 high forks
    }
  ];

  const allItemsMap = new Map();
  const lastOut = path.join(DATA_DIR, 'top_github.json');

  // Execute strategies
  for (const strat of strategies) {
    info(`[fetch_github] running strategy: ${strat.name}`);
    for (let p = 1; p <= strat.pages; p++) {
       const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(strat.q)}&sort=${strat.sort}&order=desc&per_page=100&page=${p}`;
       try {
         const res = await gh(url); 
         if (res && res.data && Array.isArray(res.data.items)) {
           let newCount = 0;
           for (const item of res.data.items) {
             if (item && item.full_name) {
               if (!allItemsMap.has(item.full_name)) {
                 allItemsMap.set(item.full_name, item);
                 newCount++;
               }
             }
           }
           info(`[fetch_github] strategy ${strat.name} page ${p} found ${res.data.items.length} items (${newCount} new unique)`);
         }
         await sleep(1000); // Be polite
       } catch (err) {
         warn(`[fetch_github] strategy ${strat.name} page ${p} failed: ${err.message}`);
         break; 
       }
    }
  }

  let items = Array.from(allItemsMap.values())
    .map(mapGithubRepo)
    .filter(Boolean);

  const repoIdSet = new Set(items.map((it) => it.id));
  
  // Add excluded IDs to the set to prevent fetching them
  if (Array.isArray(options.excludeIds)) {
    for (const id of options.excludeIds) {
      if (id) repoIdSet.add(id);
    }
  }

  // Fetch trending repos
  const trending = await fetchTrendingRepos();
  for (const slug of trending) {
      if (repoIdSet.has(slug)) continue;
      const repo = await fetchTargetRepo(slug);
      if (repo) {
          repoIdSet.add(repo.id);
          items.push(repo);
          await sleep(200);
      }
  }

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
  
  // Sort by score descending
  items.sort((a, b) => b.score - a.score);

  // Persist normalized snapshot for later reuse
  try { writeJSON(lastOut, { items }); } catch {}
  
  // Return top desired items
  return items.slice(0, desired);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchGithubTop().then(items=>{
    info('GitHub items:', items.length);
  }).catch(e=>{ console.error(e); process.exit(1); });
}
