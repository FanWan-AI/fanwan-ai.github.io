import fs from 'fs'
import path from 'path'

const ROOT = path.resolve('data','ai','modelswatch')
const triPath = path.join(ROOT, 'tri_cache.json')
const summaryPath = path.join(ROOT, 'summary_cache.json')

function readJSON(p){
  return JSON.parse(fs.readFileSync(p,'utf8'))
}

function writeJSON(p, obj){
  fs.writeFileSync(p, JSON.stringify(obj, null, 2)+'\n', 'utf8')
}

function buildTriMap(tri){
  const map = new Map()
  if(!tri || !tri.items) return map
  for(const [shortKey, val] of Object.entries(tri.items)){
    // store by shortKey
    map.set(shortKey.toLowerCase(), val)
    // if val.key exists and looks like sha256:..., store by that and by hex-only
    if(val && val.key && typeof val.key === 'string'){
      const k = val.key
      map.set(k.toLowerCase(), val)
      const parts = k.split(':')
      if(parts.length===2) map.set(parts[1].toLowerCase(), val)
    }
  }
  return map
}

function findTriForHash(map, hash){
  if(!hash) return null
  const h = hash.toLowerCase()
  // canonical: sha256:<fullhex>
  if(map.has(h)) return map.get(h)
  // hex only
  const hex = h.startsWith('sha256:') ? h.split(':')[1] : h
  if(map.has(hex)) return map.get(hex)
  // short 16
  if(hex && hex.length>=16){
    const short = hex.slice(0,16)
    if(map.has(short)) return map.get(short)
  }
  return null
}

async function main(){
  console.log('Loading tri_cache and summary_cache...')
  if(!fs.existsSync(triPath)){
    console.error('tri_cache.json not found at', triPath)
    process.exit(1)
  }
  if(!fs.existsSync(summaryPath)){
    console.error('summary_cache.json not found at', summaryPath)
    process.exit(1)
  }

  const tri = readJSON(triPath)
  const summary = readJSON(summaryPath)

  const triMap = buildTriMap(tri)

  let updated = 0
  const now = new Date().toISOString()
  for(const [modelKey, modelVal] of Object.entries(summary.models||{})){
    const hash = modelVal.hash
    // skip if already has zh/en
    const hasZh = modelVal.summary_zh && modelVal.summary_zh.trim().length>10
    const hasEn = modelVal.summary_en && modelVal.summary_en.trim().length>10
    if(hasZh && hasEn) continue

    const triEntry = findTriForHash(triMap, hash)
    if(triEntry){
      // copy safely
      if(triEntry.zh && (!modelVal.summary_zh || modelVal.summary_zh.trim().length<10)){
        modelVal.summary_zh = triEntry.zh
      }
      if(triEntry.en && (!modelVal.summary_en || modelVal.summary_en.trim().length<10)){
        modelVal.summary_en = triEntry.en
      }
      if(triEntry.es && (!modelVal.summary_es || modelVal.summary_es.trim().length<10)){
        modelVal.summary_es = triEntry.es
      }
      modelVal.fallback = false
      modelVal.summary_generated_at = now
      updated++
    }
  }

  if(updated>0){
    // backup
    const bak = summaryPath + '.' + Date.now() + '.bak'
    fs.copyFileSync(summaryPath, bak)
    writeJSON(summaryPath, summary)
    console.log('Updated', updated, 'summary_cache entries. Backup at', bak)
  } else {
    console.log('No entries updated from tri_cache -> summary_cache')
  }

  // regenerate snapshot sidecars for requested dates
  const dates = [ '2025-09-30', '2025-09-29' ]
  for(const date of dates){
    const snapDir = path.join(ROOT, 'snapshots', date)
    if(!fs.existsSync(snapDir)){
      console.log('snapshot dir missing for', date)
      continue
    }
    // hf (hf.json) -> hf_summaries.json
    const hfJson = path.join(snapDir, 'hf.json')
    if(fs.existsSync(hfJson)){
      const hf = readJSON(hfJson)
      const out = {}
      for(const modelId of Object.keys(hf)){
        const key = 'hf:' + modelId
        const m = (summary.models && summary.models[key]) || null
        if(m && m.summary_zh){
          out[modelId] = {
            hash: m.hash,
            summary_en: m.summary_en || '',
            summary_zh: m.summary_zh,
            summary_es: m.summary_es || ''
          }
        }
      }
      const outPath = path.join(snapDir, 'hf_summaries.json')
      writeJSON(outPath, out)
      console.log('Wrote', outPath, Object.keys(out).length, 'entries')
    }

    // gh (github) -> gh_summaries.json
    const ghJson = path.join(snapDir, 'gh.json')
    if(fs.existsSync(ghJson)){
      const gh = readJSON(ghJson)
      const out = {}
      for(const modelId of Object.keys(gh)){
        const key = 'github:' + modelId
        const m = (summary.models && summary.models[key]) || null
        if(m && m.summary_zh){
          out[modelId] = {
            hash: m.hash,
            summary_en: m.summary_en || '',
            summary_zh: m.summary_zh,
            summary_es: m.summary_es || ''
          }
        }
      }
      const outPath = path.join(snapDir, 'gh_summaries.json')
      writeJSON(outPath, out)
      console.log('Wrote', outPath, Object.keys(out).length, 'entries')
    }
  }

  console.log('done')
}

main().catch(e=>{console.error(e); process.exit(2)})
