# AI 前沿要闻 · 每日语音播报（Audio Brief）规格说明书

> 版本: v0.1 (MVP 设计)  
> 文档目的: 作为实现“AI 前沿要闻”每日自动语音播报功能的最小可行参考，适配当前站点 (GitHub Pages 静态托管 + GitHub Actions 自动化) 的约束。  
> 面向读者: 产品设计 / 研发实现 / 内容运营 / 后续维护者。

---

## 1. 产品定位 & 电梯语

**一句话**：每天 2 分钟，快速听懂全球高信号 AI 进展，不再来回点链接。

### 核心价值

- 节省时间：将精选新闻（已有 ai-radar 数据）压缩成结构化可听脚本。
- 降低噪声：去除低价值重复；只保留“事实 + 影响一句话”。
- 可验证：文本稿 + 来源引用；音频只是入口，不是黑箱。
- 可扩展：后续支持多语言 / 段落跳转 / Podcast。

### MVP 范围

| 能力 | 是否包含 | 说明 |
|------|-----------|------|
| 每日自动生成播报稿 | 是 | 基于现有 ai-radar 当日 JSON/数据输出 |
| 英文主稿 + 中文版本 | 推荐 | 可先只做中文 (极简)；正式版建议 EN 主稿再适配中文 |
| 音频合成 (TTS) | 是 | 云 API 生成 MP3；失败可降级为纯文本 |
| 页面展示 `<audio>` | 是 | `lab/ai-radar.html` 顶部新模块 |
| 多段时间戳跳转 | 否 (迭代) | MVP 用整段音频 |
| 多语言(西语) | 否 (迭代) | 后续加 |
| Podcast RSS | 否 (迭代) | 第 2 阶段 |
| 个性化 / 订阅推送 | 否 | 后续评估 |

---

## 2. 用户典型路径 (MVP)

1. 用户打开 AI 前沿要闻页面（`/lab/ai-radar.html`）。
2. 顶部看到“今日语音播报 · YYYY-MM-DD · 时长 02:1x”。
3. 点击播放 → 听 6–8 条核心事件（每条 1–2 句）。
4. 想深挖 → 向下滚动查看同日图文详细列表（已有模块）。
5. 没时间 → 播放 60 秒后离开，也能获得基本结构信息。

_后续（非 MVP）：点击条目列表某条 → 跳至该段时间戳。_

---

## 3. 数据来源与最小依赖

**唯一基础输入**：现有每日 ai-radar 数据（来源已在仓库生成或可配置 workflow 产出）。

### 建议数据输入文件（示例结构）

```json
data/ai/airadar/2025-10-06.json
{
  "date": "2025-10-06",
  "items": [
    {"id": "m1", "title": "OpenAI 发布新模型 X", "summary": "扩展多模态推理，支持...", "source": "OpenAI Blog", "url": "https://..."},
    {"id": "m2", "title": "Meta 模型 Y 参数更新", "summary": "提升推理效率 ...", "source": "GitHub", "url": "https://..."},
    {"id": "m3", "title": "...", "summary": "...", "source": "...", "url": "..."}
  ]
}
```

> 如果当前文件不包含 `summary`，可让 LLM 先做“标题→简要一句”补全（可选）。

---

## 4. 每日自动化流水线 (MVP) 概览

| 步骤 | 输入 | 处理 | 输出 |
|------|------|------|------|
| 1. 读取 | 当日新闻 JSON | 校验结构、存在性 | 内存对象 |
| 2. 组 Prompt | items 列表 | 生成 LLM 主稿（英文或中文） | 播报脚本初稿 |
| 3. 适配多语言 | 主稿 | 翻译/语义适配 | zh / en 版本文本 |
| 4. 长度/规则校验 | 文本草稿 | 截断 / 过滤敏感词 | 最终文本稿 |
| 5. 调用 TTS | 文本稿 | 云 API 合成 | MP3 文件 |
| 6. 写文件 | 文本/音频 | 保存并提交 | `assets/audio/...` + 脚本 JSON |
| 7. 更新索引 | 新增日期 | 读旧 index → 追加 | `data/ai/airadar/audio-index.json` |

---

## 5. 播报脚本结构规范

**控制目标**：总时长 ≈ 120–150 秒；语速按默认新闻播报。

```text
Opening (1 句)
MainEvents (6–8 条)
  - 每条 = [标签可选][事实一句][影响/意义一句(可选)]
Optional Micro Pulse (1 条，可留空)
Closing (1 句 + 可选“访问站点查看更多”)
```

### 量化约束

| 元素 | 约束 |
|------|------|
| Opening | ≤ 18 英文词 或 ≤ 28 汉字 |
| 单条事件事实句 | 英文 ≤ 18 词 / 中文 ≤ 30 字 |
| 影响句 (第二句) | 可选；若存在 ≤ 18 词 / ≤ 28 字 |
| 总事件数 | 6–8 |
| Closing | ≤ 15 英文词 / 25 汉字 |

### 标签（可选集）

`Model`, `Open-Source`, `Research`, `Policy`, `Safety`, `Funding`, `Infra`

---

## 6. LLM 生成策略（概念，不写代码）

### 6.1 主稿 Prompt 要点（英文）

- 指令：你是专业科技新闻编辑，任务是将若干 AI 相关新闻浓缩为一段可口播脚本。
- 输入：日期 + items 列表（title + summary + source）。
- 严格要求：
  1. 不添加未出现的实体/数据。
  2. 避免夸张词：revolutionary / unprecedented / game-changing 等。
  3. 输出 JSON（结构: opening, events[], closing）。
  4. 每个 event: { tag, fact, impact? }
  5. 若多条来源重复，不在 fact 内重复来源。

### 6.2 中文适配 Prompt 要点

- 输入：英文 JSON 主稿。
- 指令：自然、简洁、专业；不逐字直译；保留模型/组织英文名原样；控制总字数与句长。

### 6.3 失败与降级

| 情况 | 行为 |
|------|------|
| LLM 超时 / 429 | 重试一次；再失败 → 使用“标题拼接”简版纯文本（不生成音频） |
| 输出字段缺失 | 补空值；仍可用 |
| 字数超标 | 截断末尾多余事件或删 impact 句 |

---

## 7. 文本校验与清洗逻辑（规则层面）

| 规则 | 处理 |
|------|------|
| 长度超标 | 逐级：移除 impact 句 → 截事件尾部 |
| 敏感/禁止形容词 | 词表替换或删除 |
| 空事件 | 过滤 |
| 重复事实（Jaccard > 0.8） | 去重保留前者 |
| 数字/日期格式 | 英文用“Oct 6” / 中文用“10月6日” |

---

## 8. 音频合成 (TTS) 方案选择

### 8.1 推荐首发：云 TTS

| 供应商 | 优点 | 备注 |
|--------|------|------|
| Azure Cognitive Services | 多语高质量，News 风格 | 声线例: zh-CN-Xiaoxiao / en-US-Guy / en-US-Jenny |
| AWS Polly | 成本低 | 发音较中性，可先用 |
| ElevenLabs | 拟人度高 | 成本略高，注意速率限制 |

> MVP 建议：选一个即可，不做多引擎切换。

### 8.2 调用形式

- **整段模式**：整份脚本一次送入，产出一个 MP3（最简）。
- 分段模式（迭代）：每条 event 单独合成 → 前端支持跳段/高亮。

### 8.3 输出文件结构

```text
assets/audio/ai-radar/2025/10/06/brief-en.mp3
assets/audio/ai-radar/2025/10/06/brief-zh.mp3  (可选)
```

> 建议使用 48–64 kbps mono MP3，控制文件大小 < 500 KB。

### 8.4 失败降级策略

| 场景 | 展示方式 |
|------|----------|
| TTS 全失败 | 页面显示“音频生成延迟，现提供文本稿” |
| 单语言失败 | 只隐藏失败语言按钮 |

---

## 9. 输出文件与索引

### 9.1 脚本归档（结构化）

```json
data/ai/airadar/brief/2025-10-06.json
{
  "date": "2025-10-06",
  "version": 1,
  "langs": ["en","zh"],
  "opening": {"en": "...", "zh": "..."},
  "events": [
    {"id": "evt1", "tag": "Model", "fact": {"en": "...", "zh": "..."}, "impact": {"en": "...", "zh": "..."}},
    {"id": "evt2", "tag": "Open-Source", "fact": {"en": "...", "zh": "..."}}
  ],
  "closing": {"en": "...", "zh": "..."},
  "audio": {
    "en": "assets/audio/ai-radar/2025/10/06/brief-en.mp3",
    "zh": "assets/audio/ai-radar/2025/10/06/brief-zh.mp3"
  },
  "generated_at": "2025-10-06T04:07:12Z",
  "status": "ok"
}
```

### 9.2 索引文件

```json
data/ai/airadar/audio-index.json
{
  "latest": "2025-10-06",
  "items": [
    {"date": "2025-10-06", "langs": {"en": true, "zh": true}, "duration_sec": 132, "status": "ok"},
    {"date": "2025-10-05", "langs": {"en": true}, "duration_sec": 118, "status": "text-only"}
  ]
}
```

前端引用 `audio-index.json` 判断是否显示“今日语音播报”模块。

---

## 10. GitHub Actions 概念流程（伪步骤）

> 不写具体脚本，只描述逻辑顺序。

1. 触发：CRON（例：`0 4 * * *` UTC）。
2. Checkout 仓库。
3. 解析日期变量（例如：`TODAY=YYYY-MM-DD`）。
4. 检查 `data/ai/airadar/TODAY.json` 是否存在；不存在则 Fail + 退出或延迟重试。
5. 调用 LLM 生成英文主稿 (或中文单稿)。
6. （可选）多语言适配（中文）。
7. 校验 / 截断 / 去重。
8. 写脚本 JSON (`brief/DATE.json`)。
9. 调用 TTS（每语言 1 次）。
10. 写 MP3 到 `assets/audio/...`；记录时长（可解析本地播放或估算字数 * 系数）。
11. 更新 `audio-index.json`（读取旧 → prepend 新 → 限制长度 N 条）。
12. Git 配置用户名 / 邮箱 → Commit → Push。
13. 若任一步失败：更新 Issue 或在索引中写入 `status: text-only`。

---

## 11. 质量与风险控制 (MVP 级)

| 风险 | MVP 处理 | 后续增强 |
|------|----------|----------|
| 幻觉添加不存在事实 | Prompt 明示“不得引入未在输入中出现的主语/数字” | 结构化事实抽取对比 |
| 事件重复 | 简单相似度（标题相同或含核心 bigram）去重 | 语义嵌入聚类 |
| 长度失控 | 规则截断 | 动态依据 TTS 速率估算 |
| API 限流 | 单次失败重试 | 多模型后备池 |
| 成本上涨 | 控制条目数 & 只多语言一次 | 缓存重复事件描述 |

---

## 12. 迭代路线图

| 阶段 | 目标 | 新增能力 |
|------|------|----------|
| v0.1 | 最小闭环 | 英文或中文 + 整段音频 |
| v0.2 | 双语 & 指标 | EN + ZH、索引、状态标记 |
| v0.3 | 可靠性 | Fallback、播报状态提示、Fail Issue |
| v0.4 | 体验 | 分段时间戳 / 段落跳转 |
| v0.5 | 分发 | Podcast RSS、简单播放统计 |
| v1.0 | 增强 | 第三语言、预测钩子、个性声线 |

---

## 13. 命名规范与目录组织

| 类型 | 路径示例 | 说明 |
|------|----------|------|
| 输入源 | `data/ai/airadar/2025-10-06.json` | ai-radar 原始精选/聚合数据 |
| 脚本输出 | `data/ai/airadar/brief/2025-10-06.json` | 结构化播报脚本 |
| 音频输出 | `assets/audio/ai-radar/2025/10/06/brief-en.mp3` | 按年/月/日分层 |
| 索引 | `data/ai/airadar/audio-index.json` | 前端入口引用 |
| 运行日志(可选) | `.logs/ai-radar-audio/2025-10-06.txt` | 仅 Actions Artifact 保存 |

---

## 14. 成功验收指标 (MVP)

| 指标 | 目标 |
|------|------|
| 每日生成成功率 | ≥ 90% |
| 音频时长偏差（目标 2 分钟） | ± 20 秒内 |
| 用户实际播放点击率（页面模块出现时） | ≥ 25% |
| 页面无重大事实错误反馈 | 连续 14 天 0 次 |
| 生成耗时（Actions 总用时） | < 5 分钟 |

---

## 15. 后续扩展占位（非 MVP）

- 分段 TTS + WebVTT → 逐句高亮 / 快速跳转
- 增加“今日热度微图” (sparkline) 与“明日关注”段落
- Podcast 订阅转换率追踪
- 指标注入：来源去重率 / 影响力分布
- 多主题订阅：用户偏好筛选（后端或离线切片）

---

## 16. 常见问题 (FAQ)

**Q: 如果当天 ai-radar 数据延迟？**  
A: 可在 Actions 中先等待/重试，或生成占位脚本：只播报“今日数据延迟，将很快更新”。

**Q: 为什么推荐英文为主稿？**  
A: 专有名词与术语在英文环境一致性最好，便于后续翻译保持准确性。

**Q: 如果 TTS API 突然价格上涨？**  
A: 可快速切 gTTS 过渡（质量下降但不中断功能），同时评估替代供应商。

**Q: 要不要做情感/口播风格？**  
A: MVP 不加，避免过多停顿或夸张语气破坏“可信中性”的基调。

---

## 17. 术语表 (初稿)

| 术语 | 说明 |
|------|------|
| 主稿 (Master Script) | 第一个生成的基线语言脚本（推荐英文） |
| 适配翻译 | 基于主稿语义重写为目标语言自然表达 |
| Fallback (降级) | 在部分环节失败时的替代方案（文本-only / 延迟标签） |
| 索引文件 | 列出所有已发布音频的检索入口 JSON |
| 事件条目 (Item) | ai-radar 原始数据中的单条新闻单元 |

---

## 18. 极简执行指南（口袋卡片）

1. 确认当日 `ai-radar` JSON 已生成。
2. 调 LLM → 结构化脚本 JSON (opening + events + closing)。
3. 多语言适配（可选）。
4. 校验长度 / 去敏感词。
5. 云 TTS → MP3。
6. 写脚本 + 音频 + 更新索引。
7. Commit & Push → 页面出现“今日语音播报”。

> 如果第 5 步失败：跳过音频，索引标 `status: text-only`。

---

## 19. 维护与演进建议

| 场景 | 检查频率 | 行动 |
|------|----------|------|
| 幻觉与错误 | 每周抽检 2–3 日 | Prompt 迭代 & 补充禁止词列表 |
| 音频调用成本 | 每月 | 评估是否需要缓存或限长 |
| 多语言自然度 | 每月 | 抽样比较“直译 vs 当前”差异 |
| 用户行为（播放完成率） | 每两周 | 调整脚本长度 or 减少事件条数 |

---

## 20. 附录：MVP Prompt 示意（概念草稿）

> 不直接用于生产，可在实现时具体化。

### 主稿（英文）概念模板

```text
You are an AI industry news script editor. Date: {{DATE}}
Input items (title, one-line summary, source):
{{ITEMS_JSON}}
Task: Produce a concise audio script under ~2 minutes.
Structure (JSON): {
  opening: string,
  events: [ { tag, fact, impact? } ],
  closing: string
}
Constraints:
- 6 to 8 events
- No invented facts or numbers
- Avoid hype words (revolutionary, unprecedented, game-changing)
- Each event fact <= 18 English words; impact sentence optional
Return ONLY JSON.
```

### 中文适配概念模板

```text
你将收到英文脚本 JSON。请用自然、专业、精炼中文表达，保持结构，保留模型/机构英文名。
控制：单条事实句 ≤ 30 字；避免夸张词；不新增新信息。
输入：{{EN_JSON}}
输出：同结构 JSON (opening, events[], closing)。
```

---

### 文档结束
