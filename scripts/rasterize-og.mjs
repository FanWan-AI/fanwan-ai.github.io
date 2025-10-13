// Rasterize existing SVG blog covers into 1200x630 PNGs using sharp as a Puppeteer-free fallback.
// Usage: node scripts/rasterize-og.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

// scripts/ -> project root (robust on Windows)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const assetsDir = path.join(root, 'assets', 'blog');

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

async function fetchBinary(url){
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode && res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function loadFontBase64(kind){
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

async function ensureFontData(){
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
    console.warn('[rasterize-og] Warning: failed to embed font data:', err?.message || err);
    cachedFontData = null;
  }
  return cachedFontData;
}

async function ensureDir(p){ await fs.mkdir(p, { recursive: true }); }

async function rasterizeWithPuppeteer(svg, outPng){
  try {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });

    // Inline fonts into a small <style> so Chromium has glyphs available
    const fontData = await ensureFontData();
    let fontCss = '';
    if (fontData) {
      fontCss = `@font-face{font-family: 'NotoSansSCEmbedded'; src: url('${fontData.regular}') format('truetype'); font-weight: 400;}
@font-face{font-family: 'NotoSansSCEmbedded'; src: url('${fontData.bold}') format('truetype'); font-weight: 700;}
svg{font-family: 'NotoSansSCEmbedded', 'Noto Sans SC', system-ui, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft Yahei', sans-serif;}`;
    }

    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss}body{margin:0}</style></head><body>${svg}</body></html>`;
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.evaluate(() => (window.document.fonts ? window.document.fonts.ready : Promise.resolve()));
  await ensureDir(path.dirname(outPng));
  await page.screenshot({ path: outPng, type: 'png' });
    await browser.close();
    return true;
  } catch (e) {
    // Puppeteer not available or failed
    console.warn('[rasterize-og] Puppeteer render failed:', e?.message || e);
    return false;
  }
}

async function rasterizeWithSharp(svgInput, outPng){
  try {
    const sharp = (await import('sharp')).default;
    const input = Buffer.from(svgInput, 'utf8');
  await ensureDir(path.dirname(outPng));
  const image = sharp(input, { density: 300 });
    await image.resize(1200, 630, { fit: 'cover' }).png({ quality: 90 }).toFile(outPng);
    return true;
  } catch (e) {
    console.warn('[rasterize-og] Sharp render failed:', e?.message || e);
    return false;
  }
}

async function rasterizeOne(svgPath, pngPath){
  try {
    const svg = await fs.readFile(svgPath, 'utf8');
    // Try Puppeteer first (ensures webfont support). If unavailable, fall back to sharp.
    const ok = await rasterizeWithPuppeteer(svg, pngPath);
    if (ok) { console.log('Rendered (puppeteer) ', path.relative(root, svgPath), '->', path.relative(root, pngPath)); return; }
    const ok2 = await rasterizeWithSharp(svg, pngPath);
    if (ok2) { console.log('Rasterized (sharp) ', path.relative(root, svgPath), '->', path.relative(root, pngPath)); return; }
    console.warn('Failed to rasterize', svgPath);
  } catch (e) {
    console.error('rasterizeOne error', e?.message || e);
  }
}

async function main(){
  let names = [];
  try { names = await fs.readdir(assetsDir); } catch {}
  console.log('[rasterize-og] found', names.length, 'files in', assetsDir);
  for (const name of names){
    console.log('[rasterize-og] checking', name);
    if (!/\.svg$/i.test(name)) continue;
    const svgPath = path.join(assetsDir, name);
    const pngPath = svgPath.replace(/\.svg$/i, '.png');
    try {
      await fs.access(pngPath); // already exists
      console.log('[rasterize-og] png already exists, skipping', path.relative(root, pngPath));
      continue;
    } catch {}
    await rasterizeOne(svgPath, pngPath);
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
