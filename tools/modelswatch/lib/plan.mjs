import { promises as fs } from 'fs';
import { resolveDataPath } from './paths.mjs';

function readPlanSyncSafe() {
  return fs
    .readFile(resolveDataPath('fetch_priorities.json'), 'utf8')
    .then((text) => JSON.parse(text))
    .catch((err) => {
      if (err && err.code === 'ENOENT') {
        return null;
      }
      throw err;
    });
}

function unique(array) {
  return Array.from(new Set(array.filter(Boolean)));
}

function extractGithubTargets(focusCategories = []) {
  const slugs = [];
  for (const entry of focusCategories) {
    if (!entry || !Array.isArray(entry.top_examples)) continue;
    for (const example of entry.top_examples) {
      const canonical = example?.canonical_id || '';
      if (!canonical.startsWith('github:')) continue;
      const slug = canonical.slice('github:'.length);
      if (slug && slug.includes('/')) {
        slugs.push(slug.trim());
      }
    }
  }
  return unique(slugs);
}

function extractHFTargets(focusTasks = []) {
  const ids = [];
  for (const entry of focusTasks) {
    if (!entry || !Array.isArray(entry.top_examples)) continue;
    for (const example of entry.top_examples) {
      const canonical = example?.canonical_id || '';
      if (!canonical.startsWith('huggingface:')) continue;
      const modelId = canonical.slice('huggingface:'.length);
      if (modelId) {
        ids.push(modelId.trim());
      }
    }
  }
  return unique(ids);
}

export async function loadFetchPlan() {
  const plan = await readPlanSyncSafe();
  if (!plan || typeof plan !== 'object') return null;
  if (!plan.source_recommendations) return null;
  return plan;
}

export function computeFetchAdjustments(plan) {
  const empty = {
    meta: {
      planAvailable: false,
      generatedAt: null,
      notes: []
    },
    github: {
      focusKeys: [],
      limitMultiplier: 1,
      targetedRepos: [],
      suggestedActions: [],
      deficitCount: 0
    },
    huggingface: {
      focusKeys: [],
      limitMultiplier: 1,
      targetedModels: [],
      suggestedActions: [],
      deficitCount: 0
    }
  };
  if (!plan) return empty;

  const githubFocus = Array.isArray(plan?.source_recommendations?.github?.focus_categories)
    ? plan.source_recommendations.github.focus_categories
    : [];
  const huggingfaceFocus = Array.isArray(plan?.source_recommendations?.huggingface?.focus_tasks)
    ? plan.source_recommendations.huggingface.focus_tasks
    : [];

  const githubActions = Array.isArray(plan?.source_recommendations?.github?.suggested_actions)
    ? plan.source_recommendations.github.suggested_actions
    : [];
  const huggingfaceActions = Array.isArray(plan?.source_recommendations?.huggingface?.suggested_actions)
    ? plan.source_recommendations.huggingface.suggested_actions
    : [];

  const githubMultiplier = githubFocus.length > 0 || githubActions.includes('increase_github_fetch_window')
    ? Math.min(1 + githubFocus.length * 0.2 + (githubActions.includes('increase_github_fetch_window') ? 0.5 : 0), 3)
    : 1;
  const hfMultiplier = huggingfaceFocus.length > 0 || huggingfaceActions.includes('increase_huggingface_fetch_window')
    ? Math.min(1 + huggingfaceFocus.length * 0.2 + (huggingfaceActions.includes('increase_huggingface_fetch_window') ? 0.5 : 0), 3)
    : 1;

  return {
    meta: {
      planAvailable: true,
      generatedAt: plan.generated_at || null,
      notes: Array.isArray(plan.notes) ? plan.notes : []
    },
    github: {
      focusKeys: githubFocus.map((entry) => entry?.key).filter(Boolean),
      limitMultiplier: githubMultiplier,
      targetedRepos: extractGithubTargets(githubFocus),
      suggestedActions: githubActions,
      deficitCount: githubFocus.length
    },
    huggingface: {
      focusKeys: huggingfaceFocus.map((entry) => entry?.key).filter(Boolean),
      limitMultiplier: hfMultiplier,
      targetedModels: extractHFTargets(huggingfaceFocus),
      suggestedActions: huggingfaceActions,
      deficitCount: huggingfaceFocus.length
    }
  };
}

export function summarizeAdjustments(adjustments) {
  if (!adjustments || !adjustments.meta?.planAvailable) {
    return null;
  }
  return {
    generated_at: adjustments.meta.generatedAt,
    github: {
      deficit: adjustments.github.deficitCount,
      limit_multiplier: adjustments.github.limitMultiplier,
      focus: adjustments.github.focusKeys,
      targeted: adjustments.github.targetedRepos.length
    },
    huggingface: {
      deficit: adjustments.huggingface.deficitCount,
      limit_multiplier: adjustments.huggingface.limitMultiplier,
      focus: adjustments.huggingface.focusKeys,
      targeted: adjustments.huggingface.targetedModels.length
    },
    notes: adjustments.meta.notes.slice(0, 6)
  };
}
