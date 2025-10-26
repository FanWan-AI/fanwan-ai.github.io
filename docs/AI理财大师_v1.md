# 《AI 理财助手（AI Wealth Mentor）》落地白皮书 · 极简可实施版（v1.1）

> 形态：纯静态站（GitHub Pages） + JSON 数据 + Node 脚本 + GitHub Actions（LLM 在 CI 侧调用）
> 范围：仅包含**每日理财课**与**市场快讯**两块，保证**少即是多**、**稳定可运维**。

---

## 0. 执行摘要（TL;DR）

* **MVP 核心**：

  * 每天 1 条**理财学习卡**（双语/三语，含摘要/要点/练习/参考）。
  * （可选）每天/每周 1 组**市场要闻摘要**（事实+影响一句话）。
* **纯静态实现**：生成在 CI 侧完成；前端仅 `fetch` JSON 渲染。
* **代码变更点**：新增 1 个页面 + 3 个脚本 + 2 个工作流 + 2 份数据契约。
* **目录约定**：

  ```
  data/ai/wealth/               # 数据目录（新增）
    topics.json                 # 你的已存在选题池（不改）
    finance-daily.json          # 每日理财课（滚动窗口）
    finance-daily-archive/      # 月归档
    pulse.json                  # 市场快讯（可选）
    pulse-archive/              # 月归档
  tools/wealth/                 # 脚本与前端控制（新增）
    util.mjs
    generate-daily.mjs
    generate-pulse.mjs
    wealth.js                   # 前端页面控制脚本（按你要求放在 tools/ 下）
  lab/ai-wealth.html            # 页面（新增）
  .github/workflows/
    wealth-daily.yml            # 日更工作流（必需）
    wealth-pulse.yml            # 快讯工作流（可选）
  ```

---

## 1. 项目背景与目标

### 背景

* 站点为 **静态托管**，不适合在前端直接调用 LLM；
* 你已具备 **GitHub Actions** 自动化经验与 **JSON 数据驱动前端**的常规做法；
* 目标是让**零基础用户**每天“学一点、懂一点”，逐步从“存钱思维→理财思维”。

### 目标（本期）

* **稳定日更**：每日自动产出 1 课；
* **无后端依赖**：安全、简单、可迭代；
* **低耦合**：后续功能（比如知识图谱/TTS）可随时插拔接入。

### 成功标准（KPI）

* 连续 14 天日更成功率 ≥ **95%**；
* 首屏渲染 ≤ **1.5s**（移动端）；
* JSON 回退/归档策略正确，**不阻塞展示**；
* 明确的“非投资建议”合规提示。

---

## 2. 功能范围与用户体验

### 2.1 每日理财课（Daily Lesson）

* **内容**：

  * 标题（中/英/西可选）
  * 摘要（≤80字）
  * 3–5 个要点
  * 1 个“今天就能做”的小练习
  * 1–3 条参考来源
  * `degraded` 标记（当日生成失败沿用上一条时）
* **体验**：

  * 页面顶部大卡展示“今日主题”，下面展示近 30 条历史卡片（分页/懒加载）。
  * 语言切换沿用全站 i18n 规则：`zh > en > es` 回退。
  * 首次访问展示“教育用途、非投资建议”的提示条。

### 2.2 市场快讯（Market Pulse，**可选**）

* **内容**：

  * 3–5 条当日要闻（标题、来源、时间、简要事实、**影响一句话**）。
  * **不提供交易建议**、不做个股/币示例；仅解释经济逻辑与可能影响方向。
* **更新频率**：

  * 日更或周更二选一（MVP 建议**周更**，降低失败面）。
* **体验**：

  * 独立卡片区块，按日期折叠；
  * 每条要闻后附“延伸阅读”链接（外链打开新页）。

---

## 3. 数据契约（Data Contracts）

> 统一采用三语结构：`{ zh: string, en?: string, es?: string }`，缺失时回退。

### 3.1 `finance-daily.json`（滚动窗口，保留近 60 条）

```json
[
  {
    "date": "2025-10-26",
    "topic_id": "compound-interest",            // 与 topics.json 对应的 id（若有）
    "topic": { "zh": "什么是复利？", "en": "The Power of Compounding" },
    "summary": {
      "zh": "复利让利息也产生利息，时间是增长的加速器。",
      "en": "When interest earns interest, time accelerates growth."
    },
    "key_points": {
      "zh": ["公式：本金×(1+r)^t", "越早开始越关键", "稳定复利优于短期暴利"],
      "en": ["Formula P×(1+r)^t", "Start early", "Stable beats spurts"]
    },
    "practice": {
      "zh": "用复利计算器试算10年后金额；记录感受。",
      "en": "Try a 10-year compound calculator; note your takeaway."
    },
    "sources": ["Investopedia: Compound Interest"],
    "degraded": false
  }
]
```

**归档策略**

* 超出 60 条即把最早的若干条**搬到**：`data/ai/wealth/finance-daily-archive/YYYY-MM.json`
* 前端只读 `finance-daily.json`，历史深度查看可后续提供档案页。

### 3.2 `pulse.json`（可选，默认 3–5 条/日或/周）

```json
[
  {
    "date": "2025-10-26",
    "items": [
      {
        "title": "央行维持利率不变",
        "source": "Official Statement",
        "time_utc": "2025-10-26T02:30:00Z",
        "facts": { 
          "zh": "政策利率维持x%，继续缩表。",
          "en": "Policy rate on hold at x%; balance sheet runoff continues."
        },
        "impact_one_liner": {
          "zh": "短期利率不变通常抑制波动，但通胀预期将决定中长期利率方向。",
          "en": "Stable policy rate tempers near-term volatility; inflation expectations guide the curve."
        },
        "links": ["https://..."]
      }
    ]
  }
]
```

**归档策略**

* 同理，月度归档至 `data/ai/wealth/pulse-archive/YYYY-MM.json`。

---

## 4. 自动化流水线（CI/CD）

### 4.1 Secrets

* `LLM_API_KEY`：LLM 服务密钥（DeepSeek / OpenAI / 其他）。
* （可选）`NEWS_API_KEY`：若你要抓取外部财经头条源，由你自定。

### 4.2 日更工作流（必做） `.github/workflows/wealth-daily.yml`

```yaml
name: Wealth Daily
on:
  schedule: [{ cron: "0 0 * * *" }]    # UTC 00:00 ≈ 东京/北京 09:00
  workflow_dispatch: {}
jobs:
  daily:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - name: Install deps
        run: npm ci || npm i
      - name: Generate daily lesson
        env: { LLM_API_KEY: ${{ secrets.LLM_API_KEY }} }
        run: node tools/wealth/generate-daily.mjs
      - name: Commit & push
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          if [ -n "$(git status --porcelain)" ]; then
            git add -A
            git commit -m "chore(wealth): daily lesson $(date -u +%F)"
            git push
          else
            echo "No changes."
          fi
```

### 4.3 快讯工作流（可选） `.github/workflows/wealth-pulse.yml`

```yaml
name: Wealth Pulse
on:
  schedule: [{ cron: "15 0 * * 1-5" }]  # 工作日 UTC 00:15（或改为周一执行）
  workflow_dispatch: {}
jobs:
  pulse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - name: Install deps
        run: npm ci || npm i
      - name: Generate market pulse
        env:
          LLM_API_KEY: ${{ secrets.LLM_API_KEY }}
          NEWS_API_KEY: ${{ secrets.NEWS_API_KEY }}
        run: node tools/wealth/generate-pulse.mjs
      - name: Commit & push
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          if [ -n "$(git status --porcelain)" ]; then
            git add -A
            git commit -m "chore(wealth): pulse $(date -u +%F)"
            git push
          fi
```

> **建议**：快讯先周更，后续再切日更，降低速率限制与失败概率。

---

## 5. 生成脚本（Node / ESM）

### 5.1 公共工具 `tools/wealth/util.mjs`

* 负责：读写 JSON、日期格式、滚动窗口归档、i18n 回退、slug、冷却窗检查等。

**关键点**

```js
export const DATA_DIR = "data/ai/wealth";
export const DAILY = `${DATA_DIR}/finance-daily.json`;
export const DAILY_ARCH = `${DATA_DIR}/finance-daily-archive`;
export const PULSE = `${DATA_DIR}/pulse.json`;
export const PULSE_ARCH = `${DATA_DIR}/pulse-archive`;

export const readJSON = async (p, fallback=[]) => { /* ... */ };
export const writeJSON = async (p, obj) => { /* ... */ };
export const ensureDir = async (dir) => { /* ... */ };
export const today = () => new Date().toISOString().slice(0,10);

// 将数组限制在 n 条，多余的按月归档
export const rollWindowAndArchive = async (arr, n, archDir, pickMonth = x => x.date?.slice(0,7)) => { /* ... */ };
```

### 5.2 日更生成 `tools/wealth/generate-daily.mjs`

**流程**

1. 读取 `topics.json`（不改动原文件）；
2. 选题（见 §6）；
3. 调用 LLM 生成双语内容（安全模板，含“非投资建议”指引）；
4. 合并写入 `finance-daily.json`（保留 60 条，超出则归档）；
5. 失败则：

   * 最多重试 2 次（指数回退 2s→5s）；
   * 仍失败：复用上一条并打 `degraded=true`。

**结果结构**：与 §3.1 完全一致。

### 5.3 快讯生成（可选） `tools/wealth/generate-pulse.mjs`

**流程**

1. 抓取 3–8 条权威财经头条（可从你已有数据源或 RSS/News API；若没有则先以“示例源”占位并用 LLM 生成摘要）。
2. 对每条要闻生成：事实小结 + 影响一句话；
3. 写入 `pulse.json`（仅保留近 30 天，每天 1 组），超出即归档。

**去风险规则**

* 不写入具体个股/币的买卖建议；
* 不对收益作承诺；
* 避免“今天立刻、稳赚不赔”等语言；
* 支持“未检索到可靠源 → 跳过当日或降级为 0 条”。

---

## 6. 选题算法（适配你已有 `topics.json`）

> 原则：**推进度 + 保多样 + 低难度优先 + 冷却窗**。

**打分要素（可简化实现）**

* *推进分（0.5）*：未讲过、且低 level 优先；
* *覆盖分（0.2）*：近 7 天标签/类目均衡；
* *关联分（0.2）*：与最近 1–2 日主题 `related_topics` 有交集 → 强化记忆；
* *多样分（0.1）*：隔日引入 1 个新概念或不同类别。

**硬约束**

* 同一 `topic` 冷却窗 **≥ 60 天**；
* 每日难度不跳级过猛（建议相邻关 0–1 个 level）；
* 当天若选题失败 → 回退到**固定优先队列**（例如“预算/复利/通胀/风险与回报”等基础题）。

> **说明**：本算法只依赖 `topics.json` 与 `finance-daily.json` 的历史记录，易于实现、可解释性强。

---

## 7. 前端实现（最小合同）

> 依据你的要求，**页面控制脚本放在 `tools/wealth/wealth.js`**，用 `<script type="module" src="/tools/wealth/wealth.js">` 引入即可。

### 7.1 页面骨架 `lab/ai-wealth.html`
ai-wealth.html 需要保持导航按 page hero部分和其他页面一致 且整体页面风格要符合整个个人网站的风格
```html
<section class="container">
  <header class="mb-6">
    <h1>AI 理财助手 · AI Wealth Mentor</h1>
    <p class="notice">本模块仅用于教育与信息分享，不构成任何投资建议。</p>
  </header>

  <main class="grid">
    <section id="daily" class="col-8"></section>   <!-- 今日 + 历史 -->
    <aside id="pulse" class="col-4"></aside>       <!-- 快讯（可选显示） -->
  </main>
</section>

<script type="module" src="/tools/wealth/wealth.js"></script>
```

### 7.2 控制脚本 `tools/wealth/wealth.js`（职责）

* 读取 `finance-daily.json`：

  * 渲染最近 1 条为“今日主题”，后续展示最近 30 条历史（分页/懒加载）。
  * 对 `degraded=true` 的卡片显示简要提示徽标。
* （可选）读取 `pulse.json` 并渲染：

  * 按日期折叠、每条要闻显示“事实 + 影响一句话 + 外链”。
* i18n 回退：优先 `zh`，缺失时回退 `en`、再回退 `es`；
* **健壮性**：

  * JSON 拉取失败 → 显示“稍后再试”与上一次缓存（localStorage）；
  * 字段缺失 → 显示可读回退文案；
* 性能：

  * 首屏只拉取 `finance-daily.json` 和 `pulse.json` 两个文件；
  * 历史列表分页渲染，避免长列表卡顿。

---

## 8. 内容模板（LLM Prompt 纲要）

### 8.1 每日理财课（中英双语同生）

**输入**：`topic`、`受众=理财小白`、`风格=简洁/可操作`、`长度=摘要≤80字、要点3–5、练习1条`
**约束**：非投资建议，不给具体买卖时点；强调风险与不确定性。
**输出字段**：与 §3.1 完全一致。

### 8.2 市场快讯（可选）

**输入**：3–8 条原始事实（标题、来源、时间、摘录）
**产出**：

* `facts.zh / facts.en`：用“白话 + 准确”的方式转述事实；
* `impact_one_liner.zh / en`：**一行**解释“这事可能影响什么/为什么”；
* 禁止夸大与承诺；禁止指向具体交易动作。

---

## 9. 合规与风险控制

* 页面与文末添加统一免责声明：

  > 本模块仅用于教育与信息分享，不构成任何投资建议或买卖邀请。金融市场具有不确定性，过往表现不代表未来。请结合自身风险承受能力，独立判断并自行承担风险。
* 脚本层：Prompt 模板中强制加入“非投资建议/风险提示”语句；
* 快讯层：不生成“买/卖/趁机/抄底”等词汇；对不确定性采用条件表述（如“可能、取决于、若…则…”）。

---

## 10. 运维与监控

* **CI 失败处理**：

  * 重试 2 次 → 仍失败则降级（复用上一条 + `degraded=true`）；
  * 可选：失败时自动开 Issue（GitHub CLI 或 Action 插件）。
* **数据体积**：

  * `finance-daily.json` ≤ 60 条，`pulse.json` ≤ 30 组；
  * 归档按月分文件，便于检索与备份。
* **性能**：

  * 控制 JSON 文件大小；
  * 首屏仅两次 `fetch`；
  * 懒加载历史。

---

## 11. 实施清单（逐条可操作）

**里程碑 0（0.5 天）**

* 新建目录：`data/ai/wealth/`、`tools/wealth/`；
* 新建空文件：`finance-daily.json`（`[]`）、`pulse.json`（`[]`）；
* 保持你已有的 `topics.json` 原样不动；
* 新建页面 `lab/ai-wealth.html`（骨架如 §7.1）。

**里程碑 1（1–2 天）**

* 完成 `tools/wealth/util.mjs`、`tools/wealth/generate-daily.mjs`；
* 配置 `.github/workflows/wealth-daily.yml` 与 `LLM_API_KEY`；
* 手动触发一次，确认 `finance-daily.json` 产出与页面可读。

**里程碑 2（0.5–1 天）**

* 完成前端控制脚本 `tools/wealth/wealth.js`（读取渲染 + i18n 回退 + 分页 + 降级提示）；
* 移动端适配与首屏测试。

**里程碑 3（0.5–1 天，可选）**

* 完成 `tools/wealth/generate-pulse.mjs` 与 `.github/workflows/wealth-pulse.yml`；
* 先设为**周更**，验证稳定后再改为日更。

**验收清单**

* [ ] 连续 3 次 CI 通过（含一次降级场景）；
* [ ] 页面首屏 ≤ 1.5s，移动端无布局错乱；
* [ ] 三语回退正确；
* [ ] `finance-daily.json` 正常滚动与归档；
* [ ] （可选）`pulse.json` 正常生成与展示。

---

## 12. 未来扩展（不纳入本期，仅保留接口）

* 在 `tools/wealth/wealth.js` 预留空钩子（如 `renderExtras()`），未来接入知识图谱/模拟器/TTS 时不破坏现有代码。
* 在 `generate-daily.mjs` 中保留 `locale=es` 支持，后续用单独 `translate.mjs` 补全西语字段。

---
