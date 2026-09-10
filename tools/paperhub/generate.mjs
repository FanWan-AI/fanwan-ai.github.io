import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { beijingDate, isDate, requireThat, validateSource } from '../../assets/paperhub/contract.mjs';
import { fetchCandidates, abstractHash } from './sources.mjs';
import { requestReviews } from './llm.mjs';
import { buildEdition, publishEdition } from './publish.mjs';

export function configuration(env = process.env, args = process.argv.slice(2)) {
  requireThat(args.every(a => ['--publish', '--help'].includes(a)), 'UNKNOWN_ARGUMENT');
  const integer = (name, fallback, min, max) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    requireThat(Number.isInteger(value) && value >= min && value <= max, `CONFIG_${name}`); return value;
  };
  const date = env.PAPERHUB_DATE || beijingDate();
  requireThat(isDate(date) && date <= beijingDate(), 'INVALID_DATE');
  return { date, maxItems: integer('PAPERHUB_MAX_ITEMS', 5, 1, 5), maxCandidates: integer('PAPERHUB_MAX_CANDIDATES', 8, 1, 16),
    lookbackDays: integer('PAPERHUB_LOOKBACK_DAYS', 7, 1, 14), maxCalls: integer('PAPERHUB_MAX_CALLS', 1, 1, 2),
    maxInputChars: integer('PAPERHUB_MAX_INPUT_CHARS', 50000, 2000, 80000), timeoutMs: integer('PAPERHUB_TIMEOUT_MS', 180000, 1000, 300000),
    maxOutputTokens: integer('PAPERHUB_MAX_OUTPUT_TOKENS', 12000, 1000, 20000),
    outputDir: path.resolve(env.PAPERHUB_OUTPUT_DIR || '.tmp/paperhub-preview'), publish: args.includes('--publish') };
}

export async function generate(options, { source = fetchCandidates, review = requestReviews, publish = publishEdition, log = () => {}, now = () => new Date() } = {}) {
  const candidates = await source(options, { log });
  requireThat(Array.isArray(candidates) && candidates.length > 0 && candidates.length <= options.maxCandidates, 'NO_CANDIDATES');
  for (const item of candidates) { validateSource(item); requireThat(abstractHash(item.abstract) === item.abstract_sha256, 'SOURCE_HASH_MISMATCH'); }
  log(`phase=review candidates=${candidates.length} max_items=${options.maxItems}`);
  const reviews = await review(candidates, options);
  const edition = buildEdition(reviews, candidates, { ...options, now: now(), log });
  log(`phase=validated date=${edition.date} papers=${edition.items.length}`);
  if (options.publish) await publish(edition, options.outputDir);
  return edition;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.includes('--help')) {
    console.log('node tools/paperhub/generate.mjs [--publish]\nReads DEEPSEEK_API_KEY from environment. Default: validates only; --publish writes to PAPERHUB_OUTPUT_DIR (default .tmp/paperhub-preview). PAPERHUB_MAX_ITEMS=1..5, MAX_CANDIDATES=1..16, LOOKBACK_DAYS=1..14, MAX_CALLS=1..2. Prefix each option with PAPERHUB_.');
  } else {
    try {
      const options = configuration();
      await generate(options, { log: message => console.log(`[paperhub] ${message}`) });
      console.log(`[paperhub] ${options.publish ? 'published' : 'validated; no files written'}`);
    } catch (error) {
      const code = /^[A-Z0-9_]+$/u.test(error.code || '') ? error.code : 'GENERATION_FAILED';
      console.error(`[paperhub] ${code}; previous edition preserved.`); process.exitCode = 1;
    }
  }
}
