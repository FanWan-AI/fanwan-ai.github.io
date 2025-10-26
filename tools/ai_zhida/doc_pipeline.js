'use strict';

(function(global){
  if (global.ZhidaDocs && typeof global.ZhidaDocs.createPipeline === 'function') {
    return;
  }

  const DEFAULT_SETTINGS = {
    maxChunkChars: 900,
    minChunkChars: 220,
    maxChunks: 120
  };
  const PDF_JS_VERSION = '3.11.174';
  const MAMMOTH_VERSION = '1.6.0';
  const XLSX_VERSION = '0.18.5';

  let pdfJsPromise = null;
  let mammothPromise = null;
  let xlsxPromise = null;

  function createPipeline(options) {
    const settings = Object.assign({}, DEFAULT_SETTINGS, options || {});

    async function process(descriptor, hooks) {
      if (!descriptor || !descriptor.file) {
        safeCall(hooks && hooks.onError, new Error('Missing file reference'));
        return;
      }

      const file = descriptor.file;
      const ext = (descriptor.type || descriptor.file.type || '').toLowerCase();

      try {
        safeStatus(hooks, 'reading');
        safeProgress(hooks, 2);

        const extraction = await extractText(file, ext, progress => {
          safeProgress(hooks, Math.min(70, Math.max(5, Math.round(progress * 0.7))));
        });

        safeStatus(hooks, 'processing');
        safeProgress(hooks, 78);

        const normalised = normaliseExtraction(extraction);
        const chunks = buildChunks(normalised.segments, settings);
        const stats = buildStats(normalised.text, chunks, file, normalised.meta);

        safeProgress(hooks, 100);
        safeStatus(hooks, 'ready');

        safeCall(hooks && hooks.onComplete, {
          chunks,
          stats,
          text: normalised.text,
          preview: buildPreview(normalised.segments)
        });
      } catch (error) {
        safeStatus(hooks, 'error');
        safeCall(hooks && hooks.onError, error instanceof Error ? error : new Error(String(error)));
      }
    }

    return { process };
  }

  async function extractText(file, ext, onProgress) {
    const lowerExt = ext || '';
    if (lowerExt.includes('pdf')) {
      return extractPdfText(file, onProgress);
    }
    if (lowerExt.includes('doc')) {
      return extractDocxText(file, onProgress);
    }
    if (lowerExt.includes('sheet') || lowerExt.includes('excel') || lowerExt.includes('xls')) {
      return extractXlsxText(file, onProgress);
    }
    const simpleExt = (file.name || '').split('.').pop();
    if (simpleExt === 'txt' || simpleExt === 'md' || simpleExt === 'csv' || simpleExt === 'json') {
      const text = await readFileAsText(file, onProgress);
      return { text };
    }
    const fallback = await readFileAsText(file, onProgress);
    return { text: fallback };
  }

  async function extractPdfText(file, onProgress) {
    const buffer = await readFileAsArrayBuffer(file, progress => safeCall(onProgress, progress));
    const pdfjs = await ensurePdfJs();
    const uint8 = new Uint8Array(buffer);
    const task = pdfjs.getDocument({ data: uint8 });
    const pdf = await task.promise;

    const segments = [];
    const pageTexts = [];
    const pageCount = pdf.numPages || 0;

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const pageData = await pdf.getPage(pageNumber);
      const content = await pageData.getTextContent();
      const parsed = parsePdfPage(content.items || [], pageNumber);
      if (parsed.text) {
        pageTexts.push(parsed.text);
      }
      if (parsed.segments && parsed.segments.length) {
        Array.prototype.push.apply(segments, parsed.segments);
      }
      safeCall(onProgress, 30 + Math.round((pageNumber / pageCount) * 60));
    }

    const text = pageTexts.join('\n\n');

    return {
      text,
      segments,
      meta: {
        pageCount: pageCount || undefined
      }
    };
  }

  async function extractDocxText(file, onProgress) {
    const buffer = await readFileAsArrayBuffer(file, progress => safeCall(onProgress, progress));
    const mammoth = await ensureMammoth();
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    safeCall(onProgress, 95);
    const text = (result && result.value) || '';
    return {
      text,
      segments: splitPlainTextSegments(text)
    };
  }

  async function extractXlsxText(file, onProgress) {
    const buffer = await readFileAsArrayBuffer(file, progress => safeCall(onProgress, progress));
    const XLSX = await ensureXlsx();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheets = workbook.SheetNames || [];
    const parts = [];
    const segments = [];

    sheets.forEach(name => {
      const sheet = workbook.Sheets[name];
      if (!sheet) {
        return;
      }
      const csv = XLSX.utils.sheet_to_csv(sheet, { FS: '\t', RS: '\n' });
      if (csv && csv.trim()) {
        const label = 'Sheet: ' + name;
        parts.push(label + '\n' + csv);
        segments.push({
          text: label,
          meta: {
            section: label,
            tags: ['sheet']
          }
        });
        splitPlainTextSegments(csv).forEach(seg => {
          segments.push({
            text: seg.text,
            meta: {
              section: name,
              tags: ['sheet-row']
            }
          });
        });
      }
    });

    safeCall(onProgress, 98);

    return {
      text: parts.join('\n\n'),
      segments
    };
  }

  function parsePdfPage(items, pageNumber) {
    const lines = groupPdfItemsIntoLines(items);
    const paragraphs = groupLinesIntoParagraphs(lines);
    const segments = [];
    const collected = [];
    let pendingHeading = null;

    for (let index = 0; index < paragraphs.length; index += 1) {
      const paragraph = paragraphs[index];
      const trimmed = paragraph.trim();
      if (!trimmed) {
        continue;
      }

      if (isHeadingLine(trimmed)) {
        pendingHeading = trimmed;
        segments.push({
          text: trimmed,
          meta: {
            page: pageNumber,
            pages: [pageNumber],
            section: trimmed,
            tags: ['heading']
          }
        });
        collected.push(trimmed);
        continue;
      }

      const meta = {
        page: pageNumber,
        pages: [pageNumber],
        section: pendingHeading || null,
        tags: deriveParagraphTags(trimmed, pendingHeading, pageNumber)
      };

      segments.push({ text: trimmed, meta });
      collected.push(trimmed);
      pendingHeading = null;
    }

    return {
      text: collected.join('\n\n'),
      segments
    };
  }

  function groupPdfItemsIntoLines(items) {
    if (!items || !items.length) {
      return [];
    }

    const lines = [];
    const LINE_TOLERANCE = 2.8;

    for (let i = 0; i < items.length; i += 1) {
      const raw = items[i];
      const fragment = typeof raw.str === 'string' ? raw.str : '';
      const text = fragment.replace(/[\t\r\f]+/g, ' ').trim();
      if (!text) {
        continue;
      }
      const transform = Array.isArray(raw.transform) ? raw.transform : [];
      const x = typeof transform[4] === 'number' ? transform[4] : 0;
      const y = typeof transform[5] === 'number' ? transform[5] : 0;

      let line = null;
      for (let j = lines.length - 1; j >= 0; j -= 1) {
        const candidate = lines[j];
        if (Math.abs(candidate.y - y) <= LINE_TOLERANCE) {
          line = candidate;
          break;
        }
      }

      if (!line) {
        line = { y, items: [] };
        lines.push(line);
      }

      line.items.push({ x, text });
    }

    lines.forEach(line => {
      line.items.sort((a, b) => a.x - b.x);
    });

    lines.sort((a, b) => b.y - a.y);

    const collapsed = [];

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      let joined = '';
      let prevRight = null;

      for (let j = 0; j < line.items.length; j += 1) {
        const part = line.items[j];
        if (joined) {
          const gap = prevRight != null ? part.x - prevRight : 0;
          if (gap > 3) {
            joined += ' ';
          }
        }
        joined += part.text;
        prevRight = part.x + estimateTextWidth(part.text);
      }

      const clean = joined.replace(/\s+/g, ' ').trim();
      if (clean) {
        collapsed.push({ text: clean, y: line.y });
      }
    }

    return collapsed;
  }

  function groupLinesIntoParagraphs(lines) {
    if (!lines.length) {
      return [];
    }

    const GAP_THRESHOLD = 16;
    const paragraphs = [];
    let buffer = [];

    for (let i = 0; i < lines.length; i += 1) {
      const current = lines[i];
      const previous = i > 0 ? lines[i - 1] : null;
      const shouldBreak = shouldStartNewParagraph(previous, current, GAP_THRESHOLD);

      if (shouldBreak && buffer.length) {
        paragraphs.push(buffer.join(' '));
        buffer = [];
      }

      buffer.push(current.text);
    }

    if (buffer.length) {
      paragraphs.push(buffer.join(' '));
    }

    return paragraphs;
  }

  function shouldStartNewParagraph(previous, current, gapThreshold) {
    if (!previous) {
      return false;
    }

    if (!current) {
      return false;
    }

    const gap = Math.abs(previous.y - current.y);
    if (gap > gapThreshold) {
      return true;
    }

    if (isHeadingLine(current.text)) {
      return true;
    }

    if (isHeadingLine(previous.text)) {
      return true;
    }

    if (/[:.;!?]$/.test(previous.text)) {
      return true;
    }

    if (/^[-•●▪]/.test(current.text)) {
      return true;
    }

    if (previous.text.length < 40 && previous.text.split(' ').length <= 6) {
      return true;
    }

    return false;
  }

  function isHeadingLine(text) {
    if (!text) {
      return false;
    }
    const trimmed = text.trim();
    if (trimmed.length > 140) {
      return false;
    }
    if (/^(table|figure)\s+\d+/i.test(trimmed)) {
      return false;
    }
    if (/^(references|acknowledgements?)$/i.test(trimmed)) {
      return true;
    }
    if (/^(abstract|introduction|background|related work|method|methods|methodology|approach|experiments?|evaluation|results|discussion|conclusion|future work)\b/i.test(trimmed)) {
      return true;
    }
    if (/^\d+(\.\d+)*\s+[A-Za-z]/.test(trimmed)) {
      return true;
    }
    if (trimmed === trimmed.toUpperCase() && /^[A-Z0-9\s,:;()\-]+$/.test(trimmed) && trimmed.replace(/\s+/g, '').length >= 3) {
      return true;
    }
    return false;
  }

  function deriveParagraphTags(text, heading, pageNumber) {
    const tags = [];
    const headingValue = heading ? heading.toLowerCase() : '';
    const paragraphValue = text.toLowerCase();

    if (pageNumber === 1) {
      tags.push('front');
    }
    if (headingValue.includes('abstract') || /^abstract\b/.test(paragraphValue)) {
      tags.push('abstract');
    }
    if (headingValue.includes('introduction')) {
      tags.push('introduction');
    }
    if (headingValue.includes('conclusion') || headingValue.includes('future work')) {
      tags.push('conclusion');
    }
    if (/\bexperimental results\b/.test(paragraphValue)) {
      tags.push('results');
    }
    if (/\bmethod\b/.test(paragraphValue) || /\bapproach\b/.test(paragraphValue)) {
      tags.push('method');
    }
    return tags.length ? Array.from(new Set(tags)) : undefined;
  }

  function estimateTextWidth(value) {
    if (!value) {
      return 4;
    }
    return Math.max(4, value.length * 2.4);
  }

  async function readFileAsText(file, onProgress) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.onabort = () => reject(new Error('Read aborted'));
      reader.onprogress = event => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          safeCall(onProgress, percent);
        }
      };
      reader.onload = () => resolve((reader.result || '').toString());
      reader.readAsText(file, 'utf-8');
    });
  }

  async function readFileAsArrayBuffer(file, onProgress) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.onabort = () => reject(new Error('Read aborted'));
      reader.onprogress = event => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          safeCall(onProgress, percent);
        }
      };
      reader.onload = () => resolve(reader.result);
      reader.readAsArrayBuffer(file);
    });
  }

  function ensurePdfJs() {
    if (global.pdfjsLib) {
      return Promise.resolve(global.pdfjsLib);
    }
    if (!pdfJsPromise) {
      pdfJsPromise = loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDF_JS_VERSION + '/build/pdf.min.js').then(() => {
        if (global.pdfjsLib && global.pdfjsLib.GlobalWorkerOptions) {
          global.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDF_JS_VERSION + '/build/pdf.worker.min.js';
        }
        return global.pdfjsLib;
      });
    }
    return pdfJsPromise;
  }

  function ensureMammoth() {
    if (global.mammoth && typeof global.mammoth.extractRawText === 'function') {
      return Promise.resolve(global.mammoth);
    }
    if (!mammothPromise) {
      mammothPromise = loadScript('https://cdn.jsdelivr.net/npm/mammoth@' + MAMMOTH_VERSION + '/mammoth.browser.min.js').then(() => global.mammoth);
    }
    return mammothPromise;
  }

  function ensureXlsx() {
    if (global.XLSX && typeof global.XLSX.read === 'function') {
      return Promise.resolve(global.XLSX);
    }
    if (!xlsxPromise) {
      xlsxPromise = loadScript('https://cdn.jsdelivr.net/npm/xlsx@' + XLSX_VERSION + '/dist/xlsx.full.min.js').then(() => global.XLSX);
    }
    return xlsxPromise;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-src="' + src + '"]');
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('Failed to load: ' + src)));
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.defer = true;
      script.dataset.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load script: ' + src));
      document.head.appendChild(script);
    });
  }

  function normaliseExtraction(extraction) {
    if (!extraction) {
      return {
        text: '',
        segments: [],
        meta: {}
      };
    }

    if (typeof extraction === 'string') {
      const text = normaliseText(extraction);
      return {
        text,
        segments: splitPlainTextSegments(text),
        meta: {}
      };
    }

    const rawText = typeof extraction.text === 'string' ? extraction.text : '';
    const text = normaliseText(rawText);
    const baseSegments = Array.isArray(extraction.segments) ? extraction.segments : [];
    const segments = normaliseSegments(baseSegments, text);
    const meta = extraction.meta && typeof extraction.meta === 'object' ? extraction.meta : {};

    if (!segments.length && text) {
      return {
        text,
        segments: splitPlainTextSegments(text),
        meta
      };
    }

    return { text, segments, meta };
  }

  function normaliseSegments(segments, fallbackText) {
    if (!Array.isArray(segments)) {
      return [];
    }
    const normalised = [];
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      if (!segment) {
        continue;
      }
      const text = normaliseText(segment.text);
      if (!text) {
        continue;
      }
      const meta = normalizeMeta(segment.meta);
      normalised.push({ text, meta });
    }
    if (!normalised.length && fallbackText) {
      return splitPlainTextSegments(fallbackText);
    }
    return normalised;
  }

  function normalizeMeta(meta) {
    if (!meta || typeof meta !== 'object') {
      return undefined;
    }
    const result = {};
    if (typeof meta.page === 'number') {
      result.page = meta.page;
    }
    if (Array.isArray(meta.pages)) {
      result.pages = meta.pages.filter(n => Number.isFinite(n)).map(n => Math.round(n));
    } else if (typeof meta.page === 'number') {
      result.pages = [meta.page];
    }
    if (typeof meta.section === 'string' && meta.section.trim()) {
      result.section = meta.section.trim();
    }
    if (Array.isArray(meta.tags) && meta.tags.length) {
      result.tags = Array.from(new Set(meta.tags.map(tag => String(tag || '').toLowerCase()).filter(Boolean)));
    }
    return Object.keys(result).length ? result : undefined;
  }

  function splitPlainTextSegments(text) {
    const clean = normaliseText(text);
    if (!clean) {
      return [];
    }
    return clean.split(/\n{2,}/).map(part => part.trim()).filter(Boolean).map(part => ({ text: part }));
  }

  function buildPreview(segments) {
    if (!Array.isArray(segments) || !segments.length) {
      return '';
    }
    const parts = [];
    let total = 0;
    for (let i = 0; i < segments.length; i += 1) {
      const text = segments[i] && segments[i].text ? segments[i].text : '';
      if (!text) {
        continue;
      }
      parts.push(text);
      total += text.length;
      if (total >= 240) {
        break;
      }
    }
    return parts.join('\n\n').slice(0, 240);
  }

  function buildChunks(segments, settings) {
    if (!Array.isArray(segments) || !segments.length) {
      return [];
    }

    const chunks = [];
    let buffer = [];
    let currentLength = 0;
    const maxLen = settings.maxChunkChars;
    const minLen = settings.minChunkChars;

    function flush(force) {
      if (!buffer.length) {
        return false;
      }
      const content = buffer.map(part => part.text).join('\n\n').trim();
      if (!content) {
        buffer = [];
        currentLength = 0;
        return false;
      }
      const meta = mergeChunkMeta(buffer);
      chunks.push(createChunk(content, chunks.length, meta));
      buffer = [];
      currentLength = 0;
      if (!force && chunks.length >= settings.maxChunks) {
        return true;
      }
      return false;
    }

    outer: for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      if (!segment || !segment.text) {
        continue;
      }
      const parts = splitSegment(segment, maxLen);
      for (let j = 0; j < parts.length; j += 1) {
        const part = parts[j];
        const partLength = part.text.length;
        if (currentLength + partLength + 2 > maxLen && currentLength >= minLen) {
          if (flush(false)) {
            break outer;
          }
        }
        buffer.push(part);
        currentLength += partLength + 2;
      }
    }

    flush(true);

    return chunks.slice(0, settings.maxChunks);
  }

  function splitSegment(segment, limit) {
    const text = segment.text || '';
    const meta = segment.meta;
    if (text.length <= limit) {
      return [{ text, meta }];
    }
    const parts = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + limit, text.length);
      parts.push({ text: text.slice(start, end), meta });
      start = end;
    }
    return parts;
  }

  function mergeChunkMeta(parts) {
    if (!Array.isArray(parts) || !parts.length) {
      return undefined;
    }
    const pages = new Set();
    const tags = new Set();
    let section = null;
    let minPage = null;

    parts.forEach(part => {
      const meta = part.meta;
      if (!meta) {
        return;
      }
      if (Array.isArray(meta.pages)) {
        meta.pages.forEach(page => {
          if (Number.isFinite(page)) {
            pages.add(Math.round(page));
            if (minPage == null || page < minPage) {
              minPage = page;
            }
          }
        });
      } else if (Number.isFinite(meta.page)) {
        const page = Math.round(meta.page);
        pages.add(page);
        if (minPage == null || page < minPage) {
          minPage = page;
        }
      }
      if (!section && typeof meta.section === 'string' && meta.section.trim()) {
        section = meta.section.trim();
      }
      if (Array.isArray(meta.tags)) {
        meta.tags.forEach(tag => {
          if (tag) {
            tags.add(String(tag).toLowerCase());
          }
        });
      }
    });

    if (!pages.size && !section && !tags.size) {
      return undefined;
    }
    const orderedPages = pages.size ? Array.from(pages).sort((a, b) => a - b) : undefined;
    const orderedTags = tags.size ? Array.from(tags) : undefined;
    return {
      pages: orderedPages,
      section,
      tags: orderedTags,
      firstPage: minPage != null ? Math.round(minPage) : undefined
    };
  }

  function createChunk(content, index, meta) {
    const tokens = tokenize(content);
    const termFreq = buildTermFrequency(tokens);
    return {
      id: 'chunk-' + index,
      content,
      tokenCount: tokens.length,
      termFreq,
      preview: content.slice(0, 160),
      source: meta,
      weight: computeChunkWeight(meta)
    };
  }

  function computeChunkWeight(meta) {
    if (!meta) {
      return 1;
    }
    let weight = 1;
    if (Array.isArray(meta.pages) && meta.pages.length) {
      const firstPage = meta.pages[0];
      if (firstPage <= 1) {
        weight += 0.35;
      } else if (firstPage <= 2) {
        weight += 0.2;
      } else if (firstPage <= 5) {
        weight += 0.1;
      }
    }
    if (Array.isArray(meta.tags)) {
      if (meta.tags.includes('abstract')) {
        weight += 0.3;
      }
      if (meta.tags.includes('introduction')) {
        weight += 0.15;
      }
      if (meta.tags.includes('conclusion')) {
        weight += 0.2;
      }
    }
    if (typeof meta.section === 'string') {
      const lower = meta.section.toLowerCase();
      if (lower.includes('abstract')) {
        weight += 0.25;
      } else if (lower.includes('introduction')) {
        weight += 0.1;
      } else if (lower.includes('conclusion') || lower.includes('discussion')) {
        weight += 0.15;
      }
    }
    return weight;
  }

  function buildStats(text, chunks, file, meta) {
    const tokens = tokenize(text);
    const stats = {
      wordCount: tokens.length,
      chunkCount: chunks.length,
      size: file && file.size ? file.size : 0
    };
    if (meta && Number.isFinite(meta.pageCount)) {
      stats.pageCount = meta.pageCount;
    } else {
      const pages = new Set();
      chunks.forEach(chunk => {
        if (!chunk || !chunk.source || !Array.isArray(chunk.source.pages)) {
          return;
        }
        chunk.source.pages.forEach(page => {
          if (Number.isFinite(page)) {
            pages.add(page);
          }
        });
      });
      if (pages.size) {
        stats.pageCount = pages.size;
      }
    }
    return stats;
  }

  function normaliseText(text) {
    return (text || '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
  }

  function tokenize(input) {
    const value = (input || '').toLowerCase();
    const matches = value.match(/[a-z0-9\u4e00-\u9fa5]+/g);
    if (!matches) {
      return [];
    }
    const tokens = [];
    for (let i = 0; i < matches.length; i += 1) {
      const token = matches[i];
      if (/^[\u4e00-\u9fa5]+$/.test(token)) {
        for (let j = 0; j < token.length; j += 1) {
          tokens.push(token[j]);
        }
      } else {
        tokens.push(token);
      }
    }
    return tokens;
  }

  function buildTermFrequency(tokens) {
    const freq = Object.create(null);
    tokens.forEach(token => {
      freq[token] = (freq[token] || 0) + 1;
    });
    return freq;
  }

  function safeCall(fn, arg) {
    if (typeof fn === 'function') {
      fn(arg);
    }
  }

  function safeStatus(hooks, status) {
    safeCall(hooks && hooks.onStatus, status);
  }

  function safeProgress(hooks, progress) {
    const safe = Math.max(0, Math.min(100, Math.round(progress)));
    safeCall(hooks && hooks.onProgress, safe);
  }

  global.ZhidaDocs = Object.assign({}, global.ZhidaDocs, {
    createPipeline
  });
})(window);
