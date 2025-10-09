import fs from 'fs'
import path from 'path'

const ROOT = path.resolve('data','ai','modelswatch')
const triPath = path.join(ROOT, 'tri_cache.json')
const summaryPath = path.join(ROOT, 'summary_cache.json')

function readJSON(p){ return JSON.parse(fs.readFileSync(p,'utf8')) }
function writeJSON(p,obj){ fs.writeFileSync(p, JSON.stringify(obj,null,2)+'\n', 'utf8') }

const tri = readJSON(triPath)
const summary = readJSON(summaryPath)

// build list of tri entries: array of {key, text}
const triEntries = []
for(const [k,v] of Object.entries(tri.items||{})){
  const text = ((v.en||'') + '\n' + (v.zh||'')).toLowerCase()
  triEntries.push({k, text, v})
}

function normalizeModelId(id){
  // model ids from hf.json like 'timm/mobilenetv3_small_100.lamb_in1k'
  return id.toLowerCase().replace(/[^a-z0-9_/.-]+/g,'')
}

let updated=0
const now = new Date().toISOString()

for(const date of ['2025-09-30','2025-09-29']){
  const snapDir = path.join(ROOT,'snapshots',date)
  if(!fs.existsSync(snapDir)) continue
  const hf = path.join(snapDir,'hf.json')
  const gh = path.join(snapDir,'gh.json')
  const ids = []
  if(fs.existsSync(hf)) ids.push(...Object.keys(readJSON(hf)).map(id=>({type:'hf', id})))
  if(fs.existsSync(gh)) ids.push(...Object.keys(readJSON(gh)).map(id=>({type:'gh', id})))

  for(const item of ids){
    const modelId = item.id
    const key = item.type === 'hf' ? 'hf:'+modelId : 'github:'+modelId
    const existing = summary.models && summary.models[key]
    const hasZh = existing && existing.summary_zh && existing.summary_zh.trim().length>10
    if(hasZh) continue

    const norm = normalizeModelId(modelId)
    // try few heuristics: exact model id token, last path segment, repo name
    const tokens = new Set()
    tokens.add(norm)
    const parts = norm.split('/')
    if(parts.length>1){
      tokens.add(parts[parts.length-1])
      tokens.add(parts.slice(-2).join('/'))
    }

    // also include variations with dots/underscores
    const variations = Array.from(tokens)

    // search tri entries for any variation
    let found = null
    for(const triE of triEntries){
      for(const v of variations){
        if(v.length<4) continue
        if(triE.text.includes(v)){
          found = triE
          break
        }
      }
      if(found) break
    }

    if(found){
      const m = existing || (summary.models[key] = { hash: existing? existing.hash : (existing && existing.hash) || null })
      if(found.v.zh && (!m.summary_zh || m.summary_zh.trim().length<10)){
        m.summary_zh = found.v.zh
      }
      if(found.v.en && (!m.summary_en || m.summary_en.trim().length<10)){
        m.summary_en = found.v.en
      }
      // Copy Spanish summary when available
      if(found.v.es && (!m.summary_es || m.summary_es.trim().length<10)){
        m.summary_es = found.v.es
      }
      m.fallback = false
      m.summary_generated_at = now
      updated++
    }
  }
}

if(updated>0){
  const bak = summaryPath + '.' + Date.now() + '.bak'
  fs.copyFileSync(summaryPath, bak)
  writeJSON(summaryPath, summary)
  console.log('Heuristic updated', updated, 'entries. Backup at', bak)
} else {
  console.log('Heuristic found 0 matches')
}

// regenerate sidecars same as apply_tri_to_summary
for(const date of ['2025-09-30','2025-09-29']){
  const snapDir = path.join(ROOT,'snapshots',date)
  if(!fs.existsSync(snapDir)) continue
  const hfJson = path.join(snapDir,'hf.json')
  if(fs.existsSync(hfJson)){
    const hf = readJSON(hfJson)
    const out = {}
    for(const modelId of Object.keys(hf)){
      const key = 'hf:' + modelId
      const m = (summary.models && summary.models[key]) || null
      if(m && m.summary_zh){
        out[modelId] = { hash: m.hash, summary_en: m.summary_en||'', summary_zh: m.summary_zh, summary_es: m.summary_es||'' }
      }
    }
    const outPath = path.join(snapDir,'hf_summaries.json')
    writeJSON(outPath, out)
    console.log('Wrote', outPath, Object.keys(out).length, 'entries')
  }
  const ghJson = path.join(snapDir,'gh.json')
  if(fs.existsSync(ghJson)){
    const gh = readJSON(ghJson)
    const out = {}
    for(const modelId of Object.keys(gh)){
      const key = 'github:' + modelId
      const m = (summary.models && summary.models[key]) || null
      if(m && m.summary_zh){
        out[modelId] = { hash: m.hash, summary_en: m.summary_en||'', summary_zh: m.summary_zh, summary_es: m.summary_es||'' }
      }
    }
    const outPath = path.join(snapDir,'gh_summaries.json')
    writeJSON(outPath, out)
    console.log('Wrote', outPath, Object.keys(out).length, 'entries')
  }
}

console.log('done')
