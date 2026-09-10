import Parser from 'rss-parser';
import { createHash } from 'node:crypto';
import { fetchText } from '../startup/lib/http.mjs';
import { arxivId, normalized, requireThat, validateSource, beijingDate, isDate } from '../../assets/paperhub/contract.mjs';

export const abstractHash = text => createHash('sha256').update(text, 'utf8').digest('hex');
export async function parseArxiv(xml, { now = new Date(), maxCandidates = 12, date = beijingDate(now), lookbackDays = 7 } = {}) {
  requireThat(typeof xml === 'string' && xml.includes('http://www.w3.org/2005/Atom') && !/<!DOCTYPE|<!ENTITY/iu.test(xml), 'ARXIV_RESPONSE');
  const parser = new Parser({ customFields: { item: [['summary', 'rawAbstract'], ['published', 'publishedAt'], ['updated', 'updatedAt']] } });
  let feed;
  try { feed = await parser.parseString(xml); } catch { requireThat(false, 'ARXIV_XML'); }
  requireThat(Array.isArray(feed.items) && feed.items.length <= maxCandidates, 'ARXIV_COUNT');
  requireThat(isDate(date), 'INVALID_DATE');
  const floor = Date.parse(`${date}T00:00:00+08:00`) - (lookbackDays - 1) * 86400000;
  const ceiling = Date.parse(`${date}T23:59:59+08:00`);
  const candidates = []; const seen = new Set();
  for (const item of feed.items) {
    const id = arxivId(item.id);
    requireThat(id, 'ARXIV_IDENTITY');
    const source = { provider: 'arxiv', id, title: normalized(item.title || ''), abstract: normalized(item.rawAbstract || ''),
      published_at: item.publishedAt, updated_at: item.updatedAt, retrieved_at: new Date(now).toISOString(),
      abstract_sha256: abstractHash(normalized(item.rawAbstract || '')), evidence_scope: 'abstract' };
    validateSource(source);
    // A simple-query fallback may include older results. Never widen the requested window.
    if (Date.parse(source.published_at) < floor || Date.parse(source.published_at) > ceiling) continue;
    const canonical = id.replace(/v\d+$/u, '');
    if (!seen.has(canonical)) { candidates.push(source); seen.add(canonical); }
  }
  return candidates;
}
export async function fetchCandidates(options = {}, { fetchImpl = fetchText, sleep = ms => new Promise(r => setTimeout(r, ms)), log = () => {} } = {}) {
  const { date = beijingDate(), maxCandidates = 12, lookbackDays = 7 } = options;
  requireThat(isDate(date) && Number.isInteger(maxCandidates) && maxCandidates >= 1 && maxCandidates <= 16
    && Number.isInteger(lookbackDays) && lookbackDays >= 1 && lookbackDays <= 14, 'SOURCE_OPTIONS');
  const start = new Date(Date.parse(`${date}T00:00:00+08:00`) - (lookbackDays - 1) * 86400000);
  // Use a stable, cache-friendly first-party query and filter dates locally. A complex
  // date-range query is not necessary to obtain complete recent abstracts.
  // Stop on HTTP failure (including rate limiting), rather than trying URL variants.
  const queries = [
    'cat:cs.AI',
    ['cat:cs.CL', 'cat:cs.CV', 'cat:cs.LG', 'cat:cs.RO', 'cat:cs.MA'][Math.floor(start.getTime() / 86400000) % 5]
  ];
  const failures = [];
  for (let index = 0; index < queries.length; index++) {
    if (index) await sleep(3100); // Respect arXiv's request spacing, including on fallback.
    const url = `https://export.arxiv.org/api/query?search_query=${queries[index]}&sortBy=submittedDate&sortOrder=descending&max_results=${maxCandidates}`;
    try {
      const xml = await fetchImpl(url, { retries: 0, timeoutMs: 25000, maxBytes: 1000000,
        headers: { 'user-agent': 'fanwan-ai-paperhub/2.0 (+https://fanwan-ai.github.io/lab/ai-paperhub.html)' } });
      const result = await parseArxiv(xml, { ...options, date, maxCandidates, lookbackDays });
      if (result.length) { log(`source=arxiv:${queries[index]} candidates=${result.length}`); return result; }
      failures.push('EMPTY_WINDOW');
    } catch (error) {
      log(`source-attempt=${index + 1} result=unavailable`);
      throw error;
    }
    log(`source-attempt=${index + 1} result=${failures.at(-1)}`);
  }
  requireThat(false, failures.every(code => code === 'EMPTY_WINDOW') ? 'NO_PAPERS_IN_WINDOW' : 'SOURCES_UNAVAILABLE');
}
