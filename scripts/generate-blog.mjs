// Simple Markdown → HTML blog generator for multilingual posts.
// No external deps. Put content in content/blog/<slug>/{zh.md,en.md,es.md} with YAML front matter:
// ---\n title: ...\n description: ...\n date: YYYY-MM-DD\n cover: assets/blog/<slug>-<lang>.svg (optional per file)\n ---
// The script outputs blog/<slug>.html, blog/<slug>.en.html, blog/<slug>.es.html

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve project root robustly across OSes: scripts/ -> ..
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const contentDir = path.join(root, 'content', 'blog');
const outDir = path.join(root, 'blog');
// Public site origin for absolute URLs in meta tags (OG/Twitter). Keep trailing slash.
const siteOrigin = 'https://fanwan-ai.github.io/';

function slugifyId(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[\u2019'"“”‘’]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5\s\-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function parseFrontMatter(src) {
  // Normalize line endings to support CRLF/LF
  const normalized = src.replace(/\r\n?/g, '\n');
  const m = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return [{}, src];
  const body = normalized.slice(m[0].length);
  const yaml = m[1];
  const meta = {};
  yaml.split(/\r?\n/).forEach(line => {
    const mm = line.match(/^([A-Za-z0-9_\-]+):\s*(.*)$/);
    if (mm) {
      const key = mm[1].trim();
      let val = mm[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      meta[key] = val;
    }
  });
  return [meta, body];
}

function escapeHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escapeAttr(s){
  return escapeHtml(s).replace(/`/g, '&#96;');
}

function serializeForScript(data){
  return JSON.stringify(data).replace(/</g, '\\u003C').replace(/>/g, '\\u003E');
}

// Normalize any Windows-style paths to URL-safe forward slashes
function toUrlPath(p){
  return String(p).replace(/\\/g, '/');
}

async function readTtsMeta(slug, lang){
  const base = path.join(root, 'data', 'blog', 'tts');
  const file = path.join(base, `${slug}.${lang}.json`);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    const segments = Array.isArray(parsed?.segments) ? parsed.segments.filter(seg => seg && typeof seg.file === 'string' && seg.file.trim()) : [];
    if (!segments.length) return null;
    const normalized = segments.map((seg, idx) => ({
      id: String(seg.id || `segment-${idx + 1}`),
      text: String(seg.text || ''),
      file: String(seg.file || '').trim(),
    }));
    return {
      slug,
      lang,
      voice: String(parsed.voice || parsed.voice_id || '').trim(),
      generated_at: parsed.generated_at || parsed.generatedAt || '',
      segments: normalized,
    };
  } catch {
    return null;
  }
}

function mdToHtml(md, { slug } = {}) {
  const lines = md.replace(/\r\n?/g,'\n').split('\n');
  const out = [];
  let inCode = false; let codeLang = '';
  const listStack = [];
  let liOpen = false;
  let mathBlock = null; // { start: string, end: string, buffer: string[] }

  const getIndent = (s) => {
    const m = s.match(/^(\s*)/)[1] || '';
    return m.replace(/\t/g, '  ').length; // treat tab as 2 spaces
  };
  const top = () => listStack[listStack.length - 1];
  const openList = (type, indent, startNum) => {
    if (type === 'ol' && typeof startNum === 'number' && startNum > 1) {
      out.push(`<ol start="${startNum}">`);
    } else {
      out.push(`<${type}>`);
    }
    listStack.push({ type, indent });
    liOpen = false;
  };
  const closeList = () => { if (liOpen) { out.push('</li>'); liOpen = false; } const l = listStack.pop(); out.push(`</${l.type}>`); };
  const closeAllLists = () => { while (listStack.length) { closeList(); } };
  const emitMathBlock = (startDelim, endDelim, buffer) => {
    const raw = buffer.join('\n');
    const normalized = raw.replace(/\r\n?/g, '\n');
    const trimmedContent = normalized.replace(/^\n+|\n+$/g, '');
    const safe = escapeHtml(trimmedContent);
    out.push(`<div class="math-block" data-math="display">${startDelim}\n${safe}\n${endDelim}</div>`);
  };

  const isHeading = (s) => /^(#{1,6})\s+/.test(s);
  const isBlockquote = (s) => /^>\s?/.test(s);
  const isHr = (s) => /^---+$/.test(s.trim());

  const inlineFmt = (s) => {
    // Safely allow limited inline HTML (sup/sub with links) by lifting them out before escaping.
    const rawHtmlTokens = [];
    let working = s.replace(/<(sup|sub)([^>]*)>([\s\S]*?)<\/\1>/gi, (m, tag, attrs, inner) => {
      // Only allow very small snippets to avoid unexpected HTML; skip if inner contains other block-level tags.
      if (/<(script|style|iframe|object|embed)/i.test(inner)) {
        return m; // fall back to default escaping
      }
      rawHtmlTokens.push(m);
      return `\u0000RAW${rawHtmlTokens.length - 1}\u0000`;
    });
    // 1) Escape HTML
    let t = escapeHtml(working);
    // 2) Images first
    t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, url) => {
      let u = url;
      if (slug && !/^([a-z]+:)?\/\//i.test(u) && !u.startsWith('/') && !u.startsWith('../') && !u.startsWith('data:')) {
        u = `../content/blog/${slug}/${u}`;
      }
      return `<img src="${u}" alt="${alt}">`;
    });
    // 3) Links
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, a, b) => {
      let u = b;
      if (slug && !/^([a-z]+:)?\/\//i.test(u) && !u.startsWith('/')) {
        u = `../content/blog/${slug}/${u}`;
      }
      return `<a href="${u}" target="_blank" rel="noopener">${a}</a>`;
    });
    // 4) Protect inline code
    const codeTokens = [];
    t = t.replace(/`([^`]+)`/g, (m, c) => { codeTokens.push(c); return `\u0000CODE${codeTokens.length-1}\u0000`; });
    // 5) Protect math ($...$ and \( ... \))
    const mathTokens = [];
    t = t
      .replace(/\$(?:[^$\\]|\\.)+\$/g, (m) => { mathTokens.push(m); return `\u0000MATH${mathTokens.length-1}\u0000`; })
      .replace(/\\\((?:[^\\]|\\.)*?\\\)/g, (m) => { mathTokens.push(m); return `\u0000MATH${mathTokens.length-1}\u0000`; });
    // 6) Bold (** or __)
    t = t.replace(/(\*\*|__)(.+?)\1/g, '<b>$2</b>');
    // 7) Italic using *...* only
    t = t.replace(/\*(?!\*)([^*]+)\*/g, '<i>$1</i>');
    // 8) Restore math and code
    t = t.replace(/\u0000MATH(\d+)\u0000/g, (m, i) => mathTokens[+i] ?? m);
    t = t.replace(/\u0000CODE(\d+)\u0000/g, (m, i) => `<code>${codeTokens[+i]}</code>`);
    // 9) Restore whitelisted raw HTML tokens (sup/sub) while escaping stray angle brackets inside href attributes
    t = t.replace(/\u0000RAW(\d+)\u0000/g, (m, i) => {
      const original = rawHtmlTokens[+i] ?? '';
      if (!original) return '';
      // Basic scrub: strip forbidden characters on the sup/sub tag wrapper, keep inner content untouched.
      return original.replace(/<(sup|sub)([^>]*)>/i, (match, tag, attrs) => {
        const safeAttrs = attrs.replace(/[^\s\w="'\-:]/g, '');
        return `<${tag}${safeAttrs}>`;
      });
    });
    // 10) Ensure external links open in a new tab when not already specified
    t = t.replace(/<a\s+([^>]*href="([^"]+)"[^>]*)>/gi, (match, attrs, href) => {
      if (!/^https?:\/\//i.test(href)) return match;
      const hasTarget = /\btarget\s*=\s*"?[^"\s]+"?/i.test(attrs);
      const hasRel = /\brel\s*=\s*"?[^"\s]+"?/i.test(attrs);
      let updated = attrs.trim();
      if (!hasTarget) updated += ' target="_blank"';
      if (!hasRel) updated += ' rel="noopener"';
      return `<a ${updated}>`;
    });
    return t;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedFull = line.trim();
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      if (!inCode) { inCode = true; codeLang = (fence[1]||'').trim(); closeAllLists(); out.push(`<pre><code class="language-${escapeHtml(codeLang)}">`); }
      else { inCode = false; out.push('</code></pre>'); }
      continue;
    }
    if (inCode) { out.push(escapeHtml(line)); continue; }

    if (mathBlock) {
      if (trimmedFull === mathBlock.end) {
        emitMathBlock(mathBlock.start, mathBlock.end, mathBlock.buffer);
        mathBlock = null;
      } else {
        mathBlock.buffer.push(line.trimEnd());
      }
      continue;
    }

    if (trimmedFull === '$$' || trimmedFull === '\\[') {
      mathBlock = { start: trimmedFull, end: trimmedFull === '\\[' ? '\\]' : '$$', buffer: [] };
      continue;
    }

    if ((trimmedFull.startsWith('$$') && trimmedFull.endsWith('$$') && trimmedFull.length > 4) || (trimmedFull.startsWith('\\[') && trimmedFull.endsWith('\\]') && trimmedFull.length > 4)) {
      const startDelim = trimmedFull.startsWith('$$') ? '$$' : '\\[';
      const endDelim = startDelim === '$$' ? '$$' : '\\]';
      const inner = trimmedFull.slice(startDelim.length, trimmedFull.length - endDelim.length);
      emitMathBlock(startDelim, endDelim, [inner]);
      continue;
    }

    if (trimmedFull.startsWith('$$') && !trimmedFull.endsWith('$$')) {
      const remaining = trimmedFull.slice(2);
      mathBlock = { start: '$$', end: '$$', buffer: [] };
      if (remaining.trim()) mathBlock.buffer.push(remaining);
      continue;
    }

    if (trimmedFull.startsWith('\\[') && !trimmedFull.endsWith('\\]')) {
      const remaining = trimmedFull.slice(2);
      mathBlock = { start: '\\[', end: '\\]', buffer: [] };
      if (remaining.trim()) mathBlock.buffer.push(remaining);
      continue;
    }

    const indent = getIndent(line);
    const trimmed = line.trimStart();
    const mOl = trimmed.match(/^(\d+)[\.)]\s+(.*)$/);
    const mUl = trimmed.match(/^[-*+]\s+(.*)$/);

    if (!trimmed) {
      if (listStack.length) {
        const rawNext = lines[i+1] ?? '';
        const next = rawNext.trimStart();
        const nextIndent = getIndent(rawNext);
        const isNextList = /^\d+[\.)]\s+/.test(next) || /^[-*+]\s+/.test(next);
        const isNextTable = next.startsWith('|');
        // 不要在表格前关闭列表；允许空行后接着继续当前列表项内容
        if (!next || (!isNextList && !isNextTable && !(nextIndent > (top()?.indent ?? 0)))) {
          closeAllLists();
        }
      }
      out.push('');
      continue;
    }

    if (mOl || mUl) {
      const desired = mOl ? 'ol' : 'ul';
      const startNum = mOl ? parseInt(mOl[1], 10) : undefined;
      const text = (mOl ? mOl[2] : mUl[1]).trim();
      while (listStack.length && indent < top().indent) { closeList(); }
      if (!listStack.length || indent > top().indent) {
        if (listStack.length && !liOpen) { out.push('<li>'); liOpen = true; }
        openList(desired, indent, startNum);
      } else if (top().type !== desired) {
        closeList();
        openList(desired, indent, startNum);
      }
      if (liOpen) { out.push('</li>'); }
      out.push(`<li>${inlineFmt(text)}`);
      liOpen = true;
      continue;
    }

    // Table block (GitHub-style): header row starting with '|' followed by separator '|---|'
    const rawNext = lines[i+1] ?? '';
    const nextTrim = rawNext.trim();
    const isHeader = trimmed.startsWith('|');
    const isSep = /^\|?\s*[:\-]+(?:\s*\|\s*[:\-]+)*\s*\|?$/.test(nextTrim);
    if (isHeader && isSep) {
      const headerCells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c=>c.trim());
      i += 1; // skip separator
      const rows = [];
      let j = i + 1;
      while (j < lines.length) {
        const r = lines[j];
        if (!r.trim()) break;
        if (!r.trimStart().startsWith('|')) break;
        const cells = r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c=>c.trim());
        rows.push(cells);
        j++;
      }
      i = j - 1;
  const thead = `<thead><tr>${headerCells.map(h=>`<th>${inlineFmt(h)}</th>`).join('')}</tr></thead>`;
  const tbody = `<tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${inlineFmt(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  // Wrap in .table-wrap for consistent styling even without JS
  out.push(`<div class="table-wrap"><table>${thead}${tbody}</table></div>`);
      continue;
    }

    if (listStack.length) { out.push(`<p>${inlineFmt(trimmed)}</p>`); continue; }

    if (isHeading(trimmed)) {
      const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
      const level = h[1].length; const text = h[2].trim();
      const id = slugifyId(text) || `h${i}`;
      out.push(`<h${level} id="${id}">${inlineFmt(text)}</h${level}>`);
      continue;
    }
    if (isBlockquote(trimmed)) { out.push(`<blockquote><p>${inlineFmt(trimmed.replace(/^>\s?/, ''))}</p></blockquote>`); continue; }
    if (isHr(line)) { out.push('<hr>'); continue; }
    out.push(`<p>${inlineFmt(line.trim())}</p>`);
  }
  if (inCode) { out.push('</code></pre>'); }
  if (mathBlock) {
    emitMathBlock(mathBlock.start, mathBlock.end, mathBlock.buffer);
    mathBlock = null;
  }
  while (listStack.length) { closeList(); }
  return out.join('\n');
}

function buildHtml({lang, slug, title, description, date, bodyHtml, heroSrc, ogImage, prevNext, orderList, backHref, ttsData}){
  const langLabel = lang==='en' ? 'English' : lang==='es' ? 'Español' : '中文';
  const titleForTwitter = lang==='en' ? `${title} (with KBLaM)` : title;
  const url = `${siteOrigin}blog/${slug}${lang==='zh'?'':'.'+lang}.html`;
  const heroImg = heroSrc || '';
  const dateLabel = lang==='en' ? `Published on ${date}` : lang==='es' ? `Publicado el ${date}` : `发表于 ${date}`;
  const estRead = lang==='en' ? 'Estimated read' : lang==='es' ? 'Lectura' : '预计阅读';
  // Detect OG mime type from extension; include SVG support
  const ogType = ogImage.endsWith('.svg')
    ? 'image/svg+xml'
    : (ogImage.endsWith('.png')
        ? 'image/png'
        : (ogImage.endsWith('.jpg') || ogImage.endsWith('.jpeg'))
          ? 'image/jpeg'
          : 'image/png');
  const hasTts = ttsData && Array.isArray(ttsData.segments) && ttsData.segments.length;
  const segmentsCount = hasTts ? ttsData.segments.length : 0;
  const voiceId = hasTts ? (ttsData.voice || 'Katerina') : '';
  const audioCopy = {
    zh: {
      badge: '语音朗读',
      voiceLabel: '配音 · {voice}',
      segmentsLabel: '共 {count} 段',
      play: '播放全文朗读',
      pause: '暂停播放',
      resume: '继续播放',
      speed: '播放速度',
      statusReady: '音频已就绪，点击播放',
      statusLoading: '音频加载中…',
      statusPlaying: '正在播放 {progress}',
      statusPaused: '已暂停 {progress}',
      statusResuming: '继续播放 {progress}',
      statusCompleted: '播放完成',
      statusError: '无法继续播放，请重试',
      statusAutoplay: '音频无法自动播放，请点击重试',
      progressTemplate: '第 {current}/{total} 段',
      progressIdle: '共 {total} 段',
      captionPrefix: '当前段落',
      speedValues: ['1.0×','1.25×','1.5×','1.75×','2.0×'],
    },
    en: {
      badge: 'Narration',
      voiceLabel: 'Voice · {voice}',
      segmentsLabel: '{count} segments',
      play: 'Play full narration',
      pause: 'Pause narration',
      resume: 'Resume narration',
      speed: 'Speed',
      statusReady: 'Audio ready. Press play.',
      statusLoading: 'Preparing audio…',
      statusPlaying: 'Playing {progress}',
      statusPaused: 'Paused {progress}',
      statusResuming: 'Resuming {progress}',
      statusCompleted: 'Playback complete',
      statusError: 'Unable to continue. Try again.',
      statusAutoplay: 'Autoplay blocked. Press play again.',
      progressTemplate: '{current}/{total}',
      progressIdle: '{total} segments',
      captionPrefix: 'Now reading',
      speedValues: ['1.0×','1.25×','1.5×','1.75×','2.0×'],
    },
    es: {
      badge: 'Narración',
      voiceLabel: 'Voz · {voice}',
      segmentsLabel: '{count} secciones',
      play: 'Reproducir narración completa',
      pause: 'Pausar narración',
      resume: 'Reanudar narración',
      speed: 'Velocidad',
      statusReady: 'Audio listo. Pulsa reproducir.',
      statusLoading: 'Preparando audio…',
      statusPlaying: 'Reproduciendo {progress}',
      statusPaused: 'Pausado {progress}',
      statusResuming: 'Reanudando {progress}',
      statusCompleted: 'Reproducción completada',
      statusError: 'No se pudo continuar. Inténtalo de nuevo.',
      statusAutoplay: 'La reproducción automática fue bloqueada. Pulsa reproducir.',
      progressTemplate: '{current}/{total}',
      progressIdle: '{total} secciones',
      captionPrefix: 'Sección actual',
      speedValues: ['1.0×','1.25×','1.5×','1.75×','2.0×'],
    },
  };
  const copy = audioCopy[lang] || audioCopy.zh;
  const voiceLine = hasTts ? copy.voiceLabel.replace('{voice}', escapeHtml(voiceId || 'Katerina')) : '';
  const segmentsLine = hasTts ? copy.segmentsLabel.replace('{count}', String(segmentsCount)) : '';
  const progressIdle = copy.progressIdle.replace('{total}', String(segmentsCount));
  const postSummary = description ? `<p class="post-hero-summary">${escapeHtml(description)}</p>` : '';
  const ttsScript = hasTts ? `<script id="post-tts-data" type="application/json">${serializeForScript(ttsData)}</script>` : '';
  const blogOrderScript = JSON.stringify(orderList || []);
  return `<!doctype html>
<html lang="${lang}" data-force-lang="${lang}">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://busuanzi.ibruce.info 'unsafe-inline'; font-src 'self' data: https://cdn.jsdelivr.net; connect-src 'self' https://api.countapi.xyz https://counterapi.dev https://api.counterapi.dev https://busuanzi.ibruce.info; base-uri 'self'; object-src 'none'">
  <meta name="referrer" content="no-referrer-when-downgrade">
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="author" content="Fan Wan">
  <link rel="canonical" href="${url}">
  <link rel="alternate" hreflang="zh" href="${siteOrigin}blog/${slug}.html">
  <link rel="alternate" hreflang="en" href="${siteOrigin}blog/${slug}.en.html">
  <link rel="alternate" hreflang="es" href="${siteOrigin}blog/${slug}.es.html">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:secure_url" content="${ogImage}">
  <meta property="og:image:type" content="${ogType}">
  <link rel="image_src" href="${ogImage}">
  <meta itemprop="image" content="${ogImage}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(titleForTwitter)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${ogImage}">
  <meta name="theme-color" content="#0f172a">
  <link rel="icon" href="../assets/logo.svg" type="image/svg+xml">
  <script src="../lang-preload.js"></script>
  <script>
    (function(){
      try {
        var root = document.documentElement;
        if (!root) return;
        var saved = null;
        try { saved = localStorage.getItem('theme'); } catch (e) { saved = null; }
        var hasManual = saved === 'light' || saved === 'dark';
        if (!hasManual && saved) {
          try { localStorage.removeItem('theme'); } catch (e2) {}
        }
        var prefersDark = false;
        try {
          prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        } catch (e3) { prefersDark = false; }
        var theme = hasManual ? saved : (prefersDark ? 'dark' : 'light');
        root.setAttribute('data-theme', theme);
        root.setAttribute('data-theme-mode', hasManual ? theme : ('system-' + theme));
        root.setAttribute('data-theme-source', hasManual ? 'user' : 'system');
      } catch (e) {}
    })();
  </script>
  <style>
    html[data-lang-loading="true"] body { visibility: hidden; }
  </style>
  <link rel="stylesheet" href="../style.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" crossorigin="anonymous" referrerpolicy="no-referrer">
  <script defer src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" crossorigin="anonymous">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js" crossorigin="anonymous"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js" crossorigin="anonymous"></script>
  <script defer src="../lang.js"></script>
  <script defer src="../script.js"></script>
  <script>window.__BLOG_ORDER__ = ${blogOrderScript};</script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to main content</a>
  <header>
    <nav class="navbar container">
      <a href="../index.html" class="brand" aria-label="Home">
        <img src="../assets/logo.svg" alt="Fan Wan logo" class="brand-logo" width="28" height="28" />
        <span class="logo"><span class="i18n l-zh">首页</span><span class="i18n l-en">Home</span><span class="i18n l-es">Inicio</span></span>
      </a>
      <ul class="nav-links">
        <li><a href="../index.html"><span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 12l9-9 9 9"/><path d="M9 21V9h6v12"/></svg></span> <span class="i18n l-zh">首页</span><span class="i18n l-en">Home</span><span class="i18n l-es">Inicio</span></a></li>
        <li><a href="../about.html"><span class="i18n l-zh">关于我</span><span class="i18n l-en">About</span><span class="i18n l-es">Acerca de</span></a></li>
        <li><a href="../publications.html"><span class="i18n l-zh">学术出版物</span><span class="i18n l-en">Research</span><span class="i18n l-es">Investigación</span></a></li>
        <li><a href="../blog.html"><span class="i18n l-zh">博客</span><span class="i18n l-en">Blog</span><span class="i18n l-es">Blog</span></a></li>
        <li class="has-dropdown">
          <div class="link-wrapper">
            <a href="/ai-lab.html" class="nav-link-dropdown">
              <span class="i18n l-zh">AI 工坊</span><span class="i18n l-en">AI Studio</span><span class="i18n l-es">Taller de IA</span>
              <svg class="icon chevron-desktop" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </a>
            <button class="dropdown-toggle" aria-label="Toggle Submenu" aria-expanded="false">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
          <ul class="dropdown-menu">
            <li><a href="/lab/ai-paperhub.html"><span class="i18n l-zh">AI 论文中心</span><span class="i18n l-en">AI Paper Hub</span><span class="i18n l-es">Centro de Papers IA</span></a></li>
            <li><a href="/lab/modelswatch.html"><span class="i18n l-zh">AI 模型雷达</span><span class="i18n l-en">AI Model Radar</span><span class="i18n l-es">Radar de Modelos IA</span></a></li>
            <li><a href="/lab/ai-radar.html"><span class="i18n l-zh">AI 前沿要闻</span><span class="i18n l-en">AI Frontier News</span><span class="i18n l-es">Noticias de Frontera IA</span></a></li>
            <li><a href="/lab/ai-wealth.html"><span class="i18n l-zh">AI 理财助手</span><span class="i18n l-en">AI Wealth Assistant</span><span class="i18n l-es">Asistente Financiero IA</span></a></li>
            <li><a href="/lab/ai-daily-academy.html"><span class="i18n l-zh">AI 每日学堂</span><span class="i18n l-en">AI Daily Academy</span><span class="i18n l-es">Academia Diaria IA</span></a></li>
            <li><a href="/lab/ai-game-center.html"><span class="i18n l-zh">AI 游戏中心</span><span class="i18n l-en">AI Game Center</span><span class="i18n l-es">Centro de Juegos IA</span></a></li>
          </ul>
        </li>
        <li><a href="../contact.html"><span class="i18n l-zh">联系</span><span class="i18n l-en">Contact</span><span class="i18n l-es">Contacto</span></a></li>
      </ul>
      <div class="nav-actions">
        <div class="lang-switcher">
          <button id="lang-button" class="btn outline icon-btn" aria-haspopup="listbox" aria-expanded="false">
            <svg class="icon icon-globe" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18"/><path d="M12 3a15 15 0 0 0 0 18"/></g></svg>
            <span class="label"></span>
          </button>
          <ul id="lang-menu" class="lang-menu" role="listbox" aria-label="Language" hidden>
            <li role="option" data-lang="en">English</li>
            <li role="option" data-lang="zh">中文</li>
            <li role="option" data-lang="es">Español</li>
          </ul>
        </div>
        <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme" title="Toggle theme">
          <svg class="icon icon-bulb" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M8.5 15.5c-.9-1-1.5-2.3-1.5-3.8a5 5 0 1 1 10 0c0 1.5-.6 2.8-1.5 3.8-.6.7-1.1 1.4-1.3 2.2H9.8c-.2-.8-.7-1.5-1.3-2.2z"/><path d="M12 2v2"/><path d="M4 10h2"/><path d="M18 10h2"/><path d="M5.5 5.5l1.4 1.4"/><path d="M18.5 5.5l-1.4 1.4"/></g></svg>
          <svg class="icon icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <svg class="icon icon-system" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2" ry="2"/><path d="M8 20h8M12 16v4"/></g></svg>
        </button>
        <div class="hamburger" id="hamburger"><span></span><span></span><span></span></div>
      </div>
    </nav>
  </header>
  <main id="main" class="blog-post">
    <section class="page-hero section">
      <div class="container post-hero-container">
        <div class="post-hero-grid">
          ${heroImg ? `<div class="post-hero-visual" data-lang="${lang}"><div class="post-hero-visual-glow"></div><div class="post-hero-visual-frame"><img src="${heroImg}" alt="Cover art"></div></div>` : ''}
          <div class="post-hero-main">
            <div class="i18n-block" data-lang="${lang}">
              <span class="post-hero-chip">${lang==='en'?'Research Note':(lang==='es'?'Cuaderno de análisis':'深度长文')}</span>
              <h1 class="post-title">${escapeHtml(title)}</h1>
              <p class="muted post-meta">${dateLabel} · ${estRead} 5 min</p>
            </div>
            ${postSummary}
            ${hasTts ? `<div class="post-audio-card"
              data-label-play="${escapeAttr(copy.play)}"
              data-label-pause="${escapeAttr(copy.pause)}"
              data-label-resume="${escapeAttr(copy.resume)}"
              data-status-ready="${escapeAttr(copy.statusReady)}"
              data-status-loading="${escapeAttr(copy.statusLoading)}"
              data-status-playing="${escapeAttr(copy.statusPlaying)}"
              data-status-paused="${escapeAttr(copy.statusPaused)}"
              data-status-resuming="${escapeAttr(copy.statusResuming)}"
              data-status-completed="${escapeAttr(copy.statusCompleted)}"
              data-status-error="${escapeAttr(copy.statusError)}"
              data-status-autoplay="${escapeAttr(copy.statusAutoplay)}"
              data-progress-template="${escapeAttr(copy.progressTemplate)}"
              data-progress-idle="${escapeAttr(progressIdle)}"
              data-caption-prefix="${escapeAttr(copy.captionPrefix)}"
            >
              <span class="post-audio-orb" aria-hidden="true"></span>
              <div class="post-audio-header">
                <span class="post-audio-chip">${escapeHtml(copy.badge)}</span>
                <div class="post-audio-meta">
                  <span class="post-audio-voice" data-role="voice">${voiceLine}</span>
                  <span class="post-audio-count" data-role="count">${escapeHtml(segmentsLine)}</span>
                </div>
              </div>
              <div class="post-audio-body">
                <button type="button" class="post-audio-toggle" data-role="toggle" aria-label="${escapeAttr(copy.play)}">
                  <span class="post-audio-icon" aria-hidden="true">
                    <svg viewBox="0 0 60 60" role="presentation"><circle cx="30" cy="30" r="27" fill="none" stroke="currentColor" stroke-width="1.6" opacity="0.2"></circle><path d="M26 21v18l14-9z" fill="currentColor"></path></svg>
                  </span>
                  <span class="post-audio-text" data-role="action">${escapeHtml(copy.play)}</span>
                </button>
                <div class="post-audio-status" data-role="status">${escapeHtml(copy.statusReady)}</div>
                <p class="post-audio-caption" data-role="caption" hidden></p>
              </div>
              <div class="post-audio-controls">
                <label class="post-audio-speed">
                  <span>${escapeHtml(copy.speed)}</span>
                  <select class="post-audio-speed-select" data-role="speed">
                    <option value="1">${escapeHtml(copy.speedValues[0])}</option>
                    <option value="1.25" selected>${escapeHtml(copy.speedValues[1])}</option>
                    <option value="1.5">${escapeHtml(copy.speedValues[2])}</option>
                    <option value="1.75">${escapeHtml(copy.speedValues[3])}</option>
                    <option value="2">${escapeHtml(copy.speedValues[4])}</option>
                  </select>
                </label>
                <div class="post-audio-progress" data-role="progress">${escapeHtml(progressIdle)}</div>
              </div>
              <audio class="post-audio-element" data-role="audio" preload="none"></audio>
            </div>` : ''}
            ${ttsScript}
          </div>
        </div>
      </div>
    </section>
    <section class="section">
      <div class="container prose">
        <nav class="toc card" aria-label="Contents" style="padding:16px;margin:12px 0;"><strong>${lang==='en'?'Contents':(lang==='es'?'Índice':'目录')}</strong><ol></ol></nav>
        <article class="i18n-block" data-lang="${lang}">
${bodyHtml}
        </article>
  <div class="share-toolbar card" style="margin-top:24px;padding:12px 16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <strong class="share-title" data-i18n="share_label">${lang==='en'?'Share':(lang==='es'?'Compartir':'分享')}</strong>
          <div class="spacer" style="flex:0 0 8px"></div>
          <button class="btn outline share-btn" data-share="wechat">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7.5 3C4.46 3 2 5.08 2 7.65c0 1.52.84 2.88 2.15 3.8l-.53 1.93 2.06-1.24c.56.14 1.15.21 1.77.21 3.04 0 5.5-2.08 5.5-4.65S10.54 3 7.5 3zm-1.4 3.6a.9.9 0 110 1.8.9.9 0 010-1.8zm3.8 0a.9.9 0 110 1.8.9.9 0 010-1.8zM16.5 10c-2.86 0-5.17 1.86-5.17 4.15 0 1.27.7 2.4 1.78 3.17l-.44 1.6 1.72-1.03c.47.12.97.18 1.48.18 2.86 0 5.17-1.86 5.17-4.15S19.36 10 16.5 10zm-1.2 2.7a.9.9 0 110 1.8.9.9 0 010-1.8zm3.6 0a.9.9 0 110 1.8.9.9 0 010-1.8z" fill="currentColor" stroke="none"></path></svg>
            <span data-i18n="share_wechat">${lang==='en'?'WeChat':(lang==='es'?'WeChat':'微信')}</span>
          </button>
          <a class="btn outline share-btn" data-share="whatsapp" target="_blank" rel="noopener"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-14.32 4.906L4 21l4.2-1.11A8 8 0 1 1 20 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5 9.5c.5 2 2.5 3.5 4 4l1.2-.8c.3-.2.7-.1.9.2l.7 1.1c.2.3.1.7-.2.9-1 .7-2.1 1.1-3.3 1.1-2.9 0-5.3-2.4-5.3-5.3 0-1.2.4-2.3 1.1-3.3.2-.3.6-.4.9-.2l1.1.7c.3.2.4.6.2.9l-.8 1.2z"/></svg>
            <span data-i18n="share_whatsapp">WhatsApp</span></a>
          <button class="btn outline share-btn" data-share="copy"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="10" height="10" rx="2"/><rect x="5" y="5" width="10" height="10" rx="2"/></svg>
            <span data-i18n="share_copy">${lang==='en'?'Copy link':(lang==='es'?'Copiar enlace':'复制链接')}</span></button>
          <button class="btn outline share-btn" data-share="native"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 16V3"/><path d="M8 7l4-4 4 4"/></svg>
            <span data-i18n="share_share">${lang==='en'?'Share…':(lang==='es'?'Compartir…':'分享…')}</span></button>
        </div>
        <!-- Subscribe CTA -->
        <div class="card" style="margin-top:16px;padding:12px 16px;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap">
          <div style="min-width:220px">
            <strong>${lang==='en'?'Subscribe to new posts':(lang==='es'?'Suscríbete a nuevas entradas':'订阅最新文章')}</strong>
            <p class="muted" style="margin:4px 0 0 0">${lang==='en'?'Get updates via RSS or Email. No spam.':(lang==='es'?'Recibe actualizaciones por RSS o Email. Sin spam.':'通过 RSS 或 Email 获取更新。')}</p>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <a class="btn rss outline" id="rss-button" href="../subscribe.html#rss">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" style="margin-right:6px"><g fill="currentColor"><path d="M6 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z"/><path d="M2 6a16 16 0 0 1 16 16h-3A13 13 0 0 0 2 9V6Z"/><path d="M2 11a11 11 0 0 1 11 11h-3A8 8 0 0 0 2 14v-3Z"/></g></svg>
              <span class="i18n l-zh">RSS 订阅</span>
              <span class="i18n l-en">RSS Subscribe</span>
              <span class="i18n l-es">Suscribirse por RSS</span>
            </a>
            <a class="btn rss outline" id="email-button" href="../subscribe.html#email">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" style="margin-right:6px"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></g></svg>
              ${lang==='en'?'Email Subscribe':(lang==='es'?'Suscripción por email':'邮箱订阅')}
            </a>
          </div>
        </div>
        <div id="share-modal" class="modal" hidden>
          <div class="modal-content card" role="dialog" aria-modal="true" aria-labelledby="share-title">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
              <h3 id="share-title" data-i18n="share_wechat">${lang==='en'?'WeChat':(lang==='es'?'WeChat':'微信')}</h3>
              <button class="btn outline" data-close><span data-i18n="share_close">${lang==='en'?'Close':(lang==='es'?'Cerrar':'关闭')}</span></button>
            </div>
            <p class="muted" style="margin:8px 0" data-i18n="share_wechat_qr_tip">${lang==='en'?'Scan in WeChat to share this post':(lang==='es'?'Escanea en WeChat para compartir':'用微信扫描分享此文')}</p>
            <div id="qr" style="display:grid;place-items:center;padding:12px"></div>
          </div>
        </div>
        <hr style="margin: 24px 0">
        <nav class="post-nav" aria-label="Post navigation">
          <a class="btn outline" href="${backHref || '../blog.html'}">${lang==='en'?'← Back':(lang==='es'?'← Volver':'← 返回')}</a>
          ${(() => {
            const prev = prevNext?.prev?.[lang] || prevNext?.prev?.zh || '';
            const next = prevNext?.next?.[lang] || prevNext?.next?.zh || '';
            const prevLabel = lang==='en'?'Previous':(lang==='es'?'Anterior':'上一个');
            const nextLabel = lang==='en'?'Next':(lang==='es'?'Siguiente':'下一个');
            const prevHtml = prev ? `<a class="btn outline" href="${prev}">${prevLabel}</a>` : `<a class=\"btn outline\" href=\"#\" aria-disabled=\"true\" onclick=\"return false;\">${prevLabel}</a>`;
            const nextHtml = next ? `<a class="btn outline" href="${next}">${nextLabel}</a>` : `<a class=\"btn outline\" href=\"#\" aria-disabled=\"true\" onclick=\"return false;\">${nextLabel}</a>`;
            return prevHtml + '\n          ' + nextHtml;
          })()}
        </nav>
      </div>
    </section>
  </main>
  <footer>
    <div class="container"><p>© <span id="year"></span> Fan Wan</p></div>
  </footer>
  <script>
    (function(){
      try {
        var yearEl = document.getElementById('year');
        if (yearEl) yearEl.textContent = new Date().getFullYear();
      } catch (e) {}
    })();
  </script>
  <script>
    (function(){
      if (window.hljs) { try { window.hljs.highlightAll(); } catch(e){} }
      function render(){ try { if (window.renderMathInElement) window.renderMathInElement(document.body, { delimiters:[{left:'$$', right:'$$', display:true},{left:'$', right:'$', display:false}] }); } catch(e){} }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
    })();
  </script>
</body>
</html>`;
}

async function buildPost(dir){
  const slug = path.basename(dir);
  const langs = ['zh','en','es'];
  // Determine prev/next by date across all posts
  if (!globalThis.__postIndex) {
    // Build an index of all posts with date and available langs
    const names = await fs.readdir(contentDir).catch(()=>[]);
    const items = [];
    for (const n of names){
      const p = path.join(contentDir, n);
      const st = await fs.stat(p).catch(()=>null);
      if (!st || !st.isDirectory()) continue;
      // read zh/en/es to get a date; prefer zh then en then es
      let metaDate = '';
      const metaByLang = {};
      for (const L of ['zh','en','es']){
        try {
          const raw = await fs.readFile(path.join(p, `${L}.md`), 'utf8');
          const [m] = parseFrontMatter(raw);
          if (m && !/^(true|1)$/i.test(String(m.draft||'').trim())){
            metaByLang[L] = m;
            metaDate = metaDate || (m.date || '1970-01-01');
          }
        } catch {}
      }
      if (Object.keys(metaByLang).length) items.push({ slug: n, date: metaDate, langs: Object.keys(metaByLang) });
    }
    items.sort((a,b)=> (a.date>b.date?1:(a.date<b.date?-1:0)) );
    globalThis.__postIndex = items;
  }
  const index = globalThis.__postIndex;
  const idx = index.findIndex(it => it.slug === slug);
  const prevEntry = idx > 0 ? index[idx-1] : null;
  const nextEntry = idx >= 0 && idx < index.length-1 ? index[idx+1] : null;
  const prevNext = { prev:{}, next:{} };
  if (prevEntry){
    if (prevEntry.langs.includes('zh')) prevNext.prev.zh = `./${prevEntry.slug}.html`;
    if (prevEntry.langs.includes('en')) prevNext.prev.en = `./${prevEntry.slug}.en.html`;
    if (prevEntry.langs.includes('es')) prevNext.prev.es = `./${prevEntry.slug}.es.html`;
  }
  if (nextEntry){
    if (nextEntry.langs.includes('zh')) prevNext.next.zh = `./${nextEntry.slug}.html`;
    if (nextEntry.langs.includes('en')) prevNext.next.en = `./${nextEntry.slug}.en.html`;
    if (nextEntry.langs.includes('es')) prevNext.next.es = `./${nextEntry.slug}.es.html`;
  }
  // If this is an AI-daily post, override prev/next using ScholarPush feed order and set back link to ScholarPush page
  let backHref = '../blog.html';
  let orderList = (globalThis.__postIndex || []).map(it => `${it.slug}.html`);
  const isScholarPush = /ai-daily/i.test(slug);
  if (isScholarPush) {
    backHref = '../lab/scholarpush.html';
    try {
      const feedPath = path.join(root, 'data', 'ai', 'blog', 'index.json');
      const raw = await fs.readFile(feedPath, 'utf8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) {
        const order = arr.map(x => (x.url||'').split('/').pop().replace(/\.(en|es)\.html$/, '.html')).filter(Boolean);
        orderList = order.slice();
        const idx = order.findIndex(name => name === `${slug}.html`);
        if (idx !== -1) {
          const older = order[idx + 1]; // feed is newest -> oldest
          const newer = order[idx - 1];
          const mk = (name, lang) => {
            if (!name) return '';
            if (lang === 'en') return `./${name.replace(/\.html$/, '.en.html')}`;
            if (lang === 'es') return `./${name.replace(/\.html$/, '.es.html')}`;
            return `./${name}`;
          };
          prevNext.prev.zh = mk(older, 'zh');
          prevNext.prev.en = mk(older, 'en');
          prevNext.prev.es = mk(older, 'es');
          prevNext.next.zh = mk(newer, 'zh');
          prevNext.next.en = mk(newer, 'en');
          prevNext.next.es = mk(newer, 'es');
        }
      }
    } catch {}
  }
  for (const lang of langs){
    const file = path.join(dir, `${lang}.md`);
    try {
      const raw = await fs.readFile(file, 'utf8');
      const [meta, body] = parseFrontMatter(raw);
      if (/^(true|1)$/i.test(String(meta.draft||'').trim())) { continue; }
      const title = meta.title || slug;
      const description = meta.description || '';
      const date = meta.date || new Date().toISOString().slice(0,10);
      // Resolve a valid cover for hero/OG
      // - Now prefer SVG everywhere for crisp text (Chinese included). PNG/JPEG remain as fallbacks.
      // - For OG meta, we will also point to SVG when available (note: some platforms may not render SVG previews).
      // - For hero image in page: SVG is ideal; use relative path from blog/ ("../assets/..."), no hardcoded domain
      const preferRel = (meta.cover && !/^https?:\/\//i.test(meta.cover)) ? meta.cover.replace(/^\/?/,'') : '';
      const pngRel = toUrlPath(path.posix.join('assets','blog',`${slug}-${lang}.png`));
      const svgRel = toUrlPath(path.posix.join('assets','blog',`${slug}-${lang}.svg`));
      let chosenRel = '';
      if (preferRel) {
        try { await fs.access(path.join(root, preferRel)); chosenRel = toUrlPath(preferRel); } catch {}
      }
      // Prefer PNG for on-page hero; fall back to SVG if PNG missing
      if (!chosenRel) {
        try { await fs.access(path.join(root, pngRel)); chosenRel = pngRel; } catch {}
      }
      if (!chosenRel) {
        try { await fs.access(path.join(root, svgRel)); chosenRel = svgRel; } catch {}
      }
      if (!chosenRel) { chosenRel = 'assets/placeholder.jpg'; }
      // Build OG absolute URL, prefer SVG; fall back to PNG/JPG, else placeholder
      let ogRel = '';
      if (meta.cover && /^https?:\/\//i.test(meta.cover)) {
        ogRel = meta.cover; // external URL, assume valid
      } else {
        // Prefer explicitly provided cover if exists
        if (preferRel) {
          try { await fs.access(path.join(root, preferRel)); ogRel = toUrlPath(preferRel); } catch {}
        }
        // Otherwise prefer PNG (smaller, raster-friendly) then SVG
        if (!ogRel) {
          try { await fs.access(path.join(root, pngRel)); ogRel = pngRel; } catch {}
        }
        if (!ogRel) {
          try { await fs.access(path.join(root, svgRel)); ogRel = svgRel; } catch {}
        }
        if (!ogRel) ogRel = 'assets/placeholder.jpg';
      }
      const ogImage = /^https?:\/\//i.test(ogRel) ? ogRel : `${siteOrigin}${ogRel}`;
      // Build hero image src relative to /blog/*.html
      const heroSrc = meta.cover && /^https?:\/\//i.test(meta.cover)
        ? meta.cover
        : `../${toUrlPath(chosenRel).replace(/^\/?/, '')}`;
  const bodyHtml = mdToHtml(body, { slug });
  const ttsData = await readTtsMeta(slug, lang);
  const html = buildHtml({lang, slug, title, description, date, bodyHtml, heroSrc, ogImage, prevNext, orderList, backHref, ttsData});
      const outPath = path.join(outDir, `${slug}${lang==='zh'?'':'.'+lang}.html`);
      await fs.writeFile(outPath, html, 'utf8');
      console.log('Wrote', path.relative(root, outPath));
    } catch (e) {
      // Skip missing language files silently
    }
  }
}

async function main(){
  await fs.mkdir(outDir, { recursive: true });
  const arg = process.argv[2];
  const posts = [];
  if (arg) {
    const p = path.join(contentDir, arg);
    posts.push(p);
  } else {
    const names = await fs.readdir(contentDir).catch(()=>[]);
    for (const n of names){
      const p = path.join(contentDir, n);
      const st = await fs.stat(p).catch(()=>null);
      if (st?.isDirectory()) posts.push(p);
    }
  }
  for (const p of posts){
    await buildPost(p);
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
