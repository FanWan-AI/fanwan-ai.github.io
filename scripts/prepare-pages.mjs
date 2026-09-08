import { cp, mkdir, lstat, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Explicit public surface: no environment files, generators, drafts or retired apps.
const root = process.cwd();
const output = path.join(root, '.tmp', 'pages-upload');
const roots = new Set(['index.html', 'about.html', 'ai-lab.html', 'publications.html', 'blog.html', 'contact.html', '404.html', 'pdf-viewer.html', 'subscribe.html', 'google7c8e2fda9782847b.html', 'style.css', 'script.js', 'lang.js', 'lang-preload.js', 'sw.js', 'secure-post.js', 'portfolio.json', 'manifest.webmanifest', 'robots.txt', 'sitemap.xml', 'rss.xml', 'rss-en.xml', 'rss-es.xml', 'CNAME']);
const clientTools = ['tools/ai_radar/ai-radar.js', 'tools/ai_zhida/site-assistant.js', 'tools/ai_zhida/doc_pipeline.js', 'tools/ai_zhida/zhida.js'];
const excluded = /(?:^|\/)(?:[^/]*\.disabled|drafts|logs|node_modules|__pycache__|daily_temp_data|previous_data|tri_cache\.archive)(?:\/|$)|\.(?:draft|log)\.|^assets\/(?:audio\/daily(?:\/|$)|test-og\.svg$)|^data\/ai\/(?:daily-academy|wealth|trade|games)(?:\/|$)/;
let files = 0, bytes = 0;
async function copy(relative) {
  if (excluded.test(relative) || relative.split('/').some(p => p.startsWith('.'))) return;
  const source = path.join(root, relative);
  let info;
  try { info = await lstat(source); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  if (info.isSymbolicLink()) throw new Error(`Public symlink rejected: ${relative}`);
  if (info.isFile()) {
    const target = path.join(output, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { dereference: false });
    files++; bytes += info.size;
  }
}
await mkdir(path.dirname(output), { recursive: true });
// Refuse a stale staging directory instead of deleting or mixing deployment artifacts.
await mkdir(output);
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split('\0').filter(Boolean);
for (const entry of tracked) if (roots.has(entry) || /^(assets|blog|data|lab)\//.test(entry) || clientTools.includes(entry)) await copy(entry);
for (const entry of ['lab/ai-startup.html', 'assets/ai-startup/startup.js', 'assets/ai-startup/startup.css', 'data/ai/startup/opportunities/latest.json', 'data/ai/startup/cases/index.json', 'publications.html', 'lang.js', 'portfolio.json']) await stat(path.join(output, entry));
await writeFile(path.join(output, '.nojekyll'), '');
console.log(`Pages: ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MiB`);
if (bytes > 900 * 1024 * 1024) throw new Error('Pages upload exceeds the 900 MiB safety budget');
