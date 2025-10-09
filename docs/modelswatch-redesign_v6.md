# ModelSwatch 重构蓝皮书（v6）——背景、架构、实施规范与运行手册

版本信息
- 文件：docs/modelswatch-redesign_v6.md
- 管道版本：v6（整合 v4 架构 + v5 工程护栏 + 前端分类索引）
- 适用对象：产品/工程/Agent 执行者（单人维护为主，CI 优先）
- 更新时间：2025-10-09
- 作者：工程

阅读指引
- 想快速了解做什么：读“1. 执行摘要”和“2. 目标与成功指标”
- 想知道怎么落地：读“6. 数据契约”“7. 产物清单”“8. 流水线规范”“10. 工程护栏”
- 想马上开工：读“14. 实施计划（PR 切分）”“15. 验收与测试”
- 前端如何接：读“12. 前端契约与分类索引”

---

1. 执行摘要（Executive Summary）
ModelSwatch v6 提供一条可回退、可审计、低复杂度的日更发布流水线：
Daily（增量抓取）→ tri_worker（LLM 富化）→ 合并器（summary_cache）→ data_analysis（分类/覆盖/语料追加）→ qualify+publish（生成每日发布、热榜与两类分类索引），全程采用原子写、备份与 Schema 校验，确保单人运维下也能稳定运行。

---

2. 目标与成功指标
- 目标：
  - 单人可维护的端到端自动化闭环；无需 DB，纯文件可追溯
  - 前端直接消费每日文件与分类索引，加载快、字段稳定
  - 幂等、可恢复、可回退（summary_cache.bak 恢复后可重建当日发布）
- 成功指标（默认曲线）：
  - 处理能力：≤ 1 小时吞吐 ≤ 40 pending（依赖 LLM latency）
  - 覆盖率：enriched_pct ≥ 0.6 自动发布；不足时可 fast-first 回退
  - 稳定性：重跑 checksum 不变；审计与告警齐全

---

3. 背景与问题陈述（v4 痛点）
- 需要一条“无人工审核”的每日发布链路，且可快速回退
- 之前缺少统一的工程护栏（Schema、fsync、锁、冲突策略等）
- 前端分类视图（按任务、按项目类别）需要后端预计算索引，避免前端重分类

---

4. 范围与非目标
- 范围：抓取/富化/合并/分析/发布/索引/审计/回退/CI
- 非目标：
  - 引入数据库或分布式存储
  - 复杂在线服务（坚持离线构建 + 静态资源投放）

---

5. 角色与运行环境
- 角色：工程维护者（单人）、CI Runner、前端页面 modelswatch.html、Agent 执行者
- 环境：Node（与仓库 .nvmrc 一致）、GitHub Actions 或同等 CI、POSIX 文件系统（同卷 rename 原子）

---

6. 数据契约（核心字段）
- canonical_id（必）：<source>:<canonical>（例：github:owner/repo，hf:namespace/model）
- origin_ids（选）：备用/历史 id
- status：draft | passonce | unqualified | pending | qualified | published
- promptHash（必）：稳定哈希，pending/staging/cache 三处一致
- summary_version（必）：整数或时间戳，合并时自增
- 通用元数据：schema_version、pipeline_version（本版为 v6）、run_id、created_at/updated_at（UTC）

示例（最小集合）
{
  "schema_version": 1,
  "pipeline_version": "v6",
  "canonical_id": "github:owner/repo",
  "origin_ids": ["owner/repo"],
  "name": "Repo Name",
  "url": "https://github.com/owner/repo",
  "tags": ["llm","agent"],
  "summary_short": {"zh":"…","en":"…"},
  "summary_zh": "…",
  "summary_en": "…",
  "promptHash": "sha256:…",
  "summary_version": 2,
  "status": "qualified",
  "updated_at": "2025-10-09T04:10:00Z"
}

---

7. 产物清单（路径与用途）
根目录：data/ai/modelswatch/
1) raw_corpus.gh.json / raw_corpus.hf.json（daily 草稿原始聚合）
2) daily/<YYYY-MM-DD>.github.draft.json / .hf.draft.json（含 summary_short）
3) <YYYY-MM-DD>_unqualified_gh.json / _hf.json（需 tri）
4) <YYYY-MM-DD>_pending_summaries.json（tri 输入队列）
5) tri_cache.staging.json（tri 输出）
6) summary_cache.json（生产摘要缓存）+ summary_cache.json.bak.<ts>.gz（滚动备份）
7) <YYYY-MM-DD>_qualified_gh.json / _hf.json
8) daily/<YYYY-MM-DD>.github.json / .hf.json（最终发布）
9) corpus/YYYY/MM.github.jsonl / .hf.jsonl（月度分片语料）
10) daily_tasklist.json（下一轮抓取建议）
11) tools/modelswatch/audit/<YYYY-MM-DD>_runlog.json（审计）
12) state.json（流水线状态）
13) index/models_by_task.json（模型“按任务”视图索引）
14) index/projects_by_category.json（项目“按分类”视图索引）

上述产物全部采用原子写 + Schema 校验；索引文件为前端直接消费的数据源。

---

8. 流水线规范（步骤与触发）
Step A Daily：增量抓取与草稿生成
- 输入：daily_tasklist.json、历史 corpus 分片
- 输出：raw_corpus.*、daily/*.draft、*_unqualified_*、*_pending_summaries.json
- 规则：草稿内生成 summary_short；满足快速规则的标记 passonce

Step B tri_worker：异步 LLM 富化
- 输入：*_pending_summaries.json
- 输出：tri_cache.staging.json（包含 summaries 与 provider/elapsed/warnings）
- 附：并发/窗口/超时/重试/成本防线（见“10. 工程护栏”）

Step C 合并器 apply_tri_to_summary
- 输入：tri_cache.staging.json、summary_cache.json
- 行为：备份现有 cache → 校验 → 合并 → 写审计

Step D data_analysis：去重/分类/覆盖率/语料追加
- 输入：raw_corpus.*、summary_cache、历史 corpus
- 输出：corpus 分片追加、passonce、unqualified 更新、tasklist

Step E qualify + publish：合并与发布
- 合并 passonce + qualified → daily/<date>.{github,hf}.json
- 更新 corpus 分片、热榜；生成分类索引（models_by_task.json、projects_by_category.json）
- 写 state.json 与 runlog 校验

异常与回退
- 任何失败写入 audit；pending 保留、可续跑
- 回退：从 summary_cache.bak.<ts>.gz 恢复，重建发布文件

---

9. 分类与任务体系（前端需求）
- 模型按任务：data/ai/ai_categories.json（category→subcategory→tasks[].key）
- 任务别名：data/ai/modelswatch/task_aliases.json（同义词/缩写/变体）
- 项目按类别：data/ai/modelswatch/project_categories.json（categories[].key）

索引产物：
- index/models_by_task.json：按 task.key 聚合模型条目（最小展示字段）
- index/projects_by_category.json：按 category.key 聚合项目条目

生成时机：publish 步骤；写入遵循原子写与 Schema 校验。

---

10. 工程护栏（关键十项）
1) JSON Schema 与版本化：
   - docs/schemas/modelswatch/*.schema.json；每产物含 schema_version/pipeline_version
   - CI 每步校验；失败阻断
2) 原子写持久性：
   - writeTemp → fsync(file) → rename（同目录）→ fsync(dir)
   - summary_cache 写前 gzip 备份并滚动保留 N=10
3) 轻量锁：
   - data/ai/modelswatch/pipeline.lock，含 owner/host/pid/started_at/ttl
4) 合并冲突策略：
   - summary_version 比较；promptHash 域隔离；质量阈值过滤；provider/merge 元数据
5) 稳定 promptHash：
   - 输入：canonical_id、template_rev、model_id、locale_set、canonicalized_input；sha256 计算
6) 分片与归档：
   - corpus 按月 JSONL；staging/archive gzip；runlog 长期保留策略
7) UTC 与幂等：
   - 全 UTC；run_id；稳定排序与 stringify；去重键（canonical_id+promptHash）
8) 发布完整性校验：
   - counts/唯一性/质量阈值/sha256 checksum；热榜交叉校验
9) tri 弹性与成本防线：
   - 并发/窗口/超时/重试/预算短路/fast-first 回退
10) 审计与回退：
   - runlog、state.json、restore 脚手架；日志脱敏

---

11. 模型→任务、项目→类别 的分类算法（可实现细节）
模型→任务（用于 models_by_task.json）
- 别名扩展：
  - 从 task_aliases.json 读取 synonyms；自动生成 hyphen/underscore/连写/首字母缩略词变体，全部小写去重
- 词袋构建：
  - 从条目 tags、name、repo topics、summary_short（可开关）抽词，统一归一化
- 匹配评分：
  - 精确/边界命中：1.0；近似：0.6-0.8；阈值≥0.7 录用
- 选择与挂载：
  - Top-K（默认 3）任务写入 item.tasks[]（可选）；聚合写索引

项目→类别（用于 projects_by_category.json）
- 关键词启发式（可外化规则表）：
  - framework_core：framework, trainer, engine, torch, jax, core
  - deployment_serving：serve, serving, inference-server, gateway, api, vllm, tensorrt-llm
  - optimization_compilers：compiler, onnx, mlir, tvm, graph-opt, quantize
  - data_tooling：dataset, data, evaluation, benchmark, leaderboard
  - agents_workflows：agent, workflow, orchestrator, langchain, autogen, crew
  - security_safety：safety, moderation, redteam, guardrail, policy
  - mlops_monitoring：mlops, monitoring, observability, tracing, drift
  - edge_embedded：edge, embedded, mobile, on-device, tiny, micro
  - ui_devex：ui, devtool, playground, notebook, extension
- 分配：
  - 每项目最多 2-3 类；聚合成索引

索引结构（示意）
- models_by_task.json
  { schema_version, pipeline_version, taxonomy:"data/ai/ai_categories.json#v1", updated_at, tasks: { [task_key]: { label:{zh,en,es}, count, items:[{ canonical_id, name, url, summary_short, tags, stats }] } } }
- projects_by_category.json
  { schema_version, pipeline_version, taxonomy:"data/ai/modelswatch/project_categories.json#v1", updated_at, categories: { [key]: { label:{zh,en,es}, count, items:[…] } } }

---

12. 前端契约与数据源
- 日更文件：daily/<date>.{github,hf}.json（稳定字段：canonical_id、name、url、tags、summary_short.{zh|en}、summaries?、stats?、first_seen/last_seen）
- 分类索引：index/models_by_task.json、index/projects_by_category.json（前端仅拉取索引，不做重分类）
- 语言回退：无 zh 用 en.short，反之亦然；长摘要优先 tri，有则显示

---

13. CI / Workflow（建议模板）
- 并发组：modelswatch-${branch}（防同分支并行）
- 作业：
  1) daily → 原子写产物 + Schema 校验
  2) tri_worker → staging
  3) apply_tri_to_summary → 备份 + 合并 + 审计
  4) data_analysis → 语料分片 + passonce + tasklist
  5) qualify_publish → daily 最终 + 热榜 + 两类索引 + state.json
- 每步写 runlog 片段；关键产物作为 CI artifact（可选）

---

14. 实施计划（PR 切分）
- PR-0：抽象公共工具（atomic 写、锁、schema 校验、哈希）与 JSON Schema；补 runlog/state 基建。
- PR-1：重写 daily.mjs 以产出 raw_corpus.*、draft、pending/unqualified，内建 fast_summary、Schema 校验、runlog 片段。
- PR-2：新增 tri_worker.mjs 和 apply_tri_to_summary.mjs，实现 staging→cache 合并、备份与质量阈值。
- PR-3：实现 data_analysis.mjs（语料追加、分类、tasklist）并写 passonce/unqualified。
- PR-4：实现 qualify_publish.mjs，合并 passonce+qualified，生成热榜与分类索引、更新 state.json。
- PR-5：补充审计、清理与监控工具，更新旧脚本或弃用。

---

15. 验收与测试
本地 smoke：
- daily（--dry-run）→ 生成 raw/draft/unqualified/pending，Schema PASS
- tri_worker（≤10）→ 生成 staging
- apply_tri_to_summary → 生成 .bak.gz + 新 cache
- data_analysis → 语料分片 + passonce
- qualify_publish → 日更 + 热榜 + 索引 + state.json，完整性 PASS

CI 验收：
- ≤ 1 小时处理 ≤ 40 pending；重跑 checksum 不变；runlog 完整

---

16. 运维与回退（Runbook）

- 查看失败：tools/modelswatch/audit/{date}_runlog.json
- 手工回退：挑选 summary_cache.json.bak.{timestamp}.gz → 还原 → 重新执行 publish
- 清理策略：备份 N=10，staging/archive 7-30 天，runlog ≥60 天
- 审计维护脚本：`node tools/modelswatch/maintain_audit.mjs [--dry-run]`（自动归档超期 runlog/publish_audit，并写入 audit/summary.json + state.notes.audit_summary）
- 历史数据归档：`node tools/modelswatch/archive_data.mjs [--include-audit]`（将 data/ai/modelswatch 下现有数据搬迁至 previous_data/{timestamp}/，便于零数据重启）

---

17. 安全与合规

- 日志脱敏，不记录密钥与敏感上下文
- 可配置 why/what/how 的保留级别（隐私优先）

---

18. 术语与缩写

- tri：LLM 富化
- staging：待合并临时缓存
- cache：生产摘要缓存
- bak：备份文件

结语
v6 将 v4 的闭环与 v5 的工程护栏融合为一份“读得懂、可执行、可维护”的蓝皮书。按本规范逐步落地后，你可以用一条轻量、幂等、可回退的流水线稳定支撑 modelswatch 的日更与前端分类导航。
