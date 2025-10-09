## ModelSwatch 重构设计与实施说明

目标：重构 ModelSwatch 后端流程，使每日（daily）获取与摘要生成流程更可控、增量化，并让周期性流程专注于语料库分析与任务清单生成（注意：corpus builder + analysis 不负责主动拉取大规模数据——拉取职责由每日/其他采集脚本承担）。

本文件汇总需求、设计契约、工作流职责分配、数据格式、实施步骤与测试计划，供开发与运维参考。

---

### 任务清单（来自用户要求）
- 每日：从 GitHub（`fetch_github.js`）与 Hugging Face（`fetch_hf.js`）以增量方式获取候选项，优先覆盖未覆盖的类别，避免重复拉取。
- 每日：对项目/模型生成双语摘要（中文与英文，西班牙语可用英语替代），写入以日期命名的 `daily` JSON 文件供前端展示。
- 每日：考虑已存在数据与未覆盖类别，做增量拉取而非全量重复拉取。
- 周期（corpus builder + analysis）：基于已有语料（来自 daily/weekly/top 等），做分类/覆盖率分析并产出 `corpus.json`、`coverage.json`、`daily_tasklist.json` 等；但明确：该步骤不进行大规模数据拉取。 

---

## 高层职责划分（最终版，含你的反馈）

- Daily (modelswatch-daily)
  - 职责：负责实际的增量数据采集（调用 `fetch_github.js` / `fetch_hf.js` 等），执行摘要生成/回填（优先使用缓存/sidecars），并写入当天归档 `data/ai/modelswatch/daily/<YYYY-MM-DD>.json` 及兼容的 `daily_github.json` / `daily_hf.json`。
  - 优先依据 `daily_tasklist.json`（若存在）执行任务：按类别优先采集、满足每类目标数量。
  - 避免重复：使用 `corpus.json`、archive history（`daily/dates.json`）、`last_fetched_at`、`recentById` 等做冷却/去重判断，实施增量拉取。
  - 摘要策略：优先复用 `summary_cache.json` / snapshot sidecars；缺失时使用 `fast_summary`（占位）并将条目写入 `pending_summaries.json` 供异步 tri_worker 批量丰富。

- Corpus builder + analysis（原 weekly，但不做拉取）
  - 职责：仅在已有数据基础上进行聚合与分析。它**不会**主动去拉取 GitHub/HF 的大规模数据。
  - 输入数据源：`corpus.github.json`、`corpus.hf.json`、`data/ai/modelswatch/daily/*.json`、`snapshots/*`、`summary_cache.json` 等由采集脚本或前端/外部流程产生的文件。
  - 输出：统一 `corpus.json`（聚合并规范化）、`coverage.json`（分类覆盖统计）、`daily_tasklist.json`（为下一次 daily 提供优先级任务清单）、以及 diagnostics（例如 `summaries_coverage.json`、`classification_stats.json`）。
  - 说明（重要）：该组件只做“分析与任务生成/合并”——真正的采集请求（fetch）由每日或其他采集程序发起，以便控制抓取时机、并发与外部 token 使用。

- tri_worker / batch summarizer
  - 职责：异步处理 `pending_summaries.json` 中的摘要任务，使用批量 LLM/DeepSeek 或 Python 批处理生成双语摘要并回写 `summary_cache.json` / snapshot sidecars，供后续 daily 使用。

---

## 数据契约（简要）

- `data/ai/modelswatch/corpus.json`（统一语料）
  - shape: { version, generated_at, items: [ { id, source, owner, url, name, tags, description, stats, categories:[{name,confidence,source}], summary_en, summary_zh, summary_es, first_seen, last_seen, last_fetched_at, status } ] }

- `data/ai/modelswatch/coverage.json`
  - shape: { generated_at, categories: { <cat>: { total, recent_7d, owners_count, missing, notes } } }

- `data/ai/modelswatch/daily_tasklist.json`
  - shape: { date, generated_at, tasks: [ { category, desired_count, source_preference, min_filters, priority, reason } ], global_N }

- `data/ai/modelswatch/daily/<YYYY-MM-DD>.json`
  - shape: { version, date, updated_at, items: [ { id, source, owner, name, summary_en, summary_zh, summary_es, reason_label, reason_text, ... } ] }

- `pending_summaries.json` (array of promptHash 或 item refs)

说明：以上文件应包含来源与生成时间，以便追溯与去重。

---

## daily 的增量采集算法（概念实现说明）

1. 读取 `daily_tasklist.json`（若存在）并按 priority 排序，生成按类别的采集目标（desired_count）。
2. 读取 `corpus.json` 与历史档案（`daily/dates.json`），建立 recentById/recentByOwner 字典与类别计数。
3. 对每个 task：在 `corpus.json` 中查找未满足目标且不在冷却期的候选；若不足，则对该类别执行定向的 live fetch（仅调用每日采集），将新条目 merge 回 `corpus.json`（更新 `last_fetched_at`）。
4. 汇总候选后执行选择策略（quota + deficit + owner-uniqueness + cooldown）。
5. 摘要阶段：优先使用 `summary_cache.json` / sidecar；否则使用 `fast_summary`（低成本占位）；若 BILINGUAL_REQUIRED，尽量调用 LLM（受 `BILINGUAL_CAP` 限制），并把待完成的放入 `pending_summaries.json`。
6. 写入 `data/ai/modelswatch/daily/<YYYY-MM-DD>.json`、`daily_github.json`、`daily_hf.json`，并更新 `state.json`（运行元数据）与 archive `dates.json`。

---

## corpus builder + analysis 的行为（不做抓取）

1. 聚合输入：读取 `corpus.github.json`、`corpus.hf.json`、`data/ai/modelswatch/daily/*.json`、`snapshots/*`、以及 `summary_cache.json`。
2. 标准化与去重：按 canonical id（repo full name / hf model id）合并条目，填充 `first_seen/last_seen/last_fetched_at`。
3. 分类：以启发式方法（`normCapsFromItem`）打标签并赋予置信度；将置信度 < threshold 的条目写入 `tri_classify_pending.json`（等待批量 LLM 分类）。
4. 计算覆盖率：为每个 category 统计 total、7d 内数量、owner 覆盖等，生成 `coverage.json`。
5. 生成 `daily_tasklist.json`：根据 coverage 计算 deficit 与优先级，产出下一日的“任务清单”（按类别的 desired_count、source_preference、priority）。
6. 输出 diagnostics（`classification_stats.json`、`summaries_coverage.json`），上传为 workflow artifact 便于观察。

重要：此过程**不**主动向外部 API（GitHub/HF）发出抓取请求；抓取留给 daily 或其他采集脚本做控制。

---

## CI / Workflow 修改要点（概要）

- weekly（改名或保留名为 corpus-analysis）：
  - 在完成分析后 `git add`/commit `corpus.json`、`coverage.json`、`daily_tasklist.json` 以及 diagnostics，并 push（或创建 PR，见下文 branch policy）。
  - 切勿在此流程中做大规模外部拉取；仅基于仓库内已有文件分析。

- daily workflow：
  - 增加 env 标记 `MODELSWATCH_DAILY_USE_TASKLIST=1`、`MODELSWATCH_DAILY_INCREMENTAL=1`。
  - daily 在启动时优先读取 `daily_tasklist.json` 并按照任务执行增量 fetch。
  - 当仓库 `main` 启用 branch protection 时，工作流应 fallback 到“automation 分支 + 自动创建 PR”而非直接强推（现有 workflow 已检查保护并退出，建议改成创建 PR 的选项）。

---

## 实施步骤（分阶段，含优先级）

短期（最小可行）：
1. 在 `docs/` 中添加本设计文档（已完成）。
2. 在仓库中定义并提交 `data/ai/modelswatch` 的 JSON schema 说明（或把本文件作为初步规范）。
3. 修改 `tools/modelswatch/daily.mjs`：增加读取 `daily_tasklist.json` 的选项、在采集步骤合并/更新 `corpus.json` 的 `last_fetched_at`（小改，不改变主逻辑）。

中期（功能实现）：
4. 新增 `tools/modelswatch/build_corpus.mjs`（analysis-only 模块），实现 `corpus.json`、`coverage.json`、`daily_tasklist.json` 的生成逻辑（注意：不发起抓取）。
5. 在 weekly pipeline 用 `node tools/modelswatch/build_corpus.mjs` 替代或并列现有的分析步骤，产出新 artifacts 并 commit。

长期（改进与自动化）：
6. 改造工作流的提交策略：当 `main` 受保护时创建 PR 自动化分支；或配置仓库变量以允许 automation 推送。
7. 增加一个小型 dashboard（可选）显示 `coverage.json`、未分类项与 pending summaries，便于人工干预。

---

## 测试计划（最小集）

- 本地 smoke tests：
  - 运行 `node tools/modelswatch/build_corpus.mjs --dry-run`（分析模式）并验证输出 `corpus.json`/`coverage.json`/`daily_tasklist.json` 字段。
  - 运行 `node tools/modelswatch/daily.mjs --dry-run`，并模拟有/无 `daily_tasklist.json` 的场景，检查 daily 输出与 pending 产生行为。

- CI 校验：
  - 在 weekly job 中加入 step 用于校验 `corpus.json` 与 `daily_tasklist.json` 的基本字段（简单 jq 校验），失败则把 diagnostics 上传。

---

## 边界条件与风险控制

- LLM 不可用：daily 应优先使用 `fast_summary` 作为占位并写入 `pending_summaries.json`。tri_worker 将在可用时批量重试。
- Rate limits：fetch 操作由 daily 控制，必须尊重 `MODELSWATCH_HF_LIMIT`、`MODELSWATCH_GH_PER_PAGE`、`SUMMARY_CONCURRENCY` 等参数。
- 分类错误：对低置信度分类不做最终判定，写入 `tri_classify_pending.json` 以便 batch 校正。
- Branch protection：workflow 对 push 失败应提供可执行回退（创建 PR 或 push 到 automation 分支）。

---

## 结语与下一步建议

按照你的反馈，我已把 corpus builder + analysis 的职责明确限定为“只读分析/任务生成，不做主动拉取”。接下来的建议步骤：

1. 如果你同意，我会在仓库中新增 `tools/modelswatch/build_corpus.mjs` 的骨架（analysis-only），并在 `modelswatch-weekly.yml` 中用它替换/补充现有分析步骤；或者
2. 我可以先做小改（第 3 步），让 `daily.mjs` 优先读取 `daily_tasklist.json` 并把 `corpus.json` 的 `last_fetched_at` 做增量更新，以验证整体流程；然后再实现完整的 corpus builder。

请选择下一步（1：新增 analysis-only corpus builder；2：先改 daily 以使用 tasklist 并做增量更新；3：先生成 JSON schema 文件供验证）。
## Model Watch Daily 重设计方案

本文档总结了对现有 Model Watch daily 管道的重设计思路，目标是把“每日产生 picks”从依赖长时 LLM 批处理的单体流程，改为“轻量首发（快速可用）+ 异步富化（LLM 批处理）”。先有设计，再改代码，降低风险并保留可回滚路径。

## 一、目标与约束
- 目标：保证每日 picks 快速、稳定（即使 LLM 不可用也能产出），并把 LLM 成本与时延挪到异步阶段，最终提升系统稳定性与可维护性。
- 软约束：每日关键路径（从 snapshots 到写出 daily JSON）目标耗时 < 5 分钟，理想 1–2 分钟。
- 成功准则：每日产出 picks（每个来源满足 MIN 配置），pending 队列可增长且最终被异步处理，summaries_diagnostics.json 提供完整可观测指标。

## 二、接口 / 数据契约
- 输入：`data/ai/modelswatch/snapshots/<YYYY-MM-DD>/{hf.json,gh.json}`（包含 id、name、description、stats）
- 输出（实时）：
  - `data/ai/modelswatch/daily_hf.json`、`data/ai/modelswatch/daily_github.json`（10 picks 默认）
  - `data/ai/modelswatch/daily/YYYY-MM-DD.json`（归档）
  - `data/ai/modelswatch/pending_summaries.json`（待异步富化的 hash 列表）
  - `data/ai/modelswatch/summaries_diagnostics.json`（运行诊断）
- 缓存：`data/ai/modelswatch/tri_cache.json`（hash -> {en,zh,es,last_generated,...}）

每个 daily 输出条目结构建议（缩略版）：
{
  id, name, source, stats, summary_short: {en_short, zh_short, es_short, method: 'fast'|'cache'|'enriched'},
  summary_en?, summary_zh?, summary_es?, summary_source: 'fast'|'cache'|'enriched'
}

如果 tri_cache 中存在 enriched 摘要则可直接填充；否则必须有 `summary_short`（fast 摘要）保证首发可用。

## 三、高层分阶段架构
分为两个大路径：关键路径（同步、短时）与异步富化（批处理、容忍更长时间）：

- Stage A — Candidate collection（现有 snapshot 构建，保持快速）
- Stage B — Fast summarizer（关键路径）
  - 优先使用 `tri_cache` 中的条目
  - 否则使用 rule-based / extractive 的 `fast_summary`（从 description 摘取 1-2 个句子，拼接统计信息），必须非常快
  - 把需要 LLM 丰富的项写入 `pending_summaries.json`（去重）
- Stage C — Selector / Scorer
  - 基于优先字段排序（downloads, stars, likes），带备选回退策略保证 MIN picks
  - 两阶段选取：严格筛选 + 放宽筛选，确保产出
- Stage D — Publish（写 daily JSON, archive），此阶段不等待 LLM
- Stage E — Asynchronous Enrichment
  - 独立 worker（定时或事件触发）读取 pending 队列，按 SNAPSHOT_MAX_NEW 批量处理，更新 `tri_cache.json` 与 `summary_cache.json`
  - worker 可使用更大超时/并发配额（例如 SNAPSHOT_BATCH_KILL_TIMEOUT 可高一些）

## 四、两层摘要策略（核心改造）
1) Fast summary（必有）
  - 规则/模板生成：优先提取 description 前 1–2 句，截断到 N 字符，拼接简单 stat 标签（Stars: X / Downloads: Y）
  - 立即可用，无网络调用
2) Enriched summary（异步 LLM）
  - tri_summary 存入 tri_cache（键为 prompt/content 的 hash）
  - 包含完整 en/zh/es 以及 meta（provider、elapsed、warnings）

工作流使用：日常首发用 fast summary，异步 worker 填充 tri_cache，后续 daily 自动使用 enriched（如果存在）。

## 五、批处理/超时/配额策略（可调超参）
- 日常关键路径：不依赖 LLM（或只做极小量有限的快速调用）；目标总耗时 < 5 分钟
- 异步 worker：单次 run 有较高超时（SNAPSHOT_BATCH_KILL_TIMEOUT），但这仅应用在 worker，不用于关键路径
- 推荐默认 repo variables（可在 GitHub Settings → Variables 调整）：
  - SNAPSHOT_BATCH_KILL_TIMEOUT (worker 超时，fallback 900)
  - SNAPSHOT_MAX_NEW (每次 worker 最大新条数，建议 weekly 可 80，daily 可 40)
  - TRI_GROUP_JSON_SIZE, TRI_BATCH_CONCURRENCY
  - MODELSWATCH_HF_LIMIT, MODELSWATCH_GH_PER_PAGE
  - ENABLE_FAST_FIRST（feature flag）

## 六、选择保证（避免 pick=0）
- 实施两轮选择：
  1) 严格轮次（优质/高分）
  2) 回退轮次（放宽阈值，使用 fast summaries）
- 若仍不足，回用前 N 天未重复的历史 picks 以填满最小数量

## 七、监控与诊断（必须有）
- `summaries_diagnostics.json`（每次写）至少应包含：wall_time_sec、total_candidates、to_generate、fast_used_count、enriched_used_count、pending_count、cache_hits、cache_misses、picks_per_source
- 控制台日志应打印关键事件：pending 大小、worker kill/retry、retry used、batch elapsed
- CI artifact：可以把 diagnostics.json 上传为 workflow artifact（便于审计）

## 八、测试与基准
- 单元测试：scorer、picker fallback、fast_summary 输出稳定性
- 本地 load test：模拟 N items（例如 100、300）并测量 fast path 时间与 worker per-item LLM 时间
- LLM 基准：对多组组合（group_size×concurrency）记录 avg sec/item，用于调整 TRI_* 策略

## 九、迁移与回滚计划
- Phase 0（快速胜利）：实现 `fast_summary` 并把 daily 改为使用它（只写 pending），不改 worker。发布后日常运行时间立刻下降。
- Phase 1：实现异步 worker，逐步消化 pending，并在 worker 完成后 tri_cache 会逐步填满。
- Phase 2：调优并把参数暴露为 repo variables，观察 1–2 周后再放宽 SNAPSHOT_MAX_NEW。
- 回滚：保留 ENABLE_FAST_FIRST 或 FAST_ONLY 变量，当异常时设为 true（或直接禁用 worker 的 tri 调用），即可回退到原始快速-only 模式。

## 十、实现清单（优先顺序）
短期（优先）
- 新增 `tools/modelswatch/fast_summary.mjs`（extractive template）
- 修改 `tools/modelswatch/daily.mjs`：使用 fast_summary + 写 `pending_summaries.json`
- 增加 `docs/modelswatch-redesign.md`（本文件）与 README 更新

中期
- 新增 `tools/modelswatch/tri_worker.mjs`（异步批量 LLM worker），支持 SNAPSHOT_MAX_NEW、SNAPSHOT_BATCH_KILL_TIMEOUT
- 在 worker 中使用现有 `tools/tri_summarizer.py`（批模式），并在失败时退回 per-item 或占位

长期
- 自动化监控告警、成本分析、使用更快/更低成本的模型提供者、或本地轻量模型用于 fast-enrichment

## 十一、KPI 与监控阈值（建议）
- daily 首发 wall time < 300s
- picks per source >= MIN (默认 3，推荐 10)
- pending queue 增长率 < 2x/week（否则增发 worker 配额）
- tri_cache 命中率 > 60%（长期提升目标）

## 十二、下一步（我可以立刻开始的工作项）
1. 我可以把 `fast_summary.mjs` 和 `daily.mjs` 的改造实现并运行本地 smoke test（将在仓库中提交变更）。
2. 我也可以先把 worker `tri_worker.mjs` 做成可选的 workflow job（下一步）。

如果你同意，我将先实现第 1 项（Option A 的代码改造），并在本地验证每日关键路径的时间缩短与输出契约符合性。

---
文件位置：`docs/modelswatch-redesign.md`
