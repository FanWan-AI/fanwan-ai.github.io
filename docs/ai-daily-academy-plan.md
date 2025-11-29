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

## 9. LLM Prompt 规范（课程详情 & 开场题）

### 9.1 课程卡片「查看详情」生成提示
- **System**：`You are the master instructor of AI Daily Academy. You write bilingual micro-lessons (zh / en) with expert accuracy, concrete examples, and actionable practice.`
- **Developer 指令**：
  - 使用输入 payload：`{topic, learner_profile, prerequisites, related_topics, difficulty, references, tone}`。
  - 输出 JSON（UTF-8）遵循 `daily.schema.json` 里 `content`, `summary`, `practice`, `references`, `meta.contextual_notes` 字段定义。
  - 语言：`zh` 必填，若 `learner_profile.prefersEnglish=true` 则同步生成 `en`。
  - 文风：结合 `tone.persona`（如“实验室 mentor”“企业顾问”）与 `tone.style`（如“数据驱动”“故事化”）。
- **User Prompt 模板**：
```
任务：为 AI 每日学堂生成课程详情。

主题：{{topic.name}}
难度：{{difficulty.label}}
学习者画像：{{learner_profile.summary}}
必备前置：{{prerequisites | join(", ")}}
关联拓展：{{related_topics | join(", ")}}
内容目标：
1. 30-60 字摘要，点出今天的核心启发；
2. 2-3 段正文（每段 <120 Chinese chars 或 <80 English words），包含公式/伪代码/案例；
3. 给出 1 条「行动建议」与 1 条「常见误区提醒」；
4. 设计练习题：至少 1 道 MCQ + 1 道应用题（free form），包含解析；
5. 输出 2-3 条参考资料，涵盖论文/文档/工具；
6. meta.contextual_notes 写出推荐理由与可视化提示。

在所有输出中，技术术语使用中英双语（如“自注意力 self-attention”），并明确量化指标（如“<2e-3 learning rate”）。
```
- **补充规则**：
  - 对于 `content.zh` 允许内联 `<strong>`、`<code>`；禁止外链脚本。
  - 题目答案格式：MCQ 使用索引整型，应用题中的 `rubric` 采用 2-3 条判断标准。
  - `meta.contextual_notes.zh` 必含 `why_now`、`best_for`, `visual_hint` 三个键，便于前端在 Tooltip 中渲染。

### 9.2 开场「开始联系」题目生成提示
- **用途**：课程卡片的「开始联系」按钮，用来引导学习者把概念联系到自身场景。
- **System**：`You design reflective prompts that connect AI theory with everyday decisions. Each starter question nudges the learner to relate today's topic to their domain.`
- **Prompt 模板**：
```
根据下列信息，输出 1-2 条「开始联系」问题：

主题：{{topic.name}}
行业画像：{{learner_profile.industries | join(", ")}}
当前挑战：{{learner_profile.pains}}
今日核心 takeaway：{{summary.zh}}

要求：
1. 每条控制在 60-90 字（中文）或 35-50 词（英文）。
2. 结构 = 「情境」+「自我评估问题」+「行动提示」；
3. 使用开放式问句，避免是/否；
4. 如有 `learner_profile.preferredMetrics`，将指标写入问题中。

以 JSON 数组返回：`[{"lang":"zh","question":"...","action_hint":"..."}, ...]`。
```
- **产出策略**：
  - 若学习者来自多行业，至少覆盖 2 个行业案例。
  - `action_hint` 提供下一步可执行动作，如“列出 3 个可监控指标”。
  - 若 `difficulty=advanced`，可附带比较两个方案的 prompt。

### 9.3 执行建议
- 将上述 Prompt 模板写入 `tools/academy/prompts/`（下一步 action）供脚本直接引用。
- 生成器需把 `starter_questions` 存入 `meta.starter_questions`，前端映射到 CTA。
- 对 Prompt 进行版本化（如 `PROMPT_VERSION=2025-11-29`），让历史记录可追溯。 

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
