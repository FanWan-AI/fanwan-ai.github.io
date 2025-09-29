#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { info } from './log.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchGithubTop } from './fetch_github.js';
import { fetchHFTop } from './fetch_hf.js';
import { SCHEMA_VERSION } from './schema.js';
import { fastSummary, promptHash } from './fast_summary.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../');
const dir = path.join(root, 'data/ai/modelswatch');
const archiveDir = path.join(dir, 'daily');

function readJSON(p){
  if(!existsSync(p)) return { items: [] };
  try{ return JSON.parse(readFileSync(p,'utf8')); }catch{ return { items: [] }; }
}
function writeJSON(p, obj){ writeFileSync(p, JSON.stringify(obj, null, 2)); }

// --- Lightweight .env loader (local only) ---
function loadDotEnv(){
  try{
    const envPath = path.join(root, '.env');
    if(!existsSync(envPath)) return;
    const txt = readFileSync(envPath, 'utf8');
    for(const line of txt.split(/\r?\n/)){
      const l = line.trim();
      if(!l || l.startsWith('#')) continue;
      const eq = l.indexOf('=');
      if(eq<=0) continue;
      const k = l.slice(0, eq).trim();
      const v = l.slice(eq+1).trim();
      if(!(k in process.env)) process.env[k] = v;
    }
  }catch{}
}
loadDotEnv();

// --- DeepSeek Chat summarizer (optional) ---
const DS_KEY = process.env.DEEPSEEK_API_KEY || '';
const DS_BASE = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
const DS_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DS_MAX_TOKENS = Number(process.env.DEEPSEEK_MAX_TOKENS||'768');
const LLM_CONN_TIMEOUT = Number(process.env.LLM_CONN_TIMEOUT||'30'); // seconds
const LLM_READ_TIMEOUT = Number(process.env.LLM_READ_TIMEOUT||'240'); // seconds

function withTimeout(ms){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(new Error('timeout')), ms);
  return { signal: controller.signal, clear: ()=>clearTimeout(timer) };
}

async function dsSummarizeLang(prompt, lang){
  if(!DS_KEY) throw new Error('DeepSeek API key missing');
  const url = `${DS_BASE}/chat/completions`;
  let system = '';
  if(lang==='zh') system = '你是资深AI编辑。请用中文为给定开源项目或模型撰写一段4-6句的精炼摘要，面向泛技术读者，避免营销语，突出用途、亮点与适用场景。限制在280字以内。';
  else if(lang==='en') system = 'You are a senior AI editor. Write a concise English summary (4-6 sentences, max ~280 chars) for the given open-source project or model, highlighting use cases, strengths, and applicability. No marketing fluff.';
  else if(lang==='es') system = 'Eres un editor técnico experto. Escribe un resumen breve en español (4-6 oraciones, máx ~280 caracteres) del proyecto o modelo de código abierto dado. Destaca usos, puntos fuertes y casos de uso. Evita marketing.';
  else system = 'You are a helpful editor. Write a concise summary.';
  const body = {
    model: DS_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ],
    max_tokens: DS_MAX_TOKENS,
    temperature: 0.3
  };
  const { signal, clear } = withTimeout(LLM_READ_TIMEOUT*1000);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DS_KEY}`
    },
    body: JSON.stringify(body),
    signal
  });
  clear();
  if(!res.ok){ throw new Error('DeepSeek failed: '+res.status); }
  const data = await res.json();
  const txt = data?.choices?.[0]?.message?.content?.trim() || '';
  if(!txt) throw new Error('No content');
  return txt;
}

function truncateSummary(text){
  const t = String(text||'').replace(/\s+/g,' ').trim();
  return t.length>300 ? t.slice(0,297)+'…' : t;
}

async function smartSummarizeMulti(it){
  // Compose an LLM prompt with safe context
  const src = it.source||'github';
  const lines = [];
  lines.push(`名称: ${it.name||it.id||''}`);
  if(it.url) lines.push(`链接: ${it.url}`);
  if(it.license) lines.push(`协议: ${it.license}`);
  const stats = it.stats||{};
  const statBits = [];
  if(stats.stars) statBits.push(`Stars ${stats.stars}`);
  if(stats.forks) statBits.push(`Forks ${stats.forks}`);
  if(stats.hf_downloads_7d) statBits.push(`Downloads7d ${stats.hf_downloads_7d}`);
  if(stats.hf_likes) statBits.push(`Likes ${stats.hf_likes}`);
  if(statBits.length) lines.push(`指标: ${statBits.join(' · ')}`);
  if(Array.isArray(it.tags) && it.tags.length) lines.push(`标签: ${it.tags.slice(0,10).join(', ')}`);
  const desc = it.summary || it.description || it.card_desc || '';
  if(desc) lines.push(`简介: ${desc}`);
  const prompt = lines.join('\n');

  // Try DeepSeek; fallback to truncate if unavailable/failed
  try{
    const [zh, en, es] = await Promise.all([
      dsSummarizeLang(prompt, 'zh'),
      dsSummarizeLang(prompt, 'en'),
      dsSummarizeLang(prompt, 'es'),
    ]);
    return { zh, en, es };
  }catch{
    const base = truncateSummary(desc);
    return { zh: base, en: base, es: '' };
  }
}

// Simple semaphore to avoid hammering API
async function mapLimit(list, limit, fn){
  if(!Array.isArray(list) || list.length===0) return [];
  const out = new Array(list.length);
  let nextIndex = 0;
  let completed = 0;
  return new Promise((resolve) => {
    const runNext = () => {
      if (completed === list.length) { resolve(out); return; }
      while (nextIndex < list.length && (completed + (nextIndex - completed)) < completed + limit) {
        const cur = nextIndex++;
        Promise.resolve(fn(list[cur], cur))
          .then(v => { out[cur] = v; })
          .catch(() => { out[cur] = null; })
          .finally(() => { completed++; runNext(); });
      }
    };
    runNext();
  });
}

function pickTop(items, n){
  // Simple heuristic: sort by (7d growth, then score/stars/downloads)
  const sc = i => (i.stats?.stars_7d||i.stats?.hf_downloads_7d||0);
  const sec = i => (i.score||i.stats?.stars||i.stats?.hf_downloads||0);
  return [...items].sort((a,b)=> (sc(b)-sc(a)) || (sec(b)-sec(a)) ).slice(0,n);
}

// --- Category-aware diverse selection with cooldown/state ---
function loadCategories(){
  const p = path.join(dir,'categories.json');
  try{
    const j = JSON.parse(readFileSync(p,'utf8'));
    return j?.categories?.capabilities || [];
  }catch{ return []; }
}

function normCapsFromItem(it, knownCaps){
  const caps = it?.categories?.capabilities || [];
  // fallback: scan tags/summary/name for simple hints
  if(caps.length) return caps.filter(c=>knownCaps.includes(c));
  const text = `${it.name||''} ${(it.summary||'')} ${(it.tags||[]).join(' ')}`;
  const hints = [
    ['llm', /(\bllm\b|gpt|llama|mistral|qwen)/i],
    ['finetune', /(ft|fine ?tune|lora|adapter)/i],
    ['retrieval', /(rag|retriev|vector|rerank)/i],
    ['multimodal', /(multimodal|vision-language|vlm|音视频|多模态)/i],
    ['agent', /(agent|assistant|自动化|workflow)/i],
    ['asr', /(asr|speech[- ]?to[- ]?text|whisper|识别)/i],
    ['tts', /(tts|text[- ]?to[- ]?speech|合成)/i],
    ['speech', /(audio|speech)/i],
    ['vision', /(vision|视觉|detection|segmentation)/i],
    ['image', /(image|图像|sdxl|diffusion)/i],
    ['video', /(video|视频)/i],
    ['code_llm', /(code|coder|copilot|编程)/i],
    ['recommender', /(recommender|recommendation|推荐)/i],
    ['time_series', /(time series|时序|forecast)/i],
    ['graph_learning', /(graph|图 学|gnn)/i],
    ['safety', /(safety|安全|guardrail)/i],
    ['alignment', /(alignment|sft|rlhf|dpo|对齐)/i],
    ['redteaming', /(red ?team|越狱|攻击)/i],
    ['moderation', /(moderation|审查|过滤)/i],
    ['compression', /(compress|量化|剪枝|蒸馏|distill|int8|int4)/i],
    ['distillation', /(distill|蒸馏)/i],
  ];
  const out = new Set();
  for(const [k, re] of hints){ if(re.test(text) && knownCaps.includes(k)) out.add(k); }
  return [...out];
}

function buildQuotaFromCorpus(corpusItems, N, caps){
  const cnt = Object.fromEntries(caps.map(c=>[c,0]));
  let total=0;
  for(const it of corpusItems){
    const cs = normCapsFromItem(it, caps);
    const hit = cs.find(c=>cnt.hasOwnProperty(c));
    if(hit){ cnt[hit]++; total++; }
  }
  const q = Object.fromEntries(caps.map(c=>[c,0]));
  let sum=0;
  for(const c of caps){
    const part = total? (cnt[c]/total) : 0;
    q[c] = Math.max(1, Math.round(part*N));
    sum += q[c];
  }
  // normalize to N
  const keys = [...caps];
  while(sum>N){
    keys.sort((a,b)=>q[b]-q[a]);
    const c = keys[0];
    if(q[c]>1){ q[c]--; sum--; } else break;
  }
  while(sum<N){
    keys.sort((a,b)=>q[b]-q[a]);
    const c = keys[0]; q[c]++; sum++;
  }
  return q;
}

function loadRecentFromArchives(windowDays){
  // scan dates.json for last windowDays
  const datesPath = path.join(archiveDir, 'dates.json');
  const recentById = {};
  const recentByOwner = {};
  const byCatCount = {}; // key: capabilities::<cap>
  let dates=[];
  try{ dates = JSON.parse(readFileSync(datesPath,'utf8')); if(!Array.isArray(dates)) dates=[]; }catch{ dates=[]; }
  const pick = dates.slice(0, Math.min(windowDays, dates.length));
  for(const d of pick){
    const p = path.join(archiveDir, `${d}.json`);
    try{
      const j = JSON.parse(readFileSync(p,'utf8'));
      const arr = j?.items||[];
      for(const it of arr){
        const id = it.id || it.repo_id || it.url || it.name; if(!id) continue;
        recentById[id] = d;
        const owner = (it.owner || String(id).split('/')[0] || '').toLowerCase();
        if(owner) recentByOwner[owner] = d;
        const caps = (it.categories?.capabilities)||[];
        for(const c of caps){ byCatCount[`capabilities::${c}`] = (byCatCount[`capabilities::${c}`]||0)+1; }
      }
    }catch{ /* ignore */ }
  }
  return { recentById, recentByOwner, byCatCount };
}

function computeDeficit(quota, recentCatCount){
  const def = {};
  for(const c of Object.keys(quota)){
    const recent = (recentCatCount[`capabilities::${c}`]||0) / Math.max(1, 7);
    def[c] = Math.max(0, quota[c] - recent); // simple deficit
  }
  const maxv = Math.max(1, ...Object.values(def));
  for(const c in def) def[c] = def[c]/maxv; // normalize 0..1
  return def;
}

function selectDiverse(allItems, N, opts){
  const { recentById, recentByOwner, quota, alpha=1.0, cooldownDays=14, knownCaps=[] } = opts;
  const today = Date.now();
  const picked=[]; const pickedOwners=new Set();
  const deficit = computeDeficit(quota, opts.recentCatCount||{});
  function base(it){ const s=it.stats||{}; return (s.stars_7d||s.hf_downloads_7d||it.score||s.stars||s.hf_downloads||0); }
  function inCooldown(dateStr){ if(!dateStr) return false; const dt=Date.parse(dateStr); return (today - dt) < cooldownDays*86400000; }
  function capsOf(it){ const cs = normCapsFromItem(it, knownCaps); return cs.length?cs:[knownCaps[0]].filter(Boolean); }

  while(picked.length<N){
    const remainCaps = Object.entries(quota).filter(([c,v])=>v>0);
    let targetCap = remainCaps.length ? remainCaps.sort((a,b)=>(b[1]-a[1]))[0][0] : null;

    let candidates = allItems.filter(it=>{
      if(picked.some(p=>p.id===it.id)) return false;
      const owner = (it.owner||String(it.id||'').split('/')[0]||'').toLowerCase();
      if(pickedOwners.has(owner)) return false;
      if(inCooldown(recentById[it.id])) return false;
      if(inCooldown(recentByOwner[owner])) return false;
      if(targetCap){ const cs = capsOf(it); if(!cs.includes(targetCap)) return false; }
      return true;
    });
    if(!candidates.length && targetCap){
      candidates = allItems.filter(it=>{
        if(picked.some(p=>p.id===it.id)) return false;
        const owner = (it.owner||String(it.id||'').split('/')[0]||'').toLowerCase();
        if(pickedOwners.has(owner)) return false;
        if(inCooldown(recentById[it.id])) return false;
        if(inCooldown(recentByOwner[owner])) return false;
        return true;
      });
    }
    if(!candidates.length) break;

    const scored = candidates.map(it=>{
      const cs = capsOf(it);
      const gap = Math.max(0, ...cs.map(c=>deficit[c]||0));
      const gapBoost = 1 + alpha*gap;
      return { it, score: base(it)*gapBoost };
    }).sort((a,b)=>b.score-a.score);

    const chosen = scored[0].it;
    picked.push(chosen);
    const owner = (chosen.owner||String(chosen.id||'').split('/')[0]||'').toLowerCase();
    pickedOwners.add(owner);
    const cs = capsOf(chosen);
    const cap = targetCap && cs.includes(targetCap) ? targetCap : (cs[0]||null);
    if(cap && quota[cap]>0) quota[cap]--;
  }
  return picked;
}

async function main(){
  const nowDate = new Date();
  const now = nowDate.toISOString();
  // Use Beijing date (Asia/Shanghai, UTC+8) for archive/day keys
  const yyyyMmDd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).format(nowDate);
  // Pre-step: attempt to enrich corpus items from snapshot tri-lingual cache if available (no extra LLM cost here)
  try {
    const snapDir = path.join(dir, 'snapshots', yyyyMmDd);
    // use sidecar summaries produced by snapshot summarizer
    const snapHFPath = path.join(snapDir, 'hf_summaries.json');
    const snapGHPath = path.join(snapDir, 'gh_summaries.json');
    // load local summary cache if present to avoid LLM calls
    const summaryCachePath = path.join(dir, 'summary_cache.json');
    // Normalized in-memory map: allow lookups by both 'source:id' and plain 'id'
    let SUMMARY_CACHE = {};
    try{
      if(existsSync(summaryCachePath)){
        const raw = JSON.parse(readFileSync(summaryCachePath,'utf8'))||{};
        // The cache file shape is { schema_version, generated_at, models: { "github:owner/repo": {...} } }
        if(raw && raw.models && typeof raw.models === 'object'){
          for(const k of Object.keys(raw.models)){
            const v = raw.models[k];
            SUMMARY_CACHE[k] = v;
            // also expose unprefixed id for convenience (but do not override an existing explicit key)
            if(k.includes(':')){
              const id = k.split(':').slice(1).join(':');
              if(!(id in SUMMARY_CACHE)) SUMMARY_CACHE[id] = v;
            }
          }
        } else if(raw && typeof raw === 'object'){
          // backward compat: file may already be a flat map
          for(const k of Object.keys(raw)) SUMMARY_CACHE[k] = raw[k];
        }
      }
    }catch(e){ /* ignore parse/load errors and leave SUMMARY_CACHE empty */ }
    if(existsSync(snapHFPath)){
      try {
        const snapHF = JSON.parse(readFileSync(snapHFPath,'utf8'));
        // merge summaries into corpus later when matching by id
        globalThis.__SNAP_SUMMARIES_HF = Array.isArray(snapHF.items)? snapHF.items : (Array.isArray(snapHF)? snapHF : []);
        // populate SUMMARY_CACHE from sidecar for fast lookup
        if(Array.isArray(snapHF.items)) snapHF.items.forEach(s=>{ if(s && s.id){ SUMMARY_CACHE[s.id] = s; const pref = `hf:${s.id}`; if(!(pref in SUMMARY_CACHE)) SUMMARY_CACHE[pref] = s; } });
      }catch{}
    }
    if(existsSync(snapGHPath)){
      try {
        const snapGH = JSON.parse(readFileSync(snapGHPath,'utf8'));
        globalThis.__SNAP_SUMMARIES_GH = Array.isArray(snapGH.items)? snapGH.items : (Array.isArray(snapGH)? snapGH : []);
        if(Array.isArray(snapGH.items)) snapGH.items.forEach(s=>{ if(s && s.id){ SUMMARY_CACHE[s.id] = s; const pref = `github:${s.id}`; if(!(pref in SUMMARY_CACHE)) SUMMARY_CACHE[pref] = s; } });
      }catch{}
    }

    // Helper to resolve cached summary for an item. Prefer explicit source-prefixed key.
    function lookupCachedSummary(it){
      if(!it || !it.id) return null;
      const src = it.source || 'github';
      const pref = `${src}:${it.id}`;
      if(SUMMARY_CACHE && SUMMARY_CACHE[pref]) return SUMMARY_CACHE[pref];
      if(SUMMARY_CACHE && SUMMARY_CACHE[it.id]) return SUMMARY_CACHE[it.id];
      // fallback to global sidecars
      const arr = src==='hf' ? (globalThis.__SNAP_SUMMARIES_HF||[]) : (globalThis.__SNAP_SUMMARIES_GH||[]);
      const found = arr.find(x=> x && x.id === it.id);
      if(found) return found;
      return null;
    }
  }catch{}
  let cg = readJSON(path.join(dir,'corpus.github.json')).items||[];
  let ch = readJSON(path.join(dir,'corpus.hf.json')).items||[];
  // Robustness: if corpus is missing/too small, fetch fresh tops directly
  try{
    if(!Array.isArray(cg) || cg.length < 6){
      // Try local weekly outputs first
      const tg = readJSON(path.join(dir,'top_github.json')).items||[];
      if(Array.isArray(tg) && tg.length >= 6) cg = tg;
    }
    if(!Array.isArray(cg) || cg.length < 6){
      const ghLive = await fetchGithubTop();
      if(Array.isArray(ghLive) && ghLive.length) cg = ghLive;
    }
  }catch{}
  try{
    if(!Array.isArray(ch) || ch.length < 6){
      const th = readJSON(path.join(dir,'top_hf.json')).items||[];
      if(Array.isArray(th) && th.length >= 6) ch = th;
    }
    if(!Array.isArray(ch) || ch.length < 6){
      const hfLive = await fetchHFTop();
      if(Array.isArray(hfLive) && hfLive.length) ch = hfLive;
    }
  }catch{}
  const N = Number(process.env.MODELSWATCH_DAILY_N||'6');
  const NGH = Number(process.env.MODELSWATCH_DAILY_GH_N||N);
  const NHF = Number(process.env.MODELSWATCH_DAILY_HF_N||N);
  const MIN_PICKS = Number(process.env.MODELSWATCH_DAILY_MIN_PICKS||'3');
  const MAX_PICKS = Number(process.env.MODELSWATCH_DAILY_MAX_PICKS||'8');
  const ENABLE_FALLBACK = /^(1|true|yes|on)$/i.test(process.env.MODELSWATCH_DAILY_FALLBACK || 'true');
  const COOLDOWN = Number(process.env.MODELSWATCH_DAILY_COOLDOWN_DAYS||'14');
  const WINDOW = Number(process.env.MODELSWATCH_DAILY_HISTORY_WINDOW||'7');
  const ALPHA = Number(process.env.MODELSWATCH_DAILY_ALPHA||'1.0');
  // Fast/efficient daily mode: avoid heavy LLM calls, favor cached/truncated summaries
  const FAST_SUMMARY = /^(1|true|yes|on)$/i.test(process.env.MODELSWATCH_DAILY_FAST_SUMMARY || '1');
  // If picks are too few, allow relaxed selection (ignore cooldown/owner uniqueness) to reach MIN_PICKS
  const RELAX_SELECTION = /^(1|true|yes|on)$/i.test(process.env.MODELSWATCH_DAILY_RELAX_SELECTION || '1');
  const SUMMARY_CONCURRENCY = Number(process.env.MODELSWATCH_SUMMARY_CONCURRENCY||'3') || 3;

  // Treat these strings as placeholders/fallbacks coming from batch summarizer
  const placeholderRE = /占位|占位符|Auto summary|batch-fallback|fallback|自动摘要/i;

  // Choose a neutral summary preferring non-placeholder Chinese, then English, then others.
  function chooseNeutralFromSnap(snap, it){
    try{
      const zh = (snap && snap.summary_zh) ? String(snap.summary_zh).trim() : '';
      const en = (snap && snap.summary_en) ? String(snap.summary_en).trim() : '';
      const es = (snap && snap.summary_es) ? String(snap.summary_es).trim() : '';
      const s = (snap && snap.summary) ? String(snap.summary).trim() : '';
      const itSummary = (it && it.summary) ? String(it.summary).trim() : '';
      const itDesc = (it && it.description) ? String(it.description).trim() : '';
      if(zh && zh.length > 40 && !placeholderRE.test(zh)) return zh;
      if(en && en.length > 40 && !placeholderRE.test(en)) return en;
      if(es && es.length > 40 && !placeholderRE.test(es)) return es;
      if(s && s.length > 40 && !placeholderRE.test(s)) return s;
      if(itSummary && itSummary.length > 40 && !placeholderRE.test(itSummary)) return itSummary;
      if(itDesc && itDesc.length > 40 && !placeholderRE.test(itDesc)) return itDesc;
      // fallback to whatever is available (including placeholders) to preserve existing behaviour
      return zh || en || es || s || itSummary || itDesc || '';
    }catch(e){ return (snap && (snap.summary_zh||snap.summary_en||snap.summary_es||snap.summary)) || (it && (it.summary||it.description)) || ''; }
  }

  // Load categories (capabilities only) and recent history
  const knownCaps = loadCategories();
  const recent = loadRecentFromArchives(WINDOW);
  try{
    writeJSON(path.join(dir,'state.json'), {
      cooldown_days: COOLDOWN,
      history_window_days: WINDOW,
      recent: {
        by_id: recent.recentById,
        by_owner: recent.recentByOwner,
        by_category_count: recent.byCatCount
      }
    });
  }catch{}

  // Build quotas from corpus distribution
  const quotaGH = buildQuotaFromCorpus(cg, NGH, knownCaps);
  const quotaHF = buildQuotaFromCorpus(ch, NHF, knownCaps);

  // Diverse selection per source
  // Prefer items that already have bilingual summaries (weekly snapshots / summary_cache)
  const REQUIRE_BILINGUAL = /^(1|true|yes|on)$/i.test(process.env.MODELSWATCH_DAILY_REQUIRE_BILINGUAL || '1');
  function hasBilingual(it){
    try{
      if(it && (it.summary_en && it.summary_zh)) return true;
      // also check sidecar globals populated earlier
      const snapArr = (it.source === 'hf' ? (globalThis.__SNAP_SUMMARIES_HF || []) : (globalThis.__SNAP_SUMMARIES_GH || []));
      const s = snapArr.find(x=> x && x.id === it.id);
      if(s && s.summary_en && s.summary_zh) return true;
    }catch(e){}
    return false;
  }

  // helper to try filling from bilingual pool first, then fallback to general pool
  function selectPreferBilingual(allItems, N, opts){
    if(!REQUIRE_BILINGUAL) return selectDiverse(allItems, N, opts);
    const bilingualPool = allItems.filter(hasBilingual);
    const picked = selectDiverse(bilingualPool, N, opts);
    if(picked.length >= N) return picked;
    // fill remaining from the remaining items excluding already picked ids
    const pickedIds = new Set(picked.map(p=>p.id));
    const remainingPool = allItems.filter(it=> !pickedIds.has(it.id));
    const fill = selectDiverse(remainingPool, N - picked.length, opts);
    return [...picked, ...fill];
  }

  const gTop = selectPreferBilingual(cg, NGH, { ...recent, quota:{...quotaGH}, alpha: ALPHA, cooldownDays: COOLDOWN, knownCaps });
  const hTop = selectPreferBilingual(ch, NHF, { ...recent, quota:{...quotaHF}, alpha: ALPHA, cooldownDays: COOLDOWN, knownCaps });
  info(`[daily] github candidates=${cg.length}, pick=${gTop.length}; hf candidates=${ch.length}, pick=${hTop.length}`);
  // Summarize with DeepSeek when available; limit concurrency to 3
  const gsum = await mapLimit(gTop, SUMMARY_CONCURRENCY, async (it)=> {
    // Consult in-memory summary cache populated from sidecars
    try{ const snap = lookupCachedSummary(it); if(snap){
      const neutral = chooseNeutralFromSnap(snap, it);
      return { ...it, summary: neutral, summary_en: snap.summary_en, summary_zh: snap.summary_zh, summary_es: snap.summary_es };
    }}catch{}
    // Also consult global sidecar arrays as fallback
    const snap = (globalThis.__SNAP_SUMMARIES_GH||[]).find(s=>s.id===it.id);
    if(snap && (snap.summary_zh||snap.summary_en||snap.summary_es)){
      const neutral = chooseNeutralFromSnap(snap, it);
      return { ...it, summary: neutral, summary_en: snap.summary_en, summary_zh: snap.summary_zh, summary_es: snap.summary_es };
    }
    // If the item itself already has a summary fields, reuse without calling LLM
    if(it.summary || it.summary_en || it.summary_zh || it.summary_es) {
      const neutral = it.summary_zh || it.summary_en || it.summary_es || it.summary || it.description || '';
      return { ...it, summary: neutral, summary_en: it.summary_en, summary_zh: it.summary_zh, summary_es: it.summary_es };
    }
    // Last resort: use FAST truncated fallback (must be synchronous and quick)
    if(FAST_SUMMARY){
      const fs = fastSummary(it);
      const neutral = fs.zh || fs.en || fs.es || it.summary || it.description || '';
      // attach a marker so downstream knows this needs async enrichment
      return { ...it, summary: neutral, summary_en: fs.en, summary_zh: fs.zh, summary_es: fs.es, _summary_method: fs.method };
    }
    const { zh, en, es } = await smartSummarizeMulti(it);
    const neutral = zh || en || es || it.summary || it.description || '';
    return { ...it, summary: neutral, summary_en: en, summary_zh: zh, summary_es: es };
  });
  const hsum = await mapLimit(hTop, 3, async (it)=> {
    try{ const snap = lookupCachedSummary(it); if(snap){
      const neutral = chooseNeutralFromSnap(snap, it);
      return { ...it, summary: neutral, summary_en: snap.summary_en, summary_zh: snap.summary_zh, summary_es: snap.summary_es };
    }}catch{}
    const snap = (globalThis.__SNAP_SUMMARIES_HF||[]).find(s=>s.id===it.id);
    if(snap && (snap.summary_zh||snap.summary_en||snap.summary_es)){
      const neutral = chooseNeutralFromSnap(snap, it);
      return { ...it, summary: neutral, summary_en: snap.summary_en, summary_zh: snap.summary_zh, summary_es: snap.summary_es };
    }
    if(it.summary || it.summary_en || it.summary_zh || it.summary_es) {
      const neutral = it.summary_zh || it.summary_en || it.summary_es || it.summary || it.description || '';
      return { ...it, summary: neutral, summary_en: it.summary_en, summary_zh: it.summary_zh, summary_es: it.summary_es };
    }
    if(FAST_SUMMARY){
      const fs = fastSummary(it);
      const neutral = fs.zh || fs.en || fs.es || it.summary || it.description || '';
      return { ...it, summary: neutral, summary_en: fs.en, summary_zh: fs.zh, summary_es: fs.es, _summary_method: fs.method };
    }
    const { zh, en, es } = await smartSummarizeMulti(it);
    const neutral = zh || en || es || it.summary || it.description || '';
    return { ...it, summary: neutral, summary_en: en, summary_zh: zh, summary_es: es };
  });
  // --- Enforce MUST-BILINGUAL policy: for any picked item lacking a valid Chinese/English summary,
  // try to obtain a bilingual summary via LLM (smartSummarizeMulti) up to a configurable cap.
  // If LLM cannot produce a valid bilingual summary, the item will be removed from picks.
  const BILINGUAL_REQUIRED = /^(1|true|yes|on)$/i.test(process.env.MODELSWATCH_DAILY_REQUIRE_BILINGUAL || '1');
  const BILINGUAL_CAP = Number(process.env.MODELSWATCH_DAILY_BILINGUAL_CAP || '20') || 20;
  function isValidBilingualItem(it){
    try{
      if(!it) return false;
      const en = String(it.summary_en||it.summary||'').trim();
      const zh = String(it.summary_zh||it.summary||'').trim();
      if(!en || !zh) return false;
      if(en.length < 40 || zh.length < 40) return false;
      if(/占位|占位符|Auto summary|batch-fallback|fallback|自动摘要/i.test(en) || /占位|占位符|Auto summary|batch-fallback|fallback|自动摘要/i.test(zh)) return false;
      return true;
    }catch(e){ return false; }
  }

  async function tryFillBilingual(arr, allPool){
    // arr: array of items already summarized (may contain placeholders). allPool: original candidate pool (cg or ch)
    const needs = arr.filter(it => !isValidBilingualItem(it));
    if(!BILINGUAL_REQUIRED) return arr; // nothing to enforce
    if(needs.length === 0) return arr;
    const cap = Math.min(BILINGUAL_CAP, needs.length);
    // Attempt to call LLM for the first `cap` missing items
    const toCall = needs.slice(0, cap);
    const llmRes = await mapLimit(toCall, SUMMARY_CONCURRENCY, async (it)=>{
      try{
        const { zh, en, es } = await smartSummarizeMulti(it);
        return { it, zh: zh||'', en: en||'', es: es||'' };
      }catch(e){ return { it, zh:'', en:'', es:'' }; }
    });
    // Apply LLM results
    for(const r of llmRes){
      const it = r.it;
      if(r.zh && r.en && !placeholderRE.test(r.zh) && !placeholderRE.test(r.en) && r.zh.length>40 && r.en.length>40){
        it.summary_zh = r.zh; it.summary_en = r.en; it.summary_es = r.es || (process.env.BILINGUAL_MODE? r.en : r.es);
        it.summary = it.summary_zh || it.summary_en || it.summary;
      }
    }
    // Filter to valid bilingual items
    let filtered = arr.filter(isValidBilingualItem);
    // If we still lack items, attempt to find replacements from allPool that already have bilingual summaries
    const needMore = arr.length - filtered.length;
    if(needMore > 0){
      const pickedIds = new Set(filtered.map(i=>i.id));
      const excluded = new Set(arr.map(i=>i.id));
      const candidatePool = (allPool||[]).filter(it=> it && it.id && !pickedIds.has(it.id) && !excluded.has(it.id));
      // Prefer those with bilingual sidecars / cache
      const preBilingual = candidatePool.filter(it=> {
        try{ if(it.summary_en && it.summary_zh && !placeholderRE.test(it.summary_zh) && !placeholderRE.test(it.summary_en) && it.summary_zh.length>40 && it.summary_en.length>40) return true; }catch{} return false;
      });
      if(preBilingual.length){
        const add = preBilingual.slice(0, needMore);
        filtered.push(...add);
      }
      // If still short, try LLM on remaining candidates up to remaining cap
      if(filtered.length < arr.length){
        const stillNeed = arr.length - filtered.length;
        const remainingCandidates = candidatePool.filter(it=> !preBilingual.includes(it)).slice(0, Math.max(stillNeed, 0));
        const usedLLM = Math.max(0, llmRes.length);
        const capRemain = Math.max(0, BILINGUAL_CAP - usedLLM);
        const toCall2 = remainingCandidates.slice(0, Math.min(capRemain, remainingCandidates.length));
        const llmRes2 = await mapLimit(toCall2, SUMMARY_CONCURRENCY, async (it)=>{
          try{ const r = await smartSummarizeMulti(it); return { it, zh: r.zh||'', en: r.en||'', es: r.es||'' }; }catch(e){ return { it, zh:'', en:'', es:'' }; }
        });
        for(const r of llmRes2){
          if(r.zh && r.en && !placeholderRE.test(r.zh) && !placeholderRE.test(r.en) && r.zh.length>40 && r.en.length>40){
            r.it.summary_zh = r.zh; r.it.summary_en = r.en; r.it.summary_es = r.es || (process.env.BILINGUAL_MODE? r.en : r.es); r.it.summary = r.it.summary_zh || r.it.summary_en || r.it.summary;
            filtered.push(r.it);
          }
        }
      }
    }
    // Final filtered set may be smaller than original; return it
    return filtered;
  }

  // apply to github and hf picks
  try{
    const gPool = cg.map(i=> ({ ...i, source:'github' }));
    const hPool = ch.map(i=> ({ ...i, source:'hf' }));
    const enforcedG = await tryFillBilingual(gsum, gPool);
    const enforcedH = await tryFillBilingual(hsum, hPool);
    // replace the summary arrays with enforced versions
    // note: we keep decoration/archiving logic compatible; later pending_summaries build will pick up fast placeholders
    // Update gsum/hsum references
    // ensure arrays are reassigned
    gsum.length = 0; enforcedG.forEach(x=> gsum.push(x));
    hsum.length = 0; enforcedH.forEach(x=> hsum.push(x));
    info(`[daily] enforced bilingual: github before=${gTop.length} after=${gsum.length}; hf before=${hTop.length} after=${hsum.length}`);
  }catch(e){ console.warn('[daily] bilingual enforcement failed', e); }
  // If picks are too few, try relaxed selection to reach MIN_PICKS (ignore cooldown/owner uniqueness and quotas)
  try{
    let totalPicksNow = (gTop?.length||0) + (hTop?.length||0);
    if(totalPicksNow < MIN_PICKS && RELAX_SELECTION){
      const need = MIN_PICKS - totalPicksNow;
      const candidates = [];
      if(Array.isArray(cg)) candidates.push(...cg.map(i=>({...i, source:'github'})));
      if(Array.isArray(ch)) candidates.push(...ch.map(i=>({...i, source:'hf'})));
      // filter out already chosen ids
      const pickedIds = new Set([...(gTop||[]).map(i=>i.id), ...(hTop||[]).map(i=>i.id)].filter(Boolean));
      const remaining = candidates.filter(it=>{ const id = it.id||it.repo_id||it.url||it.name; return id && !pickedIds.has(id); });
      // score by simple growth/importance proxy
      const score = it=> (it.stats?.stars_7d||0) * 2 + (it.stats?.hf_downloads_7d||0)/1000 + (it.score||0) + (it.stats?.stars||0);
      remaining.sort((a,b)=> score(b)-score(a));
      const fill = remaining.slice(0, need);
      // Push fill into the proper source arrays and collect which were added
      const addedG = []; const addedH = [];
      for(const f of fill){
        if(f.source==='github'){ gTop.push(f); addedG.push(f); } else { hTop.push(f); addedH.push(f); }
      }
      // Recompute summaries quickly for newly added picks
      if(fill.length){
        const fastMap = async (arr)=> await mapLimit(arr, SUMMARY_CONCURRENCY, async (it)=>{
          const snap = lookupCachedSummary(it);
          if(snap){
              const neutral = snap.summary_zh || snap.summary_en || snap.summary_es || snap.summary || it.summary || it.description || '';
              return { ...it, summary: neutral, summary_en: snap.summary_en, summary_zh: snap.summary_zh, summary_es: snap.summary_es };
            }
          if(FAST_SUMMARY){
            const base = truncateSummary(it.summary || it.description || it.card_desc || it.name || '');
            const zh = base; const en = base; const es = '';
            const neutral = zh || en || es || it.summary || it.description || '';
            return { ...it, summary: neutral, summary_en: en, summary_zh: zh, summary_es: es };
          }
          const { zh, en, es } = await smartSummarizeMulti(it);
          const neutral = zh || en || es || it.summary || it.description || '';
          return { ...it, summary: neutral, summary_en: en, summary_zh: zh, summary_es: es };
        });
        const addedGsum = await fastMap(addedG);
        const addedHsum = await fastMap(addedH);
        // merge into gsum/hsum and update counts
        if(addedGsum.length) gsum.push(...addedGsum);
        if(addedHsum.length) hsum.push(...addedHsum);
        totalPicksNow = (gTop?.length||0) + (hTop?.length||0);
      }
    }
  }catch(e){ console.warn('[daily] relaxed selection failed', e); }
  // --- Reason label & text augmentation ---
  function inferReasonLabel(it){
    const s = (it.summary||'').toLowerCase();
    const tags = (it.tags||[]).map(t=>String(t).toLowerCase());
    if((it.stats?.stars_7d||0) > 200 || (it.stats?.downloads_7d||0) > 5000000) return 'trending_growth';
    if(tags.includes('agent') || /agent/.test(s)) return 'agent_workflow';
    if(tags.includes('quantization') || /quantiz|int8|int4|量化/.test(s)) return 'model_optimization';
    if(/distill|蒸馏/.test(s)) return 'distillation';
    if(/benchmark|evaluation|leaderboard|榜/.test(s)) return 'benchmark_update';
    if(/security|安全|越狱|attack|防护/.test(s)) return 'security_safety';
    if(/release|v\d+\.\d+/.test(s)) return 'new_release';
    return 'notable';
  }
  function buildReasonText(it, label){
    const name = it.name||it.id;
    switch(label){
      case 'trending_growth': return `短期增速显著，活跃度激增：${name}`;
      case 'agent_workflow': return `Agent/工作流相关能力突出：${name}`;
      case 'model_optimization': return `模型优化/量化相关实践：${name}`;
      case 'distillation': return `蒸馏/轻量化成果：${name}`;
      case 'benchmark_update': return `基准测试/评测更新：${name}`;
      case 'security_safety': return `安全与对齐相关更新：${name}`;
      case 'new_release': return `新版本发布：${name}`;
      default: return `值得关注的项目：${name}`;
    }
  }
  function decorate(items){
    return items.map(it=>{
      const label = inferReasonLabel(it);
      const reason = buildReasonText(it, label);
      return { ...it, reason_label: label, reason_text: reason };
    });
  }
  const gDecorated = decorate(gsum);
  const hDecorated = decorate(hsum);
  writeJSON(path.join(dir,'daily_github.json'), { version:SCHEMA_VERSION, updated_at: now, items: gDecorated });
  writeJSON(path.join(dir,'daily_hf.json'), { version:SCHEMA_VERSION, updated_at: now, items: hDecorated });
  info(`[daily] wrote daily_github.json=${gsum.length}, daily_hf.json=${hsum.length}`);

  // --- Build pending_summaries.json (deduped, cap by SNAPSHOT_MAX_NEW) ---
  try{
    const pendingPath = path.join(dir, 'pending_summaries.json');
    let existing = [];
    try{ if(existsSync(pendingPath)) existing = JSON.parse(readFileSync(pendingPath,'utf8'))||[]; }catch{}
    const seen = new Set(existing || []);
    const toAdd = [];
    function considerPush(it){
      try{
        // If item was produced by fast_summary (marker) or lacks enriched summary
        if(it._summary_method === 'fast' || !(it.summary_en || it.summary_zh || it.summary_es)){
          const h = promptHash(it);
          if(!seen.has(h)) { seen.add(h); toAdd.push(h); }
        }
      }catch{}
    }
    (gDecorated||[]).forEach(considerPush);
    (hDecorated||[]).forEach(considerPush);
    const MAX_NEW = Number(process.env.SNAPSHOT_MAX_NEW||'40') || 40;
    const combined = Array.from(seen);
    // Keep newest additions at front; cap total pending to MAX_NEW
    const finalList = combined.slice(0, MAX_NEW);
    try{ writeJSON(pendingPath, finalList); info(`[daily] wrote pending_summaries.json ${finalList.length} items`); }catch(e){ console.warn('[daily] failed write pending', e.message||e); }
  }catch(e){ console.warn('[daily] pending build failed', e); }

  // --- Write combined archive for calendar browsing ---
  try{
    // ensure archiveDir exists
    try{ await import('fs/promises').then(fs=>fs.mkdir(archiveDir, { recursive: true })); }catch{}
  const combined = { version:SCHEMA_VERSION, date: yyyyMmDd, updated_at: now, items: [...gDecorated, ...hDecorated] };
    // Ensure non-empty picks: if combined is below MIN_PICKS and fallback enabled, fill aggressively
    try{
      if(ENABLE_FALLBACK){
        let totalPicks = (gDecorated?.length||0) + (hDecorated?.length||0);
        if(totalPicks < MIN_PICKS){
          // Score remaining candidates and pick top to reach MIN_PICKS (ignore cooldown/owner)
          const candidates = [];
          if(Array.isArray(cg)) candidates.push(...cg.map(i=>({...i, source:'github'})));
          if(Array.isArray(ch)) candidates.push(...ch.map(i=>({...i, source:'hf'})));
          // Remove already picked ids
          const pickedIds = new Set((combined.items||[]).map(it=>it.id||it.repo_id||it.url||it.name));
          const remaining = candidates.filter(it=>{ const id = it.id||it.repo_id||it.url||it.name; return id && !pickedIds.has(id); });
          // Simple scoring function: recent growth proxies
          const score = it=> (it.stats?.stars_7d||0) * 2 + (it.stats?.hf_downloads_7d||0)/1000 + (it.score||0);
          remaining.sort((a,b)=> score(b)-score(a));
          const need = Math.min(MAX_PICKS, MIN_PICKS - totalPicks);
          const fill = remaining.slice(0, need).map(it=>({ ...it, reason_label:'fallback', reason_text:'fallback pick to meet daily minimum', source: it.source||'unknown' }));
          combined.items.push(...fill);
          totalPicks = combined.items.length;
          info(`[daily] fallback filled ${fill.length} items to reach minimum picks (now ${totalPicks})`);
        }
      }
    }catch(e){ console.warn('[daily] fallback fill failed', e); }
    const archivePath = path.join(archiveDir, `${yyyyMmDd}.json`);
    writeJSON(archivePath, combined);
  info(`[daily] archived ${combined.items.length} items -> ${archivePath}`);

    // maintain dates.json (most-recent-first, unique)
    const datesPath = path.join(archiveDir, 'dates.json');
    let dates = [];
    if(existsSync(datesPath)){
      try{ dates = JSON.parse(readFileSync(datesPath,'utf8')); if(!Array.isArray(dates)) dates = []; }catch{ dates=[]; }
    }
    if(!dates.includes(yyyyMmDd)){
      dates.unshift(yyyyMmDd);
      // Trim to a reasonable length to keep repo small
      if(dates.length>120) dates = dates.slice(0,120);
      writeJSON(datesPath, dates);
  info(`[daily] updated dates.json (${dates.length} dates)`);
    }
  }catch(e){ console.warn('[daily] archive write failed:', e.message||e); }
}

main().catch(e=>{ console.error(e); process.exit(1); });
