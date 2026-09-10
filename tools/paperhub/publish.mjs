import { mkdir, readFile, writeFile, rename, rm, open } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateEdition, parseDates, requireThat, codeUrls, VERSION } from '../../assets/paperhub/contract.mjs';

export function buildEdition(reviews, candidates, { date, now = new Date(), maxItems = 5, log = () => {} }) {
  requireThat(reviews && Object.keys(reviews).length === 1 && Array.isArray(reviews.items), 'REVIEW_RESPONSE');
  requireThat(reviews.items.length > 0 && reviews.items.length <= maxItems, 'REVIEW_COUNT');
  const items = []; const seen = new Set();
  for (const review of reviews.items) {
    const source = candidates.find(candidate => candidate.id === review?.id);
    try {
      requireThat(source, 'UNKNOWN_PAPER');
      validateReview(review, source);
      const canonical = source.id.replace(/v\d+$/u, '');
      requireThat(!seen.has(canonical), 'DUPLICATE_PAPER'); seen.add(canonical);
      items.push({ review, source });
    } catch (error) {
      const code = /^[A-Z0-9_]+$/u.test(error.code || '') ? error.code : 'INVALID_REVIEW';
      // Only trusted source IDs and machine-readable codes; never log provider payloads.
      log(`rejected id=${source?.id || 'unknown'} reason=${code}`);
    }
  }
  requireThat(items.length > 0, 'NO_VALID_REVIEWS');
  return validateEdition({ schema_version: VERSION, date, generated_at: new Date(now).toISOString(), items: items.map(({review: r, source}) => ({
    id: `arxiv:${source.id}`, type: 'paper', title_i18n: { zh: r.title_zh, en: source.title }, summary_i18n: { zh: r.summary_zh },
    ...Object.fromEntries(['why_it_matters', 'problem', 'novelty', 'evidence', 'limitations', 'borrow_experiment', 'tags'].map(k => [k, r[k]])),
    links: { paper: `https://arxiv.org/abs/${source.id}`, pdf: `https://arxiv.org/pdf/${source.id}`, code: codeUrls(source.abstract)[0] || null }, source
  })) });
}
import { validateReview } from '../../assets/paperhub/contract.mjs';

async function optionalRead(file) {
  try { return await readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// All bytes are validated and staged first. index.json is the last atomic rename / reader commit point.
// Ordinary write failures roll back every touched file; abrupt process death can leave an extra archive,
// but never truncates the previously readable latest edition. Git publication remains all-or-nothing.
export async function publishEdition(edition, outputDir, { beforeCommit = async () => {} } = {}) {
  validateEdition(edition);
  await mkdir(outputDir, { recursive: true });
  const lockPath = path.join(outputDir, '.paperhub-publish.lock');
  const lock = await open(lockPath, 'wx');
  const staged = []; const changed = [];
  try {
    const oldDates = await optionalRead(path.join(outputDir, 'dates.json'));
    const dates = parseDates([edition.date, ...oldDates ? parseDates(JSON.parse(oldDates.toString('utf8'))) : []]);
    const oldLatest = await optionalRead(path.join(outputDir, 'index.json'));
    if (oldLatest) {
      const previous = JSON.parse(oldLatest.toString('utf8'));
      requireThat(!previous.date || previous.date <= edition.date, 'OLDER_THAN_LATEST');
    }
    const json = JSON.stringify(edition, null, 2) + '\n';
    const files = [[`${edition.date}.json`, json], ['dates.json', JSON.stringify(dates, null, 2) + '\n'], ['index.json', json]];
    for (const [name, body] of files) {
      const target = path.join(outputDir, name);
      const temp = `${target}.${randomUUID()}.tmp`;
      staged.push({ target, temp, previous: await optionalRead(target) });
      await writeFile(temp, body, { flag: 'wx' });
    }
    await beforeCommit();
    for (const file of staged) { await rename(file.temp, file.target); changed.push(file); }
    return { date: edition.date, items: edition.items.length, files: files.map(([name]) => name) };
  } catch (error) {
    for (const file of changed.reverse()) {
      if (file.previous === null) await rm(file.target, { force: true });
      else {
        const recovery = `${file.target}.${randomUUID()}.tmp`;
        await writeFile(recovery, file.previous); await rename(recovery, file.target);
      }
    }
    throw error;
  } finally {
    for (const file of staged) await rm(file.temp, { force: true });
    await lock.close(); await rm(lockPath, { force: true });
  }
}
