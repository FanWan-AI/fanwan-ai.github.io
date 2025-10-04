#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..');
const TASKS_DIR = path.join(ROOT, 'data/ai/scholarpush/milestones/tasks');
const CATEGORIES_PATH = path.join(ROOT, 'data/ai/ai_categories.json');
const TASK_ALIAS_PATH = path.join(ROOT, 'data/ai/modelswatch/task_aliases.json');

const DEFAULT_LATEST_WINDOW_DAYS = 45;

const TASK_DOMAIN_TAGS = {
  agent: ['Agent', 'Tool Use', 'LLM'],
  asr: ['Speech', 'ASR', 'Recognition'],
  avsr: ['Speech', 'Multimodal', 'AVSR'],
  'code-generation': ['LLM', 'Code Generation', 'Developer Tools'],
  compression: ['Optimization', 'Model Compression', 'Efficiency'],
  'contrastive-learning': ['Representation Learning', 'Contrastive', 'Retrieval'],
  'data-synthesis': ['NLP', 'Data Augmentation', 'Synthesis'],
  dialog: ['NLP', 'Dialogue', 'Conversational AI'],
  diffusion: ['Multimodal', 'Generative Models', 'Diffusion'],
  gnn: ['Graph', 'GNN', 'Representation Learning'],
  'image-classification': ['Computer Vision', 'Classification', 'Perception'],
  'instruction-tuning': ['LLM', 'Alignment', 'Instruction Tuning'],
  'knowledge-graph': ['Knowledge Graph', 'Graph', 'Reasoning'],
  'language-modeling': ['LLM', 'Pretraining', 'Foundation Model'],
  'medical-imaging': ['Computer Vision', 'Medical Imaging', 'Healthcare'],
  multilingual: ['NLP', 'Multilingual', 'Cross-Lingual'],
  'multimodal-vision': ['Multimodal', 'Vision-Language', 'VQA'],
  multimodal: ['Multimodal', 'Vision-Language', 'LLM'],
  peft: ['LLM', 'Fine-Tuning', 'Efficiency'],
  nerf: ['3D', 'Computer Vision', 'NeRF'],
  'pretraining-finetuning': ['LLM', 'Pretraining', 'NLP'],
  recommendation: ['Recommendation', 'Personalization', 'Ranking'],
  'object-detection': ['Computer Vision', 'Detection', 'Perception'],
  'speaker-representation': ['Speech', 'Speaker Recognition', 'Audio'],
  segmentation: ['Computer Vision', 'Segmentation', 'Perception'],
  'super-resolution': ['Computer Vision', 'Super-Resolution', 'Enhancement'],
  'text-to-video': ['Multimodal', 'Generative Models', 'Video'],
  tts: ['Speech', 'TTS', 'Synthesis'],
  'vector-search': ['Information Retrieval', 'Vector Search', 'ANN'],
  'video-understanding': ['Computer Vision', 'Video', 'Action Recognition'],
  slu: ['Speech', 'SLU', 'Dialogue']
};

const SLUG_TO_TASK_KEY = {
  agent: null,
  asr: 'asr',
  avsr: 'avsr',
  'code-generation': 'code_generation',
  compression: 'model_compression',
  'contrastive-learning': 'contrastive_learning',
  'data-synthesis': 'nlp_data_synthesis',
  dialog: 'dialogue_system_optimization',
  diffusion: 'text_to_image',
  gnn: 'gnn',
  'image-classification': 'image_classification',
  'instruction-tuning': 'instruction_tuning',
  'knowledge-graph': 'kg_reasoning',
  'language-modeling': 'llm_pretraining',
  'medical-imaging': 'medical_image_processing',
  multilingual: 'multilingual_processing',
  'multimodal-vision': 'vqa',
  multimodal: 'multimodal_understanding_generation',
  peft: 'lora_adapter',
  nerf: 'nerf',
  'pretraining-finetuning': 'llm_pretraining',
  recommendation: 'general_recommendation',
  'object-detection': 'object_detection',
  segmentation: 'semantic_segmentation',
  'speaker-representation': null,
  'super-resolution': 'super_resolution',
  'text-to-video': 'text_to_video',
  tts: 'tts',
  'vector-search': 'vector_retrieval',
  'video-understanding': null,
  slu: 'slu'
};

const DISPLAY_OVERRIDES = {
  agent: {
    zh: 'Agent（智能体）',
    en: 'LLM Agent Systems',
    es: 'Sistemas de agentes LLM'
  },
  'speaker-representation': {
    zh: '说话人表示（Speaker Embedding）',
    en: 'Speaker Representation & Diarization',
    es: 'Representación del Hablante y Diarización'
  },
  'vector-search': {
    zh: '向量检索（ANN）',
    en: 'Vector Search (Approximate Nearest Neighbour)',
    es: 'Búsqueda Vectorial (Vecino Más Cercano Aproximado)'
  },
  'video-understanding': {
    zh: '视频理解与动作识别',
    en: 'Video Understanding & Action Recognition',
    es: 'Comprensión de Video y Reconocimiento de Acciones'
  }
};

const OVERVIEW_OVERRIDES = {
  agent: {
    zh: 'LLM Agent 系统通过规划、记忆与工具调用，让大模型可以在开放环境中执行复杂目标。从 ReAct 框架到自治反思代理，研究逐步完善感知—决策—执行闭环，并探索多工具协同与长期记忆以迈向可靠部署。',
    en: 'LLM agent systems combine planning, memory and tool use so language models can pursue complex goals in open environments. Work now spans self-improving tool chains, long-term memory and embodied interaction, pushing agents toward reliable real-world deployment.',
    es: 'Los sistemas de agentes LLM combinan planificación, memoria y uso de herramientas para que los modelos lingüísticos persigan objetivos complejos en entornos abiertos. La investigación cubre cadenas de herramientas auto-mejorables, memoria a largo plazo e interacción incorporada, acercando a los agentes a un despliegue fiable en el mundo real.'
  }
};

const PHASE_IMPORTANCE = {
  origin: 92,
  milestone: 86,
  bridge: 80,
  frontier: 82,
  survey: 74
};

const PHASE_DEFAULT_RATIONALE = {
  origin: '奠定该任务的基础范式或框架。',
  milestone: '推动该任务能力或效率的关键进展。',
  bridge: '连接阶段性成果与后续主流方案的重要过渡工作。',
  frontier: '代表当前最前沿的探索方向。',
  survey: '系统总结该领域的研究脉络与挑战。'
};

const REFRESH_MODE = process.argv.includes('--refresh');

async function loadJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function buildTaskDisplayMap(categories) {
  const map = new Map();

  function visitCategory(node) {
    if (!node) return;
    if (Array.isArray(node.tasks)) {
      for (const task of node.tasks) {
        map.set(task.key, {
          zh: task.zh || task.en || task.key,
          en: task.en || task.zh || task.key,
          es: task.es || task.en || task.key
        });
      }
    }
    if (Array.isArray(node.subcategories)) {
      for (const sub of node.subcategories) {
        visitCategory(sub);
      }
    }
  }

  if (Array.isArray(categories)) {
    for (const category of categories) {
      visitCategory(category);
    }
  }

  return map;
}

function toTitleCase(value) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function truncateSentences(text, maxSentences = 2) {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const sentencePattern = /[^。！？!?]*[。！？!?]|[^。！？!?]*\.(?=\s|$)|[^。！？!?]+$/g;
  const matches = normalized.match(sentencePattern) || [normalized];
  const sentences = matches.map((segment) => segment.trim()).filter(Boolean);
  const selected = sentences.slice(0, maxSentences);
  return selected.join(' ').trim();
}

function buildOverview(slug, core) {
  if (OVERVIEW_OVERRIDES[slug]) {
    return OVERVIEW_OVERRIDES[slug];
  }
  const fallback = { zh: '', en: '', es: '' };
  if (!core) return fallback;
  const basis = core.earliest || (Array.isArray(core.milestone) && core.milestone[0]);
  if (!basis) return fallback;
  return {
    zh: truncateSentences(basis.summary_zh || basis.summary_en || ''),
    en: truncateSentences(basis.summary_en || basis.summary_zh || ''),
    es: truncateSentences(basis.summary_es || basis.summary_en || '')
  };
}

function normalizeItemsForRefresh(slug, items) {
  if (!Array.isArray(items)) return [];
  const domainTags = TASK_DOMAIN_TAGS[slug] ? [...TASK_DOMAIN_TAGS[slug]] : null;
  return items.map((item) => ({
    ...item,
    tags: domainTags ? [...domainTags] : Array.isArray(item.tags) && item.tags.length ? item.tags : [toTitleCase(slug)]
  }));
}

function buildOverviewFromItems(slug, raw, items) {
  if (OVERVIEW_OVERRIDES[slug]) {
    return OVERVIEW_OVERRIDES[slug];
  }
  const source = items.find((entry) => entry.phase === 'origin') || items[0];
  if (!source) {
    return {
      zh: truncateSentences(raw?.overview?.zh || raw?.overview?.en || ''),
      en: truncateSentences(raw?.overview?.en || raw?.overview?.zh || ''),
      es: truncateSentences(raw?.overview?.es || raw?.overview?.en || '')
    };
  }
  const summary = source.summary_i18n || {};
  return {
    zh: truncateSentences(summary.zh || summary.en || ''),
    en: truncateSentences(summary.en || summary.zh || ''),
    es: truncateSentences(summary.es || summary.en || '')
  };
}

function ensureDisplay(slug, displayMap) {
  if (DISPLAY_OVERRIDES[slug]) {
    return DISPLAY_OVERRIDES[slug];
  }
  const taskKey = SLUG_TO_TASK_KEY[slug] || slug.replace(/-/g, '_');
  if (taskKey && displayMap.has(taskKey)) {
    return displayMap.get(taskKey);
  }
  if (displayMap.has(slug)) {
    return displayMap.get(slug);
  }
  if (taskKey && displayMap.has(taskKey.toLowerCase())) {
    return displayMap.get(taskKey.toLowerCase());
  }
  const title = toTitleCase(slug);
  return { zh: title, en: title, es: title };
}

function normalizeSummary(source) {
  return {
    zh: source.summary_zh || source.summary_en || '',
    en: source.summary_en || source.summary_zh || '',
    es: source.summary_es || source.summary_en || ''
  };
}

function normalizeTitle(source) {
  const title = source.title || '';
  return {
    zh: title,
    en: title,
    es: title
  };
}

function derivePdfLink(paperUrl) {
  if (!paperUrl) return null;
  if (/arxiv\.org\/abs\//i.test(paperUrl)) {
    return paperUrl.replace(/\/abs\//i, '/pdf/') + '.pdf';
  }
  if (/arxiv\.org\/pdf\//i.test(paperUrl)) {
    return paperUrl.endsWith('.pdf') ? paperUrl : `${paperUrl}.pdf`;
  }
  return null;
}

function estimateImportance(phase) {
  return PHASE_IMPORTANCE[phase] ?? 75;
}

function defaultRationale(phase, source) {
  if (source.why_transition) return source.why_transition;
  return PHASE_DEFAULT_RATIONALE[phase] || '';
}

function slugify(value) {
  return (
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'entry'
  );
}

function buildItemId(slug, phase, source) {
  const year = source.year ? String(source.year) : 'na';
  const base = source.id ? slugify(source.id) : slugify(source.title);
  return `${slug}:${year}:${phase}:${base}`;
}

function toItem(slug, phase, source) {
  if (!source) return null;
  const summary = normalizeSummary(source);
  const title_i18n = normalizeTitle(source);
  const links = {
    paper: source.paper_url || null,
    code: Array.isArray(source.code) && source.code.length > 0 ? source.code[0] : null,
    project: source.project_url || null,
    pdf: derivePdfLink(source.paper_url)
  };
  const ts = source.year ? `${String(source.year).padStart(4, '0')}-01-01T00:00:00Z` : null;

  return {
    id: buildItemId(slug, phase, source),
    phase,
    year: source.year || null,
    venue: source.venue || null,
    title: source.title || '',
    title_i18n,
    summary_i18n: summary,
    rationale: defaultRationale(phase, source),
    tags: TASK_DOMAIN_TAGS[slug] ? [...TASK_DOMAIN_TAGS[slug]] : [toTitleCase(slug)],
    links,
    importance_score: estimateImportance(phase),
    lineage: {
      prev: [],
      next: []
    },
    auto_injected: false,
    ts
  };
}

function collectItems(slug, data) {
  const items = [];
  const { core, transitions } = data;
  if (core?.earliest) {
    const origin = toItem(slug, 'origin', core.earliest);
    if (origin) items.push(origin);
  }
  if (Array.isArray(transitions)) {
    for (const entry of transitions) {
      const bridge = toItem(slug, 'bridge', entry);
      if (bridge) items.push(bridge);
    }
  }
  if (Array.isArray(core?.milestone)) {
    for (const entry of core.milestone) {
      const milestone = toItem(slug, 'milestone', entry);
      if (milestone) items.push(milestone);
    }
  }
  if (Array.isArray(core?.frontier)) {
    for (const entry of core.frontier) {
      const frontier = toItem(slug, 'frontier', entry);
      if (frontier) items.push(frontier);
    }
  }
  if (Array.isArray(core?.survey)) {
    for (const entry of core.survey) {
      const survey = toItem(slug, 'survey', entry);
      if (survey) items.push(survey);
    }
  }
  return items;
}

function rebuildTaskPayload(slug, raw, displayMap) {
  const items = collectItems(slug, raw);
  const overview = buildOverview(slug, raw.core);
  const display = ensureDisplay(slug, displayMap);
  const updatedAt = raw.last_reviewed ? `${raw.last_reviewed}T00:00:00Z` : null;
  const lineageHint = Boolean(raw?.core?.frontier?.length || raw?.transitions?.length);

  return {
    task: slug,
    display,
    overview,
    lineage_graph_hint: lineageHint,
    updated_at: updatedAt,
    items,
    latest_window_days: raw.latest_window_days ?? DEFAULT_LATEST_WINDOW_DAYS
  };
}

async function migrateTaskFile(filePath, displayMap) {
  const raw = await loadJson(filePath);
  const slug = raw.task || raw.slug || path.basename(filePath, '.json');

  if (Array.isArray(raw.items)) {
    if (!REFRESH_MODE) {
      return false;
    }
    const items = normalizeItemsForRefresh(slug, raw.items);
    const overview = buildOverviewFromItems(slug, raw, items);
    const display = ensureDisplay(slug, displayMap);
  const lineageHint = raw.lineage_graph_hint ?? (items.some((entry) => ['bridge', 'frontier'].includes(entry.phase)) || false);
    const payload = {
      ...raw,
      task: slug,
      display,
      overview,
      lineage_graph_hint: Boolean(lineageHint),
      updated_at: raw.updated_at || null,
      items,
      latest_window_days: raw.latest_window_days ?? DEFAULT_LATEST_WINDOW_DAYS
    };
    delete payload.slug;
    const serializedRefresh = `${JSON.stringify(payload, null, 2)}\n`;
    await fs.writeFile(filePath, serializedRefresh, 'utf8');
    return true;
  }

  const payload = rebuildTaskPayload(slug, raw, displayMap);
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  await fs.writeFile(filePath, serialized, 'utf8');
  return true;
}

async function main() {
  const categories = await loadJson(CATEGORIES_PATH);
  const displayMap = buildTaskDisplayMap(categories.categories || []);
  // warm up alias map to keep lint happy (future use)
  await loadJson(TASK_ALIAS_PATH).catch(() => null);

  const entries = await fs.readdir(TASKS_DIR, { withFileTypes: true });
  const jsonFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json'));
  const results = [];

  for (const entry of jsonFiles) {
    const filePath = path.join(TASKS_DIR, entry.name);
    const migrated = await migrateTaskFile(filePath, displayMap);
    results.push({ file: entry.name, migrated });
  }

  const migratedCount = results.filter((item) => item.migrated).length;
  console.log(`Schema migration complete. Updated ${migratedCount}/${results.length} milestone files.`);
  const skipped = results.filter((item) => !item.migrated).map((item) => item.file);
  if (skipped.length) {
    console.log(`Skipped files already in new format: ${skipped.join(', ')}`);
  }
}

main().catch((error) => {
  console.error('[migrate-milestone-schema] failed:', error);
  process.exit(1);
});
