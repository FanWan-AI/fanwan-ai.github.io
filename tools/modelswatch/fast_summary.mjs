import { buildSummaryShort } from './lib/summary.mjs';
import { computePromptHash } from './lib/hash.mjs';

export function fastSummary(it, options = {}) {
  const { summary_short, summary_method } = buildSummaryShort(it, options);
  return {
    en: summary_short.en,
    zh: summary_short.zh,
    es: summary_short.es,
    method: summary_method,
    short: summary_short.en || summary_short.zh || ''
  };
}

export function promptHash(it) {
  const canonicalId = it.canonical_id || it.id || it.repo_id || it.model_id;
  const payload = {
    canonical_id: canonicalId,
    canonicalized_input: JSON.stringify({
      name: it.name,
      summary_short: it.summary_short || {
        zh: it.summary_zh || '',
        en: it.summary_en || ''
      },
      tags: it.tags || [],
      stats: it.stats || {}
    })
  };
  return computePromptHash(payload);
}
