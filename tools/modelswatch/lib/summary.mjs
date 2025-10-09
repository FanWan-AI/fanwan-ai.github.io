const MAX_SHORT_LENGTH = 280;

function truncate(text, max = MAX_SHORT_LENGTH) {
  if (!text) return '';
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

function pickPrimarySummary(item) {
  const candidates = [
    item?.summary_short?.zh,
    item?.summary_short?.en,
    item?.summary,
    item?.summary_zh,
    item?.summary_en,
    item?.description,
    item?.card_desc
  ].filter(Boolean);
  return candidates.length ? candidates[0] : '';
}

export function buildSummaryShort(item, options = {}) {
  const maxLength = options.maxLength ?? MAX_SHORT_LENGTH;
  const baseZh = truncate(item?.summary_zh || pickPrimarySummary(item) || '', maxLength);
  const baseEn = truncate(item?.summary_en || pickPrimarySummary(item) || '', maxLength);
  const baseEs = truncate(item?.summary_es || '', maxLength);

  const zh = baseZh || baseEn;
  const en = baseEn || baseZh;
  const es = baseEs;

  const method = item?.summary_zh || item?.summary_en ? 'source' : 'fast';
  const needsTri = method !== 'source' || (zh && zh.length < 90) || (en && en.length < 90);

  return {
    summary_short: {
      zh: zh || '',
      en: en || '',
      es: es || ''
    },
    summary_method: method,
    needs_tri: needsTri,
    placeholder: method !== 'source'
  };
}
