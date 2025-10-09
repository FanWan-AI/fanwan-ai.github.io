# ModelSwatch v6 quickstart

## 分阶段执行（推荐）

1. **Stage A · Fetch & Drafts**  
  `node tools/modelswatch/daily.mjs`
2. **Stage B · TRI 富化**  
  `node tools/modelswatch/tri_worker.mjs` → `node tools/modelswatch/apply_tri_to_summary.mjs`
3. **Stage C · 分析发布 & 审计**  
  `node tools/modelswatch/data_analysis.mjs` → `node tools/modelswatch/qualify_publish.mjs` → `node tools/modelswatch/maintain_audit.mjs`

辅助命令：

- 数据归档（零数据重启）：`node tools/modelswatch/archive_data.mjs [--include-audit]`
- 审计保洁（可 dry-run）：`node tools/modelswatch/maintain_audit.mjs [--dry-run]`

## 本地调试入口

- 启动本地静态服务：`npm run serve`
- 访问示例：`http://127.0.0.1:8000/lab/modelswatch.html`

## Legacy / 旧版脚本

所有 v4/v5 时代的 pipeline 辅助脚本已迁移至 `tools/modelswatch/previous_js/`，如需查看历史实现或回滚，可从该目录运行：

```bash
node tools/modelswatch/previous_js/weekly.mjs
```

## Model Watch Scripts - Logging


The scripts under this folder now use a lightweight logging utility (`log.js`).

Environment Variable:
  MODELSWATCH_DEBUG=1 (also accepts true/yes/on, case-insensitive)
    Enables verbose debug(...) logs. If unset, only info/warn/error appear.

API:
  import { debug, info, warn, error, summary } from './log.js';
  debug('details'); // gated
  info('high-level progress');
  warn('non-fatal issue');
  error('fatal issue');
  summary('object label', someObject); // pretty prints JSON when debug enabled

Example:
  MODELSWATCH_DEBUG=1 node tools/modelswatch/daily.mjs

In CI you can omit MODELSWATCH_DEBUG to keep logs concise.

## Schema Migration (Phase 1)

Canonical cumulative fields for HF models are now:
  stats.downloads_total
  stats.likes_total

Legacy pseudo fields (removed from fetch layer):
  hf_downloads_7d, hf_likes
These previously held cumulative totals but were ambiguously named. They are no longer emitted. Front-end normalizes any historical JSON by mapping hf_downloads_7d -> downloads_total and hf_likes -> likes_total if the canonical fields are missing.

7-day delta fields (computed ONLY in hotlists after snapshots):
  downloads_7d, likes_7d (HF)
  stars_7d, forks_7d (GitHub)

Schema versioning:
  See schema.js (SCHEMA_VERSION=1). Hotlists and daily files embed { version } and front-end warns on mismatch.



