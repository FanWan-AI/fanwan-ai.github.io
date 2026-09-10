import { parseDates, isDate, paperUrl, completeText } from './contract.mjs';
import { UI, escapeHTML as e, textIn, readableEdition, renderPaper, matches, link } from './view.mjs';

const root = document.querySelector('.paperhub');
const $ = id => document.getElementById(id);
const base = new URL('../../data/ai/scholarpush/', import.meta.url);
const state = { edition: null, dates: [], tag: '', request: 0, tasks: null, taskCache: new Map(), editions: new Map(), tab: 'highlights' };
const lang = () => UI[document.documentElement.lang] ? document.documentElement.lang : 'zh';
const t = () => UI[lang()];
let failedDate = null;

async function json(relative) {
  const url = new URL(relative, base);
  if (url.origin !== location.origin || !url.pathname.startsWith(base.pathname)) throw new Error('PATH');
  const response = await fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('FETCH');
  const text = await response.text();
  if (text.length > 2000000) throw new Error('SIZE');
  return JSON.parse(text);
}
function status(target, message, retry) {
  const node = $(target); node.replaceChildren(document.createTextNode(message));
  if (retry) { const button = document.createElement('button'); button.textContent = t().retry; button.addEventListener('click', retry); node.append(button); }
}
function dateControls() {
  const date = state.edition?.date; const index = state.dates.indexOf(date);
  $('highlight-date').value = date || '';
  $('highlight-date').max = state.dates[0] || '';
  $('highlight-date').min = state.dates.at(-1) || '';
  $('highlight-prev').disabled = index < 0 || index >= state.dates.length - 1;
  $('highlight-next').disabled = index <= 0;
}
function render() {
  const edition = state.edition;
  dateControls();
  $('edition-heading').textContent = edition ? `${t().edition} · ${edition.date} · ${edition.items.length} ${t().papers}` : t().unknownEdition;
  if (!edition) return;
  $('edition-note').textContent = [edition.legacy ? t().legacy : '', !edition.legacy && lang() !== 'zh' ? t().onlyChinese : ''].filter(Boolean).join(' ');
  const tags = [...new Set(edition.items.flatMap(i => Array.isArray(i.tags) ? i.tags.filter(x => typeof x === 'string') : []))];
  $('highlight-chips').replaceChildren();
  for (const tag of tags) {
    const button = document.createElement('button'); button.textContent = tag;
    button.setAttribute('aria-pressed', String(state.tag === tag));
    button.addEventListener('click', () => { state.tag = state.tag === tag ? '' : tag; render(); }); $('highlight-chips').append(button);
  }
  const items = edition.items.filter(i => matches(i, $('highlight-search').value.trim(), state.tag));
  $('highlight-list').innerHTML = items.map((item, index) => renderPaper(item, { lang: lang(), legacy: edition.legacy, number: index + 1 })).join('');
  if (failedDate === null) status('highlight-status', !items.length ? edition.items.length ? t().filtered : t().empty : '');
}
async function loadEdition(date = null) {
  if (date !== null && !isDate(date)) { dateControls(); return; }
  const request = ++state.request; failedDate = null;
  status('highlight-status', t().loading); $('highlight-list').setAttribute('aria-busy', 'true');
  try {
    const edition = date && state.editions.has(date) ? state.editions.get(date) : readableEdition(await json(date ? `${date}.json` : 'index.json'));
    if (date && edition.date !== date) throw new Error('DATE_MISMATCH');
    if (request !== state.request) return;
    state.edition = edition; state.editions.set(edition.date, edition);
    if (state.editions.size > 12) state.editions.delete(state.editions.keys().next().value);
    state.dates = [...new Set([edition.date, ...state.dates])].sort().reverse(); state.tag = '';
    render();
  } catch {
    if (request !== state.request) return;
    failedDate = date || 'latest'; dateControls();
    status('highlight-status', t().error, () => loadEdition(date));
  } finally { if (request === state.request) $('highlight-list').removeAttribute('aria-busy'); }
}
function usableTask(task) { return task && /^[a-z0-9_-]{1,80}$/u.test(task.slug || '') && task.display && typeof task.display === 'object'; }
function renderTaskItems(data) {
  if (!Array.isArray(data?.items) || data.items.length > 200) throw new Error('TASK_DATA');
  return `<div class="ph-trajectory">${data.items.filter(item => paperUrl(item?.links?.paper)).map(item => {
    const summary = item.summary_i18n?.[lang()];
    const readable = completeText(summary, 24, 16000) && (lang() !== 'zh' || /\p{Script=Han}/u.test(summary));
    return `<article class="ph-classic-item"><div class="ph-task-date">${e(item.year || '')} · ${e(t()[item.phase] || t().record)}</div><h4>${e(textIn(item.title_i18n, lang(), item.title || ''))}</h4><p>${e(readable ? summary : t().classicSummary)}</p><div class="paper-links">${link(item.links.paper, t().paper, 'paper')}${link(item.links.pdf, t().pdf, 'paper')}${link(item.links.code, t().code)}</div></article>`;
  }).join('')}</div>`;
}
async function taskBody(task, body) {
  body.textContent = t().loading;
  try {
    const data = state.taskCache.get(task.slug) || await json(`milestones/tasks/${task.slug}.json`);
    const markup = renderTaskItems(data); state.taskCache.set(task.slug, data); body.innerHTML = markup;
  } catch {
    body.replaceChildren(document.createTextNode(t().taskError));
    const retry = document.createElement('button'); retry.textContent = t().retry;
    retry.addEventListener('click', () => taskBody(task, body)); body.append(retry);
  }
}
function renderTasks() {
  if (!state.tasks) return;
  const query = $('milestone-search').value.trim().toLocaleLowerCase();
  const tasks = state.tasks.filter(task => [...Object.values(task.display), ...Object.values(task.overview || {}), ...(task.accepted_tags || [])].join(' ').toLocaleLowerCase().includes(query));
  $('milestone-list').replaceChildren(); status('milestone-status', tasks.length ? '' : t().noTasks);
  for (const task of tasks) {
    const card = document.createElement('details'); card.className = 'ph-task';
    card.innerHTML = `<summary><h3>${e(textIn(task.display, lang()))}</h3></summary><p>${e(textIn(task.overview, lang()))}</p><span class="ph-task-date">${e(t().updated)} ${e(typeof task.updated_at === 'string' ? task.updated_at.slice(0,10) : '—')}</span><div class="ph-task-body"></div>`;
    let started = false;
    card.addEventListener('toggle', () => { if (card.open && !started) { started = true; taskBody(task, card.querySelector('.ph-task-body')); } });
    $('milestone-list').append(card);
  }
}
async function loadTasks() {
  if (state.tasks) { renderTasks(); return; }
  status('milestone-status', t().loading);
  try {
    const data = await json('milestones/index.json');
    if (!Array.isArray(data.tasks) || data.tasks.length > 150) throw new Error('TASK_INDEX');
    state.tasks = data.tasks.filter(usableTask); renderTasks();
  } catch { status('milestone-status', t().taskError, loadTasks); }
}
function activate(tab, updateHash = true) {
  state.tab = tab;
  for (const value of ['highlights', 'milestones']) {
    const selected = tab === value; $(`panel-${value}`).hidden = !selected;
    $(`tab-${value}`).setAttribute('aria-selected', String(selected)); $(`tab-${value}`).tabIndex = selected ? 0 : -1;
  }
  if (updateHash) history.replaceState(null, '', `${location.pathname}${location.search}#${tab}`);
  if (tab === 'milestones') loadTasks();
}
function translate() {
  $('tab-highlights').textContent = t().tab; $('tab-milestones').textContent = t().classics;
  for (const [id, key] of [['edition-schedule', 'schedule'], ['archive-note', 'archive'], ['classic-note', 'classicNote'], ['search-label', 'search'], ['task-search-label', 'taskSearch'], ['highlight-latest', 'latest']]) $(id).textContent = t()[key];
  $('highlight-search').placeholder = t().search; $('milestone-search').placeholder = t().taskSearch;
  for (const [id,key] of [['highlight-prev','prev'],['highlight-next','next'],['highlight-date','date']]) $(id).setAttribute('aria-label', t()[key]);
  render(); if (state.tasks) renderTasks();
  if (failedDate) status('highlight-status', t().error, () => loadEdition(failedDate === 'latest' ? null : failedDate));
}
for (const tab of root.querySelectorAll('[role="tab"]')) {
  tab.addEventListener('click', () => activate(tab.dataset.tab));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault(); const target = event.key === 'Home' ? 'highlights' : event.key === 'End' ? 'milestones' : tab.dataset.tab === 'highlights' ? 'milestones' : 'highlights';
    activate(target); $(`tab-${target}`).focus();
  });
}
$('highlight-search').addEventListener('input', render);
$('milestone-search').addEventListener('input', renderTasks);
$('highlight-date').addEventListener('change', event => loadEdition(event.target.value));
$('highlight-prev').addEventListener('click', () => loadEdition(state.dates[state.dates.indexOf(state.edition?.date) + 1]));
$('highlight-next').addEventListener('click', () => loadEdition(state.dates[state.dates.indexOf(state.edition?.date) - 1]));
$('highlight-latest').addEventListener('click', () => loadEdition());
window.addEventListener('language-changed', translate);
window.addEventListener('hashchange', () => activate(location.hash === '#milestones' ? 'milestones' : 'highlights', false));
const params = new URLSearchParams(location.search);
if (params.has('q')) { $('highlight-search').value = params.get('q'); $('milestone-search').value = params.get('q'); }
translate(); activate(location.hash === '#milestones' ? 'milestones' : 'highlights', false);
loadEdition(isDate(params.get('date')) ? params.get('date') : null);
// Independent and lightweight: no archive, tag-alias, or task fetch blocks the current edition.
json('dates.json').then(data => { state.dates = [...new Set([...parseDates(data), ...(state.edition ? [state.edition.date] : [])])].sort().reverse(); dateControls(); }).catch(() => {});
