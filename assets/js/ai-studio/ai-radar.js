// Relative time in Chinese for now; could be localized via lang.js later
function relTime(iso){
  try{
    if(!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const s = Math.max(0, (Date.now()-d.getTime())/1000);
    if(s<60) return '刚刚';
    if(s<3600) return Math.floor(s/60)+' 分钟前';
    if(s<86400) return Math.floor(s/3600)+' 小时前';
    const days = Math.floor(s/86400);
    if(days===1){ const hh = d.toTimeString().slice(0,5); return '昨天 '+hh; }
    return days+' 天前';
  }catch{ return ''; }
}

// Simple i18n for UI strings in this module
function i18nStr(key, lang){
  const map = {
    allSources: { zh: '全部来源', en: 'All sources', es: 'Todas las fuentes' },
    allTags: { zh: '全部标签', en: 'All tags', es: 'Todas las etiquetas' },
    searchPH: { zh: '全局搜索…', en: 'Global search…', es: 'Búsqueda global…' },
    today: { zh: '今天', en: 'Today', es: 'Hoy' },
    archive: { zh: '归档', en: 'Archive', es: 'Archivo' },
    updated: { zh: '更新', en: 'Updated', es: 'Actualizado' },
    items: { zh: '条', en: 'items', es: 'entradas' },
    briefingTitle: { zh: '今日导读', en: "Today's Briefing", es: 'Resumen de hoy' },
    briefingLoading: { zh: '今日导读加载中…', en: 'Loading daily briefing…', es: 'Cargando el resumen diario…' },
    briefingEmpty: { zh: '今日导读暂未生成，稍后再来。', en: 'Briefing not ready yet. Check back soon.', es: 'El resumen aún no está listo. Vuelve pronto.' },
    briefingNoItems: { zh: '暂无条目', en: 'No items yet', es: 'Sin elementos' },
    briefingJump: { zh: '定位到新闻', en: 'View story', es: 'Ver noticia' },
    briefingThemes: { zh: '主题脉络', en: 'Theme highlights', es: 'Temas clave' },
    briefingLength: { zh: '播报约 {seconds} 秒', en: 'Runtime ≈ {seconds}s', es: 'Duración ≈ {seconds}s' },
    briefingHotness: { zh: '热度趋势 {value}', en: 'Hotness {value}', es: 'Tendencia {value}' },
  };
  return (map[key]?.[lang]) || (map[key]?.zh) || '';
}

function guessBadges(it){
  const t = `${it.title||''} ${it.raw_excerpt||''}`.toLowerCase();
  const b=[];
  if(/policy|regulat|eu ai act|govern|safety/.test(t)) b.push('Policy');
  if(/funding|raise|seed|series [abc]|acquire|acquisition/.test(t)) b.push('Funding');
  if(/state[- ]of[- ]the[- ]art|sota|breakthrough|trending|viral/.test(t)) b.push('Trending');
  if(/\barxiv\b|preprint|paper|dataset|benchmark|peer[- ]review|research|study/.test(t)) b.push('Research');
  return b;
}

function badgeClass(label){
  if(label === 'Trending') return 'badge-trending';
  if(label === 'Policy') return 'badge-policy';
  if(label === 'Funding') return 'badge-funding';
  if(label === 'Research') return 'badge-research';
  return '';
}

function extractHost(u){ try{ return new URL(u).host.replace(/^www\./,''); }catch{ return ''; } }

// --- i18n helpers & excerpt cleanup ---
function pickLangText(bundle, lang, fallback){
  if (!bundle) return fallback || '';
  // Prefer requested language; for zh/es, fallback to en; for en, do NOT fallback to zh
  if (lang === 'en') return bundle.en || fallback || '';
  if (lang === 'zh') return bundle.zh || bundle.en || fallback || '';
  if (lang === 'es') return bundle.es || bundle.en || fallback || '';
  return bundle[lang] || bundle.en || fallback || '';
}
function getTitle(item, lang){
  return pickLangText(item.title_i18n, lang, item.title || '');
}
function getExcerpt(item, lang){
  return pickLangText(item.excerpt_i18n, lang, item.raw_excerpt || '');
}
function cleanExcerpt(raw){
  if (!raw) return '';
  let t = String(raw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Remove common HN boilerplate
  t = t
    .replace(/Article URL:\s*\S+/gi, '')
    .replace(/Comments URL:\s*\S+/gi, '')
    .replace(/Points:\s*\d+/gi, '')
    .replace(/#\s*Comments:\s*\d+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return t;
}

// Source display mapping
const SOURCE_MAP = {
  'news.ycombinator.com': 'Hacker News',
  'technologyreview.com': 'MIT Tech Review',
  'www.technologyreview.com': 'MIT Tech Review',
  'jiqizhixin.com': '机器之心',
  'www.jiqizhixin.com': '机器之心',
  'qbitai.com': '量子位',
  'www.qbitai.com': '量子位',
  'infoq.cn': 'InfoQ (中文)',
  'www.infoq.cn': 'InfoQ (中文)',
  'leiphone.com': '雷峰网',
  'www.leiphone.com': '雷峰网',
  'arstechnica.com': 'Ars Technica',
  'ai.googleblog.com': 'Google AI Blog',
  'openai.com': 'OpenAI',
  'huggingface.co': 'Hugging Face'
};
function sourceDisplay(item){
  try{
    const host = extractHost(item.url || (item.source?.site||'') || (item.source?.feed||''));
    if (!host) return (item.source?.site) || 'Unknown';
    return SOURCE_MAP[host] || host;
  }catch{ return (item.source?.site) || 'Unknown'; }
}

function escapeHtml(value){
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function escapeAttr(value){
  return escapeHtml(value).replace(/`/g, '&#96;');
}
function ensureLeadingSlash(url){
  if (!url) return '';
  if (/^https?:/i.test(url)) return url;
  const trimmed = String(url).replace(/^\/+/, '');
  return '/' + trimmed;
}
function cssEscapeLite(value){
  const str = String(value ?? '');
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(str);
  return str.replace(/[^a-zA-Z0-9_\-]/g, s => `\\${s}`);
}
function ensureItemId(it){
  if (it.__briefId) return it.__briefId;
  let base = '';
  if (it.id) base = String(it.id);
  else if (it.url) base = `url:${it.url}`;
  else if (it.title) base = `title:${it.title}`;
  else {
    if (!it.__generatedId) it.__generatedId = `auto-${Math.random().toString(36).slice(2,10)}`;
    base = it.__generatedId;
  }
  it.__briefId = base;
  return base;
}
function highlightCardById(itemId){
  if (!itemId) return;
  try{
    const selector = `[data-item-id="${cssEscapeLite(itemId)}"]`;
    const el = document.querySelector(selector);
    if (!el) return;
    el.classList.remove('rad-card--highlight');
    void el.offsetWidth;
    el.classList.add('rad-card--highlight');
    el.scrollIntoView({behavior:'smooth', block:'center'});
    setTimeout(()=> el.classList.remove('rad-card--highlight'), 2800);
  }catch{}
}

function briefingHasContent(data){
  if (!data) return false;
  const script = data.script || {};
  if (Array.isArray(script.paragraphs) && script.paragraphs.some(entry => String(entry || '').trim())) return true;
  if (typeof data.script_text === 'string' && data.script_text.trim()) return true;
  if (Array.isArray(script.segments) && script.segments.some(seg => seg && (seg.fact || seg.impact || seg.summary))) return true;
  if (script.opening || script.closing || script.call_to_action) return true;
  if (Array.isArray(data.sections) && data.sections.length) return true;
  if (data.outro && (data.outro.tomorrow_watch || data.outro.call_to_action)) return true;
  return false;
}

async function renderAIRadar(containerId = 'ai-radar') {
  const listEl = document.getElementById(containerId);
  const subEl = document.getElementById('rad-sub');
  const qEl = document.getElementById('rad-q');
  const srcEl = document.getElementById('rad-source');
  const tagEl = document.getElementById('rad-tag');
  const dateEl = document.getElementById('rad-date');
  const prevEl = document.getElementById('rad-prev');
  const nextEl = document.getElementById('rad-next');
  const topEl = document.getElementById('rad-top');
  const briefingEl = document.getElementById('rad-briefing');

  let dates = [];
  let payload = null;
  let items = [];
  let briefingData = null;
  let briefingState = 'idle';
  const briefingCache = new Map();
  const allCache = new Map();
  let globalIndex = null;
  let topKeys = new Set();

  function currentLang(){
    return (localStorage.getItem('lang')||document.documentElement.lang||'zh').toLowerCase();
  }

  function tr(key, fallback=''){
    const lang = currentLang();
    const dict = window.translations || {};
    return (dict[lang] && dict[lang][key]) ?? (dict.en && dict.en[key]) ?? fallback;
  }

  function isoToBjDate(iso){
    try{
      if(!iso) return '';
      const ms = Date.parse(iso);
      if (Number.isNaN(ms)) return '';
      const bj = new Date(ms + 8 * 3600 * 1000);
      return bj.toISOString().slice(0,10);
    }catch{return '';}
  }

  async function loadDates(){
    try{
      dates = await fetch('/data/ai/airadar/dates.json',{cache:'no-store'}).then(r=>r.json());
      if(!Array.isArray(dates)) dates=[];
    }catch{ dates=[]; }
  }
  function setDateBounds(){ if(dateEl && dates.length>0){ dateEl.min=dates[dates.length-1]; dateEl.max=dates[0]; } }
  function updateNav(){ const idx=dates.indexOf(dateEl?.value||''); if(prevEl) prevEl.disabled=(idx===-1)||(idx>=dates.length-1); if(nextEl) nextEl.disabled=(idx===-1)||(idx<=0); }

  function assignItemIds(arr){ arr.forEach(it=> ensureItemId(it)); }

  async function loadData(){
    const picked = dateEl?.value;
    let url = '/data/ai/airadar/latest.json';
    if (picked) url = `/data/ai/airadar/${picked}.json`;
    payload = await fetch(url, {cache:'no-store'}).then(r=>r.json()).catch(()=>({items:[]}));
    items = Array.isArray(payload.items)? payload.items: [];
    assignItemIds(items);
    try{
      const lang = currentLang();
      if (qEl) qEl.placeholder = i18nStr('searchPH', lang);
    }catch{}
    try{
      const lang = currentLang();
      const hosts = Array.from(new Set(items.map(it=> extractHost(it.url||it.source?.site||it.source?.feed||'')).filter(Boolean))).sort();
      const current = srcEl?.value;
      if (srcEl){
        srcEl.innerHTML = `<option value="">${i18nStr('allSources', lang)}</option>` + hosts.map(h=>`<option value="${h}">${h}</option>`).join('');
        if (hosts.includes(current)) srcEl.value=current; else srcEl.value='';
      }
    }catch{}
    try{
      const lang = currentLang();
      const tagSet = new Set();
      items.forEach(it=> (it.tags||[]).forEach(t=> tagSet.add(String(t))));
      const tags = Array.from(tagSet).sort();
      const cur = tagEl?.value;
      if (tagEl){
        tagEl.innerHTML = `<option value="">${i18nStr('allTags', lang)}</option>` + tags.map(t=>`<option>${t}</option>`).join('');
        if (tags.includes(cur)) tagEl.value = cur; else tagEl.value = '';
      }
    }catch{}
  }

  function currentBriefingDate(){
    if (payload?.briefing?.date) return payload.briefing.date;
    if (dateEl?.value) return dateEl.value;
    if (payload?.generated_at){ const bj = isoToBjDate(payload.generated_at); if (bj) return bj; }
    if (items.length && items[0]?.published_at){ const bj = isoToBjDate(items[0].published_at); if (bj) return bj; }
    return '';
  }

  async function loadBriefing(){
    briefingState = 'loading';
    if (briefingEl) briefingEl.dataset.state = 'loading';
    const ref = payload?.briefing || {};
    let url = ref.url || '';
    const fallbackDate = currentBriefingDate();
    if (!url && fallbackDate) url = `/data/ai/airadar/briefings/${fallbackDate}.json`;
    if (!url){
      briefingData = null;
      briefingState = 'empty';
      return;
    }
    const normalizedUrl = ensureLeadingSlash(url);
    if (briefingCache.has(normalizedUrl)){
      briefingData = briefingCache.get(normalizedUrl);
      const cached = briefingData || {};
      briefingState = briefingHasContent(cached) ? 'ready' : 'empty';
      return;
    }
    try{
      const res = await fetch(normalizedUrl, {cache:'no-store'});
      if (!res.ok){
        briefingData = null;
        briefingCache.set(normalizedUrl, null);
        briefingState = 'empty';
        return;
      }
      const data = await res.json();
      briefingData = data;
      briefingCache.set(normalizedUrl, data);
      briefingState = briefingHasContent(data) ? 'ready' : 'empty';
    }catch{
      briefingData = null;
      briefingState = 'empty';
    }
  }

  function applySubtitle(){
    if(!subEl || !payload) return;
    const lang=currentLang();
    const gen = new Date(payload.generated_at||Date.now());
    const ts = gen.toLocaleString();
    const count = items.length;
    const isArchive = Boolean(dateEl?.value);
    if (isArchive){
      if (lang==='en') subEl.textContent = `${i18nStr('archive',lang)} · ${dateEl.value} · ${count} ${i18nStr('items',lang)} · ${i18nStr('updated',lang)} ${ts}`;
      else if (lang==='es') subEl.textContent = `${i18nStr('archive',lang)} · ${dateEl.value} · ${count} ${i18nStr('items',lang)} · ${i18nStr('updated',lang)} ${ts}`;
      else subEl.textContent = `${i18nStr('archive',lang)} · ${dateEl.value} · 共 ${count} 条 · 生成：${ts}`;
    } else {
      if (lang==='en') subEl.textContent = `${i18nStr('today',lang)} · ${count} ${i18nStr('items',lang)} · ${i18nStr('updated',lang)} ${ts}`;
      else if (lang==='es') subEl.textContent = `${i18nStr('today',lang)} · ${count} ${i18nStr('items',lang)} · ${i18nStr('updated',lang)} ${ts}`;
      else subEl.textContent = `${i18nStr('today',lang)} · 共 ${count} 条 · 更新：${ts}`;
    }
  }

  async function ensureGlobalIndex(){
    if (globalIndex !== null) return;
    try{
      const data = await fetch('/data/ai/airadar/index.json', {cache:'no-store'}).then(r=>r.json());
      globalIndex = Array.isArray(data?.items) ? data.items : [];
    }catch{ globalIndex = []; }
  }

  async function getAllItems(){
    await ensureGlobalIndex();
    if (Array.isArray(globalIndex) && globalIndex.length){
      const mapped = globalIndex.map(it => ({
        id: it.id,
        url: it.url,
        published_at: it.ts,
        title_i18n: it.title_i18n || {},
        excerpt_i18n: it.excerpt_i18n || {},
        raw_excerpt: '',
        source: { site: it.source_host, feed: '' },
        tags: [],
      }));
      assignItemIds(mapped);
      return mapped;
    }
    const want = dates.slice();
    const toFetch = want.filter(d => !allCache.has(d));
    await Promise.all(toFetch.map(async d => {
      try{
        const data = await fetch(`/data/ai/airadar/${d}.json`, {cache:'no-store'}).then(r=>r.json());
        allCache.set(d, Array.isArray(data.items)? data.items: []);
      }catch{ allCache.set(d, []); }
    }));
    const merged = [];
    for (const d of want){ merged.push(...(allCache.get(d) || [])); }
    merged.sort((a,b)=> String(b.published_at||'').localeCompare(String(a.published_at||'')));
    assignItemIds(merged);
    return merged;
  }

  async function filterItems(){
    const q = (qEl?.value||'').trim().toLowerCase();
    const src = (srcEl?.value||'').trim().toLowerCase();
    const tag = (tagEl?.value||'').trim().toLowerCase();
    let pool = items;
    if (q) pool = await getAllItems();
    return pool.filter(it=>{
      if (src){
        const host = extractHost(it.url||'');
        if (host && !host.includes(src)) return false;
      }
      if (tag){
        const tags = (it.tags||[]).map(x=>String(x).toLowerCase());
        if (!tags.includes(tag)) return false;
      }
      if (!q) return true;
      const ti = it.title_i18n || {};
      const ei = it.excerpt_i18n || {};
      const blob = [
        it.title||'', it.raw_excerpt||'',
        ti.zh||'', ti.en||'', ti.es||'',
        ei.zh||'', ei.en||'', ei.es||'',
        (it.source?.site||''), (it.source?.feed||'')
      ].join(' ').toLowerCase();
      return q.split(/\s+/).filter(Boolean).some(w=>blob.includes(w));
    });
  }

  function cardHTML(it, isTop=false){
    const lang = currentLang();
    const itemId = ensureItemId(it);
    const titleRaw = getTitle(it, lang);
    const title = titleRaw && titleRaw.trim() ? titleRaw.trim() : '(无标题)';
    const hostDisp = sourceDisplay(it) || '未知来源';
    const time = relTime(it.published_at);
    const allTags = new Set([...(it.tags || []).map(String), ...guessBadges(it)]);
    const badges = Array.from(allTags).map(lbl=>{
      const b = String(lbl);
      const cls = badgeClass(b) || '';
      const emoji = b === 'Research' ? '🧪' : b === 'Policy' ? '🏛️' : b === 'Funding' ? '💰' : b === 'Trending' ? '🔥' : '';
      return `<span class="badge ${cls}">${emoji} ${b}</span>`;
    }).join(' ');
    const excerptPrimary = cleanExcerpt(getExcerpt(it, lang));
    const fallbackExcerpt = tr('radar_card_no_summary', '暂无摘要，点击“阅读原文”了解详情。');
    const originalLabel = tr('radar_card_original', '阅读原文');
    const originalBadgeLabel = tr('radar_badge_original', '原文');
    const needsI18nBadge = !(it.title_i18n && (it.title_i18n[lang]||it.title_i18n.zh||it.title_i18n.en));
    const topClass = isTop ? ' card--top' : '';
    const aria = `${title} - ${hostDisp}`;
    const published = it.published_at ? new Date(it.published_at) : null;
    const fallbackTime = (!time && published && !Number.isNaN(published.getTime())) ? published.toLocaleString() : '';
    const metaBits = [];
    if (time) metaBits.push(time);
    else if (fallbackTime) metaBits.push(fallbackTime);
    if (hostDisp) metaBits.push(hostDisp);
    const metaText = metaBits.join(' ｜ ');
    const tagsBlock = (it.tags||[]).map(tag=>`<span class="tag">${tag}</span>`).join('');
    const badgeParts = [];
    if (badges) badgeParts.push(badges);
    if (needsI18nBadge) badgeParts.push(`<span class="badge badge-translation">🌐 ${originalBadgeLabel}</span>`);
    const badgesBlock = badgeParts.length ? `<div class="rad-badges">${badgeParts.join('')}</div>` : '';
    const summaryBlock = excerptPrimary
      ? `<p class="rad-excerpt">${excerptPrimary}</p>`
      : `<p class="rad-excerpt rad-excerpt--empty">${fallbackExcerpt}</p>`;
    return `
      <article class="card rad-card${topClass}" data-item-id="${escapeAttr(itemId)}" tabindex="0" aria-label="${aria}">
        <div class="rad-card-head">
          ${badgesBlock}
          <div class="rad-card-title">
            <h3 class="rad-title"><a href="${it.url}" target="_blank" rel="noopener">${title}</a></h3>
          </div>
        </div>
        <div class="rad-card-body">
          <div class="rad-meta">${metaText}</div>
          ${summaryBlock}
          ${tagsBlock ? `<div class="rad-tags">${tagsBlock}</div>` : ''}
        </div>
        <div class="rad-card-footer">
          <div class="rad-card-actions">
            <a class="rad-link" href="${it.url}" target="_blank" rel="noopener">${originalLabel}</a>
          </div>
        </div>
      </article>
    `;
  }

  async function renderList(){
    if(!listEl) return;
    const arr = await filterItems();
    const PAGE = 40;
    let page = 1;
    function draw(){
      const hasQuery = (qEl?.value||'').trim().length>0;
      const hasSourceFilter = (srcEl?.value||'').trim().length>0;
      const hasTagFilter = (tagEl?.value||'').trim().length>0;
      const hasAnyFilter = hasQuery || hasSourceFilter || hasTagFilter;
      const deduped = hasAnyFilter ? arr.slice() : arr.filter(it=> !topKeys.has(ensureItemId(it)));
      const slice = deduped.slice(0, PAGE*page);
      const needsMore = slice.length < deduped.length;
      listEl.innerHTML = slice.map(it => cardHTML(it)).join('') + (needsMore ? `<div style="grid-column:1 / -1;display:flex;justify-content:center;margin:8px 0"><button id="rad-more" class="btn outline" aria-label="加载更多">加载更多</button></div>` : '');
      setupCardInteractivity(listEl);
      const more = document.getElementById('rad-more');
      more?.addEventListener('click', ()=>{ page++; draw(); });
    }
    draw();
  }

  function setupCardInteractivity(scope){
    if(!scope) return;
    scope.querySelectorAll('article.card.rad-card').forEach(card=>{
      const link = card.querySelector('a[href]');
      const url = link?.getAttribute('href');
      if (!url) return;
      card.addEventListener('click', (e)=>{ if (e.target.closest('a,button')) return; window.open(url, '_blank', 'noopener'); });
      card.addEventListener('keydown', (e)=>{ if (e.target.closest('a,button')) return; if (e.key==='Enter' || e.key===' '){ e.preventDefault(); window.open(url, '_blank', 'noopener'); }});
    });
  }

  function getTopItems(arr){
    const N = 6;
    const res = [];
    const seen = new Set();
    for (const it of arr){
      const key = ensureItemId(it);
      if (guessBadges(it).length>0 && !seen.has(key)){
        res.push(it);
        seen.add(key);
        if (res.length===N) break;
      }
    }
    if (res.length < N){
      for (const it of arr){
        const key = ensureItemId(it);
        if (!seen.has(key)){
          res.push(it);
          seen.add(key);
          if (res.length===N) break;
        }
      }
    }
    return res.slice(0,N);
  }

  function renderTop(){
    if(!topEl) return;
    const hasQuery = (qEl?.value||'').trim().length>0;
    const hasSourceFilter = (srcEl?.value||'').trim().length>0;
    const hasTagFilter = (tagEl?.value||'').trim().length>0;
    if (hasQuery || hasSourceFilter || hasTagFilter){ topEl.innerHTML=''; topKeys = new Set(); return; }
    const arr = items.slice();
    const top = getTopItems(arr);
    topKeys = new Set(top.map(it => ensureItemId(it)));
    const wrap = document.createElement('div');
    wrap.className = 'rad-top-wrap';
    const heading = document.createElement('div');
    heading.className = 'rad-top-heading';
    const titleEl = document.createElement('h3');
    titleEl.textContent = tr('radar_top_label', 'Top 6 热度榜');
    const subtitle = document.createElement('span');
    subtitle.textContent = tr('radar_top_caption', '今日关注度最高的 6 条资讯');
    heading.appendChild(titleEl);
    heading.appendChild(subtitle);
    wrap.appendChild(heading);
    const grid = document.createElement('div');
    grid.className = 'rad-top-grid';
    grid.innerHTML = top.map(it => cardHTML(it, true)).join('');
    wrap.appendChild(grid);
    topEl.innerHTML = '';
    try { topEl.classList.remove('rad-list'); } catch {}
    topEl.appendChild(wrap);
    setupCardInteractivity(topEl);
  }

  function renderBriefing(){
    if (!briefingEl){ return; }
    const lang = currentLang();
    briefingEl.dataset.state = briefingState;
    const data = briefingData || {};
    if (!briefingHasContent(data)){
      const msgKey = briefingState === 'loading' ? 'briefingLoading' : 'briefingEmpty';
      briefingEl.innerHTML = `<div class="rad-briefing-empty">${escapeHtml(i18nStr(msgKey, lang))}</div>`;
      return;
    }

    const script = data.script || {};
    const segments = Array.isArray(script.segments) ? script.segments : [];
    const scriptTextRaw = typeof data.script_text === 'string' ? data.script_text.trim() : '';
    const meta = data.meta || {};
    const themeEntries = Array.isArray(meta.themes) ? meta.themes : [];
    const themeLine = themeEntries.length ? themeEntries.map(t => `${t.topic || ''}：${t.one_line || ''}`.trim()).filter(Boolean).join('；') : '';
    const themesLabel = i18nStr('briefingThemes', lang);
    const lengthLine = meta.length_sec_estimate ? i18nStr('briefingLength', lang).replace('{seconds}', String(meta.length_sec_estimate)) : '';
    const hotnessChip = meta.hotness_delta ? i18nStr('briefingHotness', lang).replace('{value}', String(meta.hotness_delta)) : '';

    let paragraphs = [];
    if (Array.isArray(script.paragraphs)){
      paragraphs = script.paragraphs.map(entry => String(entry || '').trim()).filter(Boolean);
    }
    if (!paragraphs.length && scriptTextRaw){
      paragraphs = scriptTextRaw.split(/\n{2,}/).map(chunk => chunk.trim()).filter(Boolean);
    }
    if (!paragraphs.length){
      const opening = script.opening ? String(script.opening).trim() : '';
      if (opening) paragraphs.push(opening);
      segments.forEach((segment, idx) => {
        if (!segment || typeof segment !== 'object') return;
        const pieces = [];
        if (segment.fact) pieces.push(String(segment.fact).trim());
        if (segment.impact) pieces.push(String(segment.impact).trim());
        if (segment.summary) pieces.push(String(segment.summary).trim());
        const combined = pieces.filter(Boolean).join(' ');
        if (!combined) return;
        const tag = segment.tag ? `（${String(segment.tag).trim()}）` : '';
        const seq = idx + 1;
        paragraphs.push(`第${seq}条${tag}：${combined}`);
      });
      const closing = script.closing ? String(script.closing).trim() : '';
      if (closing) paragraphs.push(closing);
      const cta = script.call_to_action ? String(script.call_to_action).trim() : '';
      if (cta) paragraphs.push(cta);
    }
    if (!paragraphs.length && Array.isArray(data.sections)){
      (data.sections || []).forEach(section => {
        if (!section || typeof section !== 'object') return;
        const title = section.title ? String(section.title).trim() : '';
        const entries = Array.isArray(section.items) ? section.items : [];
        const summary = entries.map(entry => {
          if (!entry || typeof entry !== 'object') return '';
          const bits = [entry.one_liner, entry.why_it_matters, entry.next_step].map(v => v ? String(v).trim() : '').filter(Boolean);
          return bits.join(' ');
        }).filter(Boolean).slice(0, 3).join('；');
        const line = [title, summary].filter(Boolean).join('：');
        if (line) paragraphs.push(line);
      });
      const outro = data.outro || {};
      const tomorrow = outro.tomorrow_watch ? String(outro.tomorrow_watch).trim() : '';
      if (tomorrow) paragraphs.push(`明日关注：${tomorrow}`);
      const action = outro.call_to_action ? String(outro.call_to_action).trim() : '';
      if (action) paragraphs.push(action);
    }
    paragraphs = paragraphs.map(text => String(text || '').trim()).filter(Boolean);
    if (!paragraphs.length){
      const msgKey = briefingState === 'loading' ? 'briefingLoading' : 'briefingEmpty';
      briefingEl.innerHTML = `<div class="rad-briefing-empty">${escapeHtml(i18nStr(msgKey, lang))}</div>`;
      return;
    }

    const paragraphHtml = paragraphs.map((text, idx) => {
      const attrs = [];
      if (idx === 0) attrs.push('data-opening="true"');
      if (idx === paragraphs.length - 1) attrs.push('data-closing="true"');
      const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';
      return `<p class="rad-briefing-paragraph"${attrStr}>${escapeHtml(text)}</p>`;
    }).join('');
    const bodyHtml = `<div class="rad-briefing-text">${paragraphHtml}</div>`;

    briefingEl.innerHTML = `
      <div class="rad-briefing-inner">
        <div class="rad-briefing-head">
          <div>
            <h3 class="rad-briefing-title">${escapeHtml(i18nStr('briefingTitle', lang))}</h3>
            ${themeLine ? `<p class="rad-briefing-themes">${escapeHtml(`${themesLabel}：${themeLine}`)}</p>` : ''}
            ${lengthLine ? `<p class="rad-briefing-meta">${escapeHtml(lengthLine)}</p>` : ''}
          </div>
          ${hotnessChip ? `<span class="rad-briefing-chip">${escapeHtml(hotnessChip)}</span>` : ''}
        </div>
        ${bodyHtml}
      </div>
    `;
  }

  await loadDates();
  setDateBounds();
  if (dateEl && !dateEl.value && Array.isArray(dates) && dates.length > 0) {
    try { dateEl.value = dates[0]; } catch {}
  }
  await loadData();
  await loadBriefing();
  applySubtitle();
  renderBriefing();
  renderTop();
  await renderList();
  updateNav();

  qEl?.addEventListener('input', ()=>{ renderTop(); renderList(); });
  srcEl?.addEventListener('change', ()=>{ renderTop(); renderList(); });
  tagEl?.addEventListener('change', ()=>{ renderTop(); renderList(); });
  dateEl?.addEventListener('change', async ()=>{
    await loadData();
    await loadBriefing();
    applySubtitle();
    renderBriefing();
    renderTop();
    await renderList();
    updateNav();
  });
  prevEl?.addEventListener('click', async ()=>{
    let idx = dates.indexOf(dateEl?.value||'');
    if (idx === -1) idx = 0;
    if (idx < dates.length - 1) {
      dateEl.value = dates[idx + 1];
      await loadData();
      await loadBriefing();
      applySubtitle();
      renderBriefing();
      renderTop();
      await renderList();
      updateNav();
    }
  });
  nextEl?.addEventListener('click', async ()=>{
    let idx = dates.indexOf(dateEl?.value||'');
    if (idx === -1) idx = 0;
    if (idx > 0) {
      dateEl.value = dates[idx - 1];
      await loadData();
      await loadBriefing();
      applySubtitle();
      renderBriefing();
      renderTop();
      await renderList();
      updateNav();
    }
  });

  window.addEventListener('language-changed', ()=>{ applySubtitle(); renderBriefing(); renderTop(); renderList(); });
}
window.addEventListener('DOMContentLoaded', () => renderAIRadar('ai-radar'));
