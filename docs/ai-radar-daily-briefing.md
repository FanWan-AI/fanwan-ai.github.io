# AI Radar · 每日导读（主持人手稿式）设计与落地方案

最后更新：2025-10-12

本方案在不改动现有抓取逻辑的前提下，增加“每日导读”文本产物（主持人手稿式），用于帮助用户在 1–3 分钟内理解当天最重要的 AI 新闻，并为后续 TTS 有声播报打基础。

---

## 1) 现有数据是否足以支持 LLM 生成导读？

结论（可行，但需策略性取材与兜底）：

- 可用字段：latest.json/日归档中每条事件均包含 title、url、raw_excerpt、tags、published_at（以及预览抓取后可能更完整的摘要，见下）。
- 原始摘要质量参差：
  - 多数 RSS 源会提供较完整摘要，适合直接作为 LLM 输入。
  - HN/极简博客等往往摘要不足；但 `tools/ai_radar/aggregate_reports.py` 已内置“预览抓取”与 HTML meta 描述抽取（受 PREVIEW_MIN_LEN、PREVIEW_DENY 等配置约束），对 Top 项做补全。
  - 已排除 arXiv/GitHub 链接，有助于减少“只有链接无内容”的条目。
- 因此：用“标题 + raw_excerpt +（若有）预览摘要 + 基于 tags/来源/时间的上下文特征”喂给 LLM，能够产出可靠的“主持人手稿式导读”。
- 需要的约束：
  - 明确只允许改写输入事实，不得虚构细节；
  - 对摘要不足的条目，优先用统计型小结兜底（不强行编造）。

建议：MVP 仅对 Top K（如 12–16 条）做导读生成，保证成本与质量；对于缺少足够上下文的条目，LLM 仅输出“看点/影响/建议”的保守版本。

---

## 2) MVP 范围与目标

- 范围：仅“主持人手稿式”文本导读；暂不生成音频；前端展示一张“今日导读”卡片。
- 用户价值（成功标准）：
  - 用户在 1 分钟内理解“今天 3–5 件最重要的事”。
  - 每次导读带来至少 1 次点击/收藏/分享的互动。
  - 内容风格一致、信息准确，不复读、不夸大。

---

## 3) 数据输入契约（来自 latest.json）

对 LLM 的输入来自 latest.json 的 Top K 项的子集字段：

- id: string
- title: string
- url: string（可派生 source_host）
- raw_excerpt: string（可能为空或很短）
- tags: string[]（可能为空）
- published_at: ISO8601 string
- 可选：预览/清洗后的 excerpt（aggregate 会在特定条件下注入）；
- 可选：热度/排序分（若已有）；若无，则用“时间 + 标签权重 + 来源权重”简单复合排序。

我们不要求修改 fetch_feeds.py；MVP 复用现有字段，必要时在 aggregate_reports.py 中“选择/排序/聚类”后再传 LLM。

---

## 4) 选择与排序（供导读使用）

- Top K 选择：
  - 时间窗口：48 小时（沿用 latest.json window_hours）。
  - 先按“是否新近（与日归档去重）”分桶：新→旧；桶内按 recency/hotness 排序。
  - K 建议 12（可配 8–16）。
- 分组：将 Top K 自动分 3 个板块（政策/融资、研究/模型、工具/产业），规则优先 tags 匹配（Policy/Funding/Research/Tools/Industry），其次关键词兜底。
- 选 1 条“深读”：在 Top K 中挑一条“篇幅/影响/新颖性”最高的，作为“今日深读”。

---

## 5) LLM 产出 Schema（JSON 严格）

输出文件：`data/ai/airadar/briefings/YYYY-MM-DD.json`

```json
{
  "date": "2025-10-12",
  "mode": "host_script",
  "meta": {
    "hotness_delta": "+18%",
    "themes": [
      { "topic": "模型/工具", "one_line": "Agent 工具链叙事延续，发布与集成加速。" },
      { "topic": "政策/安全", "one_line": "合规与对齐继续成为头部厂商发力点。" }
    ],
    "length_sec_estimate": 120
  },
  "sections": [
    {
      "title": "今日大事",
      "items": [
        {
          "id": "<news-id>",
          "one_liner": "一句话看点，通俗但准确",
          "why_it_matters": "影响对象/影响方式",
          "next_step": "给研究者/企业/开发者之一的具体建议（可三选一）"
        }
      ]
    },
    {
      "title": "政策/融资",
      "items": [ { "id": "...", "one_liner": "...", "why_it_matters": "...", "next_step": "..." } ]
    },
    {
      "title": "研究/模型",
      "items": [ ]
    },
    {
      "title": "工具/产业",
      "items": [ ]
    }
  ],
  "deep_dive": {
    "id": "<news-id>",
    "why_read": "为什么值得读（2–3 句，避免夸大）",
    "counterpoint": "反方/注意点（1 句，可选）",
    "takeaway": "带走一个观点或方法（1 句）"
  },
  "outro": {
    "tomorrow_watch": "明日观察（可提到发布/会议/解禁）",
    "call_to_action": "建议动作（如收藏专题/关注标签）"
  }
}
```

约束：

- 仅基于输入事实改写，不得虚构具体数字与未出现的结论。
- 优先中文；无英文并行输出（后续可扩展）。
- 若输入不足，允许简化“why_it_matters/next_step”，避免瞎编。

---

## 6) Prompt 草案（主持人手稿式）

输入材料：

- 今日 Top K 条目的 {title, url, source_host, raw_excerpt_or_preview, tags, published_at}
- 统计概览：主题分布（tags 汇总）、来源分布（host top3）、热度相对昨日（若能计算）

指令要点：

- 角色：你是一名专业的科技新闻编辑，输出主持人播报手稿。
- 风格：稳重、通俗、简洁；避免夸张语；不复读标题。
- 结构：按上文 JSON schema 输出严格 JSON（不加代码块）。
- 事实限制：只基于输入材料改写；不可编造未出现的数字/结论；对“传闻/未证实”明确弱化。
- 可理解性：给每条“一句话看点 + 为什么重要 + 下一步建议（面向研究者/企业/开发者之一）”。

---

## 7) 产物与路径

- 文本导读 JSON：`data/ai/airadar/briefings/YYYY-MM-DD.json`
- latest.json 附加轻量引用（便于前端快速发现）：

```json
{
  "briefing": {
    "date": "YYYY-MM-DD",
    "url": "/data/ai/airadar/briefings/YYYY-MM-DD.json",
    "sections": ["今日大事", "政策/融资", "研究/模型", "工具/产业"],
    "deep_dive_id": "<news-id>"
  }
}
```

---

## 8) 前端展示（lab/ai-radar.html）

- 顶部新增“今日导读”卡：
  - 标题 + 主题脉络一行（来自 meta.themes）
  - 折叠面板展示 sections/deep_dive/outro（条目可点击跳转到下方对应卡片）
  - 轻量占位：若当日未生成，隐藏卡片或显示“暂未生成”提示
- 与列表联动：点击导读中的条目时，滚动定位到对应新闻卡；并高亮 3 秒

（MVP 无音频播放器；后续加入 TTS 时在此卡上补播放器与字幕）

---

## 9) 生成流程（CI/本地任务）

在现有 AI Radar 日流程（fetch_feeds → aggregate_reports）之后新增一步：

1. 读取 latest.json（窗口 48h）
2. Top K 选择 + 分组 + 统计概览
3. 构造 LLM 输入并调用（tools.ai_llm.chat_once，如无 Key 则降级模板化生成）
4. 校验 JSON 与约束（长度/用词/是否越界事实）
5. 写入 `briefings/YYYY-MM-DD.json`，并在 latest.json 注入 briefing 引用（只含最小字段）

失败与降级：

- LLM 失败 → 生成“模板化导读”：仅基于 tags/时间/来源分布输出简要导读 JSON（无 deep_dive/counterpoint）。
- 任何异常都不影响 latest.json 的基本新闻列表产出。

---

## 10) 配置与环境变量（建议）

- BRIEFING_TOP_K（默认 12）
- BRIEFING_MODE（host_script）
- BRIEFING_MAX_TOKENS（LLM 输出上限）
- BRIEFING_SOURCE_BLACKLIST（可选，屏蔽低质量来源）
- LLM 提示/模型 复用 tools.ai_llm 的既有 ENV（如 DEEPSEEK_API_KEY 等），无需新增。

---

## 11) 质量与合规

- 校验器：
  - JSON Schema 基础校验（键是否齐、数组长度是否在范围内）。
  - 文风与事实检查：
    - 禁用词：唯一、必然、确定地、已证实（当输入未给证据时）；
    - 数字过拟合：出现百分号/具体金额/用户量时，需确认输入中存在；否则替换为“上升/下降/扩大/缩小”等模糊表述。
- 留痕：briefing 文件尾部附加 generation_log（模型、tokens、耗时、输入条目 ID）。

---

## 12) 监测指标（后续）

- 展示率：导读卡片曝光次数 / 页面访问量
- 互动率：导读内条目的点击率、深读点击率
- 复访率与平均停留时长变化
- 失败率：LLM 失败/降级触发次数

---

## 13) 开发清单（不立即提交代码，仅罗列）

- 新增：脚本 `tools/ai_radar/generate_briefing.py`
  - 读取 latest.json → 选 Top K → 组织输入 → 调用 chat_once → 写 briefing JSON
  - 降级模板生成器（无 LLM Key 或 LLM 失败）
- 修改：`tools/ai_radar/aggregate_reports.py`
  - 在生成 latest.json 的流程末尾，尝试写入轻量 briefing 引用（若 briefing 文件存在）
- 前端：`lab/ai-radar.html`
  - 加载 briefing 引用并拉取 JSON，渲染“今日导读”卡（无音频）
- CI：在 modelswatch-daily-full.yml 或单独 workflow 中，在 AI Radar 构建之后串上 `generate_briefing` 步骤

---

## 14) 时间线建议

- 第 1 天：实现 generate_briefing.py（含降级）、最小 Schema、前端卡片（文本版）
- 第 2–3 天：校验器与风格收敛、实验不同 Top K 与分组策略
- 第 4 天：上线小规模运行（工作日每天 1 次），观察点击与阅读路径
- 第 2 周：加入音频 TTS 与字幕（播放器），扩展“顾问式/电台式”模式

---

## 15) 未来扩展

- 多风格导读（consulting/radio），A/B 实验
- 片段级 TTS（段落切分 + 可跳播）与可视化字幕
- 导读主题订阅（仅政策/仅研究），生成个性化导读
- 事实核验流水线（针对敏感新闻做二次核验与来源对比）

---

如需，我可以基于此文档，在不影响现有抓取稳定性的前提下，提交一组最小可用的脚本与前端改动。
