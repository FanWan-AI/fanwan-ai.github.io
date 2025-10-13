/*
 * Front‑end interactivity for Fan Wan's personal website.
 *
 * This script handles the following behaviours:
 * 1. Updating the copyright year in the footer.
 * 2. Toggling the mobile navigation menu via the hamburger icon.
 * 3. Animating sections as they enter the viewport using an
 *    IntersectionObserver. Each section starts slightly faded and
 *    translated downwards; the observer adds the `visible` class to
 *    animate them into place.
 */

function safeLocalGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

function safeLocalRemove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {}
}

function resolveLang(defaultLang = 'zh') {
  const docLang = (document.documentElement && document.documentElement.lang) || defaultLang;
  const stored = safeLocalGet('lang');
  return (stored || docLang || defaultLang || '').toString();
}

document.addEventListener('DOMContentLoaded', () => {
  // Footer traveler line: only UV, tri-lingual sentence; centered with ©
  (function setupTravelerLine(){
    try {
      const footerBox = document.querySelector('footer .container');
      if (!footerBox) return;
      if (document.getElementById('site-counter')) return;
      const getLang = () => resolveLang().slice(0, 2);
      const wrap = document.createElement('div');
      wrap.id = 'site-counter';
      wrap.className = 'counter';
      wrap.setAttribute('aria-live','polite');
      // Initial template with 0; will update after fetch
      function formatCount(n){
        if (n === '—') return '—';
        const maybe = Number.parseInt(String(n), 10);
        return (Number.isFinite(maybe) && maybe > 0) ? String(maybe) : '—';
      }

      function line(n, lang){
        const num = formatCount(n);
        if (lang === 'en') return `Traveler <span class="counter-number" data-counter="uv">${num}</span>: your mark has been etched into this story, forever part of its journey. Thank you.`;
        if (lang === 'es') return `Viajero <span class="counter-number" data-counter="uv">${num}</span>: tu huella ha quedado grabada en esta historia, parte eterna de su camino. Gracias.`;
        return `旅行者 <span class="counter-number" data-counter="uv">${num}</span>：你的印记，已镌刻在此间的故事里。致谢。`;
      }
      // Decide initial display: if offline and no cache, show a dash instead of 0
      function getCachedUV(){
        try {
          const raw = safeLocalGet('site_uv_cache');
          if (!raw) return 0;
          const obj = JSON.parse(raw);
          const v = parseInt(obj?.v, 10);
          return (Number.isFinite(v) && v > 0) ? v : 0;
        } catch { return 0; }
      }
      const cachedAtBoot = getCachedUV();
      const hasCacheAtBoot = cachedAtBoot > 0;
      const initialVal = hasCacheAtBoot ? cachedAtBoot : '—';
      wrap.innerHTML = `<span class="counter-item">${line(initialVal, getLang())}</span>`;
      footerBox.appendChild(wrap);

      // Minimal count-up animation for the number only
      function countUp(el, to){
        try {
          const target = parseInt(String(to), 10);
          if (!Number.isFinite(target) || target <= 0) {
            el.textContent = '—';
            return;
          }
          const startRaw = parseInt(el.textContent || '0', 10);
          const start = Number.isFinite(startRaw) && startRaw > 0 ? startRaw : 0;
          if (start === target) return;
          const dur = 650; // slightly faster to feel snappier
          const t0 = performance.now();
          function easeOutCubic(x){ return 1 - Math.pow(1 - x, 3); }
          function step(now){
            const p = Math.min(1, (now - t0) / dur);
            const val = Math.round(start + (target - start) * easeOutCubic(p));
            el.textContent = String(val);
            if (p < 1) requestAnimationFrame(step);
          }
          requestAnimationFrame(step);
        } catch {
          el.textContent = formatCount(to);
        }
      }

      // CountAPI/CounterAPI helpers
      const NS = 'fanwan-ai.github.io';
      const KEY_UV = 'site_uv';
      const hasTagged = !!safeLocalGet('site_uv_tag');
      const tagVisitor = ()=>{ safeLocalSet('site_uv_tag', '1'); };
      // Basic fetch with timeout
      async function fetchJson(url, timeoutMs = 1400){
        const ctl = new AbortController();
        const t = setTimeout(()=>ctl.abort(), timeoutMs);
        try {
          const r = await fetch(url, { mode: 'cors', signal: ctl.signal });
          if (!r.ok) throw new Error('net');
          return await r.json();
        } finally { clearTimeout(t); }
      }
      async function countapi(method, key){
        const base = 'https://api.countapi.xyz';
        const url = method === 'hit' ? `${base}/hit/${encodeURIComponent(NS)}/${encodeURIComponent(key)}`
                                     : `${base}/get/${encodeURIComponent(NS)}/${encodeURIComponent(key)}`;
        return fetchJson(url, 1400);
      }
      async function counterapi(method, key){
        const base = 'https://counterapi.dev/api';
        const url = method === 'hit' ? `${base}/${encodeURIComponent(NS)}/${encodeURIComponent(key)}/increment`
                                     : `${base}/${encodeURIComponent(NS)}/${encodeURIComponent(key)}`;
        return fetchJson(url, 1400);
      }

      // Fallback: Busuanzi (popular in CN). Load mini script and read site UV.
      async function busuanziUV(timeoutMs = 1800){
        // Only attempt on HTTPS pages to avoid mixed-content/CSP noise in local file previews
        if (location.protocol !== 'https:') {
          throw new Error('skip-busuanzi-non-https');
        }
        const src = 'https://busuanzi.ibruce.info/busuanzi/2.3/busuanzi.pure.mini.js';
        // Ensure a target span exists for the script to populate
        let span = document.getElementById('busuanzi_value_site_uv');
        if (!span) {
          span = document.createElement('span');
          span.id = 'busuanzi_value_site_uv';
          span.style.cssText = 'position:absolute;left:-9999px;top:-9999px;pointer-events:none;opacity:0;';
          document.body.appendChild(span);
        }
        // Load script once
        const already = Array.from(document.scripts).some(s => (s.src||'').includes('busuanzi/2.3/busuanzi.pure.mini.js'));
        if (!already) {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src; s.async = true; s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
          });
        }
        // Poll for value
        return await new Promise((resolve, reject) => {
          const t0 = Date.now();
          const timer = setInterval(() => {
            const txt = (span.textContent || '').trim();
            const n = parseInt(txt, 10);
            if (Number.isFinite(n) && n > 0) { clearInterval(timer); resolve(n); }
            else if (Date.now() - t0 > timeoutMs) { clearInterval(timer); reject(new Error('busuanzi timeout')); }
          }, 120);
        });
      }

  // Show cached value immediately to avoid initial 0
      (function showCached(){
        try {
          const raw = safeLocalGet('site_uv_cache');
          if (!raw) return;
          const obj = JSON.parse(raw);
          const v = parseInt(obj?.v, 10);
          if (Number.isFinite(v) && v > 0) {
            const lang = getLang();
            wrap.innerHTML = `<span class="counter-item">${line(v, lang)}</span>`;
          }
        } catch {}
      })();

      async function getUV(){
        // 1) Fast path: race GET from both providers
        async function fastGet(){
          const responses = await Promise.allSettled([
            countapi('get', KEY_UV),
            counterapi('get', KEY_UV)
          ]);
          const values = responses.map(r => {
            if (r.status !== 'fulfilled') return 0;
            const raw = r.value?.value ?? r.value?.count ?? r.value?.views;
            return (Number.isFinite(raw) && raw > 0) ? raw : 0;
          });
          const best = values.filter(v => v > 0);
          return best.length ? Math.max(...best) : 0;
        }
        // 2) If first visit on this browser, perform HIT in background to increment
        let shown = 0;
        try { shown = await fastGet(); } catch { shown = 0; }
        // Update UI quickly if we got something
        if (shown > 0) {
          try {
            const numEl = wrap.querySelector('[data-counter="uv"]');
            if (numEl) countUp(numEl, shown); else {
              const lang = getLang(); wrap.innerHTML = `<span class="counter-item">${line(shown, lang)}</span>`;
            }
            safeLocalSet('site_uv_cache', JSON.stringify({ v: shown, t: Date.now() }));
          } catch {}
        }
        // 3) Increment once per visitor
        if (!hasTagged) {
          let inc = 0;
          try { const a = await countapi('hit', KEY_UV); inc = a?.value ?? a?.count ?? a?.views ?? 0; }
          catch { try { const b = await counterapi('hit', KEY_UV); inc = b?.value ?? b?.count ?? b?.views ?? 0; } catch {}
          }
          if (inc > 0) {
            // Prefer incremented value if higher than shown
            const final = Math.max(shown || 0, inc);
            try {
              const numEl = wrap.querySelector('[data-counter="uv"]');
              if (numEl) countUp(numEl, final); else {
                const lang = getLang(); wrap.innerHTML = `<span class="counter-item">${line(final, lang)}</span>`;
              }
              safeLocalSet('site_uv_cache', JSON.stringify({ v: final, t: Date.now() }));
            } catch {}
            tagVisitor();
            return final;
          }
        }
        // 4) If nothing yet, try full GET again (both) then Busuanzi as last resort
        let uv = shown;
        if (!uv || uv <= 0) {
          try { uv = await fastGet(); } catch { uv = 0; }
        }
        if (!uv || uv <= 0) {
          try {
            const bz = await busuanziUV();
            if (Number.isFinite(bz) && bz > 0) {
              uv = bz;
              if (!hasTagged) tagVisitor();
            }
          } catch {}
        }
        return uv || 0;
      }

    // Fetch & render
  (async () => {
        try {
          const uv = await getUV();
          // Rebuild line in current language, then animate the number
      const lang = getLang();
      const cached = getCachedUV();
      const sanitized = (Number.isFinite(uv) && uv > 0)
        ? uv
        : (cached > 0 ? cached : '—');
      wrap.innerHTML = `<span class="counter-item">${line(sanitized, lang)}</span>`;
      const numEl = wrap.querySelector('[data-counter="uv"]');
      if (numEl && typeof sanitized === 'number') countUp(numEl, sanitized);
        } catch {
          wrap.style.display = 'none';
        }
      })();

    // Update on language change (re-render sentence, preserve value displayed, keep dash if present)
      window.addEventListener('language-changed', () => {
        try {
      const txt = (wrap.querySelector('[data-counter="uv"]')?.textContent)||'0';
      const keep = /^\d+$/.test(txt) ? parseInt(txt, 10) : '—';
      wrap.innerHTML = `<span class="counter-item">${line(keep, getLang())}</span>`;
        } catch {}
      });
    } catch { /* ignore */ }
  })();

  /* Floating Table of Contents: auto-build from h2/h3 and attach a hover-expandable widget */
  (function buildFloatingTOC(){
    try {
      // Only build on post pages (presence of .blog-post or many headings)
      const isPost = document.body.classList.contains('blog-post') || document.querySelector('.i18n-block');
      if (!isPost) return;

      const headings = Array.from(document.querySelectorAll('.i18n-block h2, .i18n-block h3'))
                        .filter(h => h.id || (h.textContent && h.textContent.trim().length));
      if (!headings.length) return;

      // Normalize: ensure each heading has an id
      headings.forEach((h, i) => {
        if (!h.id) {
          const base = h.textContent.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g,'');
          let id = base || `heading-${i}`;
          // avoid collisions
          let k = 1;
          while (document.getElementById(id)) { id = `${base || 'heading'}-${k++}`; }
          h.id = id;
        }
      });

      // Build DOM
      const toc = document.createElement('nav');
      toc.className = 'floating-toc floating-toc--collapsed';
      toc.setAttribute('aria-label','Table of contents');
      toc.tabIndex = 0;

      const panel = document.createElement('div'); panel.className = 'floating-toc__panel';
      const tab = document.createElement('button'); tab.className = 'floating-toc__tab'; tab.type = 'button';
      tab.title = '目录';
      // Simplified content: a single span used as the icon canvas. Visual lines are drawn with CSS.
      tab.innerHTML = `<span class="icon-line" aria-hidden="true"></span>`;
      tab.setAttribute('aria-expanded','false');

      const content = document.createElement('div'); content.className = 'floating-toc__content';
      const title = document.createElement('div'); title.className = 'floating-toc__title'; title.textContent = '目录';
      const list = document.createElement('ul'); list.className = 'floating-toc__list';

      headings.forEach(h => {
        const li = document.createElement('li');
        li.tabIndex = 0;
        li.setAttribute('data-level', h.tagName.toLowerCase() === 'h2' ? '2' : '3');
        li.dataset.target = h.id;
        li.textContent = (h.textContent || '').trim();
        li.addEventListener('click', (e)=>{
          e.preventDefault();
          // compute target top taking into account a fixed header if present
          const targetEl = document.getElementById(h.id);
          if (targetEl) {
            const rect = targetEl.getBoundingClientRect();
            // detect fixed header by querying header element height (if present)
            const header = document.querySelector('body > header, header');
            const headerHeight = header ? header.getBoundingClientRect().height : 0;
            const safeOffset = Math.min(headerHeight + 12, Math.round(window.innerHeight * 0.18));
            const top = window.scrollY + rect.top - safeOffset;
            window.scrollTo({ top: top, behavior: 'smooth' });
          }
          // Always collapse after the user selects a TOC entry (click-to-toggle UX)
          toc.classList.add('floating-toc--collapsed');
          tab.setAttribute('aria-expanded','false');
          try { tab.focus(); } catch (e) {}
        });
        li.addEventListener('keydown', (ev)=>{ if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); li.click(); } });
        list.appendChild(li);
      });

  content.appendChild(title);
  content.appendChild(list);
  // Keep the tab outside the sliding panel so the collapsed circular
  // button remains visible even when the panel is translated off-screen.
  panel.appendChild(content);
  toc.appendChild(tab);
  toc.appendChild(panel);
      document.body.appendChild(toc);

      // Interaction: tab toggles collapsed state on click (click-to-toggle UX).
      // Keep the handler lightweight; keyboard activation via Enter/Space is wired below.
      tab.addEventListener('click', ()=>{
        const isCollapsed = toc.classList.contains('floating-toc--collapsed');
        if (isCollapsed) { toc.classList.remove('floating-toc--collapsed'); tab.setAttribute('aria-expanded','true'); }
        else { toc.classList.add('floating-toc--collapsed'); tab.setAttribute('aria-expanded','false'); }
      });

      // Click-to-toggle: collapse when clicking/tapping outside the TOC.
      function collapseToc(){ if (!toc.classList.contains('floating-toc--collapsed')) { toc.classList.add('floating-toc--collapsed'); tab.setAttribute('aria-expanded','false'); } }
      function expandToc(){ if (toc.classList.contains('floating-toc--collapsed')) { toc.classList.remove('floating-toc--collapsed'); tab.setAttribute('aria-expanded','true'); } }

      // Keyboard: allow Enter/Space to toggle when the tab is focused
      tab.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); tab.click(); } });

      // Outside click/tap collapses the TOC
      document.addEventListener('click', (e) => { if (!toc.contains(e.target)) collapseToc(); });
      document.addEventListener('touchstart', (e) => { if (!toc.contains(e.target)) collapseToc(); }, { passive: true });

      // Global Escape: collapse and restore focus to the tab for accessibility
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { collapseToc(); try { tab.focus(); } catch (err) {} } });

      // Highlight active heading on scroll (IntersectionObserver)
      const items = Array.from(list.querySelectorAll('li'));
      const idToItem = new Map(items.map(li => [li.dataset.target, li]));
      const io = new IntersectionObserver((entries)=>{
        entries.forEach(en=>{
          const id = en.target.id;
          const li = idToItem.get(id);
          if (!li) return;
          if (en.isIntersecting && en.intersectionRatio > 0.25) {
            items.forEach(x=>x.classList.remove('active'));
            li.classList.add('active');
          }
        });
      }, { root: null, rootMargin: '0px 0px -60% 0px', threshold: [0.25, 0.5] });

      headings.forEach(h => io.observe(h));

      // Accessibility: allow closing via Escape when focused inside
      toc.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') { toc.classList.add('floating-toc--collapsed'); tab.setAttribute('aria-expanded','false'); tab.focus(); } });

    } catch (err) { console.warn('floating TOC init failed', err); }
  })();
  // Set current year in footer
  const yearSpan = document.getElementById('year');
  if (yearSpan) {
    yearSpan.textContent = new Date().getFullYear();
  }

  // Mobile navigation toggle
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.querySelector('.nav-links');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      navLinks.classList.toggle('open');
      hamburger.classList.toggle('open');
    });
  }

  // Normalize top-level navigation anchors to root-relative paths.
  // This avoids 404s when the current page is inside a subfolder (e.g. /blog/foo.html)
  (function normalizeTopNavLinks(){
    try {
      if (!/^https?:$/.test(location.protocol)) return;
      const allowed = new Set(['index.html','about.html','publications.html','blog.html','ai-lab.html','contact.html','subscribe.html']);
      document.querySelectorAll('.nav-links a[href]').forEach(a => {
        const href = a.getAttribute('href') || '';
        if (!href) return;
        // Leave absolute, hash, and external links alone
        if (href.startsWith('/') || href.startsWith('#') || /^(https?:)?\/\//i.test(href)) return;
        // Normalize segments like ../../foo.html or ../foo.html or foo.html -> /foo.html
        const base = href.split('/').pop();
        if (allowed.has(base)) {
          a.setAttribute('href', '/' + base);
        }
      });
    } catch (e) { /* silent */ }
  })();

  // Unify Chinese label for the contact link across pages (including nested paths)
  (function updateContactNavLabel(){
    try {
      const zhLabel = '联系我';
      document.querySelectorAll('a[href$="contact.html"] .i18n.l-zh').forEach(node => {
        if (node && node.textContent.trim() !== zhLabel) {
          node.textContent = zhLabel;
        }
      });
    } catch { /* ignore */ }
  })();

  // Close mobile nav on link tap to improve mobile UX
  (function autoCloseMobileNav(){
    const nav = document.querySelector('.nav-links');
    if (!nav) return;
    nav.addEventListener('click', (e) => {
      const target = e.target.closest('a');
      if (!target) return;
      const hamburger = document.getElementById('hamburger');
      if (nav.classList.contains('open')) {
        nav.classList.remove('open');
        if (hamburger) hamburger.classList.remove('open');
      }
    });
  })();

  // Trigger About portrait effect when clicking About link in nav
  (function wireAboutNavEffect(){
    const aboutLinks = Array.from(document.querySelectorAll('a[href$="about.html"], a[href="#about"], a[data-nav="about"]'));
    if (!aboutLinks.length) return;
    aboutLinks.forEach(a => {
      a.addEventListener('click', (e) => {
        try { sessionStorage.setItem('triggerAboutFx', '1'); } catch {}
        // If link stays on this page (hash/nav), trigger immediately
        const href = a.getAttribute('href') || '';
        const isHash = href.startsWith('#');
        const samePageAbout = href.includes('#about');
        if (isHash || samePageAbout) {
          const target = document.querySelector('.about-portrait.fx-reveal') || document.querySelector('.about-photo .fx-tilt');
          if (target && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            triggerAboutReveal(target);
          }
        }
      }, { passive: true });
    });
  })();

  // Fade‑in sections as they scroll into view
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.section').forEach(section => {
    observer.observe(section);
  });

  // Blog enhancements: lang-block toggle, auto TOC from active lang, highlight + reading time
  (function enhanceBlog(){
    const isPost = document.querySelector('main.blog-post');
  if (!isPost) return;
    // Ensure tables are wrapped for consistent styling without touching list logic
    (function wrapTables(){
      const blocks = isPost.querySelectorAll('article.i18n-block');
      blocks.forEach(block => {
        block.querySelectorAll(':scope > table, :scope p > table').forEach(tbl => {
          if (tbl.closest('.table-wrap')) return;
          const wrap = document.createElement('div');
          wrap.className = 'table-wrap';
          tbl.parentNode.insertBefore(wrap, tbl);
          wrap.appendChild(tbl);
        });
      });
    })();
    // Ensure the URL variant matches selected language so OG/Twitter share cards stay consistent
    (function ensurePageLangURL(){
      const path = location.pathname;
      const pageLang = path.endsWith('.en.html') ? 'en' : path.endsWith('.es.html') ? 'es' : 'zh';
      function targetFor(lang){
        if (lang === 'en') return path.endsWith('.en.html') ? path : path.replace(/\.es\.html$|\.html$/, '.en.html');
        if (lang === 'es') return path.endsWith('.es.html') ? path : path.replace(/\.en\.html$|\.html$/, '.es.html');
        // zh default: no lang suffix
        return path.replace(/\.(en|es)\.html$/, '.html');
      }
      // On load, prefer current page variant and persist it
      safeLocalSet('lang', pageLang);
      // On language change, redirect to the corresponding variant
      window.addEventListener('language-changed', (e) => {
        const lang = (e && e.detail && e.detail.lang) || resolveLang();
        if (lang !== pageLang) {
          const target = targetFor(lang);
          if (target && target !== path) location.href = target + location.search + location.hash;
        }
      });
    })();
    function getActiveLang(){
      return resolveLang();
    }
    function updateTocLabel(){
      const tocWrap = document.querySelector('.toc');
      if (!tocWrap) return;
      const lang = getActiveLang();
      const label = lang === 'en' ? 'Contents' : (lang === 'es' ? 'Índice' : '目录');
      tocWrap.setAttribute('aria-label', label);
      const strong = tocWrap.querySelector('strong');
      if (strong) strong.textContent = label;
    }
    function syncLangBlocks(){
      const lang = getActiveLang();
      const blocks = isPost.querySelectorAll('.i18n-block');
      if (blocks.length) {
        blocks.forEach(b => {
          const bLang = b.getAttribute('data-lang');
          if (bLang === lang) {
            b.hidden = false;
          } else {
            b.hidden = true;
          }
        });
      }
    }
    // Build TOC from the visible language block only
    function buildToc(){
      const toc = document.querySelector('.toc ol');
      if (!toc) return;
      toc.innerHTML = '';
      // Prefer the visible article block that actually has h2 headings
      const visibleBlocks = Array.from(isPost.querySelectorAll('.i18n-block:not([hidden])'));
      let active = visibleBlocks.find(b => b.closest('.container.prose') && b.querySelector('h2[id]'))
               || visibleBlocks.find(b => b.querySelector('h2[id]'))
               || isPost;
      const headings = active.querySelectorAll('h2[id]');
      headings.forEach(h => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = `#${h.id}`;
    // Remove any leading numbering like "1.", "2)", "(3)", or full-width variants to avoid double numbering in the OL
    const raw = (h.textContent || '').replace(/\s+/g, ' ').trim();
    const cleaned = raw.replace(/^\s*(?:\d+[\.\) 、]|[\(（]\d+[\)）])\s*/, '');
        a.textContent = cleaned || raw;
        li.appendChild(a);
        toc.appendChild(li);
      });
      // Active highlight
      const links = Array.from(toc.querySelectorAll('a'));
      const map = new Map();
      links.forEach(a => {
        const id = a.getAttribute('href').slice(1);
        const sec = document.getElementById(id);
        if (sec) map.set(sec, a);
      });
      const io = new IntersectionObserver(entries => {
        entries.forEach(e => {
          const link = map.get(e.target);
          if (!link) return;
          if (e.isIntersecting) {
            links.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
          }
        });
      }, { rootMargin: '-40% 0px -55% 0px', threshold: [0, 1.0] });
      map.forEach((_, sec) => io.observe(sec));
    }
    function updateReadingTime(){
      // Prefer the main article content of the active language block
      const activeArticle = isPost.querySelector('article.i18n-block:not([hidden])');
      const active = activeArticle || isPost.querySelector('.i18n-block:not([hidden])') || isPost;
      const metaP = isPost.querySelector('.page-hero .i18n-block:not([hidden]) .post-meta') || document.querySelector('.page-hero .post-meta');
      if (metaP && active) {
        const lang = getActiveLang();
        const text = (active.innerText || '').trim();
        let minutes = 1;
        if (lang === 'zh') {
          // For Chinese, approximate by visible CJK characters (exclude spaces/punct), 500 chars/min
          const chars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
          minutes = Math.max(1, Math.round(chars / 500));
        } else {
          // For Latin languages, use word count at ~260 wpm
          const words = text.split(/\s+/).filter(Boolean).length;
          minutes = Math.max(1, Math.round(words / 260));
        }
        const label = lang === 'en' ? `Estimated read ${minutes} min` : lang === 'es' ? `Lectura ${minutes} min` : `预计阅读 ${minutes} 分钟`;
        // Replace any existing time segment at the end of meta text
        if (/预计阅读|Estimated read|Lectura/.test(metaP.textContent)) {
          metaP.textContent = metaP.textContent.replace(/(预计阅读.*|Estimated read.*|Lectura .*?)$/, label);
        } else {
          metaP.textContent += ` · ${label}`;
        }
      }
    }

    // Toggle localized hero image according to language
    function syncPostHero(){
      const lang = getActiveLang();
      const arts = isPost.querySelectorAll('.post-hero-art, .post-hero-visual');
      arts.forEach(el => {
        const l = el.getAttribute('data-lang');
        if (l === lang) { el.hidden = false; }
        else { el.hidden = true; }
      });
    }

    function initPostAudio(){
      const wrap = isPost.querySelector('.post-audio-card');
      const dataNode = document.getElementById('post-tts-data');
      if (!wrap || !dataNode) return;
      if (wrap.dataset.audioReady === '1') return;
      let payload = null;
      try { payload = JSON.parse(dataNode.textContent || '{}'); } catch { payload = null; }
      if (!payload) return;
      const rawSegments = Array.isArray(payload.segments) ? payload.segments : [];
      const segments = rawSegments
        .map((seg, idx) => {
          if (!seg || typeof seg.file !== 'string') return null;
          const file = String(seg.file || '').trim();
          if (!file) return null;
          return {
            id: String(seg.id || `segment-${idx + 1}`),
            text: typeof seg.text === 'string' ? seg.text : '',
            file,
          };
        })
        .filter(Boolean);
      if (!segments.length) return;

  const playBtn = wrap.querySelector('[data-role="toggle"]');
      const statusEl = wrap.querySelector('[data-role="status"]');
      const captionEl = wrap.querySelector('[data-role="caption"]');
      const progressEl = wrap.querySelector('[data-role="progress"]');
      const speedEl = wrap.querySelector('[data-role="speed"]');
      const audioEl = wrap.querySelector('[data-role="audio"]');
      const actionEl = wrap.querySelector('[data-role="action"]');
  const iconEl = wrap.querySelector('.post-audio-icon');
      const voiceEl = wrap.querySelector('[data-role="voice"]');
      const countEl = wrap.querySelector('[data-role="count"]');
  if (!playBtn || !audioEl || !statusEl || !progressEl) return;

      wrap.dataset.audioReady = '1';

      const strings = {
        play: wrap.dataset.labelPlay || 'Play',
        pause: wrap.dataset.labelPause || 'Pause',
        resume: wrap.dataset.labelResume || 'Resume',
        statusReady: wrap.dataset.statusReady || '',
        statusLoading: wrap.dataset.statusLoading || '',
        statusPlaying: wrap.dataset.statusPlaying || '',
        statusPaused: wrap.dataset.statusPaused || '',
        statusResuming: wrap.dataset.statusResuming || '',
        statusCompleted: wrap.dataset.statusCompleted || '',
        statusError: wrap.dataset.statusError || '',
        statusAutoplay: wrap.dataset.statusAutoplay || '',
        progressTemplate: wrap.dataset.progressTemplate || '{current}/{total}',
        progressIdle: wrap.dataset.progressIdle || '',
        captionPrefix: wrap.dataset.captionPrefix || '',
      };

      const total = segments.length;
      if (voiceEl && payload.voice && !voiceEl.textContent.trim()) {
        voiceEl.textContent = payload.voice;
      }
      if (countEl && !countEl.textContent.trim() && strings.progressIdle) {
        countEl.textContent = strings.progressIdle;
      }

      let state = 'idle';
      let index = 0;
      let endedNaturally = false;
      let currentRate = Number.parseFloat(speedEl && speedEl.value ? speedEl.value : '1.25') || 1.25;

      function setActionLabel(label){
        const text = label || '';
        playBtn.setAttribute('aria-label', text);
        if (actionEl) actionEl.textContent = text;
      }

      function setState(next){
        state = next;
        playBtn.dataset.state = next;
        if (next === 'playing') {
          setActionLabel(strings.pause);
        } else if (next === 'paused') {
          setActionLabel(strings.resume);
        } else {
          setActionLabel(strings.play);
        }
      }

      // SVG assets for the small orb button. Keep them inline to avoid extra
      // network requests and to allow immediate swapping when state changes.
      const playSvg = '<svg viewBox="0 0 60 60" role="presentation"><circle cx="30" cy="30" r="27" fill="none" stroke="currentColor" stroke-width="1.6" opacity="0.2"></circle><path d="M26 21v18l14-9z" fill="currentColor"></path></svg>';
      const pauseSvg = '<svg viewBox="0 0 60 60" role="presentation"><circle cx="30" cy="30" r="27" fill="none" stroke="currentColor" stroke-width="1.6" opacity="0.2"></circle><rect x="20" y="20" width="7" height="20" fill="currentColor"></rect><rect x="33" y="20" width="7" height="20" fill="currentColor"></rect></svg>';

      // Enhance setState to also update the visible icon so it reflects the
      // actual playback state (playing -> show pause icon; paused/idle -> play).
      const originalSetState = setState;
      function setState(next){
        // call original behaviour
        state = next;
        playBtn.dataset.state = next;
        if (next === 'playing') {
          setActionLabel(strings.pause);
        } else if (next === 'paused') {
          setActionLabel(strings.resume);
        } else {
          setActionLabel(strings.play);
        }
        try {
          if (iconEl) {
            if (next === 'playing') iconEl.innerHTML = pauseSvg;
            else iconEl.innerHTML = playSvg;
          }
        } catch (e) { /* ignore DOM write errors */ }
      }

      function applyRate(value){
        const rate = Number.parseFloat(String(value));
        if (!Number.isFinite(rate) || rate <= 0) return;
        currentRate = rate;
        try {
          audioEl.playbackRate = rate;
          audioEl.defaultPlaybackRate = rate;
        } catch {}
      }

      function progressText(idx){
        const safeIndex = Math.max(0, Math.min(total - 1, idx));
        return strings.progressTemplate
          .replace('{current}', String(safeIndex + 1))
          .replace('{total}', String(total));
      }

      // Interactive progress bar: shows total timeline across segments and allows seeking.
      // We'll render a scrubber inside the existing progressEl and keep text fallback.
      let segmentDurations = new Array(total).fill(null); // seconds or null
      let totalDuration = null; // seconds or null

      function formatTime(s){
        if (!Number.isFinite(s) || s <= 0) return '0:00';
        const sec = Math.floor(s % 60);
        const min = Math.floor((s / 60) % 60);
        const hr = Math.floor(s / 3600);
        const pad = (n)=>String(n).padStart(2,'0');
        if (hr > 0) return `${hr}:${pad(min)}:${pad(sec)}`;
        return `${min}:${pad(sec)}`;
      }

      function buildProgressScrubber(){
        // Build HTML structure once
        progressEl.innerHTML = `
          <div class="scrubber" role="slider" aria-valuemin="0" aria-valuemax="100" tabindex="0">
            <div class="scrubber-track"><div class="scrubber-fill"></div><div class="scrubber-thumb" aria-hidden="true"></div></div>
          </div>
          <div class="scrubber-times"><span class="scrubber-current">0:00</span><span class="scrubber-sep">/</span><span class="scrubber-total">-:--</span></div>
        `;
        // cache nodes
        progressEl._scrubber = progressEl.querySelector('.scrubber');
        progressEl._track = progressEl.querySelector('.scrubber-track');
        progressEl._fill = progressEl.querySelector('.scrubber-fill');
        progressEl._thumb = progressEl.querySelector('.scrubber-thumb');
        progressEl._timeCurrent = progressEl.querySelector('.scrubber-current');
        progressEl._timeTotal = progressEl.querySelector('.scrubber-total');
      }

      function setScrubberPosition(percent){
        if (!progressEl || !progressEl._fill) return;
        const p = Math.max(0, Math.min(1, percent));
        progressEl._fill.style.transform = `scaleX(${p})`;
        progressEl._thumb.style.left = `${p * 100}%`;
        if (totalDuration) progressEl._timeTotal.textContent = formatTime(totalDuration);
      }

      function setScrubberTime(curSeconds){
        if (!progressEl || !progressEl._timeCurrent) return;
        progressEl._timeCurrent.textContent = formatTime(curSeconds);
        if (totalDuration) setScrubberPosition(curSeconds / totalDuration);
      }

      function findSegmentForGlobalTime(t){
        // returns {idx, offset}
        if (!Array.isArray(segmentDurations) || segmentDurations.length === 0) return { idx: 0, offset: 0 };
        let acc = 0;
        for (let i=0;i<segmentDurations.length;i++){
          const d = Number(segmentDurations[i]) || 0;
          if (t <= acc + d || i === segmentDurations.length - 1){
            return { idx: i, offset: Math.max(0, t - acc) };
          }
          acc += d;
        }
        return { idx: segmentDurations.length -1, offset: 0 };
      }

      async function ensureDurations(){
        // Only fetch if any nulls remain and not currently all known.
        if (totalDuration !== null) return;
        try {
          // Use a single temp audio for sequential metadata loads to avoid many players.
          const probe = document.createElement('audio');
          probe.preload = 'metadata';
          let acc = 0;
          for (let i=0;i<segments.length;i++){
            if (typeof segmentDurations[i] === 'number') { acc += segmentDurations[i]; continue; }
            const src = resolveSource(segments[i].file);
            let dur = 0;
            try {
              probe.src = src;
              await new Promise((resolve, reject) => {
                const onLoaded = () => { dur = Number.isFinite(probe.duration) ? probe.duration : 0; cleanup(); resolve(); };
                const onErr = () => { dur = 0; cleanup(); resolve(); };
                const onTimeout = () => { dur = 0; cleanup(); resolve(); };
                function cleanup(){ probe.removeEventListener('loadedmetadata', onLoaded); probe.removeEventListener('error', onErr); clearTimeout(timer); probe.src = ''; }
                probe.addEventListener('loadedmetadata', onLoaded);
                probe.addEventListener('error', onErr);
                const timer = setTimeout(onTimeout, 4500);
              });
            } catch { dur = 0; }
            segmentDurations[i] = Math.max(0, Number(dur) || 0);
            acc += segmentDurations[i];
          }
          totalDuration = segmentDurations.reduce((a,b)=>a + (Number(b)||0), 0) || null;
          if (!totalDuration) totalDuration = null;
          if (progressEl && progressEl._timeTotal && totalDuration) progressEl._timeTotal.textContent = formatTime(totalDuration);
        } catch (e) {
          // ignore: leave durations unknown
          totalDuration = null;
        }
      }

      function renderProgress(idx){
        if (!progressEl) return;
        // Build scrubber only once
        if (!progressEl._scrubber) buildProgressScrubber();
        // If we have durations, compute global time; otherwise show segment index and total
        if (totalDuration) {
          // compute global current time
          let acc = 0;
          for (let i=0;i<idx;i++) acc += Number(segmentDurations[i]) || 0;
          const cur = acc + (audioEl.currentTime || 0);
          setScrubberTime(cur);
        } else {
          // fallback: show segment index / total
          progressEl._timeCurrent && (progressEl._timeCurrent.textContent = `${idx+1}/${total}`);
          progressEl._timeTotal && (progressEl._timeTotal.textContent = '');
        }
      }

      function renderStatus(template, idx){
        if (!statusEl) return;
        const base = template || '';
        if (base.includes('{progress}')) {
          const position = typeof idx === 'number' ? idx : index;
          statusEl.textContent = base.replace('{progress}', progressText(Math.max(0, Math.min(total - 1, position))));
        } else {
          statusEl.textContent = base;
        }
      }

      function shorten(text){
        const cleaned = (text || '').replace(/\s+/g, ' ').trim();
        if (!cleaned) return '';
        if (cleaned.length <= 160) return cleaned;
        return `${cleaned.slice(0, 150).trim()}…`;
      }

      function updateCaption(idx){
        if (!captionEl) return;
        const seg = idx >= 0 ? segments[idx] : null;
        const trimmed = seg ? shorten(seg.text || '') : '';
        if (trimmed) {
          captionEl.hidden = false;
          captionEl.textContent = strings.captionPrefix ? `${strings.captionPrefix} · ${trimmed}` : trimmed;
        } else {
          captionEl.hidden = true;
          captionEl.textContent = '';
        }
      }

      function resolveSource(file){
        if (!file) return '';
        if (/^https?:\/\//i.test(file) || file.startsWith('/')) return file;
        if (file.startsWith('../') || file.startsWith('./')) return file;
        return `../${file.replace(/^\/+/, '')}`;
      }

      function loadSegment(idx){
        const seg = segments[idx];
        if (!seg) return false;
        endedNaturally = false;
        const src = resolveSource(seg.file);
        if (src) {
          audioEl.src = src;
        }
        try { audioEl.load(); } catch {}
        try { audioEl.currentTime = 0; } catch {}
        applyRate(currentRate);
        renderProgress(idx);
        updateCaption(idx);
        return true;
      }

      async function startSegment(idx){
        index = idx;
        if (!loadSegment(idx)) return;
        renderStatus(strings.statusLoading, idx);
        try {
          await audioEl.play();
          setState('playing');
          renderStatus(strings.statusPlaying, idx);
        } catch (err) {
          console.warn('audio playback blocked', err);
          setState('paused');
          renderStatus(strings.statusAutoplay || strings.statusError, idx);
        }
      }

      playBtn.addEventListener('click', () => {
        if (state === 'idle' || state === 'done') {
          index = 0;
          startSegment(index);
        } else if (state === 'playing') {
          audioEl.pause();
        } else if (state === 'paused') {
          renderStatus(strings.statusResuming, index);
          audioEl.play().then(() => {
            setState('playing');
            renderStatus(strings.statusPlaying, index);
          }).catch(err => {
            console.warn('audio resume failed', err);
            renderStatus(strings.statusError, index);
          });
        }
      });

      if (speedEl) {
        speedEl.addEventListener('change', () => {
          applyRate(speedEl.value);
        });
        applyRate(speedEl.value);
      } else {
        applyRate(currentRate);
      }

      audioEl.addEventListener('play', () => {
        endedNaturally = false;
        setState('playing');
        renderStatus(strings.statusPlaying, index);
      });

      audioEl.addEventListener('pause', () => {
        if (endedNaturally) return;
        setState('paused');
        renderStatus(strings.statusPaused, index);
      });

      audioEl.addEventListener('ended', () => {
        endedNaturally = true;
        const nextIndex = index + 1;
        if (nextIndex < total) {
          index = nextIndex;
          setTimeout(() => startSegment(index), 90);
        } else {
          renderProgress(total - 1);
          renderStatus(strings.statusCompleted, total - 1);
          updateCaption(-1);
          setState('done');
          index = 0;
        }
      });

      // Update scrubber position as audio plays
      audioEl.addEventListener('timeupdate', () => {
        try { renderProgress(index); } catch (e) {}
      });

      // Wire scrubber interactions (click to seek, drag to scrub)
      function seekToGlobal(seconds){
        if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
        if (!Array.isArray(segmentDurations) || segmentDurations.every(d => !d)) {
          // Unknown durations: just restart current segment
          try { audioEl.currentTime = 0; } catch {}
          return;
        }
        const seg = findSegmentForGlobalTime(seconds);
        if (!seg) return;
        const { idx: tgtIdx, offset } = seg;
        index = tgtIdx;
        loadSegment(index);
        try { audioEl.currentTime = Math.max(0, Math.min(audioEl.duration || 1, offset)); } catch {}
        audioEl.play().catch(()=>{});
      }

      // Attach handlers to scrubber nodes when built
      function wireScrubber(){
        if (!progressEl || !progressEl._scrubber) return;
        const scrub = progressEl._scrubber;
        let dragging = false;
        const getRect = ()=> progressEl._track.getBoundingClientRect();

        function posToSeconds(clientX){
          const rect = getRect();
          const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
          const frac = rect.width ? (x / rect.width) : 0;
          return (totalDuration || 0) * frac;
        }

        function onDown(e){
          e.preventDefault();
          dragging = true;
          const clientX = (e.touches ? e.touches[0].clientX : e.clientX);
          const seconds = posToSeconds(clientX);
          setScrubberTime(seconds);
        }
        function onMove(e){
          if (!dragging) return;
          const clientX = (e.touches ? e.touches[0].clientX : e.clientX);
          const seconds = posToSeconds(clientX);
          setScrubberTime(seconds);
        }
        function onUp(e){
          if (!dragging) return; dragging = false;
          const clientX = (e.changedTouches ? e.changedTouches[0].clientX : e.clientX);
          const seconds = posToSeconds(clientX);
          seekToGlobal(seconds);
        }

        scrub.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        scrub.addEventListener('touchstart', onDown, { passive: true });
        window.addEventListener('touchmove', onMove, { passive: true });
        window.addEventListener('touchend', onUp, { passive: true });

        // keyboard accessibility
        scrub.addEventListener('keydown', (e)=>{
          if (!totalDuration) return;
          const step = totalDuration / 20;
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { seekToGlobal((audioEl.currentTime || 0) + step); }
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { seekToGlobal((audioEl.currentTime || 0) - step); }
          else if (e.key === 'Home') { seekToGlobal(0); }
          else if (e.key === 'End') { seekToGlobal(totalDuration); }
        });
      }

      // Initialize scrubber and start probing durations in background
      buildProgressScrubber();
      wireScrubber();
      // probe durations but don't block UI
      ensureDurations().then(()=>{
        // if we have durations, update UI
        if (totalDuration) setScrubberPosition(0);
      }).catch(()=>{});

      audioEl.addEventListener('error', () => {
        renderStatus(strings.statusError, index);
        setState('paused');
      });

      setState('idle');
      renderStatus(strings.statusReady, -1);
      renderProgress(-1);
      if (captionEl) { captionEl.hidden = true; captionEl.textContent = ''; }
      wrap.classList.add('post-audio-ready');
    }

    // Initial sync: do critical visibility first, then defer heavier work
    syncLangBlocks();
    syncPostHero();
    initPostAudio();
    const schedule = window.requestIdleCallback ? (cb) => requestIdleCallback(cb, { timeout: 1000 }) : (cb) => setTimeout(cb, 0);
    schedule(() => {
      updateTocLabel();
      buildToc();
      updateReadingTime();
      initPostAudio();
    });
    // Rebuild when language changes
    window.addEventListener('language-changed', () => {
      syncLangBlocks();
      updateTocLabel();
      buildToc();
      updateReadingTime();
      syncPostHero();
    });

    // Share feature: WeChat QR, WhatsApp, Copy link, Native share (Download cover removed)
    (function initShare(){
      const bar = document.querySelector('.share-toolbar');
      if (!bar) return;
      function activeLang(){ return resolveLang(); }
      function currentUrl(){ return location.href.split('#')[0]; }
      function whatsappHref(){
        const text = encodeURIComponent(document.title + ' ' + currentUrl());
        return 'https://wa.me/?text=' + text;
      }
      // Minimal QR generator for URL using a tiny SVG fallback (no external dep)
      async function renderQR(target, text){
        target.innerHTML = '';
        function drawWithLib(){
          try {
            if (window.QRCode) {
              target.innerHTML = '';
              // eslint-disable-next-line no-new
              new window.QRCode(target, { text, width: 220, height: 220, correctLevel: window.QRCode.CorrectLevel.M });
              return true;
            }
          } catch {}
          return false;
        }
        // Try local vendor lib (preferred). If not present, lazy-load it.
        if (drawWithLib()) return;
        const localSrc = (location.pathname.includes('/blog/') ? '../' : '') + 'assets/vendor/qrcode.min.js';
        try {
          await new Promise((resolve, reject) => {
            // Avoid duplicate loads
            const existing = Array.from(document.scripts).find(s => s.src && s.src.endsWith('assets/vendor/qrcode.min.js'));
            if (existing) { existing.addEventListener('load', resolve); existing.addEventListener('error', reject); return; }
            const s = document.createElement('script');
            s.src = localSrc; s.async = true; s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
          });
          if (drawWithLib()) return;
        } catch {}
        // Try to lazy-load from CDN as a resilience fallback when online
        try {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
            s.async = true;
            s.onload = resolve; s.onerror = reject;
            document.head.appendChild(s);
          });
          if (drawWithLib()) return;
        } catch {}
        // Final fallback: show the URL text if no lib available
        const note = document.createElement('div');
        note.className = 'muted';
        note.style.cssText = 'font-size:12px;word-break:break-all;text-align:center;max-width:280px;';
        note.textContent = text;
        target.appendChild(note);
      }
      function openModal(){ document.getElementById('share-modal')?.removeAttribute('hidden'); }
      function closeModal(){ document.getElementById('share-modal')?.setAttribute('hidden',''); }

      // Wire actions
      const btnWeChat = bar.querySelector('[data-share="wechat"]');
      const btnWhats = bar.querySelector('[data-share="whatsapp"]');
      const btnCopy = bar.querySelector('[data-share="copy"]');
      const btnDown = null; // removed
      const btnNative = bar.querySelector('[data-share="native"]');
      const modal = document.getElementById('share-modal');
      const modalClose = modal?.querySelector('[data-close]');
      const qr = document.getElementById('qr');
      if (btnWhats) btnWhats.setAttribute('href', whatsappHref());
      // download feature removed
      if (btnWeChat) btnWeChat.addEventListener('click', () => { openModal(); renderQR(qr, currentUrl()); });
      if (modalClose) modalClose.addEventListener('click', closeModal);
      if (modal) modal.addEventListener('click', (e)=>{ if (e.target===modal) closeModal(); });
      if (btnCopy) btnCopy.addEventListener('click', async ()=>{
        try { await navigator.clipboard.writeText(currentUrl());
          const lang = activeLang();
          const ok = (window.translations?.[lang]?.share_copied) || 'Copied';
          btnCopy.textContent = ok;
          setTimeout(()=>{ btnCopy.querySelector ? (btnCopy.querySelector('span')? btnCopy.querySelector('span').textContent = (window.translations?.[lang]?.share_copy)||'Copy link' : btnCopy.textContent=(window.translations?.[lang]?.share_copy)||'Copy link') : null; }, 1400);
        } catch {}
      });
      if (btnNative) btnNative.addEventListener('click', async ()=>{
        if (navigator.share) {
          try { await navigator.share({ title: document.title, url: currentUrl() }); } catch {}
        } else {
          // fallback to copy
          try { await navigator.clipboard.writeText(currentUrl()); } catch {}
        }
      });

      // Keep WhatsApp link and download cover in sync when language changes
      window.addEventListener('language-changed', () => {
        if (btnWhats) btnWhats.setAttribute('href', whatsappHref());
      });
    })();

    // Robust prev/next wiring: if links are disabled but neighbors exist, compute URLs
  (function fixPrevNext(){
      const nav = document.querySelector('.post-nav');
      if (!nav) return;
      const links = Array.from(nav.querySelectorAll('a.btn.outline'));
      if (links.length < 3) return; // expect: [Back], [Prev], [Next]
      const back = links[0];
      const prev = links[1];
      const next = links[2];
      // If prev/next are disabled (#), attempt to compute from blog index order
      const isDisabled = (a)=> a.getAttribute('href') === '#' || a.hasAttribute('aria-disabled');
      if (!isDisabled(prev) && !isDisabled(next)) return; // already wired
  const schedulePN = window.requestIdleCallback ? (cb) => requestIdleCallback(cb, { timeout: 1200 }) : (cb) => setTimeout(cb, 250);
      schedulePN(() => {
        (async () => {
          try {
            const file = location.pathname.split('/').pop() || '';
            const isDaily = /ai-daily/i.test(file);
            // First try embedded order (oldest -> newest)
            let updated = false;
            const orderOldToNew = (!isDaily ? (window.__BLOG_ORDER__ || []).map(s=>String(s)) : []);
            const haveOldToNew = orderOldToNew.length > 0;
            let current = location.pathname.split('/').pop(); // e.g., foo.html or foo.en.html
            const lang = current.endsWith('.en.html') ? 'en' : current.endsWith('.es.html') ? 'es' : 'zh';
            const base = current.replace(/\.(en|es)\.html$/, '.html');
            const zhName = base;
            const setHref = (a, targetZhName) => {
              if (!a) return;
              let target = targetZhName;
              if (lang === 'en') target = target.replace(/\.html$/, '.en.html');
              else if (lang === 'es') target = target.replace(/\.html$/, '.es.html');
              a.setAttribute('href', `./${target}`);
              a.removeAttribute('aria-disabled');
              a.removeAttribute('onclick');
            };
            if (haveOldToNew) {
              const order = orderOldToNew;
              const idx = order.findIndex(name => name === zhName);
              if (idx !== -1) {
                if (isDisabled(prev) && idx > 0) { setHref(prev, order[idx - 1]); updated = true; }
                if (isDisabled(next) && idx < order.length - 1) { setHref(next, order[idx + 1]); updated = true; }
              }
            }
            if (!isDaily && updated && !isDisabled(prev) && !isDisabled(next)) return;
            // Prefer ScholarPush feed order when available
            let aiDaily = [];
            try {
              const res = await fetch('../data/ai/blog/index.json', { cache: 'no-store' });
              if (res.ok) aiDaily = await res.json();
            } catch {}
            if (Array.isArray(aiDaily) && aiDaily.length) {
              const order = aiDaily.map(x => (x.url||'').split('/').pop().replace(/\.(en|es)\.html$/, '.html')).filter(Boolean);
              const idx2 = order.findIndex(name => name === zhName);
              const setHref2 = (a, targetZhName) => {
                if (!a) return;
                let target = targetZhName;
                if (lang === 'en') target = target.replace(/\.html$/, '.en.html');
                else if (lang === 'es') target = target.replace(/\.html$/, '.es.html');
                a.setAttribute('href', `./${target}`);
                a.removeAttribute('aria-disabled');
                a.removeAttribute('onclick');
              };
              if (idx2 !== -1) {
                if (isDisabled(prev) && idx2 < order.length - 1) setHref2(prev, order[idx2 + 1]); // feed is newest first
                if (isDisabled(next) && idx2 > 0) setHref2(next, order[idx2 - 1]);
                // Also route back button to ScholarPush when in feed
                if (back && back.getAttribute('href') && /blog\.html$/.test(back.getAttribute('href'))) {
                  const backLabel = lang==='en' ? '← Back to ScholarPush' : (lang==='es' ? '← Volver a ImpulsoAcadémico' : '← 返回学术快报');
                  back.setAttribute('href', '../lab/scholarpush.html');
                  back.textContent = backLabel;
                }
              }
              if (!isDisabled(prev) && !isDisabled(next)) return;
            }
            // If still missing, try blog.html (newest -> oldest) with cache-friendly mode
            let orderNewToOld = [];
            const resp = await fetch('../blog.html', { cache: 'force-cache' }).catch(() => null);
            if (resp && resp.ok) {
              const html = await resp.text();
              const doc = new DOMParser().parseFromString(html, 'text/html');
              const anchors = Array.from(doc.querySelectorAll('.blog-posts .post-card a.post-link'));
              orderNewToOld = anchors.map(a => {
                const href = a.getAttribute('href') || '';
                const file = href.split('/').pop() || '';
                return file.replace(/\.(en|es)\.html$/, '.html');
              }).filter(Boolean);
            }
            if (orderNewToOld.length) {
              const order = orderNewToOld;
              const idx = order.findIndex(name => name === zhName);
              if (idx !== -1) {
                if (isDisabled(prev) && idx < order.length - 1) setHref(prev, order[idx + 1]);
                if (isDisabled(next) && idx > 0) setHref(next, order[idx - 1]);
              }
            }
          } catch {}
        })();
      });
    })();
  })();

  // Theme toggle: default follows system; manual overrides persist via localStorage.
  const THEME_KEY = 'theme'; // stores manual override ('light' | 'dark')
  const root = document.documentElement;
  const toggleBtn = document.getElementById('theme-toggle');
  const mediaQuery = (typeof window.matchMedia === 'function') ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  let releaseSystemWatcher = null;

  function systemPrefersDark() {
    if (mediaQuery) return mediaQuery.matches;
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  }

  function getStoredTheme() {
    const saved = safeLocalGet(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    if (saved) safeLocalRemove(THEME_KEY);
    return null;
  }

  function getEffectiveTheme() {
    const stored = getStoredTheme();
    if (stored) return stored;
    return systemPrefersDark() ? 'dark' : 'light';
  }

  function setThemeAttributes(theme, source) {
    const mode = source === 'system' ? `system-${theme}` : theme;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-theme-mode', mode);
    root.setAttribute('data-theme-source', source);
  }

  function applyTheme(theme, options = {}) {
    const { source = 'user', persist = true } = options;
    setThemeAttributes(theme, source);
    if (persist) {
      if (source === 'user') {
        safeLocalSet(THEME_KEY, theme);
      } else {
        safeLocalRemove(THEME_KEY);
      }
    }
  }

  function currentLang() {
    return resolveLang();
  }

  function t(key) {
    try { return (window.translations?.[currentLang()]?.[key]) || key; } catch { return key; }
  }

  function refreshToggleTooltip() {
    if (!toggleBtn) return;
    const current = getEffectiveTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    const actionText = next === 'dark' ? t('theme_switch_to_dark') : t('theme_switch_to_light');
    toggleBtn.setAttribute('aria-label', t('theme_toggle_label'));
    toggleBtn.setAttribute('title', actionText);
  }

  function stopSystemWatcher() {
    if (releaseSystemWatcher) {
      releaseSystemWatcher();
      releaseSystemWatcher = null;
    }
  }

  function ensureSystemWatcher() {
    if (!mediaQuery || releaseSystemWatcher) return;
    const listener = (event) => {
      if (getStoredTheme()) {
        stopSystemWatcher();
        return;
      }
      const next = event.matches ? 'dark' : 'light';
      applyTheme(next, { source: 'system', persist: false });
      refreshToggleTooltip();
    };
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', listener);
      releaseSystemWatcher = () => mediaQuery.removeEventListener('change', listener);
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(listener);
      releaseSystemWatcher = () => mediaQuery.removeListener(listener);
    }
  }

  const storedTheme = getStoredTheme();
  if (storedTheme) {
    applyTheme(storedTheme, { source: 'user', persist: true });
  } else {
    const initial = systemPrefersDark() ? 'dark' : 'light';
    applyTheme(initial, { source: 'system', persist: false });
    ensureSystemWatcher();
  }
  refreshToggleTooltip();

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const current = getEffectiveTheme();
      const next = current === 'dark' ? 'light' : 'dark';
      stopSystemWatcher();
      applyTheme(next, { source: 'user', persist: true });
      refreshToggleTooltip();
    });
  }

  window.addEventListener('language-changed', refreshToggleTooltip);

  // Render portfolio from JSON
  async function renderPortfolio(filter = 'all') {
    const grid = document.querySelector('.portfolio-grid');
    if (!grid) return;
    try {
      const res = await fetch('portfolio.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('failed');
      const items = await res.json();
      grid.innerHTML = '';
      const lang = currentLang();
      items.filter(it => filter === 'all' || it.category === filter).forEach(it => {
        const article = document.createElement('article');
        article.className = 'card portfolio-item';
        article.innerHTML = `
          <div class="portfolio-content">
            <div class="badge${it.badge === 'CV' ? ' success' : ''}">${it.badge}</div>
    <h3>${(it.title && (it.title[lang] || it.title.en || it.title.zh)) || ''}</h3>
    <p class="muted">${(it.summary && (it.summary[lang] || it.summary.en || it.summary.zh)) || ''}</p>
            <ul class="portfolio-meta">
      <li><span class="tag">${lang==='en'?'Role':lang==='es'?'Rol':'角色'}：${(it.role && (it.role[lang] || it.role.en || it.role.zh)) || ''}</span></li>
      <li><span class="tag">${lang==='en'?'Stack':lang==='es'?'Stack':'技术栈'}：${(it.stack||[]).join('·')}</span></li>
            </ul>
          </div>`;
        grid.appendChild(article);
      });
    } catch (e) {
      // keep existing static markup if fetch fails
    }
  }
  renderPortfolio();
  // Filters
  document.querySelectorAll('.portfolio-filters [data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = btn.getAttribute('data-filter');
      renderPortfolio(f);
    });
  });

  // Language button + menu
  const langBtn = document.getElementById('lang-button');
  const langMenu = document.getElementById('lang-menu');
  const langSelect = document.getElementById('lang-select');
  function setLangLabel() {
    if (!langBtn) return;
    const map = { en: 'English', zh: '中文', es: 'Español' };
    const cur = resolveLang('en');
    const labelEl = langBtn.querySelector('.label');
    if (labelEl) {
      labelEl.textContent = map[cur] || '';
    } else {
      // Fallback if no inner span exists (avoid removing the icon)
      langBtn.textContent = map[cur] || '';
    }
  }
  setLangLabel();
  if (langBtn && langMenu) {
    langBtn.addEventListener('click', () => {
      const open = langMenu.hasAttribute('hidden') ? false : true;
      if (open) {
        langMenu.setAttribute('hidden', '');
        langBtn.setAttribute('aria-expanded', 'false');
      } else {
        langMenu.removeAttribute('hidden');
        langBtn.setAttribute('aria-expanded', 'true');
      }
    });
    langMenu.querySelectorAll('li[data-lang]').forEach(item => {
      item.addEventListener('click', () => {
        const code = item.getAttribute('data-lang');
        // Persist and apply language regardless of presence of <select>
        safeLocalSet('lang', code);
        if (langSelect) { langSelect.value = code; }
        if (typeof translatePage === 'function') translatePage(code);
        setLangLabel();
        langMenu.setAttribute('hidden', '');
        langBtn.setAttribute('aria-expanded', 'false');
      });
    });
    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!langMenu.contains(e.target) && !langBtn.contains(e.target)) {
        if (!langMenu.hasAttribute('hidden')) {
          langMenu.setAttribute('hidden', '');
          langBtn.setAttribute('aria-expanded', 'false');
        }
      }
    });
  }

  // Language-aware RSS/Email routing on blog pages and posts
  (function wireSubscriptionButtons(){
    function activeLang(){ return resolveLang(); }
    function setHrefs(){
      const lang = activeLang();
      const rss = document.getElementById('rss-button');
      const email = document.getElementById('email-button');
      const subscribeUnified = document.getElementById('subscribe-button');
      if (rss) {
        // Route RSS button to subscribe hub with language + #rss
        let href = 'subscribe.html';
        if (location.pathname.includes('/blog/')) href = '../' + href; // adjust on post pages
        const url = new URL(href, location.origin);
        url.searchParams.set('lang', lang);
        url.hash = 'rss';
        rss.setAttribute('href', url.pathname + url.search + url.hash);
        const titles = { zh: 'RSS 订阅', en: 'RSS', es: 'RSS' };
        rss.setAttribute('title', titles[lang] || 'RSS');
        rss.setAttribute('aria-label', titles[lang] || 'RSS');
      }
      if (email) {
        let href = 'subscribe.html';
        if (location.pathname.includes('/blog/')) href = '../' + href;
        // Add language hint via query param for subscribe page routing
        const url = new URL(href, location.origin);
        url.searchParams.set('lang', lang);
        url.hash = 'email';
        email.setAttribute('href', url.pathname + url.search + url.hash);
      }
      if (subscribeUnified) {
        let href = 'subscribe.html';
        if (location.pathname.includes('/blog/')) href = '../' + href;
        const url = new URL(href, location.origin);
        url.searchParams.set('lang', lang);
        // Default focus to RSS tab on first landing; user can switch to email there
        url.hash = 'rss';
        subscribeUnified.setAttribute('href', url.pathname + url.search + url.hash);
        const titles = { zh: '订阅', en: 'Subscribe', es: 'Suscribirse' };
        subscribeUnified.setAttribute('title', titles[lang] || 'Subscribe');
        subscribeUnified.setAttribute('aria-label', titles[lang] || 'Subscribe');
      }
    }
    // run on load
    setHrefs();
    // update on language change
    window.addEventListener('language-changed', setHrefs);
  })();

  // PWA: register service worker (avoid caching pitfalls in local/dev)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      const isLocal = location.protocol === 'file:' || location.hostname === '' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      if (isLocal) {
        // Unregister any existing SW in dev to avoid stale resources
        navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
        return;
      }
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {/* noop */});
    });
  }

  // Rerender portfolio when language changes
  window.addEventListener('language-changed', () => {
    renderPortfolio();
    // Update Language button label too
    const btn = document.getElementById('lang-button');
    if (btn) {
      const map = { en: 'English', zh: '中文', es: 'Español' };
      const cur = resolveLang('en');
      const labelEl = btn.querySelector('.label');
      if (labelEl) labelEl.textContent = map[cur] || '';
      else btn.textContent = map[cur] || '';
    }
  });

  // Contact form: AJAX submission with static fallback
  (function enhanceContactForm(){
    const form = document.getElementById('contact-form');
    if (!form) return;
    const status = document.getElementById('form-status');
    const lang = resolveLang();
    function t(k){ try { return (window.translations?.[lang]?.[k]) || ''; } catch { return ''; } }
    // Slider verification wiring
    let verified = false;
    const slider = document.getElementById('slider-verify');
    if (slider) {
      const thumb = slider.querySelector('.verify-thumb');
  const track = slider.querySelector('.verify-track');
      if (!thumb || !track) return;
      let dragging = false;
      let startX = 0;
      let startLeft = 0;
  const max = () => slider.clientWidth - thumb.clientWidth;
      function setLeft(px){ thumb.style.left = Math.max(0, Math.min(max(), px)) + 'px'; }
      function complete(){
        verified = true;
        slider.classList.add('done');
        setLeft(max());
        thumb.style.cursor = 'default';
        const span = track.querySelector('span');
        if (span) span.remove();
        const check = document.createElement('span');
        check.textContent = '✓';
        check.style.fontWeight = '700';
        check.style.fontSize = '1rem';
        check.style.color = 'var(--success)';
        track.appendChild(check);
      }
      function onDown(e){ dragging = true; startX = (e.touches?e.touches[0].clientX:e.clientX); startLeft = parseFloat(thumb.style.left||'0'); thumb.style.cursor='grabbing'; e.preventDefault(); }
      function onMove(e){ if(!dragging) return; const x=(e.touches?e.touches[0].clientX:e.clientX); const dx=x-startX; setLeft(startLeft+dx); }
      function onUp(){ if(!dragging) return; dragging=false; thumb.style.cursor='grab'; if(parseFloat(thumb.style.left||'0')>=max()-4){ complete(); } else { setLeft(0); } }
      thumb.addEventListener('mousedown', onDown); thumb.addEventListener('touchstart', onDown, {passive:false});
      window.addEventListener('mousemove', onMove, {passive:false}); window.addEventListener('touchmove', onMove, {passive:false});
      window.addEventListener('mouseup', onUp); window.addEventListener('touchend', onUp);
    }
    // If redirected back with ?sent=1 (no-JS fallback), show success
    try {
      const url = new URL(location.href);
      if (url.searchParams.get('sent') === '1' && status) {
        status.hidden = false; status.className = 'alert success'; status.textContent = t('form_success');
      }
    } catch {}
    function validate(){
      const name = form.querySelector('#name');
      const email = form.querySelector('#email');
      const message = form.querySelector('#message');
      if (!name?.value || !email?.value || !message?.value){ return { ok:false, reason:'required' }; }
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
      return ok ? { ok:true } : { ok:false, reason:'email' };
    }
    form.addEventListener('submit', async (e) => {
      // Progressive enhancement: use fetch if available
      if (!window.fetch) return; // fall back to default submit
      e.preventDefault();
      if (!verified) {
        if (status){ status.hidden = false; status.className = 'alert error'; status.textContent = t('verify_needed') || 'Please complete verification before submitting'; }
        return;
      }
      const v = validate();
      if (!v.ok){
        if (status){
          status.hidden = false; status.className = 'alert error';
          status.textContent = v.reason==='email'? t('form_invalid_email') : t('form_required');
        }
        return;
      }
      const btn = form.querySelector('button[type="submit"]');
      if (btn){ btn.disabled = true; btn.style.opacity = .7; }
      if (status){ status.hidden = false; status.className = 'alert'; status.textContent = '...'; }
      try {
        const data = new FormData(form);
        const res = await fetch(form.action, { method: 'POST', body: data, headers: { 'Accept': 'application/json' } });
        if (res.ok){
          form.reset();
          if (status){ status.className = 'alert success'; status.textContent = t('form_success'); }
        } else {
          throw new Error('send failed');
        }
      } catch {
        if (status){
          status.hidden = false; status.className = 'alert error';
          const email = 'fan.wan.uk@gmail.com';
          status.textContent = `${t('form_error')} ${email}`;
        }
      } finally {
        if (btn){ btn.disabled = false; btn.style.opacity = 1; }
      }
    });
  })();

  (function enhanceConnectSubscribe(){
    const section = document.getElementById('connect-subscribe');
    if (!section) return;

    let setActiveTab = null;
    (function setupConnectTabs(){
      const tabs = Array.from(document.querySelectorAll('.connect-tab'));
      const panes = Array.from(document.querySelectorAll('[data-tab-panel]'));
      if (!tabs.length || !panes.length) return;

      const tabMap = new Map();
      tabs.forEach(btn => {
        const key = (btn.dataset.tab || '').trim();
        if (key) tabMap.set(key, btn);
      });

      const paneMap = new Map();
      panes.forEach(pane => {
        const key = (pane.dataset.tabPanel || '').trim();
        if (key) paneMap.set(key, pane);
      });

      const orderedTabs = tabs.filter(btn => paneMap.has((btn.dataset.tab || '').trim()))
        .map(btn => {
          const key = (btn.dataset.tab || '').trim();
          btn.setAttribute('role', 'tab');
          if (!btn.id) btn.id = `connect-tab-${key}`;
          return btn;
        });

      if (!orderedTabs.length) return;

      const updateHash = (target) => {
        const anchor = target === 'subscribe' ? '#connect-subscribe' : '#connect-direct';
        try {
          history.replaceState(null, '', anchor);
        } catch {}
      };

      const activate = (target, { focusButton = false, emitHash = false } = {}) => {
        if (!tabMap.has(target) || !paneMap.has(target)) return;

        tabMap.forEach((btn, key) => {
          const selected = key === target;
          btn.setAttribute('aria-selected', selected ? 'true' : 'false');
          btn.classList.toggle('is-active', selected);
          btn.tabIndex = selected ? 0 : -1;
          if (selected && focusButton) {
            setTimeout(() => { btn.focus(); }, 0);
          }
        });

        paneMap.forEach((pane, key) => {
          const active = key === target;
          pane.classList.toggle('active', active);
          pane.hidden = !active;
          pane.setAttribute('aria-hidden', active ? 'false' : 'true');
        });

        if (emitHash) updateHash(target);
      };

      setActiveTab = (target, options) => activate(target, options);

      const hash = (location.hash || '').toLowerCase();
      let initial = (hash.includes('subscribe') || hash === '#rss' || hash === '#email') ? 'subscribe' : 'contact';
      if (!paneMap.has(initial)) {
        initial = (orderedTabs[0]?.dataset.tab || '').trim();
      }
      if (initial) {
        activate(initial, { focusButton: false });
      }

      orderedTabs.forEach(btn => {
        const key = (btn.dataset.tab || '').trim();
        btn.addEventListener('click', () => {
          activate(key, { emitHash: true });
        });
        btn.addEventListener('keydown', (event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const index = orderedTabs.indexOf(btn);
          if (index === -1) return;
          if (event.key === 'Home') {
            const first = orderedTabs[0];
            activate((first.dataset.tab || '').trim(), { focusButton: true, emitHash: true });
            return;
          }
          if (event.key === 'End') {
            const last = orderedTabs[orderedTabs.length - 1];
            activate((last.dataset.tab || '').trim(), { focusButton: true, emitHash: true });
            return;
          }
          const dir = event.key === 'ArrowRight' ? 1 : -1;
          let nextIndex = (index + dir + orderedTabs.length) % orderedTabs.length;
          const next = orderedTabs[nextIndex];
          activate((next.dataset.tab || '').trim(), { focusButton: true, emitHash: true });
        });
      });

      window.addEventListener('hashchange', () => {
        const h = (location.hash || '').toLowerCase();
        if (h.includes('subscribe') || h === '#rss' || h === '#email') {
          activate('subscribe');
        } else if (h === '#connect-direct' || h === '#connect') {
          activate('contact');
        }
      });
    })();

    const EMAIL_HANDLES = { zh: 'wan', en: 'wan', es: 'wan' };
    const rssCard = document.getElementById('rss-card');
    const rssRow = document.getElementById('rss-row');
    const rssButton = document.getElementById('rss-button');
    const form = section.querySelector('form.embeddable-buttondown-form');
    const success = document.getElementById('bd-success');

    const rssTexts = {
      zh: {
        tipIOS: '如果点开后只有纯文本，说明浏览器没有内置 RSS 阅读器。先安装 Reeder 或 NetNewsWire，再使用上方按钮或下面的一键订阅。',
        tipAndroid: '如果浏览器直接显示文本，请使用 Feedly 或 Inoreader 订阅，或复制链接到你喜欢的阅读器。',
        tipOther: '浏览器可能不会自动订阅 RSS。可以使用下面的一键订阅按钮，或复制 RSS 链接到阅读器。',
        copy: '复制 RSS 链接',
        copied: '已复制',
        quick: '一键订阅：',
        more: '如果希望在浏览器里直接预览 RSS，可安装扩展（如 Feedbro/Feeder）或使用桌面阅读器（Reeder、NetNewsWire 等）。',
        feedly: '若 Feedly 显示“Feed not found”，请复制上方 RSS 链接到 Feedly 手动添加或稍后重试。'
      },
      en: {
        tipIOS: 'If you only see plain text, your browser lacks a built-in RSS reader. Install Reeder or NetNewsWire, then use the button above or the quick links below.',
        tipAndroid: 'If the browser shows raw text, subscribe with Feedly or Inoreader, or copy the feed URL into your reader.',
        tipOther: 'Your browser might not subscribe directly. Use the quick links below or copy the RSS link into your reader.',
        copy: 'Copy RSS link',
        copied: 'Copied',
        quick: 'Quick subscribe:',
        more: 'To preview RSS inside the browser, install an extension (Feedbro/Feeder) or use a desktop reader (Reeder, NetNewsWire, etc.).',
        feedly: 'If Feedly shows “Feed not found”, copy the RSS link above and add it manually in Feedly or try again later.'
      },
      es: {
        tipIOS: 'Si solo ves texto plano, tu navegador no trae lector RSS integrado. Instala Reeder o NetNewsWire y usa el botón o los accesos rápidos abajo.',
        tipAndroid: 'Si el navegador muestra texto en crudo, usa Feedly o Inoreader, o copia el enlace del feed a tu lector.',
        tipOther: 'Puede que tu navegador no suscriba directamente. Usa los accesos rápidos o copia el enlace RSS a tu lector.',
        copy: 'Copiar enlace RSS',
        copied: 'Copiado',
        quick: 'Suscripción rápida:',
        more: 'Para ver RSS en el navegador, instala una extensión (Feedbro/Feeder) o usa un lector de escritorio (Reeder, NetNewsWire, etc.).',
        feedly: 'Si Feedly muestra “Feed not found”, copia el enlace RSS y añádelo manualmente o inténtalo más tarde.'
      }
    };

    function currentLang(){
      const raw = (resolveLang('zh') || 'zh').slice(0, 2);
      return raw === 'en' || raw === 'es' ? raw : 'zh';
    }

    function feedFor(lang){
      if (lang === 'en') return 'rss-en.xml';
      if (lang === 'es') return 'rss-es.xml';
      return 'rss.xml';
    }

    function setRssButton(lang){
      if (!rssButton) return;
      rssButton.setAttribute('href', feedFor(lang));
      rssButton.setAttribute('title', 'RSS');
      rssButton.setAttribute('aria-label', 'RSS');
    }

    function buildRssHelp(lang){
      if (!rssCard || !rssRow) return;
      rssCard.querySelectorAll('[data-rss-help]').forEach(node => node.remove());
      const text = rssTexts[lang] || rssTexts.zh;

      const feedHref = rssButton?.getAttribute('href') || 'rss.xml';
      const PROD_ORIGIN = 'https://fanwan-ai.github.io/';
      const isLocal = location.protocol === 'file:' || /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(location.origin);
      const feedUrl = new URL(feedHref, isLocal ? PROD_ORIGIN : `${location.origin}/`).toString();

      const ua = navigator.userAgent || navigator.vendor || window.opera || '';
      const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|Android/i.test(ua);
      const isIOSSafari = isIOS && isSafari;
      const isAndroid = /Android/i.test(ua);

      const tip = document.createElement('p');
      tip.className = 'rss-tip';
      tip.dataset.rssHelp = '';
      tip.textContent = isIOSSafari ? text.tipIOS : (isAndroid ? text.tipAndroid : text.tipOther);
      rssCard.appendChild(tip);

      const actions = document.createElement('div');
      actions.className = 'rss-actions';
      actions.dataset.rssHelp = '';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.id = 'copy-rss';
      copyBtn.className = 'btn outline';
      copyBtn.textContent = text.copy;
      copyBtn.addEventListener('click', async () => {
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(feedUrl);
          } else {
            const ta = document.createElement('textarea');
            ta.value = feedUrl;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          }
          copyBtn.textContent = text.copied;
          setTimeout(() => { copyBtn.textContent = text.copy; }, 1300);
        } catch {}
      });
      actions.appendChild(copyBtn);

      const quick = document.createElement('span');
      quick.className = 'rss-note-small';
      quick.textContent = text.quick;
      actions.appendChild(quick);

      const link = (href, label) => {
        const a = document.createElement('a');
        a.className = 'btn outline';
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = label;
        return a;
      };

      actions.appendChild(link(`https://feedly.com/i/subscription/feed/${feedUrl}`, 'Feedly'));
      actions.appendChild(link(`https://www.inoreader.com/?add_feed=${encodeURIComponent(feedUrl)}`, 'Inoreader'));
      if (isIOS) {
        actions.appendChild(link(`netnewswire://subscribe?url=${encodeURIComponent(feedUrl)}`, 'NetNewsWire'));
        actions.appendChild(link(`reeder://x-callback-url/subscribe?feed=${encodeURIComponent(feedUrl)}`, 'Reeder'));
      }
      rssCard.appendChild(actions);

      const more = document.createElement('p');
      more.className = 'rss-note-small';
      more.dataset.rssHelp = '';
      more.textContent = text.more;
      rssCard.appendChild(more);

      const feedlyNote = document.createElement('p');
      feedlyNote.className = 'rss-note-small';
      feedlyNote.dataset.rssHelp = '';
      feedlyNote.textContent = text.feedly;
      rssCard.appendChild(feedlyNote);
    }

    function updateEmailForm(lang){
      if (!form) return;
      const handle = EMAIL_HANDLES[lang] || EMAIL_HANDLES.zh;
      if (handle && !/YOUR_HANDLE/.test(handle)) {
        form.setAttribute('action', `https://buttondown.com/api/emails/embed-subscribe/${handle}`);
      }
    }

    if (form && success) {
      form.addEventListener('submit', () => {
        const lang = currentLang();
        const msg = translations?.[lang]?.contact_subscribe_email_success;
        if (msg) {
          success.textContent = msg;
          success.hidden = false;
        }
      });
    }

    function refresh(lang){
      setRssButton(lang);
      buildRssHelp(lang);
      updateEmailForm(lang);
      if (success && !success.hidden) {
        const msg = translations?.[lang]?.contact_subscribe_email_success;
        if (msg) success.textContent = msg;
      }
    }

    refresh(currentLang());

    window.addEventListener('language-changed', (e) => {
      const lang = (e?.detail?.lang || currentLang()).slice(0,2);
      refresh(lang === 'en' || lang === 'es' ? lang : 'zh');
    });

    (function focusHash(){
      const h = (location.hash || '').toLowerCase();
      const map = { '#rss': 'rss-card', '#email': 'email-card' };
      const id = map[h];
      if (!id) return;
      if (typeof setActiveTab === 'function') {
        setActiveTab('subscribe');
      }
      const card = document.getElementById(id);
      if (card) {
        card.setAttribute('tabindex', '-1');
        card.style.outline = '2px solid var(--primary)';
        card.style.outlineOffset = '3px';
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(() => { card.focus(); }, 60);
        setTimeout(() => {
          card.style.outline = '';
          card.style.outlineOffset = '';
          card.removeAttribute('tabindex');
        }, 1600);
      }
    })();
  })();

  // Blog list page: switch card link and thumbnail per language
  (function syncBlogListCards(){
    const isBlogList = location.pathname.endsWith('/blog.html') || document.querySelector('main .blog-posts');
    if (!isBlogList) return;
    function apply() {
      const lang = resolveLang();
      document.querySelectorAll('.post-card').forEach(card => {
        const link = card.querySelector('a.post-link');
        const img = card.querySelector('img.post-thumb');
        // Determine the target href for this language from the primary link's data attributes
        let targetHref = '';
        if (link) {
          targetHref = link.getAttribute(`data-href-${lang}`) || link.getAttribute('href') || '';
          if (targetHref) link.setAttribute('href', targetHref);
        }
        // Also update the title link (inside h3) to point to the same language-specific URL
        const titleLink = card.querySelector('h3 a');
        if (titleLink && targetHref) {
          titleLink.setAttribute('href', targetHref);
        }
        if (img) {
          const src = img.getAttribute(`data-src-${lang}`) || img.getAttribute('src');
          if (src) img.setAttribute('src', src);
        }
      });
    }
    apply();
    window.addEventListener('language-changed', apply);
  })();

  // If landing on About page (or About section in home), trigger a one-off pop effect
  (function triggerAboutFxOnLoad(){
    const target = document.querySelector('.about-portrait.fx-reveal') || document.querySelector('.about-photo .fx-tilt');
    if (!target) return; // only on pages that have the element
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const flag = (()=>{ try { return sessionStorage.getItem('triggerAboutFx'); } catch { return null; } })();
    if (prefersReduced) return; // respect reduced motion, image will show via CSS
    // Trigger on explicit nav intent or on page refresh/load directly (no flag)
    try { sessionStorage.removeItem('triggerAboutFx'); } catch {}
    triggerAboutReveal(target);
  })();

  function triggerAboutReveal(target){
    // If we have the reveal effect, use it; else fallback to pop
    if (target.classList && target.classList.contains('fx-reveal')){
      target.classList.remove('revealed');
      // force reflow
      void target.offsetWidth;
      target.classList.add('revealed');
    } else {
      target.classList.remove('fx-pop');
      void target.offsetWidth;
      target.classList.add('fx-pop');
      target.addEventListener('animationend', () => target.classList.remove('fx-pop'), { once: true });
    }
  }

  // About page: subtle parallax tilt + moving highlight on portrait
  (function parallaxPortrait(){
    const card = document.querySelector('.about-portrait.fx-tilt');
    if (!card) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hasFinePointer = window.matchMedia('(pointer: fine)').matches;
    if (prefersReduced || !hasFinePointer) return; // skip on touch or reduced motion

    const maxTilt = 8; // degrees
    const damp = 18;    // lower = snappier
    let rx = 0, ry = 0; // current rotation
    let vx = 0, vy = 0; // velocity for smoothing
    let rafId = 0;

    function animate(){
      // exponential smoothing
      rx += (vx - rx) / damp;
      ry += (vy - ry) / damp;
      card.style.transform = `perspective(700px) rotateX(${rx}deg) rotateY(${ry}deg)`;
      rafId = requestAnimationFrame(animate);
    }

    function onMove(e){
      const rect = card.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const x = (e.clientX - cx) / (rect.width / 2); // [-1,1]
      const y = (e.clientY - cy) / (rect.height / 2); // [-1,1]
      // target rotations (invert y for natural tilt)
      vy = Math.max(-maxTilt, Math.min(maxTilt, -y * maxTilt));
      vx = Math.max(-maxTilt, Math.min(maxTilt, x * maxTilt));
      // shift highlight with cursor (0%..100%)
      const px = `${50 + x * 20}%`;
      const py = `${50 + y * 20}%`;
      card.style.setProperty('--fx-x', px);
      card.style.setProperty('--fx-y', py);
    }

    function reset(){
      vx = vy = rx = ry = 0;
      card.style.transform = 'none';
      card.style.removeProperty('--fx-x');
      card.style.removeProperty('--fx-y');
    }

    card.addEventListener('mouseenter', () => { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(animate); });
    card.addEventListener('mousemove', onMove);
    card.addEventListener('mouseleave', () => { cancelAnimationFrame(rafId); reset(); });
  })();

  // Publications: inline PDF viewer modal
  (function setupPdfModal(){
    const modal = document.getElementById('pdf-modal');
    if (!modal) return;
    const frame = document.getElementById('pdf-frame');
    const fallback = document.getElementById('pdf-fallback');
    const titleEl = document.getElementById('pdf-title');
    const isMobile = () => {
      try {
        const ua = navigator.userAgent || '';
        return /iPhone|iPad|Android|Mobile/i.test(ua) || window.innerWidth < 768;
      } catch { return window.innerWidth < 768; }
    };
    function openModal(src){
      if (frame) frame.src = src || '';
      if (fallback) fallback.hidden = !!src;
      modal.hidden = false;
      document.body.style.overflow = 'hidden';
    }
    function closeModal(){
      modal.hidden = true;
      if (frame) frame.src = '';
      document.body.style.overflow = '';
    }
    modal.addEventListener('click', (e)=>{
      if (e.target && (e.target.hasAttribute('data-close'))) closeModal();
    });
    document.addEventListener('keydown', (e)=>{
      if (e.key === 'Escape' && !modal.hidden) closeModal();
    });
    document.querySelectorAll('.view-pdf[data-pdf]')?.forEach(btn => {
      btn.addEventListener('click', async () => {
        const src = btn.getAttribute('data-pdf');
        // Set dynamic title: PDF Viewer – <paper title>
        try {
          const h = btn.closest('.pub-item')?.querySelector('h3')?.textContent?.trim();
          const langPref = resolveLang('en');
          if (titleEl) titleEl.textContent = h ? `PDF Viewer – ${h}` : (window.translations?.[langPref]?.pdf_viewer_title || 'PDF Viewer');
        } catch {}
        // On mobile devices, open the PDF directly in a new tab (native viewer)
        if (isMobile() && src) {
          try { window.open(src, '_blank', 'noopener,noreferrer'); } catch { location.href = src; }
          return;
        }
        // Probe availability before showing iframe to avoid broken content
        try {
          const head = await fetch(src, { method: 'HEAD' });
          if (head.ok) {
            openModal(src);
          } else {
            if (fallback) fallback.hidden = false;
            openModal('');
          }
        } catch {
          if (fallback) fallback.hidden = false;
          openModal('');
        }
      });
    });
  })();

  // Enhance Education section: add official website links to schools
  function enhanceEducationLinks(){
    const root = document;
    const container = root.querySelector('.education .timeline');
    if (!container) return;
    const lang = resolveLang().slice(0, 2);
    /** @type {Record<string, Array<{name:string,url:string}>>} */
    const map = {
      zh: [
        { name: '杜伦大学', url: 'https://www.durham.ac.uk/' },
        { name: '纽卡斯尔大学', url: 'https://www.ncl.ac.uk/' },
        { name: '山西农业大学', url: 'https://www.sxau.edu.cn/' }
      ],
      en: [
        { name: 'Durham University', url: 'https://www.durham.ac.uk/' },
        { name: 'Newcastle University', url: 'https://www.ncl.ac.uk/' },
        { name: 'Shanxi Agricultural University', url: 'https://www.sxau.edu.cn/' }
      ],
      es: [
        { name: 'Universidad de Durham', url: 'https://www.durham.ac.uk/' },
        { name: 'Universidad de Newcastle', url: 'https://www.ncl.ac.uk/' },
        { name: 'Universidad Agrícola de Shanxi', url: 'https://www.sxau.edu.cn/' }
      ]
    };
    const items = container.querySelectorAll('.timeline-item h3');
    items.forEach(h3 => {
      const text = h3.textContent || '';
      const list = map[lang] || map.zh;
      let replaced = text;
      for (const it of list) {
        if (replaced.includes(it.name)) {
          // Replace first occurrence with anchor
          const safeName = it.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          replaced = replaced.replace(new RegExp(safeName), `<a href="${it.url}" target="_blank" rel="noopener">${it.name}</a>`);
          break;
        }
      }
      h3.innerHTML = replaced;
    });
  }
  enhanceEducationLinks();
  window.addEventListener('language-changed', enhanceEducationLinks);

  // AI Lab: hydrate progress bars and stage soft card reveals
  (function initAiLabExperience(){
    const labPage = document.body?.classList?.contains('lab-page');
    if (!labPage) return;
    const cards = Array.from(document.querySelectorAll('.lab-card'));
    if (!cards.length) return;

    cards.forEach(card => {
      const progress = Number.parseInt(card.dataset.progress || '', 10);
      if (!Number.isFinite(progress)) return;
      const clamped = Math.max(0, Math.min(progress, 100));
      const bar = card.querySelector('.lab-progress-bar span');
      const value = card.querySelector('.lab-progress-value');
      if (bar) bar.style.width = `${clamped}%`;
      if (value) value.textContent = `${clamped}%`;
    });

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('lab-card-visible');
        obs.unobserve(entry.target);
      });
    }, { threshold: 0.25, rootMargin: '0px 0px -40px 0px' });

    cards.forEach((card, idx) => {
      card.style.setProperty('--lab-card-delay', `${Math.min(idx * 80, 320)}ms`);
      card.classList.add('lab-card-animate');
      observer.observe(card);
    });
  })();
});