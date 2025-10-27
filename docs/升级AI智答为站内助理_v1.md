# 升级 AI 智答为“站内助理” v1

最后更新：2025-10-27

本方案把现有的“AI 智答”升级为“站内总助理（Site-wide AI）”。目标是让助手真正“懂站点、懂内容、会办事”：它能覆盖全站内容、跨模块检索与对比、输出可验证的结论，并提供可执行的站内操作与跳转。

本文件融合两版思路：以工程化的数据契约/接口为主干，结合轻量可落地的 MVP 路线，使其能在 1 周内上线首版，并保留长期扩展空间。

---

## 1. 目标与成功标准

- 站内可证：默认仅使用站内知识回答；每条结论至少附 1 条可点击引用（标题/来源/锚点/时间）。
- 会办事：提供站内操作与导航（找论文摘要、对比两个模型、今日更新、解释当前页面）。
- 多语言一致：遵循站点的 zh/en/es 语言策略；检索跨语，但优先同语料；答案按当前语言输出。
- 体验指标（v1 目标）：
  - Coverage@10 ≥ 0.85（检索命中正确来源的比例）
  - Citation Rate ≥ 0.95（回答带引用的比例）
  - Hallucination ≤ 0.02（不在站内仍给结论的比例）
  - 首屏工具点击率 ≥ 0.35；站内跳转点击率 ≥ 0.25

---

## 2. 范围（Scope）

- 覆盖数据源（首期）：
  1) scholarpush（论文与摘要/要点）
  2) Modelswatch（GitHub 开源项目 + HF 模型条目）
  3) airadar（AI前沿要闻）
  4) Site Docs（关于我、博客、模块说明、Lab 页面正文选区）
  5) Profile（个人信息/论文清单/对外链接）
- 不在 v1：实体图数据库、复杂工作流自动化、大规模联网抓取（保留接口位）。

---

## 3. 总体架构（四层）

1) 内容注册层（Content Registry）：统一登记数据源、路径、语言、更新频率与权重。

2) 抽取与编排层（ETL）：为每类数据实现抽取器，将原始 JSON/HTML/MD 规范化为“文档块 doc_chunk”和“实体卡 entity_card”，并生成 content_hash 用于增量。

3) 索引与检索层（Hybrid RAG）：BM25 关键词检索 + 向量检索并行召回，RRF 融合（v1），支持语言/类型/时间过滤；新闻类加入时效加权。

4) Agent 工具层（NL2API）：暴露 site.search / site.lookup / site.compare / site.changelog / site.navigate 等工具，智答通过工具完成“检索-证据-生成-跳转”。

数据流（文字版）：
- GitHub Actions 触发 → 抽取器产出规范化语料与元数据 → 生成/更新嵌入与 BM25 索引切片 → 上传 Cloudflare Workers KV / R2 → 前端智答通过工具 API 检索 → 以引用卡片+结论返回。

---

## 4. 数据契约 v1（最小可用版）

### 4.1 内容注册表 content_registry.json

用途：枚举数据源、路径、语言与更新策略，构建与抽取器按此表执行。

字段：
- id: string 唯一源标识
- type: string 源类型（papers/repos/hf_models/news/pages/profile/...）
- lang: string[] 可用语言
- fetch: { kind: 'json'|'sitemap'|'yaml'|'html', path: string }
- update_strategy: 'on_commit'|'daily'|'hourly'|'manual'
- priority: number [0,1] 召回加权因子

示例：
```json
{
  "sources": [
    {"id":"paperhub","type":"papers","lang":["zh","en","es"],"fetch":{"kind":"json","path":"/data/ai/scholar/*.json"},"update_strategy":"daily","priority":0.9},
    {"id":"modelradar_github","type":"repos","lang":["en","zh"],"fetch":{"kind":"json","path":"/data/ai/modelswatch/github/*.json"},"update_strategy":"daily","priority":0.8},
    {"id":"modelradar_hf","type":"hf_models","lang":["en","zh"],"fetch":{"kind":"json","path":"/data/ai/modelswatch/hf/*.json"},"update_strategy":"daily","priority":0.8},
    {"id":"newsradar","type":"news","lang":["zh","en"],"fetch":{"kind":"json","path":"/data/ai/airadar/*.json"},"update_strategy":"daily","priority":0.7},
    {"id":"site_docs","type":"pages","lang":["zh","en","es"],"fetch":{"kind":"sitemap","path":"/sitemap.xml"},"update_strategy":"on_commit","priority":1.0},
    {"id":"me_profile","type":"profile","lang":["zh","en","es"],"fetch":{"kind":"yaml","path":"/data/profile.yaml"},"update_strategy":"manual","priority":1.0}
  ]
}
```

### 4.2 文档块 doc_chunk.jsonl（每行一条，便于向量化）

字段：
- doc_id: `${source}:${logical_id}`（稳定可复现）
- source: string（例如 'paperhub'）
- type: string（paper_abstract/paper_section/repo_readme/hf_card/news_item/page_section/...）
- lang: 'zh'|'en'|'es'
- title: string（块标题或上级标题）
- url: string（可点击跳转，带锚点）
- chunk_id: string（同一文档的分块编号）
- text: string（<= 1200 字/800 tokens）
- meta: { tags?: string[], authors?/venue?/year?, updated_at: ISO8601, canonical_id?: string, time_weight?: number }

示例：
```json
{
  "doc_id": "paperhub:2025-10-21:arXiv-2501.01234",
  "source": "paperhub",
  "type": "paper_abstract",
  "lang": "en",
  "title": "Self-RAG++",
  "url": "https://fanwan-ai.github.io/lab/ai-paperhub.html#self-ragpp",
  "chunk_id": "c1",
  "text": "We propose ...",
  "meta": {"authors":["..."],"year":2025,"tags":["RAG"],"updated_at":"2025-10-21T06:30:00Z","canonical_id":"paper:self-ragpp:2501.01234"}
}
```

### 4.3 实体卡 entity_card.jsonl（用于对比/导航）

字段：
- entity_id: string（例如 'paper:self-ragpp:2501.01234'）
- entity_type: 'paper'|'repo'|'hf'|'person'|'concept'
- name: string
- summary_zh/en/es: string
- links: { page?: string, pdf?: string, code?: string, homepage?: string }
- tags: string[]
- metrics?: { stars?: number, likes?: number, cites?: number }
- updated_at: ISO8601

示例：
```json
{
  "entity_id": "paper:self-ragpp:2501.01234",
  "entity_type": "paper",
  "name": "Self-RAG++",
  "summary_zh": "……",
  "summary_en": "...",
  "summary_es": "...",
  "links": {"page":"/lab/ai-paperhub.html#self-ragpp","pdf":"https://arxiv.org/abs/2501.01234","code":"https://github.com/..."},
  "tags": ["RAG","retrieval"],
  "metrics": {"cites": 12},
  "updated_at": "2025-10-21T06:30:00Z"
}
```

约束：
- 同一 canonical_id 下的 doc_chunk 与 entity_card 能互相指向。
- 语言空缺时允许仅有 EN，同时生成 zh/es 的短摘要（可用 LLM 统一风格）。

---

## 5. 目录结构（建议）

```
/data/ai/siteAI
  content_registry.json
  /scholarpush/*.json
  /modelswatch/github/*.json
  /modelswatch/hf/*.json
  /airadar/*.json
  profile.yaml
  /bus/                # 知识总线输出
    doc_chunk.jsonl
    entity_card.jsonl
    bm25.index         # 可分片
    embeddings.bin     # 或分片 JSON + 量化
    registry_state.json
/tools/
  /site-assistant/
    api.md             # 工具契约
    schemas.md         # 数据契约（本文件核心摘录）
    README.md
```

---

## 6. 抽取器设计（MVP 三个）

通用策略：
- 生成 content_hash（对 text+关键元数据做 hash），仅对新增/变更条目重算嵌入与索引。
- 文本切分 300–600 tokens；保留 title、url、lang；新闻类写入 `time_weight`（例如近 7 天线性递减）。

6.1 PaperHub
- 输入：`/data/scholarpush/xxxx-xx-xx.json`
- 输出：
  - doc_chunk：abstract、introduction、conclusion 等块；
  - entity_card：论文实体（summary_zh/en/es、links、year、tags、cites?）。
- 规则：引用优先本页锚点 URL；若无，则指向 PaperHub 详情锚点。

6.2 ModelRadar（GitHub + HF）
- 输入：`/data/modelswatch/github/corpus.gh.json`、`/data/modelswatch/hf/corpus.hf.json`、`/data/ai/modelswatch/daily_hf.json`、`/data/ai/modelswatch/daily_gh.json`
- 输出：
  - doc_chunk：repo README 概述/usage/limitations，HF card 的 description/usage；
  - entity_card：项目/模型实体（stars、task、license、links）。
- 规则：抽取“任务/适用场景/限制/license”要点入 tags 与摘要。



6.3 AI News
- 输入：`/data/airadar/xxxx-xx-xx.json`
- 输出：
- 先把现有“AI前沿要闻” JSON 统一成 news schema；
- doc_chunk：事实点与一行影响；加入 `time_weight`；
- entity_card：当日/当周要闻聚合实体（方便“今日更新”）。

6.4 Site Docs（页面正文）
- 输入：`/sitemap.xml`（过滤 PDF/OG 图片/Feed 等）
- 抽取：仅选择正文区域（建议用约定注释或 css 选择器标注“可检索区”）；
- 输出：page_section 块（按段/小节切分），带页面锚点与语言。
---

## 7. 索引与检索（Hybrid）

### 7.1 方案 A（推荐）：Cloudflare Workers KV / R2 + 轻量检索 API

- KV/R2 存储：bm25 索引分片、向量分片（或量化）、doc_chunk & entity_card（JSONL 归档）。
- 路由：
  - GET /v1/search?query=&lang=&scopes=&limit=
  - GET /v1/lookup?id=
  - POST /v1/compare  body: { ids: [] }
  - GET /v1/changelog?since=ISO8601
- 返回结构（统一 Answer 片段）：
```json
{
  "query": "best rag papers",
  "lang": "en",
  "used_scopes": ["paperhub","modelradar_github"],
  "chunks": [{
    "doc_id":"paperhub:...",
    "title":"Self-RAG++",
    "url":"/lab/ai-paperhub.html#self-ragpp",
    "snippet":"We propose...",
    "source":"paperhub",
    "score": 0.86
  }],
  "entities": [{
    "entity_id":"paper:self-ragpp:2501.01234",
    "entity_type":"paper",
    "name":"Self-RAG++",
    "links":{"page":"...","pdf":"..."},
    "summary":"..."
  }],
  "meta": {"took_ms": 128, "index_ts": "2025-10-27T09:00:00Z"}
}
```
- 排序：BM25 与向量 TopK 并行→RRF 融合；
- 过滤：lang/scopes/type/date_range；
- 新闻：score *= time_decay(days)。

### 7.2 方案 B：纯前端（备选）

- 将索引切片静态发布，Web Worker 内检索；
- 仅适合小体量；后续可平滑迁移到方案 A。

---

## 8. 智答前端接入

### 8.1 工具函数（LLM 可调用）
- site.search(query, k, lang, scopes[]) → {chunks[], entities[], meta}
- site.lookup(canonical_id) → entity_card + related
- site.compare(ids[]) → 对比表 & 差异要点
- site.changelog(since) → 按模块的新增/更新
- site.navigate(query) → 推荐站内跳转（模块页/锚点）

### 8.2 轻路由策略
- 识别“对比/最新/导航/解释页面”意图切工具；
- 默认先 search，再结合 compare/changelog；
- 证据阈值不足：不下结论，给澄清与站内跳转。

### 8.3 UI 行为
- 搜索框中的新增“智能站内查找”按钮（要好看） 点击查找按钮弹出弹窗（和目前的参数设置弹窗样式相似）弹窗中设计：找论文｜找模型｜找AI新闻|找财经新闻| 今日站内更新等；
- 引用卡片：标题、来源徽章、片段、跳转按钮；
- 范围开关：论文/模型/新闻/页面/全部；
- i18n：跟随页面语言；跨语检索但优先同语返回。

---

## 9. CI/CD 与增量更新

- GitHub Actions：
  1) 抽取：按 content_registry 跑各抽取器；
  2) 生成 content_hash，定位增量；
  3) 嵌入：API 批量生成向量（DeepSeek/OpenAI 均可）或使用自托管 embedding；
  4) 建索引：BM25 与向量分片；
  5) 发布：上传 KV/R2；
  6) 通知：POST /admin/reload（如有）热更新索引；
  7) 产出 registry_state.json 与 index_ts。
- 失败报警：Actions 失败 → GitHub 通知 + 邮件；同时保留上一版索引为回滚。

---

## 10. 评估与质控

- 指标：Coverage@N、Citation Rate、Freshness Lag、Hallucination、Multi-Lingual Score。
- 评测集：准备 30 条跨模块问题（含对比/导航/今日更新），每次构建后自动跑离线评测（只测检索/排序，不调用 LLM）。
- 质控流程：
  - <2 条证据时，强制降级为导航/澄清；
  - 引用片段不能跨语言混用时给二选提示；
  - 输出显式“索引更新时间”。

---

## 11. 安全、隐私与合规

- 只使用公开站内数据与白名单外链；
- CSP 保持对外仅代理到已配置的 LLM 端点；
- 对用户上传文档（如有）保持本地处理或临时存储并会话级删除。

---

## 12. 推进计划（1 周内 MVP）

- D1–D2：
  - 定稿数据契约与目录；
  - 完成 3 个抽取器样例（各 ≥50 条）与增量 Hash；
- D3：
  - 索引原型（RRF 融合）+ Workers KV / R2；
  - /v1/search 与 /v1/lookup 返回引用片段；
- D4：
  - 智答工具化接入；
  - 首屏动作卡 + 引用卡片渲染；
- D5：
  - CI 自动化与失败报警；
  - 评估集 30 问离线跑；
- D6–D7：
  - 调参与多语言回退；灰度发布与收集反馈。

---

## 13. 成本与资源

- 向量生成：按新增/变更条目计费，可通过批处理与量化降低成本；
- KV/R2：小体量低成本；
- LLM：回答生成按对话请求计费，默认仅站内证据，必要时提示用户启用联网搜索。

---

## 14. Roadmap（v2+）

- 交叉编码重排、实体图（论文↔作者↔仓库↔概念）、变更差分摘要；
- 学习路径、严格“只用站内证据”模式、可插拔知识包；
- 可视化日志与质量看板。

---

## 15. 任务清单映射（与仓库 TODO 对齐）

- 锁定统一数据契约 → 本文件第 4/5 章（样例与字段定义）
- 三个抽取器 MVP → 第 6 章
- 检索索引与 API → 第 7 章
- 前端工具接入智答 → 第 8 章
- CI 自动化与增量 → 第 9 章
- 评估与质控 → 第 10 章
- 首屏任务入口 → 第 8.3 节
- 二期增强 → 第 14 章

---

## 16. 附：接口返回与错误码（建议）

- 200：成功；204：无结果（建议改为导航提示）；400：参数错误；429：频率限制；500：内部错误；
- meta 中统一返回 `took_ms`、`index_ts`、`scopes_used`、`filters_applied`，便于日志与评估。

---

如需具体抽取器脚本与 Workers API 模板，可在 /tools/site-assistant/ 目录新增样板；待确认本方案后执行。
