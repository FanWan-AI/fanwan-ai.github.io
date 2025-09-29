#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../');
const DATA_DIR = path.join(ROOT, 'data/ai/modelswatch');
const CACHE_FILE = path.join(DATA_DIR, 'summary_cache.json');
const PENDING_FILE = path.join(DATA_DIR, 'pending_summaries.json');

function readJSON(p){ try{ if(fs.existsSync(p)) return JSON.parse(fs.readFileSync(p,'utf8')); }catch(e){} return null; }
function writeJSON(p,obj){ try{ fs.mkdirSync(path.dirname(p), { recursive: true }); const tmp = p + '.tmp.' + Date.now(); fs.writeFileSync(tmp, JSON.stringify(obj,null,2)); fs.renameSync(tmp, p); return true;}catch(e){ console.warn('writeJSON failed', e.message||e); return false;} }

function looksLikePlaceholder(t){ try{ return !t || /(占位|占位符|Auto summary|batch-fallback|fallback|自动摘要)/i.test(String(t)); }catch(e){ return true; } }
function isGoodLangText(txt, other){ if(!txt) return false; const s = String(txt).trim(); if(s.length < 40) return false; if(looksLikePlaceholder(s)) return false; if(other && String(other||'').trim() && s === String(other||'').trim()) return false; return true; }

function main(){
  const cache = readJSON(CACHE_FILE) || { models: {} };
  const models = cache.models || {};
  const toRequeue = [];
  for(const [key, val] of Object.entries(models)){
    try{
      const hash = val.hash || val.prompt_hash || null;
      const en = val.summary_en || '';
      const zh = val.summary_zh || '';
      const fallback = !!val.fallback;
      const bad = fallback || !isGoodLangText(zh, en);
      if(bad && hash) toRequeue.push(hash);
    }catch(e){}
  }
  const uniq = Array.from(new Set(toRequeue));
  if(uniq.length===0){ console.log('No bad summaries found to requeue'); return; }
  // merge with existing pending and cap
  const existing = readJSON(PENDING_FILE) || [];
  const combined = Array.from(new Set([...(existing||[]), ...uniq]));
  const cap = Math.max(0, Number(process.env.SNAPSHOT_MAX_NEW||'200')) || 200;
  const final = combined.slice(0, cap);
  writeJSON(PENDING_FILE, final);
  console.log('Requeued', uniq.length, 'hashes -> pending_summaries.json (final length:', final.length, ')');
}

main();
