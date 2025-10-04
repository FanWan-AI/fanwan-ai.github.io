#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadTaskFiles(tasksDir) {
  const entries = await fs.readdir(tasksDir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json'));
  const tasks = [];
  for (const file of files) {
    const filePath = path.join(tasksDir, file.name);
    const raw = await fs.readFile(filePath, 'utf8');
    try {
      const data = JSON.parse(raw);
      const slug = path.basename(file.name, '.json');
      const taskId = data.task || data.slug || slug;
      tasks.push({ slug, taskId, data });
    } catch (error) {
      throw new Error(`Failed to parse ${file.name}: ${error.message}`);
    }
  }
  return tasks;
}

function summarizeTask(task) {
  const { data, slug, taskId } = task;
  const items = Array.isArray(data.items) ? data.items : [];
  const counts = {
    total: items.length,
    frontier: items.filter((it) => it.phase === 'frontier').length,
    auto_injected: items.filter((it) => it.auto_injected).length,
    survey: items.filter((it) => it.phase === 'survey').length,
    bridge: items.filter((it) => it.phase === 'bridge').length,
    milestone: items.filter((it) => it.phase === 'milestone').length
  };
  const latestYear = items.reduce((max, it) => Math.max(max, Number(it.year) || 0), 0);
  const acceptedTags = Array.from(
    new Set(
      items
        .flatMap((it) => Array.isArray(it.tags) ? it.tags : [])
        .map((tag) => String(tag || '').trim())
        .filter((tag) => tag && tag.toLowerCase() !== 'n/a')
    )
  ).sort((a, b) => a.localeCompare(b, 'en'));

  return {
    task: taskId,
    slug,
    display: data.display || { zh: slug, en: slug, es: slug },
    overview: data.overview || {
      zh: '',
      en: '',
      es: ''
    },
    updated_at: data.updated_at || null,
    lineage_graph_hint: Boolean(data.lineage_graph_hint),
    latest_year: latestYear || null,
    latest_window_days: data.latest_window_days ?? null,
    counts,
    accepted_tags: acceptedTags,
    sample_titles: items.slice(0, 3).map((it) => it.title).filter(Boolean)
  };
}

async function main() {
  const tasksDir = path.resolve(__dirname, '../data/ai/scholarpush/milestones/tasks');
  const outputPath = path.resolve(__dirname, '../data/ai/scholarpush/milestones/index.json');

  const tasks = await loadTaskFiles(tasksDir);
  const summaries = tasks.map(summarizeTask).sort((a, b) => a.task.localeCompare(b.task));

  const payload = {
    version: 'v1',
    generated_at: new Date().toISOString(),
    task_count: summaries.length,
    tasks: summaries
  };

  const json = `${JSON.stringify(payload, null, 2)}\n`;
  await fs.writeFile(outputPath, json, 'utf8');
  console.log(`Milestone index written to ${path.relative(process.cwd(), outputPath)}`);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('[build-milestones-index] failed:', error);
    process.exit(1);
  });
