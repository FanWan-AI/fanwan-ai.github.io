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

    function process(descriptor, hooks) {
      if (!descriptor || !descriptor.file) {
        safeCall(hooks && hooks.onError, new Error('Missing file reference'));
        return Promise.resolve();
      }
      const file = descriptor.file;
      const ext = (descriptor.type || descriptor.file.type || '').toLowerCase();
      const id = descriptor.id;

      return (async () => {
        try {
          safeStatus(hooks, 'reading');
          safeProgress(hooks, 2);
          const text = await extractText(file, ext, progress => {
            safeProgress(hooks, Math.min(60, Math.max(5, Math.round(progress * 0.6))));
          });
          safeStatus(hooks, 'processing');
          safeProgress(hooks, 70);
          const normalized = normaliseText(text);
          const chunks = buildChunks(normalized, settings);
          const stats = buildStats(normalized, chunks, file);
          safeProgress(hooks, 100);
          safeStatus(hooks, 'ready');
          safeCall(hooks && hooks.onComplete, {
            chunks,
            stats,
            text: normalized,
            preview: normalized.slice(0, 240)
          });
        } catch (error) {
          safeStatus(hooks, 'error');
          safeCall(hooks && hooks.onError, error instanceof Error ? error : new Error(String(error)));
        }
      })();
    }

    return {
      process
    };
  }

  function extractText(file, ext, onProgress) {
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
    if (simpleExt === 'txt' || simpleExt === 'md' || simpleExt === 'csv') {
      return readFileAsText(file, onProgress);
    }
    return readFileAsText(file, onProgress);
  }

  function extractPdfText(file, onProgress) {
    return readFileAsArrayBuffer(file, progress => {
      safeCall(onProgress, progress);
    }).then(async buffer => {
      const pdfjs = await ensurePdfJs();
      const uint8 = new Uint8Array(buffer);
      const pdf = await pdfjs.getDocument({ data: uint8 }).promise;
      let combined = '';
      for (let page = 1; page <= pdf.numPages; page += 1) {
        const pageData = await pdf.getPage(page);
        const content = await pageData.getTextContent();
        const text = (content.items || []).map(item => item.str || '').join(' ');
        combined += text + '\n\n';
        safeCall(onProgress, 60 + Math.round((page / pdf.numPages) * 40));
      }
      return combined;
    });
  }

  function extractDocxText(file, onProgress) {
    return readFileAsArrayBuffer(file, progress => {
      safeCall(onProgress, progress);
    }).then(async buffer => {
      const mammoth = await ensureMammoth();
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      safeCall(onProgress, 90);
      return (result && result.value) || '';
    });
  }

  function extractXlsxText(file, onProgress) {
    return readFileAsArrayBuffer(file, progress => {
      safeCall(onProgress, progress);
    }).then(async buffer => {
      const XLSX = await ensureXlsx();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheets = workbook.SheetNames || [];
      const parts = [];
      sheets.forEach(name => {
        const sheet = workbook.Sheets[name];
        if (!sheet) return;
        const csv = XLSX.utils.sheet_to_csv(sheet, { FS: '\t', RS: '\n' });
        if (csv && csv.trim()) {
          parts.push('Sheet: ' + name + '\n' + csv);
        }
      });
      safeCall(onProgress, 95);
      return parts.join('\n\n');
    });
  }

  function readFileAsText(file, onProgress) {
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

  function readFileAsArrayBuffer(file, onProgress) {
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

  function normaliseText(text) {
    return (text || '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
  }

  function buildChunks(text, settings) {
    if (!text) return [];
    const paragraphs = text.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
    const chunks = [];
    let buffer = [];
    let currentLength = 0;
    const maxLen = settings.maxChunkChars;
    const minLen = settings.minChunkChars;

    function flush(force) {
      if (!buffer.length) return;
      const content = buffer.join('\n\n').trim();
      if (!content) {
        buffer = [];
        currentLength = 0;
        return;
      }
      chunks.push(createChunk(content, chunks.length));
      buffer = [];
      currentLength = 0;
      if (!force && chunks.length >= settings.maxChunks) {
        return true;
      }
      return false;
    }

    for (let i = 0; i < paragraphs.length; i += 1) {
      const paragraph = paragraphs[i];
      if (!paragraph) continue;
      const parts = splitParagraph(paragraph, maxLen);
      for (let j = 0; j < parts.length; j += 1) {
        const segment = parts[j];
        if (currentLength + segment.length + 2 > maxLen && currentLength >= minLen) {
          if (flush()) {
            return chunks;
          }
        }
        buffer.push(segment);
        currentLength += segment.length + 2;
      }
    }
    flush(true);
    return chunks.slice(0, settings.maxChunks);
  }

  function splitParagraph(text, limit) {
    if (text.length <= limit) {
      return [text];
    }
    const segments = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + limit, text.length);
      segments.push(text.slice(start, end));
      start = end;
    }
    return segments;
  }

  function createChunk(content, index) {
    const tokens = tokenize(content);
    const termFreq = buildTermFrequency(tokens);
    return {
      id: 'chunk-' + index,
      content,
      tokenCount: tokens.length,
      termFreq,
      preview: content.slice(0, 160)
    };
  }

  function buildStats(text, chunks, file) {
    const tokens = tokenize(text);
    return {
      wordCount: tokens.length,
      chunkCount: chunks.length,
      size: file && file.size ? file.size : 0
    };
  }

  function tokenize(input) {
    const value = (input || '').toLowerCase();
    const matches = value.match(/[a-z0-9\u4e00-\u9fa5]+/g);
    if (!matches) return [];
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
