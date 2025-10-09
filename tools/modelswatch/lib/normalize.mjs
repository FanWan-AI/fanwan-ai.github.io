import { buildSummaryShort } from './summary.mjs';
import { computePromptHash, stableStringify } from './hash.mjs';

function baseCanonicalId(source, id) {
  return `${source}:${id}`;
}

function buildSummaryFlags(summaryMeta) {
  return {
    needs_tri: summaryMeta.needs_tri,
    fast_first: summaryMeta.summary_method !== 'source',
    placeholder: summaryMeta.placeholder ?? false
  };
}

function normalizeCommon(raw, source, nowIso) {
  const canonical_id = baseCanonicalId(source, raw.id);
  const summaryMeta = buildSummaryShort(raw);
  const promptHash = computePromptHash({
    canonical_id,
    canonicalized_input: stableStringify({
      name: raw.name,
      tags: raw.tags || [],
      stats: raw.stats || {},
      summary_short: summaryMeta.summary_short
    })
  });

  return {
    canonical_id,
    origin_ids: [raw.id].filter(Boolean),
    source,
    name: raw.name || raw.id,
    url: raw.url,
    tags: raw.tags || [],
    summary_short: summaryMeta.summary_short,
    summary_flags: buildSummaryFlags(summaryMeta),
    summary_version: 0,
    status: summaryMeta.needs_tri ? 'pending' : 'passonce',
    promptHash,
    stats: raw.stats || {},
    metadata: {
      license: raw.license || null,
      lang: raw.lang || null,
      categories: raw.categories || null
    },
    created_at: nowIso,
    updated_at: nowIso
  };
}

export function normalizeGithubItem(raw, nowIso = new Date().toISOString()) {
  const doc = normalizeCommon(raw, 'github', nowIso);
  doc.owner = raw.id?.split('/')[0] || null;
  return doc;
}

export function normalizeHFItem(raw, nowIso = new Date().toISOString()) {
  const doc = normalizeCommon(raw, 'hf', nowIso);
  doc.repo_id = raw.id;
  return doc;
}
