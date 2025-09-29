#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { fastSummary, promptHash } from './fast_summary.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../');
const DATA_DIR = path.join(ROOT, 'data/ai/modelswatch');
const PENDING_FILE = path.join(DATA_DIR, 'pending_summaries.json');
const TRI_CACHE_FILE = process.env.TRI_CACHE_FILE || path.join(DATA_DIR, 'tri_cache.json');
const SUMMARY_CACHE_FILE = path.join(DATA_DIR, 'summary_cache.json');

function readJSON(p){ try{ if(fs.existsSync(p)) return JSON.parse(fs.readFileSync(p,'utf8')); }catch(e){} return null; }
function writeJSON(p,obj){ try{ fs.mkdirSync(path.dirname(p), { recursive: true }); const tmp = p + '.tmp.' + Date.now(); fs.writeFileSync(tmp, JSON.stringify(obj,null,2)); fs.renameSync(tmp, p); return true;}catch(e){ console.warn('writeJSON failed', e.message||e); return false;} }

function buildPromptFromItem(it){
  const stats = it.stats||{}; const statBits = [];
  if(stats.stars) statBits.push(`Stars ${stats.stars}`);
  if(stats.forks) statBits.push(`Forks ${stats.forks}`);
  if(stats.downloads_total) statBits.push(`DownloadsTotal ${stats.downloads_total}`);
  if(stats.downloads_7d) statBits.push(`Downloads7d ${stats.downloads_7d}`);
  if(stats.likes_total) statBits.push(`Likes ${stats.likes_total}`);
  const desc = it.summary || it.description || '';
  const tags = (it.tags||[]).slice(0,20).join(', ');
  const id = it.id || it.repo_id || it.name || '';
  const prompt = `PROJECT ID: ${id}\nNAME: ${it.name||id}\nSOURCE: ${it.source||''}\nURL: ${it.url||''}\nTAGS: ${tags}\nSTATS: ${statBits.join(' · ')}\nRAW_DESC: ${String(desc).slice(0,4000)}`;
  return prompt;
}

async function runBatchPrompts(prompts, triEnv, timeoutSec){
  return new Promise((resolve)=>{
    const child = spawn('python', ['tools/tri_summarizer.py','--batch'], { env: { ...process.env, ...triEnv } });
    let out = '';
    let killedByTimeout = false;
    child.stdout.on('data', d=> out += d.toString());
    child.stderr.on('data', d=> process.stderr.write(d.toString()));
    child.on('error', e=> { console.warn('[tri_worker] spawn error', e.message); });
    const timer = setTimeout(()=>{ killedByTimeout = true; try{ child.kill('SIGKILL'); process.stderr.write('[tri_worker] child killed due to timeout\n'); }catch(e){} }, timeoutSec*1000);
    child.on('close', code=>{
      clearTimeout(timer);
      if(code===0 && !killedByTimeout){
        try{ const parsed = JSON.parse(out); return resolve({ ok: true, parsed }); }catch(e){ console.warn('[tri_worker] parse error', e.message); return resolve({ ok:false, parse_error:true }); }
      }
      return resolve({ ok:false, killed:killedByTimeout });
    });
    // send base64-encoded prompts to avoid Unicode/encoding issues in Python child
    const b64prompts = prompts.map(s => ({ b64: Buffer.from(String(s||''), 'utf8').toString('base64') }));
    child.stdin.write(JSON.stringify(b64prompts)+'\n');
    child.stdin.end();
  });
}

async function main(){
  console.log('[tri_worker] starting');
  const pending = readJSON(PENDING_FILE) || [];
  if(!Array.isArray(pending) || pending.length===0){ console.log('[tri_worker] no pending items'); return; }
  // cap
  const MAX_NEW = Number(process.env.SNAPSHOT_MAX_NEW||'40') || 40;
  // Start with pending list but remove those already present in tri_cache
  const triCacheExisting = readJSON(TRI_CACHE_FILE) || {};
  const pendingAll = Array.isArray(pending) ? pending.slice() : [];
  const uniquePending = Array.from(new Set(pendingAll));
  // Select up to MAX_NEW hashes that are not already in triCacheExisting
  const toProcess = uniquePending.filter(h => !(triCacheExisting && triCacheExisting[h])).slice(0, MAX_NEW);

  // load candidate pool (corpus & snapshots)
  const corpusGH = (readJSON(path.join(DATA_DIR,'corpus.github.json'))?.items) || [];
  const corpusHF = (readJSON(path.join(DATA_DIR,'corpus.hf.json'))?.items) || [];
  const snapshotsDir = path.join(DATA_DIR,'snapshots');
  // Build map from hash->item by scanning corpus + snapshots sidecars
  const hashToItem = new Map();
  const all = [...corpusGH.map(i=>({...i, source:'github'})), ...corpusHF.map(i=>({...i, source:'hf'}))];
  for(const it of all){ try{ const h = promptHash(it); if(!hashToItem.has(h)) hashToItem.set(h, it); }catch(e){} }
  // scan today's and recent snapshots to pick up more items
  try{
    if(fs.existsSync(snapshotsDir)){
      const days = fs.readdirSync(snapshotsDir).filter(f=>fs.statSync(path.join(snapshotsDir,f)).isDirectory());
      for(const d of days.slice(0,7)){
        const hfP = path.join(snapshotsDir,d,'hf.json');
        const ghP = path.join(snapshotsDir,d,'gh.json');
        for(const p of [hfP, ghP]){
          try{ if(fs.existsSync(p)){ const arr = JSON.parse(fs.readFileSync(p,'utf8')); if(Array.isArray(arr)) arr.forEach(it=>{ try{ const h=promptHash(it); if(!hashToItem.has(h)) hashToItem.set(h,it);}catch(e){} }); } }catch(e){}
        }
      }
    }
  }catch(e){ console.warn('[tri_worker] snapshot scan failed', e.message||e); }

    // Also load summary_cache and map stored cache.hash -> item stub so pending hashes from summary_cache can be resolved
    try{
      const summaryCache = readJSON(path.join(DATA_DIR,'summary_cache.json')) || { models: {} };
      const models = summaryCache.models || {};
      for(const key of Object.keys(models)){
        try{
          const val = models[key] || {};
          const h = val.hash;
          if(!h) continue;
          if(hashToItem.has(h)) continue; // keep existing richer item if present
          // key format is "source:id" e.g. 'github:owner/repo' or 'hf:repo'
          const parts = String(key).split(':');
          const src = parts[0] || 'unknown';
          const id = parts.slice(1).join(':') || (val.id||'');
          const stub = { id: id, name: id, source: src, url: val.url||'', summary: val.summary||val.summary_en||val.summary_zh||'', description: val.summary||val.summary_en||val.summary_zh||'', tags: [], stats: {} };
          hashToItem.set(h, stub);
        }catch(e){}
      }
    }catch(e){ /* ignore */ }

  // build prompts array and map index->hash for only missing hashes
  const prompts = [];
  const indexToHash = [];
  for(const h of toProcess){
    const item = hashToItem.get(h);
    if(!item){ console.warn('[tri_worker] item for hash not found', h); continue; }
    const prompt = buildPromptFromItem(item);
  // sanitize prompt to avoid unpaired surrogates or control characters that crash Python utf-8 encoding
  let safe = String(prompt||'');
  try{ safe = safe.normalize('NFC'); }catch(e){}
  // remove C0 control chars
  safe = safe.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
  // replace any surrogate code units (unpaired) with replacement char to avoid Python encoding errors
  try{
    // deterministic replacement by scanning code units
    let out = '';
    for(let i=0;i<safe.length;i++){
      const cc = safe.charCodeAt(i);
      if(cc >= 0xD800 && cc <= 0xDFFF){ out += '\uFFFD'; }
      else { out += safe.charAt(i); }
    }
    safe = out;
  }catch(e){ safe = safe.replace(/[\uD800-\uDFFF]/g, '\uFFFD'); }
    prompts.push(safe);
    indexToHash.push({ hash:h, id: item.id || item.repo_id || item.name, source: item.source || 'unknown' });
  }
  if(prompts.length===0){ console.log('[tri_worker] no prompts to process'); return; }

  // tri env defaults
  const triEnv = {
    BILINGUAL_MODE: process.env.BILINGUAL_MODE || '1',
    TRI_GROUP_JSON_SIZE: process.env.TRI_GROUP_JSON_SIZE || (prompts.length>32 ? '3' : prompts.length>12 ? '2' : '1'),
    TRI_BATCH_CONCURRENCY: process.env.TRI_BATCH_CONCURRENCY || '2',
    SPEED_MODE: (typeof process.env.SPEED_MODE !== 'undefined') ? process.env.SPEED_MODE : '1',
    TRI_CACHE_FILE: TRI_CACHE_FILE,
    TRI_CACHE_PERSIST: process.env.TRI_CACHE_PERSIST || '1'
  };
  const BATCH_KILL_TIMEOUT = Number(process.env.SNAPSHOT_BATCH_KILL_TIMEOUT||'900');
  console.log('[tri_worker] invoking tri_summarizer with GROUP=', triEnv.TRI_GROUP_JSON_SIZE, 'CONC=', triEnv.TRI_BATCH_CONCURRENCY, 'TIMEOUT=', BATCH_KILL_TIMEOUT);

  // attempt
  let res = await runBatchPrompts(prompts, triEnv, BATCH_KILL_TIMEOUT);
  if(!res.ok && res.killed){
    console.warn('[tri_worker] batch killed; retrying with smaller group');
    const retryEnv = { ...triEnv, TRI_GROUP_JSON_SIZE: '1', TRI_BATCH_CONCURRENCY: '2' };
    res = await runBatchPrompts(prompts, retryEnv, BATCH_KILL_TIMEOUT);
  }

  const triCache = readJSON(TRI_CACHE_FILE) || {};
  const processedHashes = [];
  // tri_cache structure: simple mapping hash -> { en, zh, es, last_generated }
  if(!triCache || typeof triCache !== 'object'){
    // start fresh
  }

  if(res.ok && res.parsed){
    const results = res.parsed.results || [];
    for(let i=0;i<results.length;i++){
      const r = results[i] || {};
      const meta = indexToHash[i]; if(!meta) continue;
      const h = meta.hash;
      const en = r.en||''; const zh = r.zh||''; const es = r.es||'';
      // detect placeholder or poor-quality zh (too short or identical to en)
      function looksLikePlaceholder(t){ try{ return !t || /(占位|占位符|Auto summary|batch-fallback|fallback|自动摘要)/i.test(String(t)); }catch(e){ return true; } }
      function isGoodLangText(txt, other){ if(!txt) return false; const s = String(txt).trim(); if(s.length < 40) return false; if(looksLikePlaceholder(s)) return false; if(other && String(other||'').trim() && s === String(other||'').trim()) return false; return true; }
      const isFallback = !isGoodLangText(zh, en);
      triCache[h] = { en, zh, es, last_generated: new Date().toISOString(), fallback: !!isFallback };
      processedHashes.push(h);
      // Also update summary_cache with a source:key style to help daily lookups
      try{
        const summaryCache = readJSON(SUMMARY_CACHE_FILE) || { models: {} };
        const key = `${meta.source}:${meta.id}`;
        summaryCache.models = summaryCache.models || {};
        summaryCache.models[key] = { hash: h, updated_at: new Date().toISOString(), summary_en: en, summary_zh: zh, summary_es: es, summary: zh||en||es, fallback: !!isFallback };
        writeJSON(SUMMARY_CACHE_FILE, summaryCache);
      }catch(e){ console.warn('[tri_worker] update summary_cache failed', e.message||e); }
    }
    writeJSON(TRI_CACHE_FILE, triCache);
    console.log('[tri_worker] updated tri_cache with', results.length, 'entries');
  } else {
    console.warn('[tri_worker] batch failed; no cache updates');
  }

  // remove processed hashes from pending
  try{
    const pendingAllNow = readJSON(PENDING_FILE) || [];
    // Also consider hashes that were already present in tri cache before this run as processed
    const alreadyCached = uniquePending.filter(h => triCacheExisting && triCacheExisting[h]);
    const processedSet = new Set(processedHashes.concat(alreadyCached));
    const remaining = pendingAllNow.filter(h=> !processedSet.has(h));
    writeJSON(PENDING_FILE, remaining);
    console.log('[tri_worker] updated pending_summaries.json, remaining=', remaining.length, 'removed=', (pendingAllNow.length - remaining.length));
  }catch(e){ console.warn('[tri_worker] failed update pending file', e.message||e); }

  // write diagnostics
  try{
    const diag = { run_at: new Date().toISOString(), attempted: toProcess.length, processed: processedHashes.length, pending_before: uniquePending.length };
    writeJSON(path.join(DATA_DIR,'tri_worker_diagnostics.json'), diag);
  }catch(e){ }
}

main().catch(e=>{ console.error('[tri_worker] error', e); process.exit(1); });
