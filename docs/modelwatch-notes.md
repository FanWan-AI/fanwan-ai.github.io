## ModelSwatch 运行说明与参数速查（中文）

更新时间：2025-10-10

本文件汇总 ModelSwatch 三阶段流水线的关键超参数、前端读取的 JSON 路径、每阶段产物与默认值，以及当前状态与下一步建议。

### 快速结论（要点）
- 5-item 配额 `MODELSWATCH_TRI_LIMIT`：Stage B（TRI）在 GitHub Actions 的 `modelswatch-stage-b.yml` 中可设为 `5`。tri_worker 会先读两个来源的 pending 桶（`github`、`huggingface`），并在这 5 个名额里轮流抽样分配，避免单一来源被饿死。源码默认值（没有环境变量覆盖时）为 `20`。
- 前端在“今日灵感（daily 模式）”优先读取 `data/ai/modelswatch/daily/<日期>.github.json` 与 `data/ai/modelswatch/daily/<日期>.huggingface.json` 并合并去重；仅在缺失时才回退到 `daily_github.json` / `daily_hf.json` 的联合包。
- GH / HF 榜单分别优先读取 `snapshots/<latest>/gh_summaries.json` / `snapshots/<latest>/hf_summaries.json`，再回退到 `projects_hotlist.json` / `models_hotlist.json`，最后兜底 `top_github.json` / `top_hf.json`。

---

## 前端读取规则（详细）

- 今日灵感（模式：daily）
  - 首选：`data/ai/modelswatch/daily/<date>.github.json` 与 `data/ai/modelswatch/daily/<date>.huggingface.json`（分别为两个来源的日更输出）。
  - 合并：前端会将两个文件合并后去重（以 canonical id / canonicalSlug 为主），展示统一的瀑布流。
  - 退而求其次：若上面文件缺失或为空，前端才会尝试使用 `data/ai/modelswatch/daily_github.json` / `data/ai/modelswatch/daily_hf.json` 的联合包。

- GitHub 工程榜（模式：gh）
  - 优先：`data/ai/modelswatch/snapshots/<latest>/gh_summaries.json`（来自 snapshot 的预计算聚合）。
  - 回退：如果 snapshot 中包含过多占位摘要（placeholder），则回退到 `projects_hotlist.json`。
  - 最后兜底：`top_github.json`。

- Hugging Face 模型榜（模式：hf）
  - 优先：`data/ai/modelswatch/snapshots/<latest>/hf_summaries.json`。
  - 回退：`models_hotlist.json`。
  - 兜底：`top_hf.json`。

- “按任务查看模型”开关
  - 一旦启用或输入搜索/勾选方框，前端会批量加载多个日期的 `daily/<date>.github.json` 与 `daily/<date>.huggingface.json`（逐日合并），并用 `task_keys` / `project_categories` 将条目分配到任务瀑布。任务字典来自 `data/ai/modelswatch/ai_categories.json`。

---

## 各 Stage 行为与产物

Stage A — Fetch & Drafts
- 作用：抓取 GitHub 与 Hugging Face 的热门条目，产出草稿和初步分数。主要产物示例：
  - `raw_corpus.*.json`
  - `daily/<date>.*.draft.json`（按来源的 draft）
  - `<date>_unqualified_<source>.json`
  - `<date>_pending_summaries.json`（包含 needs_tri 队列）
- 关键超参（文件顶部有默认值，可用环境变量覆盖）
  - `MODELSWATCH_GH_PER_PAGE`（默认 20）：控制 `fetch_github.js` 每页抓取的项目数与分页大小。
  - `MODELSWATCH_HF_LIMIT`（默认 20）：控制 `fetch_hf.js` 请求 HF API 的 limit。
  - 认证令牌：`GH_TOKEN`、`HF_TOKEN` 决定访问权限与速率限制。

Stage B — TRI enrichment
- 作用：将 `Stage A` 产物中被标注为占位或“摘要不合格”的条目（在 `<date>_pending_summaries.json`）送入 tri 流水线，调用 `tri_summarizer.py`（DeepSeek/LLM）生成中英双语摘要。
- 数据流与缓存：tri 的结果先写入 `tri_cache.staging.json`，再由 `apply_tri_to_summary.mjs` 将成功的项合并到 `summary_cache.json`。失败或不合格的项会留在 pending 队列，等待下次运行重试。
- 主要超参：
  - `MODELSWATCH_TRI_LIMIT`（总配额）：控制单次 run 发给 LLM 的最大条目数。例如在 GitHub Actions `modelswatch-stage-b.yml` 已把该环境变量设为 `5`（短跑模式），源码默认为 `20`。
  - `TRI_BATCH_CONCURRENCY`（默认 2）：并发批次数。
  - `TRI_GROUP_JSON_SIZE`、`TRI_JSON_FIRST`、`TRI_ENABLE_REWRITE`：分别控制批量打包大小、优先 JSON 模式与是否允许重写已有摘要等策略。
- 说明：目前我们把 `tri_worker` 的选择逻辑改为先把 pending 按来源分桶（GH / HF），然后在 `MODELSWATCH_TRI_LIMIT` 的 5 个名额里轮流抽样以保证两边都有机会入选。这意味着“摘要不合格”的占位条目会被放到 pending，并且每次 run 只有这 5 个会被送去 LLM；如果某个条目在 LLM 中生成失败或长度不足，它会继续留在队列里等待后续 run。

Stage C — Analysis & Publish
- 作用：`data_analysis.mjs` 汇总 Stage A/B 的产物（coverage、聚合 summaries、生成 `all_dates_hf.json`、`task_counts_history.json` 等）；`qualify_publish.mjs` 合并并产出最终的日更文件与 hotlist。
- 关键产物：
  - `daily/<date>.<source>.json`（比如 `daily/2025-10-10.github.json`、`daily/2025-10-10.huggingface.json`）
  - `daily_<source>.json`（别名/聚合）
  - `models_hotlist.json`、`projects_hotlist.json`、`models_by_task.json` 等
- 重要行为变更：我们已修改 `qualify_publish.mjs`，即便某个来源（如 HF）没有合格内容也会写出一个空的 `daily/<date>.huggingface.json` 文件，以避免前端 404 导致页面异常。

---

## 常用超参与默认值（可以用环境变量覆盖）
- `MODELSWATCH_TRI_LIMIT`：默认 20，短跑可设为 5（actions 覆盖）。
- `MODELSWATCH_GH_PER_PAGE`：默认 20。
- `MODELSWATCH_HF_LIMIT`：默认 20。
- `MODELSWATCH_TASK_THRESHOLD`：任务匹配阈值，默认 0.7。
- `MODELSWATCH_TASK_TOP_K`：默认 3。
- `MODELSWATCH_CATEGORY_LIMIT`：默认 3。
- `MODELSWATCH_CATEGORY_INDEX_LIMIT` / `MODELSWATCH_TASK_INDEX_LIMIT`：默认 500。
- `MODELSWATCH_MAX_DATES`：默认 120（维护 daily/dates.json 的滚动窗口）。
- `MODELSWATCH_HOTLIST_LIMIT`：默认 50（hotlist 每类上限）。

所有默认值都可以在各脚本顶部找到（`fetch_github.js`、`fetch_hf.js`、`tri_worker.mjs`、`qualify_publish.mjs`），GitHub Actions 的 env 只是覆盖其中的一部分配置。

---

## 逐 Stage 数据流（简化图）
1. Stage A：抓取 → 产出 drafts / passonce / pending
2. Stage B：读取 `<date>_pending_summaries.json` → 选取最多 `MODELSWATCH_TRI_LIMIT`（例如 5）条 → 调用 LLM 生成双语摘要 → 写入 `tri_cache.staging.json` → 成功写入 `summary_cache.json`；失败回到 pending
3. Stage C：`data_analysis.mjs` 读取 passonce + summary_cache → 生成聚合文件 → `qualify_publish.mjs` 输出 `daily/<date>.<source>.json`、hotlist 等

---

## 当前状态（2025-10-10）与下一步建议
- 当前观测：`data/ai/modelswatch/2025-10-10.passonce_hf.json` 与 `2025-10-10_qualified_hf.json` 为空；`2025-10-10.github.json` 已包含 5 条 GitHub 合格条目并带有双语摘要。
- 原因与对策：HF 的候选条目仍在 pending 队列（`2025-10-10_pending_summaries.json`），需要重新运行 Stage B（tri_worker，短跑模式 `MODELSWATCH_TRI_LIMIT=5`，但由于我们已实现跨来源轮选，HF 会获得名额），随后再运行 Stage C（analysis + qualify_publish）以生成 `daily/2025-10-10.huggingface.json`。
- 建议的本地快速复现步骤（示例）：
  - 在本地或 CI 中，设置环境变量并执行 Stage B 脚本（示例，仅供参考）：

```bash
# 在项目根目录
MODELSWATCH_TRI_LIMIT=5 node tools/modelswatch/tri_worker.mjs
```

  - 确认 `tri_cache.staging.json` 中出现 HF 的 tri 结果并被写入 `summary_cache.json`。
  - 运行 Stage C：

```bash
node tools/modelswatch/data_analysis.mjs && node tools/modelswatch/qualify_publish.mjs
```

  - 确认 `data/ai/modelswatch/daily/2025-10-10.huggingface.json` 已生成（即便为空也不会 404）。

---

## 备注与风险
- LLM 调用会产生费用与速率限制（使用 DeepSeek / tri_summarizer.py），summary cache 用以避免重复付费。
- 若 HF 项目数量较多，考虑增加 `MODELSWATCH_TRI_LIMIT` 或运行多次 Stage B 以加速处理。

---

如果你需要我直接执行 Stage B/C 的快速本地跑（在当前仓库环境下），我可以按照上面的命令帮你运行并把结果回报；或者我可以把这份文档进一步细化为 README 风格的步骤说明并加入示例输出。现在我已把文档写入 `docs/modelwatch-notes.md` 并在 todo list 中创建后续动作条目。
