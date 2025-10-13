// Node script to generate OG images from the SVG template by injecting text and exporting PNG via headless Chromium (using Puppeteer if available) or fallback to writing modified SVG.
// Usage (with Node 18+):
//   node scripts/generate-og.mjs "Title" "Subtitle" out/og.png
// If Puppeteer is not installed, will output SVG instead of PNG.

import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';

const [,, titleArg = 'Title', descArg = 'Subtitle', outPathArg = 'out/og.png'] = process.argv;
const root = path.resolve(new URL('..', import.meta.url).pathname);
const templatePath = path.join(root, 'assets', 'og-template.svg');

const fontSources = {
  regular: {
    file: path.join(root, 'assets', 'fonts', 'NotoSansSC-Regular.ttf'),
    url: 'https://fonts.gstatic.com/s/notosanssc/v39/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYw.ttf',
    mime: 'font/ttf',
  },
  bold: {
    file: path.join(root, 'assets', 'fonts', 'NotoSansSC-Bold.ttf'),
    url: 'https://fonts.gstatic.com/s/notosanssc/v39/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaGzjCnYw.ttf',
    mime: 'font/ttf',
  },
};

let cachedFontData = null;

async function fetchBinary(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        if (res.statusCode && res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

async function loadFontBase64(kind) {
  const { file, url } = fontSources[kind];
  try {
    const buf = await fs.readFile(file);
    return buf.toString('base64');
  } catch {}
  const data = await fetchBinary(url);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
  return data.toString('base64');
}

async function ensureFontData() {
  if (cachedFontData) return cachedFontData;
  try {
    const [regular, bold] = await Promise.all([
      loadFontBase64('regular'),
      loadFontBase64('bold'),
    ]);
    cachedFontData = {
      regular: `data:${fontSources.regular.mime};base64,${regular}`,
      bold: `data:${fontSources.bold.mime};base64,${bold}`,
    };
  } catch (err) {
    console.warn('[og] Warning: failed to embed font data:', err?.message || err);
    cachedFontData = null;
  }
  return cachedFontData;
}

async function embedFonts(svg) {
  const fontData = await ensureFontData();
  if (!fontData) return svg;
  return svg
    .replace(/__OG_FONT_REGULAR__/g, fontData.regular)
    .replace(/__OG_FONT_BOLD__/g, fontData.bold);
}

async function ensureDir(p) {
  await fs.mkdir(path.dirname(p), { recursive: true });
}

let svg = await fs.readFile(templatePath, 'utf8');
svg = await embedFonts(svg);
const filled = svg
  .replace(/<text id="og-title"[\s\S]*?<\/text>/i,
    `<text id="og-title" x="96" y="180" font-size="56" font-weight="700">${titleArg}</text>`)
  .replace(/<text id="og-desc"[\s\S]*?<\/text>/i,
    `<text id="og-desc" x="96" y="270" font-size="28" opacity="0.95">${descArg}</text>`);

await ensureDir(outPathArg);

let wrotePng = false;
try {
  const puppeteer = await import('puppeteer').catch(() => null);
  if (puppeteer && puppeteer.default) {
    const browser = await puppeteer.default.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">${filled}</body></html>`;
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.evaluate(() => (window.document.fonts ? window.document.fonts.ready : Promise.resolve()));
    await ensureDir(outPathArg);
    await page.screenshot({ path: outPathArg, type: 'png' });
    await browser.close();
    wrotePng = true;
    console.log('OG PNG generated at', outPathArg);
  }
} catch (e) {
  // ignore and fall back
}

if (!wrotePng) {
  const outSvg = outPathArg.replace(/\.png$/i, '.svg');
  await fs.writeFile(outSvg, filled, 'utf8');
  console.log('Puppeteer not available. Wrote SVG at', outSvg);
}
