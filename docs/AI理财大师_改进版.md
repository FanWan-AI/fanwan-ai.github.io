# AI 理财大师（AI Wealth Mentor）改进版（可实施方案）

本稿在原设计基础上做可落地化优化，充分结合当前仓库“静态站点 + 前端 JS + JSON 数据 + Node 脚本 + GitHub Actions”的能力，给出更务实的模块切片、数据规范与上线计划。

---

## 0. 关键结论一览（TL;DR）

- 不引入服务端，所有生成在 CI 定时完成，前端仅读取 JSON 展示，安全可控。
- 首期 MVP 聚焦 3 个子模块：每日理财课、学习路径、简单模拟器；知识图谱与市场快讯以“周更/可选”落地。
- 数据全部落在 `data/ai/wealth/*`，双语/三语字段与站内现有 i18n 规则一致（`zh/en/es` 三键）。
- 新增 1 个生成脚本 + 1 个（可选）周更脚本 + 1 个前端 JS 模块 + 1 个页面/区块。
- 通过 GitHub Actions 定时生成与提交，使用仓库 Secrets 安全持有 LLM Token。
---

## 1. 现状评估与优化方向

与当前仓库契合点：

- 站点是纯静态，前端已有完善的 i18n 与数据渲染（`script.js`）经验；
- `scripts/*.mjs` 与 `tools/*` 中已有内容生成、OG 渲染、RSS 构建等流水线脚本；
- `package.json` 已有 `site:build` 汇总任务，可扩展；
- `lab/` 目录用于实验/功能模块页，适配新增页面。

落地限制与对策：

- 不能在浏览器端直连 LLM：改为 GitHub Actions 定时生成 JSON；
- 避免前端复杂依赖：使用轻量原生 JS 渲染卡片/图表；
- 数据增量与体积：每日内容写入 `finance-daily.json` 仅保留近 N 条，同时按月归档。

---

```text
/data/ai/wealth/
```

## 2. MVP 范围与成功标准

MVP 范围（2 周内可上线）：

- 每日理财课（Daily Lesson）：每日 1 主题，双语/三语 JSON 输出与卡片展示；
- 学习路径（Learning Path）：按 Level 进阶，基于本地存储记录学习进度，推荐下一主题；
- 简单投资模拟器（Investment Sandbox）：定投与通胀影响两种基础可视化。

次阶段功能（MVP+，可 4–6 周）：

- 知识图谱（Mindmap）周更；
- 市场快讯（Market Pulse）日更摘要；
- 语音讲解（TTS）与 AI 教练模式（Q&A）作为可选增强。

成功标准（MVP）：

- JSON 自动生成稳定运行≥14天，失败自动降级不影响页面可用；
- 页面在移动端 1.5s 内首屏可读；
- 三语切换生效，默认中文，英文/西语回退逻辑正确；
- 用户完成 7 天学习，能看到进度与下一个推荐主题。

---

## 3. 系统架构（落地版）

- 生成层（CI）：
  - `tools/wealth/generate-daily.mjs`（日更）
    - 追加写入 `data/ai/wealth/finance-daily.json`（仅保留近 60 条）；
    - 失败降级：跳过当日或复用上一条并打标 `"degraded": true`。
  - `tools/wealth/weekly-mindmap.mjs`（周更，可选）
    - 汇总近 7 日主题，扩展 `data/ai/wealth/mindmap.json` 节点与关系。
- 数据层（JSON）：
  - 放置于 `data/ai/wealth/`，前端 `fetch` 读取；
  - 三语字段遵循 `{ zh: string, en?: string, es?: string }` 结构；
- 展示层（前端）：
  - 新页面 `lab/ai-wealth.html`（或在 `ai-lab.html` 中增区块）；
  - 新脚本 `assets/js/wealth.js` 负责渲染、进度记录与轻量图表；
  - 不做前端 LLM 调用，Q&A 以“精选 FAQ + 检索”模式起步。

---

## 4. 数据规范（JSON Schemas）

建议目录结构：

```text
/data/ai/wealth/
  topics.json               # 选题池（手工 + 稳态）
  finance-daily.json        # 日更内容（滚动 60 条）
  finance-daily-archive/    # 归档（YYYY-MM.json）
  mindmap.json              # 知识图谱（周更，可选）

4.1 topics.json（手工/半自动维护）

- 用途：选题池，支持等级与先修关系，避免重复。
- 结构：

```json
[
  {
    "id": "compound-interest",
    "level": 1,
    "title": { "zh": "复利原理", "en": "Compound Interest" },
    "tags": ["启蒙","收益增长"],
    "prereq": [],
    "popularity": 0.72,           
    "status": "active"          
  }
]
```

4.2 finance-daily.json（近 60 条滚动窗口；位于 data/ai/wealth/finance-daily.json）

- 用途：每日理财课前端数据源；

```json
[
  {
    "topic_id": "compound-interest",
    "topic": { "zh": "什么是复利？", "en": "The Power of Compound Interest" },
    "summary": {
      "zh": "复利是让钱为你工作的机制……",
      "en": "Compound interest lets your money work for you…"
    },
    "key_points": {
      "zh": ["复利=本金×(1+利率)^时间","早点开始更重要","稳定复利 > 短期暴利"],
      "en": ["Formula…","Start early…","Stable compounding…"]
    },
    "practice": { "zh": "用在线复利计算器…", "en": "Try an online calculator…" },
    "degraded": false
  }
]
```

4.3 mindmap.json（可选；位于 data/ai/wealth/mindmap.json）

- 用途：知识图谱节点与关系，周更；
- 结构（简化）：

```json
{
  "nodes": [{ "id": "compound-interest", "label": {"zh": "复利", "en": "Compounding"}, "level": 1 }],
}
```

4.4 faq.json（精选问答，先人工/后半自动；位于 data/ai/wealth/faq.json）

```json
[
  {
    "q": { "zh": "现在买比特币合适吗？", "en": "Is now a good time to buy BTC?" },
    "a": { "zh": "先评估风险承受度与配置比例……", "en": "Assess risk tolerance and allocation…" },
    "tags": ["资产配置","加密资产"],
    "updated": "2025-10-18"
  }
]
```

4.5 选题算法（基于 data/ai/wealth/topics.json）

- 结构解析：该 JSON 以「Level → Categories → Topics」层级组织，包含 `difficulty`、`recommended_order` 与 `order`、`related_topics`、`keywords` 等字段；
- 预处理：生成 `topic_id`（`slug(level)/slug(category)/slug(topic)`），扁平化索引，建立 `related_ids`；
- 打分策略：课程推进 0.5 + 覆盖均衡 0.2 + 关联巩固 0.2 + 适度多样 0.1；
- 约束：冷却窗 60 天、类目每周 ≤ 3 次、早期限制高难度；
- 选择：Top-K 中随机 1；输出附带 `level/category/difficulty/tags`（来自 keywords）。

---

## 5. 前端展示与交互（轻量、可直接接入）

- 页面位置：
  - 推荐新建 `lab/ai-wealth.html`，并从首页/AI Lab 入口导航；
  - 或在 `ai-lab.html` 添加板块占位，后续再独立成页。
- 渲染方式：
  - 新增 `assets/js/wealth.js`：
    - 读取 `data/ai/wealth/finance-daily.json`，显示最近一条为“今日主题”，历史 30 条可翻页；
    - 读取 `data/ai/wealth/topics.json` 显示学习路径（Level 1→6），本地存储记录“已学”；
    - 轻量模拟器：
      - 定投：输入月投入、收益率、年限，前端计算并画线图；
      - 通胀影响：输入年通胀率与目标金额，展示实际购买力变化；
    - 多语言：与全站一致，优先 `zh`，`en`/`es` 缺失时回退。
- 可选增强：
  - TTS：沿用博客文章音频卡片样式，输出到 `assets/audio/wealth/DATE/*.mp3`；
  - FAQ 检索：前端关键词过滤 + 标签筛选。

---

## 6. 自动化流水线（GitHub Actions）

- 新增日更工作流（示意）：`.github/workflows/wealth-daily.yml`
  - 触发：`cron: '0 1 * * *'`（UTC，每日 09:00 北京时间可自行换算）；
  - 步骤：
    1. `actions/checkout`
    2. `setup-node@v4` (node 20)
    3. 运行 `node tools/wealth/generate-daily.mjs`
    4. 若有变更，`git commit && git push`
  - Secrets：`LLM_API_KEY`/`OPENAI_API_KEY`（或 DeepSeek 等）。
- 周更工作流（可选）：`.github/workflows/wealth-weekly.yml`
  - 触发：`cron: '0 2 * * 1'`（每周一）；
  - 运行 `node tools/wealth/weekly-mindmap.mjs` 并提交。
- 与 `site:build` 的关系：
  - 日更 JSON 写入后即可前端展示，无需全站重建；
  - 若结合 OG 或 RSS，可追加 `npm run og:render` / `npm run rss`（按需）。

---

## 7. 实施计划与步骤（逐项可操作）

里程碑 0：目录与占位（0.5 天）

- 创建目录与空文件：
  - `data/ai/wealth/topics.json`（已完成）
  - `data/ai/wealth/finance-daily.json`（空数组 `[]`）
  - `data/ai/wealth/mindmap.json`（初始 10–20 节点，可空）
  - `data/ai/wealth/faq.json`（3–5 条样例）

里程碑 1：每日生成脚本（1–2 天）

- `tools/wealth/generate-daily.mjs`：
  - 读取 `data/ai/wealth/topics.json` → 选题（参见 4.5 打分与约束）；
  - 调 LLM 生成双语内容（模板 + 词数/风格控制）；
  - 追加写 `data/ai/wealth/finance-daily.json`（保留近 60 条，旧的归档到 `data/ai/wealth/finance-daily-archive/YYYY-MM.json`）；
  - 容错：API 失败 → 重试 → 复用上一条并 `degraded=true`；
  - 输出统计日志（便于 CI 调试）。

里程碑 2：前端集成（1–1.5 天）

- 新建 `lab/ai-wealth.html`：
  - 结构包括：今日卡片、历史列表、学习路径、模拟器区块、FAQ；
- 新建 `assets/js/wealth.js`：
  - fetch JSON + 渲染；
  - 本地存储进度（完成/收藏/稍后再学）；
  - 轻量图表（可用原生 `<canvas>`/SVG，无第三方库）；
  - i18n 与页面现有语言切换事件打通（`language-changed`）。

里程碑 3：CI 配置（0.5 天）

- 新增 `.github/workflows/wealth-daily.yml`；
- 在仓库 Secrets 配置 `LLM_API_KEY`；
- 首次手动运行验证 → 查看 JSON 更新与页面展示。

里程碑 4：周更与优化（1–2 天，可选）

- `tools/wealth/weekly-mindmap.mjs` 依据近 7 日主题扩充 `data/ai/wealth/mindmap.json`；
- 在 `ai-lab.html` 添加入口卡片；
- 添加错误监控：CI 失败时提交 issue 或发送邮件（可选）。

验收标准（Check list）

- [ ] `data/ai/wealth/*` 数据存在且 JSON 校验通过；
- [ ] 每日 1 次更新成功提交，失败有降级且页面可用；
- [ ] 页面在移动端（3G/低端机）渲染正常，交互不卡顿；
- [ ] 三语切换对每日卡片/路径/FAQ 生效；
- [ ] 模拟器计算正确（抽样单测 2–3 组数）。

---

## 8. 生成模板（供脚本使用）

提示词骨架（中文为主，英文同步）：

- 输入：`topic`、`level`、`受众=理财小白`、`风格=简洁/可操作`；
- 输出字段：`summary.zh/en`、`key_points.zh/en[3–5]`、`practice.zh/en`、`sources[1–3]`；
- 约束：
  - 禁止投资建议的肯定语气与立竿见影承诺；
  - 对风险与不确定性给出提示；
  - 避免地域/时点强相关数据（易过时）。

---

## 9. 风险与对策

- LLM 不稳定/限流：指数回退 + 最多重试 2 次 + 降级复用上一条；
- 三语成本：先保证 `zh`，`en/es` 可利用 `tools/translate.mjs` 半自动补全；
- JSON 体积增长：`finance-daily.json` 只保留近 60 条，其余按月归档；
- 前端渲染性能：首屏只加载最近 10–20 条，历史翻页/懒加载；
- 合规表述：模板内置“风险提示”与“非投资建议”声明段落。

---

## 10. 后续拓展（MVP+）

- AI 教练模式（Q&A）：接入 FastGPT/Fine-tuned LLM，仍在服务端/CI 侧生成候选答复，前端仅检索展示。
- TTS 每日播报：沿用博客音频 UI，合成 60–90 秒摘要音频；
- 市场快讯：基于公开新闻源 + LLM 摘要，写入 `data/ai/wealth/pulse.json`，与每日课件弱关联；
- 进阶策略卡片：在 `Level 4–6` 增加“行为偏差/再平衡/税务优化”情景练习。

---

## 11. 与现有仓库复用点

- i18n：沿用 `script.js` 的语言切换事件与对象结构；
- 翻译：`tools/translate.mjs` 可用于英文/西语补全；
- 构建：可选将日更任务加入 `site:build` 或独立 Workflow；
- 设计与组件：复用现有卡片、按钮、分享条、音频卡片等样式。

---

## 12. 附：最小化前端“合同”说明

- 输入：`data/ai/wealth/finance-daily.json`、`data/ai/wealth/topics.json`、`data/ai/wealth/faq.json`；
- 输出：
  - 今日卡片 + 历史列表（分页）
  - 学习路径（Level 展示 + 本地完成度）
  - 两个模拟器结果图/数字
- 错误模式：
  - JSON 拉取失败 → 显示占位提示与上次缓存（localStorage）；
  - 字段缺失 → 用中文字段回退；
  - 数据为空 → 展示引导占位与重试按钮。

---

如需，我可以在后续提交中：

- 生成脚本与工作流样板；
- 页面与 `assets/js/wealth.js` 初版；
- `topics.json` 首批 50 条主题种子。
