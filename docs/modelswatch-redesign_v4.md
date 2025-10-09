# ModelSwatch 重构设计（v4）——发布闭环与统一上站策略

版本说明
- 文件：`docs/modelswatch-redesign_v4.md`
- 目标：提供一份可执行、实现级别的重构设计，基于你最新的简化流程与接受的优化（pipeline：Daily → tri_worker → Corpus builder → Publish；采用 atomic tmp->rename 写法；合并时保存 `summary_cache.json.bak`）。
- 适用对象：单人维护的自动化流水线，强调可追溯、可回退与最小运行复杂度。

更新时间：2025-10-09

作者：工程（基于你的提案与反馈）

---

快速概览（先读要点）
- 主流水线（最终）：
  1) Daily（增量采集，产出 raw_corpus & draft）
  2) tri_worker（异步批量 LLM 富化，处理 pending）
  3) data_analysis（去重/标准化/分类/覆盖率/生成 tasklist，并把合格的摘要追加到 corpus）
  4) apply_tri_to_summary（合并 staging summaries 到正式 `summary_cache.json`，并产生 qualified 列表）
  5) publish（把 `daily/<date>.{github,hf}.json` 写入并作为前端数据源；更新 corpus 热榜）
- 核心设计决策：不使用 snapshot 系列文件；用 canonical_id 保证一致性；关键写操作采用 tmp->rename（atomic）；summary 合并前保存 bak 文件。

---

检查清单（实现前必须满足）
- 统一 canonical id 方案并在所有 JSON 中携带 `canonical_id` 与 `origin_ids`。
- 所有关键输出（corpus、daily、summary_cache）使用 tmp 写入并 rename 成最终文件。
- 在每次更新 `summary_cache.json` 前先保存 `summary_cache.json.bak.<timestamp>`。
- tri_worker 仅处理 `*_pending_summaries.json` 并输出 `tri_cache.staging.json`，合并由专门合并器完成。
- 所有中间与最终 JSON 列表、字段与用途在本文档明确说明，便于前端直接消费。

---

1. 统一 id 与字段约定（必须遵守）
- canonical_id (string) — 格式：`<source>:<canonical>`，例如 `github:owner/repo` 或 `hf:namespace/model`。
- origin_ids (array) — 可能的备用 id 或原始 id（便于 fuzzy match）。
- promptHash (string) — 摘要请求标识符，用于去重与 pending 集合唯一化。
- summary_version (int or timestamp) — 摘要版本号，用于回退与比较。
- status (enum) — 可能值：`draft`, `passonce`, `unqualified`, `pending`, `qualified`, `published`。

示例条目（最小必需字段）
```
{
  "canonical_id": "github:owner/repo",
  "origin_ids": ["owner/repo"],
  "name": "Repo Name",
  "owner": "owner",
  "url": "https://github.com/owner/repo",
  "tags": ["llm","agent"],
  "stats": {"stars":123, "stars_7d":10},
  "first_seen": "2025-09-01T00:00:00Z",
  "last_seen": "2025-10-09T04:00:00Z",
  "summary_short": {"zh":"...","en":"..."},
  "summary_zh": "...",
  "summary_en": "...",
  "promptHash": "sha256:...",
  "summary_version": 3,
  "status": "qualified"
}
```

---

2. JSON Artifact 清单与用途（路径与关键字段）
- `data/ai/modelswatch/raw_corpus.gh.json` / `raw_corpus.hf.json`
  - 由 `daily` 写入（draft/原始抓取结果），含 raw 条目数组，字段同示例，status 初始为 `draft`。

- `data/ai/modelswatch/daily/<YYYY-MM-DD>.github.draft.json` 和 `.hf.draft.json`
  - daily 草稿文件（供 tri_worker 与 data_analysis 使用），包含 summary_short 与 minimal meta。

- `data/ai/modelswatch/YYYY-MM-DD_unqualified_gh.json` / `_hf.json`
  - data_analysis 产生，表示当前轮次通过启发式/规则判定为“不合格，需要 LLM”的条目（含 promptHash 与 priority）。

- `data/ai/modelswatch/YYYY-MM-DD_pending_summaries.json`
  - tri_worker 输入队列（array of { canonical_id, promptHash, source, priority, created_at }）。

- `data/ai/modelswatch/tri_cache.staging.json`
  - tri_worker 输出（staging）：每条包含 enriched summaries（en/zh/es, why/what/how）、provider、elapsed、warnings、promptHash。

- `data/ai/modelswatch/summary_cache.json` (+ backups `summary_cache.json.bak.<ts>`)
  - 存放正式生产摘要，供 data_analysis、daily、前端查询。合并器负责把 staging 串接到这里。

- `data/ai/modelswatch/YYYY-MM-DD_qualified_gh.json` / `_hf.json`
  - 在合并器运行后生成：对 unqualified 列表中那些能在 `summary_cache.json` 找到合格摘要（非占位、满足长度/质量阈值）的条目列表。

- `data/ai/modelswatch/daily/<YYYY-MM-DD>.passonce_gh.json` / `.passonce_hf.json`
  - data_analysis 判定为合格（无需 LLM 或 fast_summary 已可接受）的条目（本次通过，一次性）。

- `data/ai/modelswatch/daily/<YYYY-MM-DD>.github.json` / `.hf.json`（最终发布文件）
  - publish 输出。前端每日灵感直接消费此文件。

- `data/ai/modelswatch/corpus.github.json` / `corpus.hf.json`
  - 长期语料库（追加合格条目），用于热榜展示与前端按类别检索。

- `data/ai/modelswatch/daily_tasklist.json`
  - 由 data_analysis 生成，供 next daily 使用。

- `tools/modelswatch/audit/<YYYY-MM-DD>_runlog.json`
  - 运行诊断（counts、times、errors），用于监控与调优。

注意：所有关键产物在写入时必须采用 tmp->rename（atomic）并保留 `.bak` 备份（summary_cache 必须）。

---

3. 详细流水线（实现级顺序与行为）

Step A — Daily（增量抓取与草稿生成）
- 触发：每天调度（或 workflow_dispatch）。
- 输入：`data/ai/modelswatch/daily_tasklist.json`（若存在）与历史 `corpus.*.json`。
- 行为：
  - 按 tasklist 优先做定向小规模 fetch（调用 `fetch_github.js` 或 `fetch_hf.js`，传 category/filters）；若 tasklist 不存在则使用默认 top fetch。
  - 将抓取结果写入 `data/ai/modelswatch/raw_corpus.gh.json` / `.hf.json` 与 `daily/<date>.github.draft.json`、`.hf.draft.json`（tmp->rename）。
  - 生成 `summary_short`（使用 `fast_summary` 或已有 `summary_cache`）并填入 draft。
  - 如果 draft 中 summary 符合快速合格规则，标注为 `passonce` 并加入 `daily/<date>.passonce_*.json`；否则加入 unqualified 列表。
  - 写出 `YYYY-MM-DD_unqualified_*.json` 与 `YYYY-MM-DD_pending_summaries.json`（pending 包含 promptHash、priority）。

Step B — tri_worker（异步 LLM 富化）
- 触发：Daily 完成后触发 tri_worker（CI job 或 runner）。
- 输入：`YYYY-MM-DD_pending_summaries.json`。
- 行为：
  - 按 batch/并发限制读取 pending，调用 LLM 生成 en/zh/es + why/what/how，产生 `tri_cache.staging.json`。
  - 将 per-item metadata（provider, elapsed, warnings, promptHash）写入 staging。
  - 若 tri_worker 在时间或并发限制到达前无法完成剩余项，保留剩余在 pending 以供下次运行。

Step C — apply_tri_to_summary（合并器）
- 触发：tri_worker 完成后（或定时合并窗口）。
- 行为：
  - 校验 `tri_cache.staging.json`（格式、promptHash 对应、占位标记过滤）。
  - 备份当前 `summary_cache.json` 到 `summary_cache.json.bak.<timestamp>`（如果存在）。
  - 合并 staging 到 `summary_cache.json`（增加 summary_version、记录 provider 与 merge metadata）。
  - 写出合并日志到 `tools/modelswatch/audit/` 并移除 staging（或留存为 archive）。

Step D — data_analysis（去重/标准化/分类/覆盖率/生成 tasklist）
- 触发：apply_tri_to_summary 完成后（因为 data_analysis 需要看到 enriched summaries 以提高分类准确性）。
- 行为：
  - 读取 `raw_corpus.*.json`、`summary_cache.json`、历史 `corpus.*.json`。
  - 去重并做 canonical match（使用 canonical_id/origin_ids），合并字段并把合格条目追加到 `corpus.github.json` / `corpus.hf.json`（tmp->rename）。
  - 为未合格/仍需 LLM 的条目生成或更新 `YYYY-MM-DD_unqualified_*.json`（若 tri 产出新摘要，可在此步中把它们划为 qualified）。
  - 生成 `daily_tasklist.json`（基于覆盖率 deficit 算法），并写 diagnostics。

Step E — qualify & final merge -> publish
- 触发：data_analysis 完成。
- 行为：
  - 对 `YYYY-MM-DD_unqualified_*.json` 中的 id，查 `summary_cache.json` 中是否已有合格摘要；生成 `YYYY-MM-DD_qualified_*.json`。
  - 合并 `passonce` + `qualified` 为最终 `data/ai/modelswatch/daily/<YYYY-MM-DD>.{github,hf}.json`（tmp->rename）并写入 `state.json`（last_published）。
  - 将新增合格条目追加到 `corpus.github.json` / `corpus.hf.json`（tmp->rename），并更新 hotlist 文件 `models_hotlist.json` / `projects_hotlist.json`。

Step F — 后续/监控/回退
- 任何一步发生异常，写入 `tools/modelswatch/audit/<date>_runlog.json` 并保持未完成项在 pending，允许下次继续处理。
- 回退：若发现合并后的摘要质量不达标，可以使用 `summary_cache.json.bak.<timestamp>` 恢复并重新生成最终 daily 文件；`state.json` 恢复到上一个 last_published 值。

---

4. 原子写入与备份策略（实现细节，必须）
- 约定：所有关键文件（`corpus.*.json`, `daily/*.json`, `summary_cache.json`, `daily_tasklist.json`）必须采用：写入到临时文件（同目录下 `.tmp` 后缀或 `.writing`），完成后调用 filesystem rename/move 到目标文件名（POSIX 下 rename 是原子操作）。
- 示例（伪代码）：
  - writeFile(tmpPath, JSON.stringify(obj))
  - fs.renameSync(tmpPath, finalPath)
- `summary_cache.json` 合并时：先复制 `summary_cache.json` 到 `summary_cache.json.bak.<timestamp>`（如果存在），再写入新的 `summary_cache.json`（tmp->rename）。
- 目的：避免并发读到半成品文件，便于回退与审计。

---

5. 配置变量（可在 workflow / repo vars 中设置）
- SNAPSHOT_MAX_NEW — tri_worker 单次新项上限（可调整，默认留空由你决定）。
- SUMMARY_CONCURRENCY — LLM 并发调用上限（默认可设 4）。
- TRI_BATCH_CONCURRENCY — tri_worker 内部并行分组数（默认可设 4）。
- PER_ITEM_LLM_TIMEOUT — 单次 LLM 请求超时（建议 30-90s）。
- MAX_WORKER_WINDOW — tri_worker 最大运行窗口（建议默认 45-55 分钟，可空置以便手工配置）。
- ENABLE_FAST_FIRST — 当 tri_worker 未完成且触发回退策略时使用 fast summaries 发布（boolean）。

说明：初始超参可以空置或在 workflow 里以 repo variables 暴露，后续按监控指标调整。

---

6. 质量门与自动化发布规则（单人运行场景）
- 由于你是单人维护且不需要人工审核，本设计采用自动阈值策略：
  - auto_publish_if_enriched_pct >= COVERAGE_THRESHOLD（例如 0.6），则自动合并并 publish；否则如果 ENABLE_FAST_FIRST 为 true，回退并发布 fast summaries；否则标记为 pending 并告警。
- Logging：每次 run 都写 `runlog.json` 包含 counts 与 durations，便于后续审查。

---

7. CI / Workflow 改动要点（建议）
- daily workflow：运行 `node tools/modelswatch/daily.mjs` -> 写 raw_corpus + draft -> upload artifacts（draft）-> trigger tri_worker job。
- tri_worker job：读取 pending，运行 LLM，写 tri_cache.staging.json -> trigger apply_tri_to_summary。
- apply_tri_to_summary job：备份 summary_cache -> 合并 staging -> trigger data_analysis。
- data_analysis job：生成 tasklist, passonce, unqualified, corpus append -> trigger qualify+publish。
- publish job：生成 `daily/<date>.{github,hf}.json` 并直接 push（或 PR，视 branch policy）。

注意：你可以把超参与回退策略作为 repo variables，以便不修改代码直接调参。

---

8. 测试与验收标准（最小集，便于在一小时窗口内验证）
- smoke tests（local）：
  - run daily.mjs --dry-run -> expect `raw_corpus.*.json` 与 `daily/*.draft.json`、`*_unqualified_*.json`、`*_pending_summaries.json` 生成（格式校验）。
  - run tri_worker against small pending (<= 10) -> expect `tri_cache.staging.json` produced within worker window。
  - run apply_tri_to_summary -> expect `summary_cache.json.bak.*` and new `summary_cache.json`。
  - run data_analysis -> expect `corpus.*.json` 和 `daily/<date>.passonce.*.json`。
  - run qualify+publish -> expect final `data/ai/modelswatch/daily/<date>.{github,hf}.json` 和 `state.json` updated。
- acceptance：自动化流程在默认超参下能用 <= 1 小时处理 <= 40 pending 项（依赖 LLM latency）。

---

9. 风险清单与缓解（摘要）
- 风险：重复 & fuzzy match 错误。缓解：canonical_id+origin_ids+fuzzy heuristics。
- 风险：LLM 失败/超时。缓解：限批、超时机制、保留 pending 与 ENABLE_FAST_FIRST 回退。
- 风险：并发写导致数据损坏。缓解：tmp->rename 原子写与 bak 策略。
- 风险：发布不一致（部分合并）。缓解：publish 前保证最终 daily 完整性检查（counts 与 checksum）。

---

10. 简短的实现里程（建议顺序）
1. 在 `docs/` 添加本文件（已完成）。
2. 新增 `tools/modelswatch/fast_summary.mjs`（快速本地摘要）。
3. 修改 `tools/modelswatch/daily.mjs`：写 `raw_corpus.*`、draft、unqualified 与 pending 文件（tmp->rename）。
4. 新增或调整 tri_worker 调用点以读取 pending 并写 staging。
5. 新增 `apply_tri_to_summary.mjs`（合并器，包含 bak 与 atomic 写）。
6. 新增 `data_analysis.mjs`（或 adapt existing build_corpus）以合格判定、追加 corpus 与生成 tasklist。
7. 增加 runlog 与 audit artifact 上传到 CI。
8. 小范围 smoke tests 与 CI dry-run 验证。

---

结语
- 你提出的简化方案为单人自动化维护非常合理。我已把必须的工程保障（atomic writes、backup、canonical id、pending/tri_contract）整合进设计，保留可调超参以便将来优化。若你确认无其他修改，我可以按你之前同意的方案 A 开工（先实现 fast_summary 与 daily的小改，随后实现合并器与 data_analysis），并在分支上提交 PR 与 smoke-test 报告。

请确认是否开始实现，或指定先实现的子任务（例如：我先只增加 `fast_summary.mjs` 并改 `daily.mjs` 写 raw_corpus + pending）。
