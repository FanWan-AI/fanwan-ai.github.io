import crypto from 'crypto';

function truncate(text, max=200){
  const t = String(text||'').replace(/\s+/g,' ').trim();
  if(!t) return '';
  if(t.length <= max) return t;
  return t.slice(0, max-1) + '…';
}

export function fastSummary(it){
  // Simple extractive/template short summary for fast-path
  const base = truncate(it.summary || it.description || it.card_desc || it.name || '', 220);
  // For now, reuse base for en/zh; es keep empty to be filled by async worker
  const en = base;
  const zh = base;
  const es = '';
  return { en, zh, es, method: 'fast', short: base };
}

export function promptHash(it){
  const fields = [it.id||'', it.name||'', (it.description||'').slice(0,2000), (it.summary||'').slice(0,2000), (it.tags||[]).slice(0,20).join(','), JSON.stringify(it.stats||{})];
  const h = crypto.createHash('sha256').update(fields.join('|')).digest('hex');
  return 'sha256:'+h;
}
