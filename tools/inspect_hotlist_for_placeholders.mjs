#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';

const HOTLIST = path.resolve('data/ai/modelswatch/projects_hotlist.json');
const TRI = path.resolve('data/ai/modelswatch/tri_cache.json');

function normalizeVariants(id){
  // id like 'owner/repo' or 'repo'
  const parts = (id||'').split('/').filter(Boolean);
  const repo = parts[parts.length-1] || id;
  const owner = parts.length>1 ? parts[parts.length-2] : '';
  return [repo, `${owner}/${repo}`, id, `${owner}-${repo}`].filter(Boolean);
}

function looksLikePlaceholder(item){
  const en = item.summary_en || '';
  const zh = item.summary_zh || '';
  const es = item.summary_es || '';
  if(!en && !zh && !es) return true;
  if(/auto summary|batch-fallback|auto-?generated/i.test(en)) return true;
  if(/自动摘要|占位|占位符/.test(zh)) return true;
  if(/resumen automático|resumen generado/i.test(es)) return true;
  return false;
}

async function main(){
  const [hotRaw, triRaw] = await Promise.all([
    fs.readFile(HOTLIST, 'utf8'),
    fs.readFile(TRI, 'utf8')
  ]);
  const hot = JSON.parse(hotRaw);
  const tri = JSON.parse(triRaw);
  const triKeys = new Set(Object.keys(tri.items || {}));

  const candidates = [];
  for(const cat of Object.keys(hot.by_category||{})){
    const arr = hot.by_category[cat] || [];
    for(const it of arr){
      if(looksLikePlaceholder(it)){
        candidates.push({id: it.id, item: it});
      }
    }
  }

  console.log(`Found ${candidates.length} placeholder-like hotlist items. Showing up to 40:`);
  const sample = candidates.slice(0,40);
  for(const c of sample){
    const id = c.id;
    const variants = normalizeVariants(id);
    const matches = variants.map(v => ({v, in_tri: triKeys.has(v)}));
    // also search tri values for occurrences of repo name
    const repo = variants[0];
    const triContainsRepo = Object.entries(tri.items || {}).filter(([k,v])=>{
      const hay = (v.en||'') + ' ' + (v.zh||'') + ' ' + (v.es||'');
      return hay.toLowerCase().includes(repo.toLowerCase());
    }).map(([k])=>k).slice(0,5);

    console.log('---');
    console.log(`id: ${id}`);
    console.log(`variants: ${variants.join(', ')}`);
    for(const m of matches) console.log(`  tri key exists: ${m.v} -> ${m.in_tri}`);
    if(triContainsRepo.length) console.log(`  tri entries that contain repo name in text: ${triContainsRepo.join(',')}`);
  }
}

main().catch(err=>{ console.error(err); process.exitCode=2; });
