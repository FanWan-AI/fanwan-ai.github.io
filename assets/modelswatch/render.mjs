import { escapeHtml as esc, safeUrl, primaryUrl, localizedSummary, chineseSummary } from './content.mjs';

const labels = {
  zh: { tasks: '适用任务', reason: '为什么关注', limits: '采用前须知', trial: '建议验证', detail: '边界与验证', source: '发布者资料', gh: '查看 README', hf: '阅读模型卡', untranslated: '中文解读', missing: '该归档条目尚无完整中文解读，可阅读发布者资料。', unknown: '资料未说明运行资源或商用条件，采用前请核查发布者文档与许可证。', counts: '关注信号，不代表能力评测', scope: '依据发布者 README 节选；未进行本站实测。' },
  en: { tasks: 'Useful for', reason: 'Why it matters', limits: 'Before adopting', trial: 'Suggested check', detail: 'Limits & validation', source: 'Publisher sources', gh: 'Read README', hf: 'Read model card', untranslated: 'Chinese analysis', missing: 'No complete analysis is available for this archived entry. Consult the publisher documentation.', unknown: 'Runtime resources and commercial-use conditions have not been verified. Check the documentation and license.', counts: 'Interest signals, not performance scores', scope: 'Based on publisher README excerpts; not independently benchmarked here.' },
  es: { tasks: 'Tareas adecuadas', reason: 'Por qué importa', limits: 'Antes de adoptarlo', trial: 'Validación sugerida', detail: 'Límites y validación', source: 'Fuentes del autor', gh: 'Leer README', hf: 'Leer ficha del modelo', untranslated: 'Análisis en chino', missing: 'Esta entrada de archivo no tiene un análisis completo. Consulte la documentación del autor.', unknown: 'Recursos y condiciones de uso comercial sin verificar. Consulte la documentación y la licencia.', counts: 'Interés, no evaluación de capacidades', scope: 'Basado en extractos del README del autor; sin evaluación propia.' }
};
const metric = n => Number.isFinite(Number(n)) && Number(n) > 0 ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n)) : '';

export function renderCard(item, lang = 'zh') {
  const t = labels[lang] || labels.zh, gh = item.source === 'github';
  const url = primaryUrl(item);
  const summary = localizedSummary(item, lang);
  const insight = item.insights || {}, bodyLang = summary.lang;
  const hasBody = !!summary.text;
  const cn = labels.zh; // Current enriched insights are explicitly Chinese, never mislabeled as translated.
  const sections = ['tasks', 'reason'].filter(k => insight[k]).map(k => `<div class="mw-reading-point" lang="zh"><strong>${cn[k]}</strong><p>${esc(insight[k])}</p></div>`).join('');
  const known = ['limits', 'trial'].filter(k => insight[k]).map(k => `<div class="mw-reading-point" lang="zh"><strong>${cn[k]}</strong><p>${esc(insight[k])}</p></div>`).join('');
  const e = item.evidence;
  const cited = new Set(Object.values(e?.claims || {}).flat());
  const refs = (e?.excerpts || []).filter(x => x?.text && cited.has(x.id));
  const refsHtml = refs.length ? `<details class="mw-evidence"><summary>${esc(t.source)}</summary><p class="mw-source-scope">${esc(t.scope)}</p>${refs.map(x => `<p><span>${esc(x.id)}</span> ${esc(x.text)}</p>`).join('')}</details>` : '';
  const stats = item.stats || {};
  const counts = gh ? [['Stars', stats.stars_total ?? stats.stars], ['Forks', stats.forks_total ?? stats.forks]]
    : [[lang === 'zh' ? '下载热度' : 'Downloads', stats.downloads_total ?? stats.downloads], ['Likes', stats.likes_total ?? stats.likes]];
  const metrics = counts.filter(([, n]) => metric(n)).map(([key, n]) => `<span>${esc(key)} <b>${esc(metric(n))}</b></span>`).join('');
  return `<article class="card mw-card mw-card-entry ${gh ? 'mw-card--gh' : 'mw-card--hf'}" data-id="${esc(item.id || item.canonical_id)}" data-source="${gh ? 'github' : 'hf'}" data-task-keys="${esc((item.task_keys || item.tasks || []).join(' '))}">
    <header class="mw-card-head"><h4 class="mw-title">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(item.name || item.id)}</a>` : esc(item.name || item.id)}</h4></header>
    ${bodyLang !== lang && hasBody ? `<small class="mw-language-note">${esc(t.untranslated)}</small>` : ''}
    <p class="mw-card-summary" lang="${hasBody ? bodyLang : lang}">${esc(summary.text || t.missing)}</p>
    ${sections ? `<div class="mw-reading-points">${sections}</div>` : ''}
    <details class="mw-reading-details"><summary>${esc(t.detail)}</summary>${known || `<p>${esc(t.unknown)}</p>`}${refsHtml}</details>
    ${metrics ? `<div class="mw-reading-metrics" title="${esc(t.counts)}">${metrics}</div>` : ''}
    <div class="mw-card-actions">${url ? `<a class="btn primary small mw-card-visit" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(gh ? t.gh : t.hf)}</a>` : ''}</div>
  </article>`;
}

// Legacy archive remains navigable, but empty/English-only records never enter daily selection.
export function readableDailyItems(payload) {
  return (payload?.items || []).filter(item => primaryUrl(item) && chineseSummary(item));
}
export function validateSnapshot(snapshot, expectedDate) {
  if (!snapshot || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.date || '') || (expectedDate && snapshot.date !== expectedDate)) return false;
  return ['github', 'huggingface'].every(source => {
    const payload = snapshot[source];
    return payload?.date === snapshot.date && payload.source === source && Array.isArray(payload.items) &&
      payload.items.length > 0 && readableDailyItems(payload).length === payload.items.length;
  });
}
