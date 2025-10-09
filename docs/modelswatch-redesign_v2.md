# ModelSwatch 重构设计（v2）

版本说明
- 文件：`docs/modelswatch-redesign_v2.md`
- 目的：为领导与决策者提供一版完整、结构化、可执行的 ModelSwatch 后端重构设计文档。包含功能定位、差异化优势、详细实施说明（短/中/长期）、数据契约、工作流、测试与迁移计划、KPI、风险与缓解措施。此版本基于现有 `docs/modelswatch-redesign.md` 内容，并做了补充与整理。

更新时间：2025-10-09

作者：产品/工程合写（供评审）

---

目录（快速导航）
- Executive summary（摘要）
- 目标与范围
- 功能定位与差异化优势
- 高层架构与工作流（Daily / Weekly / tri_worker / Frontend）
- 数据契约（schema 详细）
- 关键实现细节（选取算法、去重、摘要策略、LLM prompt 设计）
- 运维与治理（备份、audit、CI、分支保护、限额）
- 测试计划与验收准则
- KPI 与观测指标
- 迁移计划与分阶段实施路线图（含时间与里程碑）
- 风险清单与缓解策略
- 附录：示例 JSON、命令 & 小工具建议

---

## Executive summary（摘要）

ModelSwatch 的重构目标是把“每日 picks（热榜/日报）”的生产路径从依赖长时 LLM 批处理的单体流程，改造为“轻量首发 + 异步富化”的分层体系：

- Daily（关键路径）保证快速、稳定地生成可直接展示的中英双语摘要（至少有中文短摘），并写入按日期的归档 JSON。关键路径应在无 LLM 或 LLM 不可用时仍能产出（fast-first）。
- Corpus builder / Weekly（分析路径）负责在现有数据基础上做聚合、规范化与覆盖率分析，生成明日采集任务清单（`daily_tasklist.json`），但不主动发起大规模抓取请求。
- tri_worker（异步富化）负责批量调用 LLM，为待补充条目生成高质量双语 enriched summaries 与附加字段（为什么有竞争力 / 能做什么 / 如何使用），并把产物写入可审计的缓存（`tri_cache.json` / `summary_cache.json`）。

该设计兼顾可维护性、成本控制与用户价值（特别是面向中文用户的价值），并通过 audit/backup/diagnostics 流程降低自动化危险。短期即可交付可见价值（fast-first 改造），中长期着眼质量自动化与学习型排名。 

---

## 目标与范围

目标
- 为中文用户提供低成本、可持续维护且中文友好的每日 GH 项目 / HF 模型热榜。强调：不是直接与 GitHub/Hugging Face 的官方服务竞争，而是为中文用户在“如何选择、为何选择、如何使用”层面提供可操作的信息。 
- 保证每日首发速度与稳定性（关键路径 < 5 分钟；理想 1–2 分钟），并把高成本 LLM 操作移到异步阶段。 

范围（本次重构覆盖）
- Daily pipeline 的改造（fast_summary 首发 + pending_summaries 记录）。
- 引入 analysis-only 的 `build_corpus`（weekly）模块，负责从已有文件生成 `corpus.json`、`coverage.json`、`daily_tasklist.json`，但不做抓取。
- 设计并扩展 tri_worker 的产出字段（why / what / how），及其 audit/backup 流程。 

不在本次范围
- 构建或扩展大规模抓取器来主动拉取 GH/HF。所有抓取仍由 Daily 或外部采集脚本受控发起。 

受众
- 产品经理 / Leader：用于决策与资源分配。
- 工程团队：用于开发与实施。
- 运营/内容团队：用于审核与人工干预流程。 

---

## 功能定位与差异化优势

定位
- 面向中文用户（同时兼顾英文用户）的模型/项目发现与每日热榜服务。核心输出是：每日 picks（按来源 GH/HF 分组）、带中文短摘与后续 LLM 富化的可操作信息（为何、能做什么、如何上手）。

差异化优势
- 中文友好：首发即保证中文简短摘要（fast_summary），并在 tri_worker 中把“为何有竞争力 / 使用场景 / 上手建议”转化为中文指导，增强可读性与本地化帮助。 
- 可用性优先：fast-first 策略保障即使在 LLM 不可用或限流时也能提供展示性内容，适合小团队低成本持续运营。 
- 审计与回滚：设计中重视 dry-run / audit / backups，避免自动化误写造成数据冲击，满足企业级变更审计要求。 

竞争/合作关系说明
- 不是竞品于 GH/HF；合作点是在用户层提供“本地化/编辑式”的价值。可以结合 GH/HF 的热榜/趋势做二次呈现，聚焦“为何选择”和“如何上手”。

---

## 高层架构与工作流

总体架构图（文字版）

Snapshots & Tops (weekly scraper, external) --> data/ai/modelswatch/snapshots/...
                                              data/ai/modelswatch/top_github.json / top_hf.json
            ^
            | (read-only for analysis)
            |
  Weekly / build_corpus.mjs (analysis-only)
    inputs: corpus.github.json, corpus.hf.json, daily/*.json, snapshots/*, summary_cache.json
    outputs: corpus.json (optional merged), coverage.json, daily_tasklist.json, diagnostics

            |
            v
  Daily / daily.mjs (incremental fetcher & publisher)
    - reads daily_tasklist.json (if exists) and corpus.* (for recent history)
    - performs incremental live fetches for deficit categories (only small, targeted fetch)
    - selects picks (fast-first), writes data/ai/modelswatch/daily/YYYY-MM-DD.github.json / .hf.json and archive
    - writes pending_summaries.json for tri_worker

            v
  tri_worker.mjs (async LLM enrich)
    - processes pending_summaries.json in batches (SNAPSHOT_MAX_NEW etc.)
    - writes tri_cache.json and summary_cache.json (with provenance)
    - flags warnings / audit entries when failures occur

Frontend
  - prefers snapshot sidecars (when not placeholder-heavy), else hotlist, else top_*
  - displays daily outputs and shows why/what/how when available

Notes
- GH 和 HF 各自保留独立的 corpus（`corpus.github.json`、`corpus.hf.json`）以便与前端视图一一对应；analysis-only 阶段可合并为 `corpus.json` 以做全局统计。 
- 所有写入 summary_cache/tri_cache 的操作必须支持 dry-run、备份、和 audit 输出。 

---

## 数据契约（详细 schema）

总体说明：请将下列字段作为基本约定，实际实现时允许保留来源特有扩展字段（例如 HF 的 downloads），但合并视图应标准化为相同字段集合。

1) data/ai/modelswatch/corpus.github.json & corpus.hf.json (源级别语料)
  - shape: { version, generated_at, items: [ { id, source, owner, url, name, tags, description, stats, categories:[{name,confidence,source}], first_seen, last_seen, last_fetched_at, status } ] }
  - 说明：`id` 对 GH 为 `owner/repo`、HF 为 `model-id`（保留 `github:owner/repo`、`hf:model-id` 的 prefixed key 更保险）。

2) data/ai/modelswatch/corpus.json（可选合并视图）
  - shape: { version, generated_at, items: [ { canonical_key, id, source, owner, url, name, tags, description, stats, categories, summary_en, summary_zh, summary_es, first_seen, last_seen, last_fetched_at, status, provenance } ] }
  - 说明：`canonical_key` 可使用 `github:owner/repo` 或 `hf:model-id` 或 `sha256:<hex>` 统一标识；`provenance` 包含来源 sidecar 与生成时间。 

3) data/ai/modelswatch/coverage.json
  - shape: { generated_at, categories: { <cat>: { total, recent_7d, owners_count, missing, notes } } }

4) data/ai/modelswatch/daily_tasklist.json
  - shape: { date, generated_at, tasks: [ { source, category, desired_count, source_preference, min_filters, priority, reason } ], global_N }
  - 说明：`source` 字段用于指明 task 属于 GH 或 HF。 

5) data/ai/modelswatch/daily/<YYYY-MM-DD>.github.json / .hf.json
  - shape: { version, date, generated_at, items: [ { id, canonical_key, source, owner, name, summary_short: { zh, en }, summary_en?, summary_zh?, summary_es?, summary_method: 'fast'|'cache'|'enriched', reason_label, reason_text, stats, provenance } ] }
  - 说明：首发条目须至少含 `summary_short.zh`（中文短摘）或 `summary_short.en`，优先保证中文短摘的可用性。

6) data/ai/modelswatch/pending_summaries.json
  - shape: [ { id, canonical_key, source, promptHash, reason, created_at } ]

7) data/ai/modelswatch/tri_cache.json & summary_cache.json
  - tri_cache shape: { version, generated_at, items: { <promptHash>: { canonical_key, prompt, provider, quality, generated_at, outputs: { en, zh, es }, meta: { elapsed, warnings } } } }
  - summary_cache shape: { version, generated_at, models: { <canonical_key>: { en, zh, es, provider, generated_at, provenance } } }

8) diagnostics: summaries_diagnostics.json
  - shape: { date, wall_time_sec, total_candidates, to_generate, fast_used_count, enriched_used_count, pending_count, cache_hits, cache_misses, picks_per_source: { github, hf }, notes }

---

## 关键实现细节

1) 选择/去重/冷却策略（伪代码说明）

输入：corpusItems, recentById, recentByOwner, N, knownCaps, daily_tasklist

步骤：
- 按来源与类别构建 quota（buildQuotaFromCorpus）
- 对于每个 task (按 priority)：
  - 查找 corpus 中当前未满足目标并且不在冷却期（last_seen/last_fetched_at）且不在 owners blacklist 的候选
  - 若候选数不足，调用定向 live fetch（仅对该类别/来源做小规模、速率受控的抓取）并合并到 corpus（更新 last_fetched_at）
  - 应用 owner-uniqueness、cooldown（默认 14 天）与 deficit 优先策略选取 N 条

输出：选中列表（写入 daily 输出与 pending 列表）

注意：live fetch 必须受限（MODELSWATCH_HF_LIMIT、MODELSWATCH_GH_PER_PAGE），对外请求要有退避与速率控制。

2) 摘要策略（fast-first + async enrich）

- Fast summary（必有）：
  - 规则/模板型：从 description/README 中提取前 1–2 句，截断到约 120–280 字符，附带简短 stat 片段（Stars: X / Downloads: Y）。必须非常快、无网络调用。
  - 目的是保证首发可用（尤其是中文用户至少看到中文短摘）。

- Enriched summary（异步 LLM）：
  - tri_worker 批量处理 pending 列表，为每条生成 3 部分的详细产出：
    1) why_competitive（为什么有竞争力）：1 段、30–80 汉字，面向决策者，突出优势与限制。
    2) what_can_you_do（能做什么）：3–5 条短 bullet，列出典型用例与适用场景。
    3) quick_howto（如何上手）：1–3 条快速上手步骤及注意点（依赖、license、API key 说明等）。
  - 写入 tri_cache/summary_cache，记录 promptHash、provider、elapsed、warnings。

3) LLM prompt 设计（示例模板）

Prompt (中文)：
"你是资深 AI 编辑，目标读者为中文工程师与产品经理。请基于以下信息（名称/链接/简短描述/统计）写出：\n1) 为什么这个项目/模型有竞争力（一句话+要点，30–80 字）；\n2) 典型能做的 3 个用例（每条 1–2 句，简洁）；\n3) 快速上手提示（1–3 条，包含可能的依赖或注意的 license 问题）。\n请用中文回答，避免营销辞藻，保持客观。"

Prompt (English) 类似，回答英文版。保存生成时记录 promptHash（例如 sha256(prompt+content)）。

4) 合并与写入规则（tri_cache -> summary_cache）

- 合并器（apply_tri_to_summary.mjs）必须支持：`--dry`、`--backup`、`--write`、`--audit <file>`。
- 合并优先级：当 summary_cache 中的已有条目为空/占位/低质量，且 tri_cache 中对应 promptHash 标注为 high-quality 时，才覆盖 summary_cache。
- 任何自动写入都必须先生成 audit artifact，便于人工复核并在必要时回滚。 

---

## 运维与治理（实践细节）

1) Branch policy 与 CI
- Weekly analysis 应在开启 branch protection 的仓库时创建自动 PR（而非直接 push 到 main），并在 PR 中附带 audit artifact（`tools/modelswatch/audit/*.json`）供人工审阅后合并。

2) 备份与回滚
- 在写入 `tri_cache.json` 或 `summary_cache.json` 之前备份旧文件到 `data/ai/modelswatch/backups/<file>.<timestamp>.bak`。
- 实施简单回滚命令（PowerShell 示例已在 docs 中）。

3) Secrets 与速率控制
- 不在 repo 中存储 API keys；CI 使用 secrets，local 使用 `.env`（必须在 `.gitignore` 中）。
- 配置参数：`SNAPSHOT_BATCH_KILL_TIMEOUT`、`SNAPSHOT_MAX_NEW`、`TRI_BATCH_CONCURRENCY`、`MODELSWATCH_HF_LIMIT`、`MODELSWATCH_GH_PER_PAGE`、`ENABLE_FAST_FIRST`。

4) 监控与告警
- 日常生成 `summaries_diagnostics.json`，并在 CI/weekly 上传为 artifact。设置阈值（见 KPI）并在超阈值时创建 GitHub Issue 或发送 Slack 通知。 

---

## 测试计划与验收准则

本节给出最低覆盖的测试与验收要求，目标是确保每日首发稳定、数据契约正确、和异步富化可审计。

1) 单元/集成测试（开发阶段）
- scorer/picker：测试边界条件（空 corpus、所有候选在冷却期、owner 碰撞）
- fast_summary：对不同长度/格式描述输出稳定短摘
- apply_tri_to_summary（dry-run）：确保不会无审计覆盖写入

2) Smoke test（本地与 CI）
- `node tools/modelswatch/daily.mjs --dry-run`：模拟有与无 `daily_tasklist.json` 的场景，检查 `daily/*.json` 与 `pending_summaries.json` 输出字段
- `node tools/modelswatch/build_corpus.mjs --dry-run`：生成 corpus/coverage/daily_tasklist，不做抓取

3) Performance test
- 本地 load test：模拟 100 / 300 候选项，测量 fast path 的 wall_time 与 tri_worker 的 per-item LLM 平均耗时

4) 验收准则（Leader 可审查）
- 每日关键路径 wall_time < 300s（优先目标）
- 每日输出每来源 picks >= MIN（默认 3，期望 10）
- tri_cache hit-rate 与 summary_cache 覆盖率有记录并且可观察

---

## KPI 与观测指标（建议）

- daily 首发 wall time（目标准 < 300s，理想 60–120s）
- picks per source（>= MIN，默认 3，目标 10）
- pending queue growth rate（< 2x/week，超则触发扩容或降级）
- tri_cache 命中率（enriched / total）> 60%（长期目标）
- snapshot placeholder fraction < SNAPSHOT_PLACEHOLDER_THRESHOLD（默认 0.5）

---

## 迁移计划与分阶段实施路线图（建议）

总原则：小步快跑，短期交付可见成果并保证可回滚。

Phase 0：准备与规范（1 周）
- 在 `docs/` 明确所有数据契约（完成）
- 在 repo 中补充 `SNAPSHOT_PLACEHOLDER_THRESHOLD` 等可配置变量文档

Phase 1：Fast-first 改造（2 周）
- 新增 `tools/modelswatch/fast_summary.mjs`（extractive template）并改造 `tools/modelswatch/daily.mjs`：
  - 优先使用 `summary_cache` / snapshot sidecars；否则用 fast_summary 填写 `summary_short`，并把需要 LLM 的条目写入 `pending_summaries.json`。
  - 写出按来源的 `daily/YYYY-MM-DD.github.json` / `.hf.json`（或兼容 daily_github.json / daily_hf.json）。
- 运行本地 smoke tests 与 CI dry-run。验收：每日关键路径 wall_time 显著下降，且首发内容完整。

Phase 2：Analysis-only 构建（3 周）
- 新增 `tools/modelswatch/build_corpus.mjs`（analysis-only）：读取 `corpus.github.json`、`corpus.hf.json`、daily 归档、snapshot sidecars、`summary_cache.json`，输出 `corpus.json`（可选）、`coverage.json`、`daily_tasklist.json` 与 diagnostics。
- 在 weekly workflow 运行该工具并创建 PR（含 audit artifact）。验收：自动生成的 `daily_tasklist.json` 与 coverage 指标合理。

Phase 3：tri_worker 与 LLM 富化（4 周）
- 实现 `tools/modelswatch/tri_worker.mjs`：批量处理 `pending_summaries.json`，写入 `tri_cache.json` 与 `summary_cache.json`，并生成 why/what/how 字段。
- tri_worker 在 CI 中作为 optional full-run（需提供 secrets），并且超时与并发可配置。验收：tri_cache hit-rate 达到初期目标，生成的 why/what/how 质量合理（人工抽检）。

Phase 4：监控/质量自动化（长期）
- 构建监控 dashboard，加入 placeholder 分类器与学习型 re-ranker作为长期目标。 

备注：阶段长度为建议值，实际取决于人力与优先级。

---

## 风险清单与缓解策略

1) LLM 可用性/费用风险
- 缓解：fast-first 策略、tri_worker 的批量控制（SNAPSHOT_MAX_NEW）、并把关键告警纳入监控。

2) 自动写入损坏数据风险
- 缓解：合并器必须支持 dry-run、audit、和写前备份；自动化 PR + 人工审核链路。 

3) 数据合并/ID 冲突
- 缓解：强制 canonical_key 规范、hash 兼容性测试（check_hash_compat），以及冲突 audit。 

4) 前端兼容性问题（GH/HF 分源显示）
- 缓解：短期保留分源 daily 输出，analysis-only 阶段提供合并视图作为后端选项。 

5) 运营负担（pending 堆积）
- 缓解：指标监控、worker 调度、并可在紧急时切换 `ENABLE_FAST_FIRST=true` 或 `FAST_ONLY`。 

---

## 附录：示例 JSON（简化）

1) 日常输出示例（简化）

{
  "version": "1",
  "date": "2025-10-09",
  "generated_at": "2025-10-09T08:00:00Z",
  "items": [
    {
      "canonical_key": "github:owner/repo",
      "id": "owner/repo",
      "source": "github",
      "owner": "owner",
      "name": "Example Project",
      "stats": { "stars": 1234, "forks": 56 },
      "summary_short": { "zh": "基于 Transformer 的轻量化对话模型，适合边缘部署。", "en": "A lightweight Transformer dialogue model for edge deployment." },
      "summary_method": "fast",
      "provenance": { "snapshot": "2025-10-08", "summary_cache_hit": false }
    }
  ]
}

2) pending_summaries.json（示例）

[
  { "canonical_key": "github:owner/repo", "id": "owner/repo", "source": "github", "promptHash": "sha256:...", "created_at": "2025-10-09T08:01:00Z" }
]

---

## 我可以立刻执行的事情（建议你选项）

请选择下面一项或组合：
- A（推荐短期）：我把 `fast_summary.mjs` 的骨架与 `daily.mjs` 的小改（读取 tasklist、写按来源 daily 输出、写 pending）实现并运行 smoke tests；提交一个 PR。  
- B：我先实现 `build_corpus.mjs`（analysis-only），并把 weekly workflow 调整为运行该工具（dry-run+audit），以保证分析阶段不触发抓取。 
- C：同时做 A + B，并把 tri_worker 的 why/what/how 字段设计成标准输出（但 tri_worker 的 LLM keys 需你在 CI secrets 中提供或本地 `.env`）。

我建议以 A -> B -> C 的顺序推进（每一步小而可验证）。

---

结语

此文档为面向领导的完整重构设计（v2），覆盖从产品定位到实施细节与运维治理。若你确认方向，我会把短期的 A 实施为 PR 并在本地运行 smoke tests，然后把变更提交供 review。若要我现在开始，请直接选择 A、B 或 C。 
