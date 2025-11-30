# AI 每日学堂落地方案

> 更新时间：2025-11-29
>
> 参考依据：`docs/每日学堂设计建议.md`、`lab/ai-wealth.html`、`tools/wealth/wealth.js`。
>
> 目标：把 AI Lab 中 Beta 状态的“AI 每日学堂”落地为可交互、可持续运营的微课程模块。

## 1. 页面与导航

### 1.1 新页面 `lab/ai-daily-academy.html`
- 套用 AI 理财助手的结构：全局导航、Hero、双列内容区、尾部免责声明。
- Hero 文案示例：
  - 标题：`AI 每日学堂`
  - 副标题：`每天 10 分钟，构建你的 AI 核心知识体系`
  - CTA：`立即学习 / Explore today`（锚点跳转到课程面板）。
- 背景继续使用渐变 + 氛围粒子，颜色偏蓝紫，区分财富模块的绿色系。

### 1.2 主内容区
1. **今日课程面板**
   - 结构：课程元信息、摘要、难度/主题徽章、音频播放按钮、练习入口、参考资料。
   - 支持分页浏览历史课程（每页 10-12 条）。
   - Modal：沿用 wealth 模块的弹窗样式，用于完整内容或练习题。
2. **学习进度面板**
   - 统计卡片：累计完成课程数、连续天数、XP/积分。
   - 热力日历（占位 SVG）展示最近 4 周活跃度。
   - 排行 / 徽章列表：从本地数据生成（示例数据）。
   - CTA：设置目标、清除本地记录。

### 1.3 导航与 Lab 卡片
- `ai-lab.html`：
  - 把“Beta 申请”按钮改成 `立即体验`，链接 `/lab/ai-daily-academy.html`。
  - `data-status="live"`，progress bar 调整为 100%。
- 可在主导航「AI 工坊」下添加子链接或保留锚点，视交互而定。

## 2. 前端脚本 `tools/academy/academy.js`

### 2.1 数据与缓存
- `DAILY_URL = "/data/ai/daily-academy/daily.json"`（包含 N 条课程记录，按时间降序）。
- 可选 `DETAIL_URL`：`/data/ai/daily-academy/{id}.json` 用于加载扩展内容。
- 复用 wealth 模块的缓存工具：`localStorage` + TTL（1 小时）。

### 2.2 渲染函数
| 函数 | 说明 |
| --- | --- |
| `renderLessons(data)` | 生成课程列表、分页、当前激活项。 |
| `renderLessonCard(entry)` | 渲染主卡片，包含音频播放器、练习按钮、参考资料等。 |
| `renderPracticeModal(entry)` | 显示题目、即时反馈、答题记录计入本地 XP。 |
| `renderProgress()` | 读取本地进度（完成数、连续天数、XP、徽章），刷新统计区块与热力图。 |
| `updatePagination()` | 控制页码、按钮状态、ARIA 描述。 |

### 2.3 交互逻辑
- **音频**：若 `entry.audio[lang]` 存在，则显示播放按钮，使用 `<audio>` 或 Web Audio；支持自动切换语言文件。
- **练习**：
  - 题型：单选、多选、填空。结构参考 `practice` 字段。
  - 答题后写入 `localStorage`：`academy_progress_v1 = { completed: { [id]: timestamp }, streak, xp, badges }`。
  - 反馈信息使用新 i18n 键，如 `academy_practice_correct`, `academy_practice_incorrect`。
- **进度设置**：提供“清空数据”“导出记录（JSON）”按钮，符合数据最小化原则。
- **历史浏览**：分页 + 日期选择（可先实现分页，日历选择留作增强）。

## 3. 数据与内容生产

### 3.1 JSON Schema（示意）
```json
{
  "id": "2025-11-29-risk-sense",
  "date": "2025-11-29",
  "title": { "zh": "AI 基础算子", "en": "Core AI Operators" },
  "subtitle": { "zh": "每天 10 分钟理解 AI" },
  "summary": { "zh": "...第一段摘要..." },
  "difficulty": "beginner",
  "tags": ["LLM", "Prompting"],
  "content": { "zh": "<p>HTML 内容</p>" },
  "practice": [
    {
      "type": "mcq",
      "question": { "zh": "Transformer 的核心组件是？" },
      "options": ["RNN", "Self-Attention", "CNN", "SVM"],
      "answer": 1,
      "explain": { "zh": "原因说明" }
    }
  ],
  "references": [
    { "label": { "zh": "Attention is All You Need" }, "url": "https://arxiv.org/abs/1706.03762" }
  ],
  "audio": { "zh": "/assets/audio/daily/2025-11-29-zh.mp3" }
}
```

### 3.2 生成脚本
- 目录 `tools/academy/`：
  - `generate-daily.mjs`：解析 markdown/config，输出 `daily.json` + 逐日 detail JSON。
  - `tts_daily.py`：批量生成 TTS（可调用外部 API）。
- GitHub Actions：新增 workflow（或扩展现有脚本）
  - 步骤：`checkout → npm install → node tools/academy/generate-daily.mjs → python tools/academy/tts_daily.py → 上传 data/audio`。

### 3.3 内容运营建议
1. 上线时至少准备 7 天课程，覆盖“AI 理解、LLM、Prompt 设计、AI 伦理”等主题。
2. 设立 `docs/ai-daily-academy.md`（或本文件）记录课程规范、命名规则、内容审核流程。

## 4. 国际化 & 无障碍
- `lang.js` 新增键：
  - 元信息：`academy_meta_title`, `academy_meta_desc`。
  - UI：`academy_today_label`, `academy_list_empty`, `academy_audio_label`, `academy_practice_cta`, `academy_progress_title`, `academy_completed_label`, `academy_streak_label`, `academy_xp_label`, `academy_goal_cta`, `academy_history_prev/next`, `academy_clear_progress`, `academy_export_progress`。
  - 练习反馈：`academy_practice_correct`, `academy_practice_incorrect`, `academy_practice_score`。
- 无障碍：
  - 所有按钮加 `aria-label`。
  - Modal 支持键盘聚焦循环。
  - 颜色对比保持 >= WCAG AA。
  - 音频控件提供文本描述。

## 5. 隐私 & 本地存储
- 仅存储：`completedLessons`, `streak`, `xp`, `preferredDifficulty`, `lastVisitedDate`。
- 提供“清空数据”与“导出 JSON”入口。
- 在页面尾部或设置区域说明“数据保存在浏览器本地，随时可清除”。

## 6. 集成步骤汇总
1. **Scaffold 页面** `lab/ai-daily-academy.html`。
2. **实现脚本** `tools/academy/academy.js` 并在页面中加载。
3. **准备数据**：`data/ai/daily-academy/daily.json` + 示例 detail/audio。
4. **更新 i18n** `lang.js`，`lang-preload.js` 如需。
5. **修改 AI Lab** `ai-lab.html`（CTA、状态、描述）。
6. **SW/manifest**（可选）：缓存新资源。
7. **文档**：本文件 + README 关联说明。

## 7. 后续增强路线
- **学习日历**：真正的交互式日历或时间线视图。
- **排行榜**：与外部后端同步（可选）。
- **账号整合**：与站点未来身份系统接轨。
- **多模态练习**：引入代码沙盒、快速问答悬浮窗。

## 8. 实施记录与运维提示
1. **脚本与入口**
  - 页面：`lab/ai-daily-academy.html` 已上线，Lab 卡片 CTA 直达。
  - 主脚本：`tools/academy/academy.js`（模块化加载）。负责数据抓取、课程渲染、练习判分、热力图、徽章与导出/清除本地记录。
  - 本地存储键：`academy_progress_v1`（结构 `{ completed, xp, streak, lastCompletedDate, badges }`）。如需重置可通过 UI 的“清除本地数据”按钮或 `localStorage.removeItem`。

2. **数据资源**
  - 数据目录：`data/ai/daily-academy/`，主文件 `daily.json`（含 `generatedAt` 与 `lessons` 数组）。
  - 每条 `lesson` 记录支持 `title/summary/content/practice/audio/references` 多语言字段；参考示例已写入当前 JSON。
  - 新增课程时保持按日期降序；若有长内容可在 `content.zh` 中写 HTML 片段。
  - 可选 detail JSON 仍保留扩展空间：`/data/ai/daily-academy/{id}.json`（脚本留有接口）。

3. **生产流程建议**
  - 仍建议编写 `tools/academy/generate-daily.mjs`（未完成部分）以从 Markdown 合并进 JSON；临时可直接手工编辑 `daily.json`。
  - 若补充 TTS，可把音频放在 `/assets/audio/daily/`，并在条目 `audio.zh` 中填写绝对路径。
  - 更新数据后无需构建前端 bundle，刷新即可读取最新 JSON；必要时清除 1h 缓存（`localStorage.removeItem('academy_daily_v1')`）。

4. **隐私说明执行**
  - Progress 面板已经在 UI 文案中标注“仅保存在浏览器，可导出/清除”。
  - 所有练习数据、徽章、热力图均在本地计算，不会向服务器回传；导出文件命名 `academy-progress-YYYY-MM-DD.json`。
  - 若未来接入云端同步，需要在此文档与页面底部补充隐私声明并更新 `academy.js` 的存储逻辑。

---

> 若需进一步拆解任务，可参考 todo：
> 1. Scaffold 页面
> 2. 实现 JS 模块
> 3. 准备数据与脚本
> 4. 更新 AI Lab & i18n
> 5. 文档与运营计划

## 9. LLM Prompt 规范（Blueprint → Lesson → Critic → Revision → Starter）

### 9.0 生成流程
1. **Blueprint 架构师**：首先让 LLM 以「课程蓝图设计师」身份输出结构化 JSON（sections + practice_suite + reference_pool + toolkit + contextual_hooks）。该步只负责列提纲、量化指标、真实参考来源与多步练习草稿，禁止直接写正文。
2. **Lesson 扩写**：第二次调用以「首席讲师」身份，根据蓝图扩写 `summary/content/practice/references/meta.contextual_notes`。所有正文遵循 schema，练习与参考必须引用蓝图结果。
3. **Critic + Revision 循环**：第三次调用 `buildLessonCritiquePrompt` 让 LLM 担任裁判，对草稿进行评分并输出结构化整改指令；若 `revision_required=true`，第四次调用 `buildLessonRevisionPrompt`，用上一轮 critique + blueprint + lesson 原稿进行定向改写，直到满足题量/引用要求（当前实现一次循环，若未来需要可扩展多轮）。
4. **Starter 反思题**：独立调用 `buildStarterPrompt`，生成 1-2 条情境化提问，并写入 `meta.starter_questions`。

> Prompt 版本号 `PROMPT_VERSION` 维持在代码中统一管理，便于追踪历史输出。

### 9.1 课程蓝图 Prompt（`buildLessonBlueprintPrompt`）
- **System**：`You are a curriculum architect for AI Daily Academy. You design exhaustive outlines before any prose is written.`
- **核心约束**：
  1. `sections`：固定 4 节（概念诊断/案例飞轮/推导演练/实践冲刺，可按需重命名），字段 `{id,title,angle,pain_signal,key_questions,case,metrics,tools,steps,worked_example}`。`pain_signal` 要描述真实业务痛点，`worked_example` 需写出包含数字、矩阵或代码片段的示例，`metrics` 引用 preferredMetrics 或新增可计算指标，`tools` 必须给出公开网址（缺少则写“敬请期待”并解释用途）。
  2. `practice_suite`：至少 4 题，含 MCQ + multi + input，多步指令写在 `prompt/steps`，并附 `options/answer/explain/data_asset`；MCQ 至少 4 个选项，multi 至少 3 个选项且 `answer` 使用索引数组，input 题的 `answer` 填评分 rubric，并说明所用数据/公式。
  3. `reference_pool`：3-5 条真实 HTTPS 链接 + 8-12 字 note，禁止 example.com、dummy、404 链接。
  4. `toolkit`：列出 2-3 个工具或模板下载提示 `{name,url,usage}`，无真实链接时用“敬请期待”。
  5. `contextual_hooks`：给出 `why_now / best_for / visual_hint`，供 meta 直接引用。
- **输出**：纯 JSON 字符串（无 Markdown 包裹），供下一阶段扩写调用。

### 9.2 课程详情 Prompt（`buildLessonDetailPrompt`）
- **System**：`You are the master instructor...`（与代码保持一致）。
- **Developer 指令**：按 `daily.schema.json` 输出多语言字段，消费 blueprint + learner_profile + tone_profile。
- **内容目标**：
  1. `summary.zh` 30-60 字，总结可量化洞察。
  2. `content.zh` 使用 `<h3>` 拆成固定四节（痛点与直觉 / 推导演练 / 工具与评估 / 实践冲刺），每节 110-160 中文字，包含真实数字或百分比描述、至少 1 个公式/矩阵/伪代码（`<pre><code>` 或 `<table>`），以及 3 步可执行清单（`<ol>`/`<ul>`）。
  3. 至少一节必须写出完整 worked example：列出原始数据、逐步计算与结果；“实践冲刺”节需列 3 步执行清单 + 工具/模板（无链接写“敬请期待模板”），并说明如何追踪 `time_to_value`、`quality_score` 等指标。
  4. `practice` 必须沿用蓝图 `practice_suite`，至少 4 题：包含 1 道 MCQ、1 道 multi、1 道 input，多步动作要写在题干中；MCQ/multi 必须附 >=4 / >=3 个选项并用索引用答，input 题 `answer` 填评分 rubric，并至少有 1 道题引用数据表/矩阵/公式。
  5. `references` 只能取自蓝图 `reference_pool` 的真实 HTTPS 链接；若模型无法确认真实性，直接输出 `label={zh:"暂无公开参考（Internal insight）", en:"Internal insight only"}` 且 `url` 置空。
  6. `meta.contextual_notes` 继承蓝图 `contextual_hooks` 并根据当天课程微调，确保 `why_now / best_for / visual_hint` 均存在。
- **防重复策略**：payload 中注入最近 5 条课程（id/date/tags），模型需避免复用上一日的案例或措辞。

### 9.3 Critic & Revision Prompt（`buildLessonCritiquePrompt` / `buildLessonRevisionPrompt`）
- **Critic System**：`You are the lead reviewer ...`，要求输出 JSON：
  ```json
  {
    "revision_required": true,
    "scorecard": {
      "structure": {"score": 3, "notes": "段落划分可"},
      "accuracy": {"score": 4, "notes": ""},
      "depth": {"score": 2, "notes": "缺少推导演练"},
      "practice": {"score": 2, "notes": "题量不足"},
      "references": {"score": 3, "notes": ""}
    },
    "issues": [{"area": "depth", "severity": "high", "note": "缺少 worked example 与公式", "action": "补齐含数字的推导"}]
    ,
    "strengths": ["案例贴近高校"],
    "directives": ["将成长飞轮指标写成 KPI", "补齐 4 题测试"],
    "practice_expectations": {"min_questions": 4, "required_types": ["mcq", "multi", "input"], "require_data_driven": true},
    "content_expectations": {"require_worked_example": true, "require_formula": true, "require_steps": true, "min_sections": 4}
  }
  ```
- **Revision System**：`You are the master instructor revising ...`，需携带 blueprint、critique、previous_lesson，按 `REVISION_OBJECTIVES` 输出全新 JSON。要求：
  - 完整保留 schema；题目数量 ≥4（含 MCQ + multi + input），练习需引用数据或计算并附答案解析；
  - 优先按照 `critique.directives` 修改段落、指标、参考，必要时换用 blueprint.reference_pool 中未使用资源；
  - 若 critic 认为 references 不可信，则返回 “暂无公开参考（Internal insight）”；
  - 确保每节都含 worked example/公式/步骤，至少写 1 个 `<pre><code>` 或 `<table>` 推导块。

### 9.4 开场「开始联系」Prompt（`buildStarterPrompt`）
- **用途**：渲染前端“开始联系”按钮，强化自我映射。
- **要求**：每条 60-90 字（中文）或 35-50 words（英文），遵循“情境 → 自我评估 → 行动提示”结构；若 `preferredMetrics` 存在，必须把指标写入问题；多行业画像时至少覆盖 2 个真实场景。
- **输出**：JSON 数组，元素结构 `{"lang","question","action_hint"}`，无 Markdown 包裹。

### 9.5 执行备注
- Prompt 模板集中放在 `tools/academy/prompts/index.mjs`，并由脚本自动注入 `PROMPT_VERSION`。任何更新需同步 bump 版本号。
- 生成器在 `generate-daily.mjs` 中顺序执行 blueprint → lesson → critic → revision → starter，并把最终 `starter_questions` 写入 `meta.starter_questions`。
- 校验脚本会剔除 example.com 等占位链接；若全部参考失效，会自动 fallback 为“暂无公开参考（Internal insight）”。
- Practice 结果至少 4 题，且包含 MCQ / multi / input；若 LLM 仍缺失类型，脚本会自动补题并生成解析。答案与解析全部由 LLM 输出（或由脚本提示 LLM 生成）。

## 10. 自动化运行流程

- **本地命令**（已写入 `package.json`）
  - `npm run academy:generate`：调用 LLM，挑选主题并更新 `daily.json`（使用 `.env` 中的 `LLM_API_KEY / LLM_BASE_URL / LLM_MODEL`）。
  - `npm run academy:validate`：用最新 schema 校验 `daily.json` 与 `topics.json`。
  - `npm run academy:tts`：读取最新课程，调用 DashScope 语音接口，把 `content.zh` 合成为 `/assets/audio/daily/{id}-zh.mp3` 并同步写回 `daily.json`。
  - `npm run academy:daily`：顺序执行 generate → validate → tts，供人工或 CI 直接复用。
- **环境变量**
  - LLM：`LLM_API_KEY`（或 `OPENAI_API_KEY`）、可选 `LLM_BASE_URL`、`LLM_MODEL`。
  - TTS：`DASHSCOPE_API_KEY` 必填，可选 `DASHSCOPE_TTS_MODEL`、`DASHSCOPE_TTS_ENDPOINT`、`TTS_VOICE`、`TTS_AUDIO_FORMAT`、`TTS_MAX_CHARS`。
- **GitHub Actions**
  - 新增 `academy-daily.yml`（见 `.github/workflows/`），每天定时运行 Node 20 workflow：install → `npm run academy:daily` → commit/push。
  - 在仓库 secrets 中配置 `DEEPSEEK_API_KEY / BASE_URL / MODEL`（或其它 provider）以及 `DASHSCOPE_API_KEY`、`ACADEMY_TTS_VOICE`（可选）。
- **质量把关**
  1. 生成脚本会把 `starter_questions`、`tone_profile`、`learner_profile` 等 meta 写回 JSON，前端可直接消费。
  2. TTS 脚本把 `summary + content` 组装为 narration，自动裁剪到 `TTS_MAX_CHARS`，避免语音被截断。
  3. 验证失败时 workflow 会中止并标记失败，避免不完整内容被推送。
