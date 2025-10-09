#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { promptHash } from './fast_summary.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../');
const DATA_DIR = path.join(ROOT, 'data/ai/modelswatch');
const TRI_CACHE = path.join(DATA_DIR, 'tri_cache.json');
const SUMMARY_CACHE = path.join(DATA_DIR, 'summary_cache.json');

function readJSON(p){ try{ return JSON.parse(fs.readFileSync(p,'utf8')); }catch(e){ return null; } }

function main(){
  const tri = readJSON(TRI_CACHE) || {};
  const sum = readJSON(SUMMARY_CACHE) || { models: {} };
  const triItems = tri.items || tri || {};
  const summaryModels = sum.models || {};
  const triIndex = new Map();
  for(const k of Object.keys(triItems||{})){
    const v = triItems[k] || {};
    // prefer stored key field if present
    const key = v.key || k;
    if(key.startsWith('sha256:')) triIndex.set(key, v);
    else if(/^[0-9a-f]{16}$/.test(k)) triIndex.set('sha256:'+k, v);
    else if(/^[0-9a-f]{64}$/.test(k)) triIndex.set('sha256:'+k, v);
    else triIndex.set(String(k), v);
  }
  const missing = [];
  for(const mkey of Object.keys(summaryModels)){
    const entry = summaryModels[mkey] || {};
    const h = entry.hash;
    if(!h) continue;
    const hasSummary = entry.summary_zh || entry.summary_en;
    if(!hasSummary){
      // check tri cache for this hash (full and short)
      const hex = String(h).replace(/^sha256:/,'');
      const full = 'sha256:'+hex;
      const short = hex.slice(0,16);
      if(triIndex.has(full) || triIndex.has(short) || triIndex.has('sha256:'+short)){
        missing.push({ model: mkey, hash: h, tri: true });
      } else {
        missing.push({ model: mkey, hash: h, tri: false });
      }
    }
  }
  console.log(`Found ${missing.length} summary_cache entries missing summaries.`);
  const haveTri = missing.filter(x=>x.tri).length;
  console.log(`${haveTri} of them have tri_cache entries (legacy or normalized).`);
  if(missing.length>0){
    missing.slice(0,200).forEach(x=> console.log(x.model, x.hash, 'tri_cache:', x.tri));
  }
}

main();
