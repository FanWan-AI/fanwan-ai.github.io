# 升级 AI 智答为“站内助理” v2

最后更新：2025-10-27

本版在 v1 的基础上，结合当前仓库的真实数据与目录结构（data/ai/scholarpush、data/ai/modelswatch、data/ai/airadar、data/ai/wealth、lab/*、tools/*），做了路径修正、数据映射细化、实现步骤落地化与性能/质量保障补充，确保“一周内可上线 MVP”。

---

## 0. 本版要点（相对 v1 的改进）

- 路径与模块名对齐现状：使用 Scholarpush（论文）、Modelswatch（GitHub+HF）、AI Radar（要闻）、Wealth（市场快讯）、Site Docs（页面正文）。
- 数据映射给出“来源→doc_chunk/entity_card”的字段级映射与示例，直接参考现有 JSON 结构。
- 新增 Market Pulse（data/ai/wealth/pulse.json）纳入检索范围，支持财经事实和影响一句话。
- content_registry 与总线输出建议落在 data/ai/siteAI（仓库已存在该目录；目前空），与 ai 命名保持一致。
- 明确“检索范围别名”与 scopes→路径映射，前端/工具共用。
- 性能与大小预算（分片上限、RRF 阈值、KV Key 命名），以及隐私/CSP 注意事项。
- 提供首个 Worker API 契约草案（/v1/search|lookup|compare|changelog），参数含 lang/scopes/filters。

---

## 1. 目标与成功标准（与 v1 一致，略微收紧）

- 站内可证：默认仅用站内数据；每条结论≥2条可点击引用（标题/来源/锚点/时间）。
- 会办事：提供“找论文、找模型、找AI新闻、找财经新闻、今日站内更新、解释当前页面”等动作，并附站内跳转。
- 多语言一致：zh/en/es 跟随页面语言；跨语检索但优先同语；引用允许跨语但需标注。
- v1 体验指标：Coverage@10 ≥0.85；Citation Rate ≥0.95；Hallucination ≤0.02；首屏工具点击率 ≥0.35；跳转点击率 ≥0.25。

---

## 2. 数据源与真实路径

- Scholarpush（论文）：data/ai/scholarpush/*.json（按天，含 items[]、title_i18n、summary_i18n、links、tags、ts 等）
- Modelswatch：data/ai/modelswatch/
  - corpus.hf.json（HF 模型条目，items[].canonical_id、summaries、tags、url、stats...）
  - corpus.gh.json（GitHub 项目条目，结构相似，有 repo url 与摘要）
  - daily_*.json、top_*.json、index/ 等作为增量或榜单补充
- AI Radar（要闻）：data/ai/airadar/*.json（按天，items[]，title_i18n、excerpt_i18n、url、published_at）
- Market Pulse（财经快讯）：data/ai/wealth/pulse.json（按日期分组，每项含 time_utc、title、source、facts、impact_one_liner、links）
- Site Docs：站内页面（sitemap.xml）与 lab/*、blog/*、docs/*（正文区需选择器/标记）
- Profile：data/assets/profile 或 data/profile.json / profile.yaml（若无，v1 先忽略；在 Site Docs 内可覆盖“关于我”）

建议统一总线目录：

```
/data/ai/siteAI
  content_registry.json
  /bus/
    doc_chunk.jsonl
    entity_card.jsonl
    bm25/ (分片)
    vec/  (向量分片或量化向量)
    registry_state.json
/tools/
  /site-assistant/
    api.md             # 工具契约
    schemas.md         # 数据契约（本文件核心摘录）
    README.md
```

---

## 3. 数据映射：来源 → doc_chunk / entity_card

为保证“即插即用”，以下映射尽量复用现有字段名。

### 3.1 Scholarpush → 论文

来源样例：data/ai/scholarpush/2025-10-27.json

- doc_chunk（多条/条目）：
  - doc_id: `scholarpush:${date}:${id}`（id 来自 items[].id 或从 links.paper/DOI 解析）
  - source: `scholarpush`
  - type: `paper_insight`（或 `paper_abstract`，取决于字段）
  - lang: 优先 items[].summary_i18n 的语言键；无则从 title_i18n 推断
  - title: items[].headline 或 title_i18n[lang]
  - url: 指向 lab/scholarpush.html 的锚点或站内文章详情（若无，退回外链 paper/code）
  - chunk_id: `c1..cN`（可将 summary_i18n[lang] 分段；或 one_liner/quick_read 单独成块）
  - text: 选 summary_i18n[lang] 或 quick_read；控制在 ≤ 1200 字
  - meta: { tags, year?, authors?, updated_at: items[].ts, canonical_id: 从 links.paper/DOI 或 `${source}:${id}` }

- entity_card（每条/条目 1 个）：
  - entity_id: `paper:${canonical_id}`
  - entity_type: `paper`
  - name: 标题（英文优先）
  - summary_zh/en/es: 来自 summary_i18n
  - links: { page: 站内详情/锚点, pdf: links.pdf 或 paper, code: links.code }
  - tags: items[].tags
  - metrics: { cites?: N }（若未来可得）
  - updated_at: items[].ts

### 3.2 Modelswatch → 模型/仓库

来源样例：data/ai/modelswatch/corpus.hf.json、corpus.gh.json

- doc_chunk：
  - doc_id: 直接复用 items[].canonical_id（如 `huggingface:owner/name` 或 `github:owner/repo`）
  - source: `modelswatch_hf` / `modelswatch_gh`
  - type: `hf_card` / `repo_readme`
  - lang: 从 summaries/locales 推断（若同时有 zh/en/es，可产出多条）
  - title: items[].name
  - url: items[].url（HF/GitHub 官方页）或站内 modelswatch 详情锚点
  - chunk_id: `c1..`（从 summaries.zh/en/es 或 summary_short.* 生成 1~3 段）
  - text: 对应语言的 summary（≤1200字）
  - meta: { tags, updated_at, canonical_id: items[].canonical_id, stats* }

- entity_card：
  - entity_id: items[].canonical_id
  - entity_type: `hf` / `repo`
  - name: items[].name
  - summary_zh/en/es: summaries.*
  - links: { page: 站内 modelswatch 详情锚点?, homepage: items[].url }
  - tags: items[].tags
  - metrics: { stars/likes/downloads_total … 若存在 }
  - updated_at: items[].updated_at

### 3.3 AI Radar → 要闻

来源样例：data/ai/airadar/2025-10-27.json

- doc_chunk：
  - doc_id: `airadar:${date}:${id}`
  - source: `airadar`
  - type: `news_item`
  - lang: 从 title_i18n/excerpt_i18n 推断
  - title: title_i18n[lang]
  - url: items[].url（外链）或站内 ai-radar.html#date 锚点
  - chunk_id: `c1`
  - text: excerpt_i18n[lang]（清洗 markdown/图片 URL）
  - meta: { published_at, time_weight: decay(published_at), tags? }

- entity_card（可选：按日聚合）：
  - entity_id: `airadar:daily:${date}`
  - entity_type: `news_day`
  - name: `${date} AI 前沿要闻`
  - summary_zh/en: 当日摘要（生成）
  - links: { page: `/lab/ai-radar.html#${date}` }
  - updated_at: file.generated_at

### 3.4 Market Pulse → 财经快讯

来源：data/ai/wealth/pulse.json

- doc_chunk：
  - doc_id: `wealth:pulse:${date}:${idx}`
  - source: `wealth_pulse`
  - type: `market_pulse`
  - lang: zh/en 并存时产多条（facts/impact_one_liner 为 i18n 对象则 pick 对应语言；当前多为 zh）
  - title: item.title
  - url: 若有 links[0] 则用外链；否则指向 `/lab/ai-wealth.html#pulse-${date}`
  - chunk_id: `c1`
  - text: facts[lang] + `可能影响：` + impact_one_liner[lang]
  - meta: { time_utc, source: item.source, time_weight: 强时效 }

- entity_card（可选：按日聚合）：`wealth:pulse:daily:${date}`

### 3.5 Site Docs → 正文片段

- 从 sitemap.xml 读取 URL，过滤 PDF/OG/feeds，爬取正文区（建议在页面模板用注释包裹可检索区，如 `<!-- searchable:start --> ... <!-- searchable:end -->`；若无则使用安全的默认选择器）。
- doc_chunk：type=`page_section`，url 为页面+锚点，lang 从 html lang 或路径。

---

## 4. content_registry.json（落地版）

位置：data/ai/siteAI/content_registry.json

```json
{
  "sources": [
    {"id":"scholarpush","type":"papers","lang":["zh","en","es"],"fetch":{"kind":"json","path":"/data/ai/scholarpush/*.json"},"update_strategy":"daily","priority":0.9},
    {"id":"modelswatch_gh","type":"repos","lang":["zh","en"],"fetch":{"kind":"json","path":"/data/ai/modelswatch/corpus.gh.json"},"update_strategy":"daily","priority":0.8},
    {"id":"modelswatch_hf","type":"hf_models","lang":["zh","en"],"fetch":{"kind":"json","path":"/data/ai/modelswatch/corpus.hf.json"},"update_strategy":"daily","priority":0.8},
    {"id":"airadar","type":"news","lang":["zh","en","es"],"fetch":{"kind":"json","path":"/data/ai/airadar/*.json"},"update_strategy":"hourly","priority":0.7},
    {"id":"wealth_pulse","type":"finance","lang":["zh","en"],"fetch":{"kind":"json","path":"/data/ai/wealth/pulse.json"},"update_strategy":"daily","priority":0.7},
    {"id":"site_docs","type":"pages","lang":["zh","en","es"],"fetch":{"kind":"sitemap","path":"/sitemap.xml"},"update_strategy":"on_commit","priority":1.0}
  ]
}
```

---

## 5. 索引与检索（方案 A：Cloudflare Workers KV/R2）

- 存储布局：
  - KV keys：`bus:doc:v1:shard:${n}`、`bus:ent:v1:shard:${n}`、`bm25:v1:shard:${n}`、`vec:v1:shard:${n}`、`reg:v1`
  - 分片上限：单片 ≤ 2.5MB（便于快速加载）；vec 允许量化/压缩。
- 召回：BM25 TopK=100 + 向量 TopK=100；RRF 融合（k=60，阈值≥0.18）；新闻与快讯乘以 time_decay(days, 半衰期=3)。
- 过滤：lang、scopes（下节别名）、type、date_range（ISO）。
- API（草案）：
  - GET /v1/search?query=&lang=&scopes=scholarpush,modelswatch_hf&limit=12
  - GET /v1/lookup?id=paper:self-ragpp:2501.01234
  - POST /v1/compare {"ids":["huggingface:...","github:..."]}
  - GET /v1/changelog?since=2025-10-25T00:00:00Z
- 返回结构参见 v1，新增 `scopes_applied`、`filters_applied`、`index_ts`、`took_ms`。

### 5.1 检索范围别名（前后端共用）

```
all            → scholarpush + modelswatch_* + airadar + wealth_pulse + site_docs
papers         → scholarpush
models         → modelswatch_hf + modelswatch_gh
news_ai        → airadar
news_finance   → wealth_pulse
pages          → site_docs
```

---

## 6. 智答前端接入与 UX

- 首屏动作卡：找论文、找模型、找AI新闻、找财经新闻、今日站内更新、解释当前页面。
- 新增“智能站内查找”按钮：点击弹出范围选择（与设置面板风格一致），可复选上述 scopes。
- 回答结构：结论（<=3 段）+ 证据卡（2–4 条）+ 行动按钮（跳转/对比/仅看某范围）。
- i18n：跟随页面语言；证据若跨语，卡片右上角标注语言。
- 兜底：证据 < 2 → 提供“站内导航建议 + 是否更换范围/语言/日期”的建议。

---

## 7. 构建与增量（CI）

- GitHub Actions：
  1) 抽取（根据 content_registry 执行抽取器），输出 doc_chunk.jsonl、entity_card.jsonl；
  2) 生成 content_hash，定位增量；
  3) 嵌入生成：使用 API（DeepSeek/OpenAI）或自托管（bge-m3）；
  4) 建索引：BM25 与向量分片，写入 data/ai/siteAI/bus/* 或直接写入 KV；
  5) 发布：上传 KV/R2；
  6) 通知：/admin/reload（可选）；
  7) 写 registry_state.json（构建时间、分片摘要）。
- 失败回滚：保留上一版分片；Pages 侧返回“索引上次更新时间”。

---

## 8. 评估与质控

- 离线评测（不调用 LLM）：对 30 条问句跑检索→看 Coverage@10、RRF_Consistency、Time-Weighted Recall；
- 线上质量：统计 Citation Rate、无结果率、范围切换后的点击率；
- 规则：
  - 证据不足 → 仅给导航/澄清，不给武断结论；
  - 新闻/快讯过期（>14 天）默认降权 80%；
  - 显示 index_ts 与构建时间。

---

## 9. 性能与成本

- 分片大小：doc/ent/bm25 单片 ≤2.5MB，vec 单片 ≤3MB；首批加载 ≤2 片（按 scopes 懒加载）。
- 响应预算：纯站内检索 ≤1.2s（p95）；首次加载 ≤1.8s（p95）；
- 嵌入成本：仅对新增/变更项计算；优先使用短摘要字段；周末批量整理长文。

---

## 10. 安全与 CSP

- 仅访问已配置的 LLM 代理与 Workers API；
- 引用外链走 target="_blank" rel="noopener"；
- 用户上传文档（若开启）会话级清理；新闻/快讯链接黑名单过滤。

---

## 11. 推进计划（一周）

- D1–D2：抽取器样例（Scholarpush/Modelswatch/Site Docs + Wealth Pulse 简单版）各≥50 条；写 content_registry.json。
- D3：RRF 检索原型 + KV 部署；完成 /v1/search、/v1/lookup。
- D4：智答工具化接入 + 动作卡/范围弹窗 + 引用卡片渲染。
- D5：CI 增量 + 失败报警 + 离线评测。
- D6–D7：多语言细化与权重调优；灰度发布与收集反馈。

---

## 12. 附录：字段对照速查

- Scholarpush → paper_insight：headline/title_i18n → title；summary_i18n/quick_read → text；links.paper/pdf/code → links；ts → updated_at；tags → tags
- Modelswatch → hf_card/repo_readme：name → title；summaries.* → text；url → links.homepage；canonical_id → canonical_id；tags/stats → meta
- AI Radar → news_item：title_i18n/excerpt_i18n/url/published_at → 对应字段；hotness 可进 meta.tags 或 score 加权
- Wealth Pulse → market_pulse：title/source/facts/impact_one_liner/time_utc/links → 对应字段
- Site Docs → page_section：HTML 正文切分 + lang + url 锚点

---

若确认 v2 方案，我们即可：
1) 在 data/ai/siteAI 写入 content_registry.json；
2) 新增 tools/site-assistant/ 目录（抽取器样板 + Worker API 契约）；
3) 先产出 3 个源的样例分片并接入 /v1/search，完成 MVP。