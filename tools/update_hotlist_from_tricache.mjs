import fs from 'fs';

const hotlistPath = 'data/ai/modelswatch/projects_hotlist.json';
const triCachePath = 'data/ai/modelswatch/tri_cache.json';

function isAutoSummary(s) {
  if (!s) return true;
  const low = s.toLowerCase();
  // common placeholder markers seen in hotlist
  return low.startsWith('自动摘要') || low.startsWith('auto summary') || low.includes('batch-fallback') || low.includes('占位') || low.includes('auto-generated') || low.includes('自动生成') || low.includes('placeholder');
}

function normalizeKeyFromId(id) {
  // try last path segment
  if (!id) return null;
  const parts = id.split('/');
  return parts[parts.length-1];
}

function findTriEntry(triItems, id){
  if(!id) return null;
  const short = normalizeKeyFromId(id);
  if(triItems[short]) return triItems[short];
  if(triItems[id]) return triItems[id];

  // try owner/repo and repo variants
  const parts = id.split('/').filter(Boolean);
  const repo = parts[parts.length-1] || id;
  const owner = parts.length>1 ? parts[parts.length-2] : '';

  // direct keys tried, now scan values for mention of repo or owner/repo
  const needleCandidates = [id, `${owner}/${repo}`, repo, owner, repo.replace(/[-_.]/g,' ')].filter(Boolean).map(s=>s.toLowerCase());

  for(const [k,v] of Object.entries(triItems)){
    const hay = ((v.en||'') + ' ' + (v.zh||'') + ' ' + (v.es||'')).toLowerCase();
    for(const n of needleCandidates){
      if(n.length<3) continue;
      if(hay.includes(n)){
        return v;
      }
    }
  }

  return null;
}

function main(){
  const hotlistRaw = fs.readFileSync(hotlistPath, 'utf-8');
  const hotlist = JSON.parse(hotlistRaw);
  const triRaw = fs.readFileSync(triCachePath, 'utf-8');
  const tri = JSON.parse(triRaw).items || {};

  const updated = [];
  for (const cat of Object.keys(hotlist.by_category || {})) {
    for (const item of hotlist.by_category[cat]) {
  const triEntry = findTriEntry(tri, item.id);
  if (!triEntry) continue;
      let changed = false;
      for (const lang of ['en','zh','es']){
        const field = `summary_${lang}`;
        if (isAutoSummary(item[field])){
          const newVal = triEntry[lang] || item[field];
          if (newVal && newVal !== item[field]){
            item[field] = newVal;
            changed = true;
          }
        }
      }
      if (changed){
        updated.push({id: item.id, summary_en: item.summary_en, summary_zh: item.summary_zh, summary_es: item.summary_es});
      }
    }
  }

  fs.writeFileSync(hotlistPath, JSON.stringify(hotlist, null, 2), 'utf-8');
  fs.writeFileSync('data/ai/modelswatch/projects_hotlist.updated.json', JSON.stringify(updated, null, 2), 'utf-8');
  console.log('更新完成。已更新模型数:', updated.length);
}

try{
  main();
} catch (err){
  console.error('脚本出错:', err);
  process.exit(1);
}
