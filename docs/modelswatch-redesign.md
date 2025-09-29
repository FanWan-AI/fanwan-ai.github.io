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
