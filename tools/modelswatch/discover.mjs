// Small deterministic discovery budget. No taxonomy fan-out, pagination or paid calls.
import { fetchText } from '../startup/lib/http.mjs';
import { normalizeGithubItem, normalizeHFItem } from './lib/normalize.mjs';
import { primaryUrl } from '../../assets/modelswatch/content.mjs';
import { boundedInt } from './lib/release.mjs';

export async function discover({ perSource = 6, fetcher = fetchText, date = new Date().toISOString().slice(0,10) } = {}) {
  perSource = boundedInt(perSource, 6, 20);
  if (!perSource) throw new Error('Discovery per-source budget must be positive');
  const ghHeaders = { Accept: 'application/vnd.github+json' }, hfHeaders = {};
  if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) ghHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN || process.env.GH_TOKEN}`;
  if (process.env.HF_TOKEN) hfHeaders.Authorization = `Bearer ${process.env.HF_TOKEN}`;
  const topics = ['llm', 'ai-agents', 'llm-inference', 'rag', 'llm-evaluation', 'fine-tuning'];
  const day = Math.floor(Date.parse(date + 'T00:00:00Z') / 86400000);
  const topic = topics[((day % topics.length) + topics.length) % topics.length];
  const query = encodeURIComponent(`topic:${topic} archived:false fork:false stars:>20`);
  const urls = [
    `https://api.github.com/search/repositories?q=${query}&sort=updated&order=desc&per_page=${perSource}`,
    `https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=${perSource}&full=true&config=true`
  ];
  const responses = await Promise.all(urls.map((url, index) => fetcher(url, {
    headers: index ? hfHeaders : ghHeaders, timeoutMs: 25000, maxBytes: 1000000, retries: 1
  })));
  const [gh, hf] = responses.map(raw => JSON.parse(typeof raw === 'string' ? raw : raw.text));
  if (!Array.isArray(gh.items) || !Array.isArray(hf)) throw new Error('Invalid discovery response');
  const now = new Date().toISOString();
  const github = gh.items.slice(0, perSource).filter(r => !r.archived && !r.fork).map(r => normalizeGithubItem({
    id: r.full_name, name: r.name || r.full_name, url: `https://github.com/${r.full_name}`, tags: r.topics || [],
    description: r.description || '', updated_at: r.pushed_at, license: r.license?.spdx_id || null,
    stats: { stars: r.stargazers_count, forks: r.forks_count }
  }, now)).filter(primaryUrl);
  const huggingface = hf.slice(0, perSource).filter(m => !m.private).map(m => normalizeHFItem({
    id: m.id || m.modelId, name: m.id || m.modelId, url: `https://huggingface.co/${m.id || m.modelId}`,
    tags: m.tags || [], description: m.description || '', updated_at: m.lastModified,
    license: m.cardData?.license || null, stats: { downloads_total: m.downloads, likes_total: m.likes },
    metadata: { pipeline_tag: m.pipeline_tag || '', base_model: m.cardData?.base_model || m.config?.base_model,
      base_model_relation: m.cardData?.base_model_relation, cardData: m.cardData || {} }
  }, now)).filter(primaryUrl);
  if (!github.length || !huggingface.length) throw new Error('Discovery produced an empty source; retain the previous release');
  return { github, huggingface };
}
