# ModelSwatch 重构设计（v5）——工程化护栏版·可实施规格

版本信息
- 文件：docs/modelswatch-redesign_v5.md
- 管道版本：v5（在 v4 基础上补全工程化护栏与实施细节）
- 适用对象：单人维护的自动化流水线（CI 优先），强调可追溯、可回退、幂等与最小复杂度
- 更新时间：2025-10-09
- 作者：工程（基于 v4 方案与评审建议）

目标
- 提供一份“能直接落地”的实施级规范，便于 agent/脚本按此文档实现与验收
- 在 v4 的闭环基础上，补齐 10 项关键工程护栏：Schema/版本化、原子写持久性、锁、合并冲突策略、稳定哈希、分片与归档、时间与幂等、完整性校验、弹性与成本防线、审计与回退

兼容说明
- v5 与 v4 的核心数据模型兼容；新增字段均为后向兼容（可空）
- pipeline 的步骤与产物命名保持一致；新增了 schema_version、pipeline_version、run_id 等元信息

---

一、总览（闭环 + 护栏）
- 主链路（不变）：
  1) Daily（增量采集，产出 raw_corpus & draft）
  2) tri_worker（异步批量 LLM 富化，处理 pending）
  3) apply_tri_to_summary（合并 staging → summary_cache，备份 bak）
  4) data_analysis（去重/分类/覆盖率/生成 tasklist；合格条目追加到 corpus）
  5) qualify+publish（合并 passonce+qualified → daily 发布；更新热榜）
- 工程护栏（新增或强化）：
  - 所有产物引入 schema_version + JSON Schema 校验
  - 统一原子写：writeTemp → fsync(file) → rename → fsync(dir)
  - 轻量锁：pipeline.lock（含 owner/pid/ts/expiry），防并行跑
  - 合并冲突策略：summary_version、promptHash 域隔离、provider 记录、质量阈值
  - 稳定 promptHash 定义与去噪规范化
  - 大文件分片与归档：corpus 按月 JSONL；summary_cache.bak 滚动 gzip 保留 N 份
  - 全 UTC、幂等可重放；daily 以 UTC 日历为准
  - 发布前完整性校验：counts、重复、checksum
  - tri 弹性/成本限额、失败重试、fast-first 回退
  - 审计与回退：runlog、state.json、restore 脚手架

---

二、统一 ID 与字段契约
- canonical_id（必须）：格式 <source>:<canonical>
  - github:owner/repo
  - hf:namespace/model
- origin_ids（数组，可选）：别名/原始 id，用于 fuzzy match 与重命名追溯
- status（枚举）：draft | passonce | unqualified | pending | qualified | published
- promptHash（必须在 pending/staging/cache）：稳定哈希（见“哈希定义”）
- summary_version（整数或 ISO-8601 时间戳），随每次合并提升
- 元数据（建议）：
  - pipeline_version（字符串）："v5"
  - schema_version（整数）：当前文档指定
  - run_id（字符串）：一次完整 run 的幂等键（UUID）
  - created_at/updated_at（UTC ISO 时间）
  - provider：tri 供应商/模型信息 { vendor, model, template_rev }

示例条目（生产级最小字段）
{
  "schema_version": 1,
  "pipeline_version": "v5",
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
  "status": "qualified",
  "provider": {"vendor":"openai","model":"gpt-4o-mini","template_rev":"tri-2025-09"},
  "updated_at": "2025-10-09T04:10:00Z"
}

别名/跨源去重
- 别名映射：维护 alias 表（可选文件 data/ai/modelswatch/aliases.json），记录重命名与归并
- 跨源融合：若同一实体存在 github 与 hf 双源，优先以来源更“权威”的字段为主，保留 sources=["github","hf"] 以供前端展示溯源

---

三、JSON 产物清单（v5 扩展）
目录：data/ai/modelswatch/

1) raw_corpus.gh.json / raw_corpus.hf.json
- 由 daily 写入；数组；status 初始为 draft
- 必要字段：schema_version、pipeline_version、canonical_id、summary_short、first_seen/last_seen

2) daily/<YYYY-MM-DD>.github.draft.json / .hf.draft.json
- daily 草稿；供 tri 与分析
- 必要字段：同上 + run_id

3) <YYYY-MM-DD>_unqualified_gh.json / _hf.json
- 需 tri 的条目列表；含 promptHash、priority
- 结构：{ date, schema_version, run_id, items: [{ canonical_id, promptHash, priority, reason }] }

4) <YYYY-MM-DD>_pending_summaries.json
- tri_worker 输入队列
- 结构：{ date, schema_version, run_id, items: [{ canonical_id, promptHash, source, priority, created_at }] }

5) tri_cache.staging.json
- tri 输出（staging），待合并
- 结构：{ schema_version, run_id, items: [{ canonical_id, promptHash, provider, elapsed_ms, warnings:[], summaries: { zh, en, es, why, what, how } }] }

6) summary_cache.json（生产缓存）
- 合并后的正式摘要仓库
- 结构：{ schema_version, updated_at, items: { [canonical_id]: { summary_version, promptHash, provider, summaries, updated_at, history:[] } } }
- 备份：summary_cache.json.bak.<ts>.gz（gzip，滚动保留 N 份）

7) <YYYY-MM-DD>_qualified_gh.json / _hf.json
- 能在 summary_cache 中匹配到“合格摘要”的条目

8) daily/<YYYY-MM-DD>.passonce_gh.json / .passonce_hf.json
- 快速规则判定已合格、无需 tri 的条目

9) daily/<YYYY-MM-DD>.github.json / .hf.json（最终发布）
- 前端直接消费；冻结字段集合，见“前端契约”

10) corpus/YYYY/MM.github.jsonl / corpus/YYYY/MM.hf.jsonl
- 长期语料库分片（JSON Lines，每行一个对象）
- 附聚合视图（可选）：corpus.github.index.json（月度索引）

11) daily_tasklist.json
- 供下一轮 daily 使用的任务建议

12) tools/modelswatch/audit/<YYYY-MM-DD>_runlog.json
- 运行诊断（counts、times、errors、cost、artifact_paths）

13) state.json
- 流水线状态：{ pipeline_version, schema_version, last_run, last_tri_merge, last_published, last_daily_date, counters, warnings }
 - 流水线状态：{ pipeline_version, schema_version, last_run, last_tri_merge, last_published, last_daily_date, counters, warnings }

14) index/models_by_task.json（模型“按任务”视图索引）
- 供前端 modelswatch.html 的“按任务查看模型”使用（基于 ai_categories.json）
- 结构（建议）：
  {
    "schema_version": 1,
    "pipeline_version": "v5",
    "taxonomy": "data/ai/ai_categories.json#v1",
    "updated_at": "2025-10-09T05:20:00Z",
    "tasks": {
      "image_classification": {
        "label": {"zh":"图像分类","en":"Image Classification","es":"Clasificación de Imágenes"},
        "count": 123,
        "items": [
          {"canonical_id":"hf:namespace/model","name":"…","url":"…","summary_short":{"zh":"…","en":"…"},"tags":["…"],"stats":{"stars":123}}
        ]
      },
      "object_detection": { … }
    }
  }
- 可选：按日快照 index/daily_tasks/<YYYY-MM-DD>.json（便于时序回看）

15) index/projects_by_category.json（项目“按分类”视图索引）
- 供前端 modelswatch.html 的“按分类查看项目”使用（基于 modelswatch/project_categories.json）
- 结构（建议）：
  {
    "schema_version": 1,
    "pipeline_version": "v5",
    "taxonomy": "data/ai/modelswatch/project_categories.json#v1",
    "updated_at": "2025-10-09T05:20:00Z",
    "categories": {
      "framework_core": {
        "label": {"zh":"训练与推理框架","en":"Framework/Core","es":"Framework/Núcleo"},
        "count": 45,
        "items": [
          {"canonical_id":"github:owner/repo","name":"…","url":"…","summary_short":{"zh":"…","en":"…"},"tags":["…"],"stats":{"stars":9999}}
        ]
      },
      "deployment_serving": { … }
    }
  }
- 可选：按日快照 index/daily_projects/<YYYY-MM-DD>.json

注意：以上索引文件写入遵循原子写与 Schema 校验，并保持字段最小、排序稳定（items 按 stars 或 name 排序）。

---

四、JSON Schema 与版本化（护栏 #1）
- 为每类产物定义 JSON Schema，存于 docs/schemas/modelswatch/*.schema.json
- 每个产物顶层须含：schema_version、pipeline_version
- CI 在每步产出后运行 schema 校验（失败即阻断）
- 版本策略：
  - schema_version 自增表示字段结构升级；向后兼容时新增字段可选
  - pipeline_version 固定为 "v5"；若重大行为变更再升 v6

Schema 片段（示意：summary_cache.json）
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.com/schemas/modelswatch/summary_cache.schema.json",
  "type": "object",
  "required": ["schema_version","items"],
  "properties": {
    "schema_version": {"type":"integer","minimum":1},
    "pipeline_version": {"type":"string"},
    "updated_at": {"type":"string","format":"date-time"},
    "items": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["summary_version","promptHash","summaries"],
        "properties": {
          "summary_version": {"type":"integer","minimum":1},
          "promptHash": {"type":"string","pattern":"^sha256:"},
          "provider": {"type":"object"},
          "summaries": {"type":"object"},
          "history": {"type":"array"}
        }
      }
    }
  }
}

---

五、原子写持久性与锁（护栏 #2）
统一原子写 API（Node 伪代码）
function atomicWriteJson(finalPath, obj) {
  const dir = path.dirname(finalPath)
  const tmp = path.join(dir, "." + path.basename(finalPath) + ".tmp")
  const data = JSON.stringify(obj, null, 2)
  const fd = fs.openSync(tmp, 'w', 0o644)
  try {
    fs.writeFileSync(fd, data)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, finalPath) // 同目录 rename 保证原子性
  const dfd = fs.openSync(dir, 'r')
  try { fs.fsyncSync(dfd) } finally { fs.closeSync(dfd) }
}

备份与滚动（summary_cache）
- 写入前：复制并 gzip 当前 summary_cache.json 为 summary_cache.json.bak.<timestamp>.gz
- 滚动策略：保留最近 N（默认 10）份，超出删除；记录到 runlog

轻量锁文件 pipeline.lock
- 路径：data/ai/modelswatch/pipeline.lock
- 内容：{ owner, host, pid, started_at, ttl_sec }
- 获取：若锁存在且未过期 → 退出；过期则尝试抢占并写新锁
- 释放：流程正常结束或超时由下一次抢占

注意
- tmp 与目标必须在同一目录（避免跨卷非原子问题）
- CI Runner 工作目录固定且在同一卷

---

六、合并器冲突策略（护栏 #3）
输入：tri_cache.staging.json、summary_cache.json

核对流程
- 校验 staging 与 pending 的 promptHash 一致性（如保留 pending 快照，可对比）
- 过滤占位/低质摘要（长度、禁词、重复度等阈值）

冲突与版本
- 若 summary_cache 中存在该 canonical_id：
  - 若 existing.summary_version >= incoming.summary_version → 跳过
  - 若 promptHash 域不同（见“哈希定义”中的域），允许并行历史，覆盖 current，并把旧版本入 history[]
  - 记录 provider、model、template_rev、tri_at、merge_at
- 若不存在：写入并设置 summary_version=1

质量阈值（可调）
- 最短长度（en>=240 chars, zh>=150 chars），why/what/how 三段至少两段存在
- 禁止短语："lorem", "tbd", "coming soon" 等
- 语言检测可信度（可选快速检测）≥ 0.7
- 相似度去重：与历史摘要余弦相似度 < 0.95

输出
- 新的 summary_cache.json（atomic 写）
- 审计日志：tools/modelswatch/audit/merge_<timestamp>.json
- 可选：归档 tri_cache.staging.json → tri_cache.archive/<ts>.json.gz

---

七、稳定 promptHash 定义（护栏 #4）
输入字段（建议）：
- canonical_id
- prompt_template_rev（模板版本）
- model_id（供应商+模型名+主要超参）
- locale_set（例如 ["en","zh","es"]，排序后连接）
- canonicalized_input（去噪后的输入上下文，如 README 片段/元数据摘要）

规范化步骤
- 去除 BOM；换行统一为 \n
- 去除多余空白、尾随空格
- JSON 字段排序与稳定序列化（稳定 stringify）
- lowerCase 仅用于大小写不敏感的标识符；自然语言内容不改大小写

计算
- concat = `${canonical_id}\n${template_rev}\n${model_id}\n${locale_concat}\n${canonicalized_input}`
- promptHash = 'sha256:' + sha256_hex(concat)

一致性
- pending/staging/cache 三处都必须携带同一 promptHash
- 变更模板或模型时，由于 template_rev/model_id 变化，promptHash 自动切换到新域

---

八、分片、归档与大文件策略（护栏 #5）
- corpus 采用按月 JSONL：corpus/YYYY/MM.github.jsonl 与 .hf.jsonl
  - 写入追加需要 atomic：写到临时 .tmp 文件后与原文件拼接再 rename，或使用“就地 append + fsync（谨慎）”
  - 推荐：批次聚合后统一 atomic 覆盖（对大文件则分段聚合）
- summary_cache.bak：gzip 压缩，保留 N 份（默认 10），CI 周期清理
- tri staging 归档：按日期 gzip 存放，保留 7-30 天
- runlog 与 audit：按日分文件，超过 60 天自动清理（可调）

---

九、时间、UTC 与幂等（护栏 #6）
- 全部时间戳使用 UTC ISO-8601（YYYY-MM-DDTHH:mm:ss.sssZ）
- daily 文件名以 UTC 日期为准
- 幂等性：
  - 每个步骤以 run_id 作为幂等键；
  - 产物内容按 canonical_id 排序与稳定 stringify，确保重复运行产出一致
  - 重跑不会产生重复记录（凭 canonical_id+promptHash 去重）

---

十、发布前完整性校验（护栏 #7）
- counts：passonce_count + qualified_count = daily_total
- 唯一性：daily 中 canonical_id 唯一
- 质量：所有条目满足最小字段与阈值
- checksum：对 daily 输出计算 sha256 汇总并写入 audit
- 热榜更新：仅基于新增合格条目；校验条目存在于 corpus 分片中

---

十一、tri 弹性、失败与成本防线（护栏 #8）
- 并发：SUMMARY_CONCURRENCY（默认 4），TRI_BATCH_CONCURRENCY（默认 4）
- 窗口：MAX_WORKER_WINDOW（默认 45-55 分钟），超时提前结束并保留剩余 pending
- 超时：PER_ITEM_LLM_TIMEOUT（30-90s）
- 失败分类：
  - 可重试（429/超时/网络）：指数退避，最多 3 次
  - 不可重试（无效输入/越权）：标注 error_code 并剔出 pending → 进入 unqualified，reason 保存
- 成本（可选）：
  - 每次 run 预算：token / 金额 / 时间，超过则短路
  - 支持 provider 级速率限制
- 回退：ENABLE_FAST_FIRST=true 时，在覆盖率不足时回退到 fast summaries 发布

---

十二、前端契约与回退（护栏 #9）
- 冻结字段（daily 发布文件）：
  - required: canonical_id, name, url, tags, summary_short.{en|zh}, summaries.{en|zh}?（若可用）, stats.stars?, first_seen, last_seen
  - optional: provider, why/what/how（仅当 tri 存在）
- 语言回退：
  - zh 缺失 → 用 en 的 short；en 缺失 → 用 zh 的 short
  - 多语言展示时优先 tri 的长摘要；没有则显示 short
- RSS/热榜：
  - generate-rss.mjs 与热榜更新读取 daily 文件（新路径），字段映射不再依赖 snapshot
- 变更策略：
  - 新增字段默认 optional；删除/重命名需先在 v5.n 标注弃用期（至少 2 周）

---

十三、审计、runlog 与回退（护栏 #10）
runlog 结构（示意）
{
  "run_id": "uuid",
  "date": "2025-10-09",
  "steps": [
    {"name":"daily","started_at":"...","ended_at":"...","counts":{"gh":20,"hf":12},"duration_ms":12345,"warnings":[],"errors":[]},
    {"name":"tri_worker","...": "..."}
  ],
  "cost": {"tokens_in":0,"tokens_out":0,"usd_estimate":0},
  "artifacts": ["data/ai/modelswatch/daily/..."],
  "checksums": {"daily.github":"sha256:..."}
}

state.json（示意）
{
  "pipeline_version":"v5",
  "schema_version":1,
  "last_run":"2025-10-09T05:00:00Z",
  "last_tri_merge":"2025-10-09T05:10:00Z",
  "last_published":"2025-10-09T05:20:00Z",
  "last_daily_date":"2025-10-09",
  "counters":{"runs":12,"published_days":8},
  "warnings":[]
}

回退脚手架（操作流程）
- 选择目标 bak：summary_cache.json.bak.<ts>.gz
- 还原为 summary_cache.json（atomic 写）
- 重新执行 qualify+publish，更新 daily 与 state.json
- 记录回退事件到 audit

安全与隐私
- 日志脱敏：不记录密钥与敏感内容；staging 归档可移除原始 prompt/context 大段文本
- 只在必要时存储 why/what/how；可通过配置控制保留级别

---

十四、质量门（Quality Gates）与自动发布规则
- 覆盖率阈值 COVERAGE_THRESHOLD（默认 0.6）：enriched_pct ≥ 阈值 → 自动发布
- 未达阈值：若 ENABLE_FAST_FIRST=true → 用 fast summaries 发布；否则挂起等待下一轮 tri
- 构建前检查：Schema 校验 PASS、锁可获取、上次 run 状态健康（无未处理致命错误）

---

十五、CI / Workflow 建议
- 统一 Node 版本（.nvmrc），CI 使用相同版本；启用依赖缓存
- concurrency group：modelswatch-${{ github.ref }}，防止同分支并行
- 任务编排（建议作业名）：
  1) daily: node tools/modelswatch/daily.mjs --date UTC_DATE --dry-run? → 产出 raw + draft + unqualified + pending
  2) tri_worker: node tools/modelswatch/tri_worker.mjs --window MAX_WORKER_WINDOW → tri_cache.staging.json
  3) apply_tri_to_summary: node tools/modelswatch/apply_tri_to_summary.mjs → summary_cache（bak+merge）
  4) data_analysis: node tools/modelswatch/data_analysis.mjs → corpus append + tasklist + passonce
  5) qualify_publish: node tools/modelswatch/qualify_publish.mjs → daily final + state.json + 热榜 + 分类索引（models_by_task.json、projects_by_category.json）
- 每步结束：
  - 写 runlog 片段；
  - Schema 验证；
  - 关键产物作为 CI artifact（可选）

说明：分类索引推荐在 publish 步骤生成，避免前端在运行时做重分类，提升加载速度与一致性。

---

二十三、前端分类视图支持（模型任务与项目类别）
目的
- 支持 modelswatch.html 的两类导航：
  1) 按任务查看模型（以 ai_categories.json 为权威任务体系）
  2) 按分类查看项目（以 modelswatch/project_categories.json 为项目类别体系）

数据来源
- 任务体系：data/ai/ai_categories.json（层级：category → subcategory → tasks[]，task.key 例如 image_classification）
- 任务别名：data/ai/modelswatch/task_aliases.json（提供 task.key 的同义词、缩写等；脚本可自动扩展变体）
- 项目类别：data/ai/modelswatch/project_categories.json（categories[].key 例如 framework_core）

实现原则
- 预计算索引：在 publish 步骤生成轻量索引文件，前端直接请求使用；避免前端扫描大文件
- 稳定键：严格使用 task.key 与 category.key 作为索引键，保持与 taxonomy 文件一致
- 幂等：同一日期重跑索引一致；items 排序稳定（优先 stars 降序，其次 name 升序）
- 原子写与校验：索引写入遵守 atomic + fsync，产出后做 JSON Schema 校验

模型→任务分类（适配 HF 模型等）
步骤（在 data_analysis 或 publish 前置阶段执行）：
1) 准备别名表：读取 task_aliases.json，按 key 汇总 synonyms；自动生成 hyphen/underscore/连写/首字母缩略词变体，全部小写去重
2) 构建候选词袋：
   - 基于条目 tags[]、name、repo topics、summary_short 文本关键词（可选，开关控制），全部归一化
3) 匹配与得分：
   - 精确命中（与别名完全一致，或词边界匹配）得分 1.0；
   - 文本子串匹配或相近词（如 plural/singular）得分 0.6-0.8；
   - 可配置最小阈值 ≥0.7 作为入选门槛；
4) 选 Top-K（默认 K=3）任务挂载到条目字段 tasks: [task_key…]；写入到 daily 与 corpus 追加（可选）
5) 构建索引：
   - 依据 ai_categories.json 中的 tasks 列表，按 task.key 汇聚 items 简要信息（canonical_id、name、url、summary_short、tags、stats）
   - 写 data/ai/modelswatch/index/models_by_task.json（atomic）

项目→类别分类（适配 GitHub 工程等）
规则（初始启发式，后续可升级 ML 分类）：
- framework_core：framework, trainer, engine, torch, jax, core
- deployment_serving：serve, serving, inference-server, gateway, api, vllm, tensorrt-llm
- optimization_compilers：compiler, onnx, mlir, tvm, graph-opt, quantize（若以优化为核心）
- data_tooling：dataset, data, evaluation, benchmark, leaderboard
- agents_workflows：agent, workflow, orchestrator, langchain, autogen, crew
- security_safety：safety, moderation, redteam, guardrail, policy
- mlops_monitoring：mlops, monitoring, observability, tracing, drift
- edge_embedded：edge, embedded, mobile, on-device, tiny, micro
- ui_devex：ui, devtool, playground, notebook, extension

步骤：
1) 从条目的 tags、topics、description、summary_short 收集候选关键词，归一化
2) 匹配上述规则（可外化为 data/ai/modelswatch/project_category_aliases.json 以便维护）
3) 允许多类别（最多 2-3 个）；记入 item.project_categories[]
4) 聚合生成 index/projects_by_category.json，items 字段包含最小展示集（同上）

Schema 与契约
- 索引文件 Schema（示意）：
  - models_by_task.json: { schema_version, pipeline_version, taxonomy, updated_at, tasks: { [task_key]: { label:{zh,en,es}, count, items:[…] } } }
  - projects_by_category.json: { schema_version, pipeline_version, taxonomy, updated_at, categories: { [category_key]: { label:{zh,en,es}, count, items:[…] } } }
- 语言标签直接来源于 taxonomy 文件（ai_categories.json、project_categories.json）

端到端接线
- 生成时机：qualify_publish 步骤生成或更新上述两个索引
- 前端读取：modelswatch.html 仅请求 index/models_by_task.json 与 index/projects_by_category.json；不再在浏览器端做全文扫描
- 回退策略：如索引缺失或校验失败，前端可回退到按 stars/top N 的通用列表（后端会在下一轮重建索引）

质量与审计
- 在 runlog 记录索引生成耗时、任务/类别覆盖率（覆盖任务数 / taxonomy 任务总数）
- 对未分类样本计数，输出到 audit（协助完善别名或规则）

性能建议
- 限制每个 task/category 的 items 上限（如 500-1000）并提供分页/截断说明；
- 仅输出最小展示字段，避免索引过大；必要时按字母或 stars 分段索引

与 UTC/幂等的关系
- 所有时间戳与 daily 仍以 UTC 管理；索引的 updated_at 以 publish 结束时间为准
- 同一内容重跑不改变 checksum；排序、字段与小数位保持稳定

---

十六、工具与通用库（建议先实现）
- utils/atomic.js：atomicWriteJson, copyGzipRotate, readJsonStream, writeJsonlBatch
- utils/hash.js：stableStringify, normalizeText, sha256Hex, buildPromptHash
- utils/schema.js：validate(file, schemaId)
- utils/lock.js：acquireLock(path, ttl), releaseLock(path)
- utils/log.js：runlog start/append/finalize，checksum 计算

---

十七、数据判定与阈值（默认值，可配置）
- passonce 判定：
  - summary_short.en>=160 或 zh>=100；tags 至少 1 个；stars≥阈值（如 50）或增长率≥阈值
- qualified 判定（基于 tri 或 fast）：
  - 长摘要长度阈值、禁词过滤、语言可信度≥0.7、重复度<0.95
- 覆盖率：qualified_count / total_candidates

---

十八、测试与验收
本地 smoke（建议命令，仅供参考）
- daily（dry run）：产出 raw/draft/unqualified/pending + Schema 校验 PASS
- tri_worker（<=10 条样本）：产出 tri_cache.staging.json，窗口内完成
- apply_tri_to_summary：生成 bak+.gz，summary_cache 更新
- data_analysis：产出 corpus 分片与 passonce
- qualify_publish：产出 daily 最终文件与 state.json，完整性校验 PASS

CI 验收
- 默认参数下 ≤ 1 小时处理 ≤ 40 pending
- 幂等：同一日期重跑结果一致（checksum 不变）

---

十九、实施里程（PR 切分）
- PR-0 基础设施：utils（atomic/hash/schema/lock/log）+ docs/schemas + CI 校验
- PR-1 fast_summary + daily 改造（tmp->rename、pending/unqualified 产出）
- PR-2 apply_tri_to_summary（合并/冲突/备份）
- PR-3 data_analysis（合格判定、corpus 分片、tasklist）
- PR-4 qualify_publish（完整性校验、热榜、state）
- PR-5 运营化：归档/清理策略、监控面板（可选）

---

二十、前端消费与字段冻结（附录）
- daily 文件稳定字段：
  - canonical_id, name, url, tags[], summary_short.{zh|en}, summaries.{zh|en}?, stats.{stars,stars_7d?}, first_seen, last_seen
  - 可选：provider, why/what/how（数组或对象）
- 改动政策：仅新增 optional 字段；对 breaking 变更需先发 deprecation notice 并提供迁移期

---

二十一、错误处理与告警（附录）
- 错误分级：warn（可继续）、error（阻断当前步）、fatal（阻断流水线）
- 告警通道（可选）：GitHub Checks 注释、Issue/Discussion、邮件/IM Webhook
- 自动恢复：下一轮 run 自动读取 pending 与未完成状态，按幂等策略续跑

---

二十二、术语与缩写
- tri：LLM 富化步骤
- staging：待合并临时缓存
- cache：生产级持久摘要仓库
- bak：备份文件

结语
- v5 将 v4 的“可运行闭环”升级为“可长期运维”的实施规范。按本文的工具与步骤落地后，在单人运维下可获得稳定、可回退、幂等且低成本的每日发布能力。建议从 PR-0（通用工具与 Schema）开始，随后按 PR-1…PR-4 渐进上线。
