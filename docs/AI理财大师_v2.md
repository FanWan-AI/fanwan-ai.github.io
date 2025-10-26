# 《AI 理财助手（AI Wealth Mentor）》落地白皮书 · 可运维增强版（v2.0）

> 形态：纯静态站（GitHub Pages） + JSON 数据 + Node/ESM 脚本 + GitHub Actions（CI 侧调用 LLM）
> 范围：保留“每日理财课（Daily Lesson）+ 市场快讯（Market Pulse）”，新增质量与可观测性、Schema 校验、前端健壮性与可访问性、运维回滚、灰度与内容安全等工程化细节。

---

## 0. 执行摘要（TL;DR）

- 核心交付：
  - 自动日更的“每日理财课”（中/英/可扩 ES） +（可选）周更“市场快讯”。
  - 前端只读 JSON 渲染，离线缓存与优雅降级。
  - 完整数据契约（JSON Schema）+ CI 校验 + 归档 + 回滚。
- 新增（相对 v1）：
  - JSON Schema 与 `npm run validate:wealth` 校验，保证数据格式稳定。
  - 生成链路“软失败→降级复用上一条→显式 degraded 标识”。
  - LLM Prompt 模板标准化；角色、禁止项与合规检查清单。
  - 前端分页/懒加载/骨架屏 + i18n 回退 + a11y + PWA 缓存优化。
  - CI 并发控制、重试/退避、失效通知、自动开 Issue（可选）。
  - 灰度与回滚策略：任何异常一键恢复前一版本 JSON。

目录变更（与 v1 基本一致，补充 schema 与校验命令）

```
data/ai/wealth/
  topics.json                  # 你已有选题池（不改）
  finance-daily.json          # 每日理财课（滚动窗口 ≤ 60）
  finance-daily-archive/      # 月归档
  pulse.json                  # 市场快讯（≤ 30 组）
  pulse-archive/              # 月归档
  schemas/                    # 新增：JSON Schema
    finance-daily.schema.json
    pulse.schema.json
    topics.schema.json        #（可选，用于发现 topics.json 的结构偏差）

tools/wealth/
  util.mjs
  generate-daily.mjs
  generate-pulse.mjs
  wealth.js                   # 前端控制脚本（模块化）

lab/ai-wealth.html            # 页面（与站点风格一致的导航与 hero）

.github/workflows/
  wealth-daily.yml            # 日更工作流
  wealth-pulse.yml            # 周更/工作日更（可选）
```

---

## 1. 目标与非目标

- 目标（MVP+）：
  - 稳定日更，14 天成功率 ≥ 95%。
  - 前端首屏 ≤ 1.5s（移动端），隐藏/懒加载历史列表。
  - 数据“格式正确、可回滚、可审计”，避免坏数据阻塞展示。
  - 严格合规：教育用途，不提供交易建议；事实与影响分离。
- 非目标（本期不做）：
  - 个股/币交易建议、自动化资产配置、用户画像与个性化推荐。
  - 在线调用 LLM（保持前端纯静态，无密钥泄露风险）。

---

## 2. 架构与数据流

- 数据流（每天/每周）：topics.json → 选题/抓取 → LLM 生成结构化 JSON → 合并 finance-daily.json / pulse.json → 滚动窗口 + 月归档 → 前端拉取渲染（带缓存与降级）。
- 可信边界：
  - LLM 仅在 CI 内调用；密钥放在 GitHub Secrets（`LLM_API_KEY`）。
  - 任何拉取/生成失败不影响线上已发布数据；最坏情况使用上次可用版本。
- 可观测性：Action 日志、结构校验、提交审计、失败告警（可选 Issue/Slack）。

---

## 3. 数据契约（含 JSON Schema）

统一三语结构：`{ zh: string, en?: string, es?: string }`；前端回退顺序 `zh > en > es`。

### 3.1 finance-daily.json（滚动窗口）

业务约束：最多 60 条，超出入当月归档；同题冷却窗 ≥ 60 天。

示例（单条）：

```json
{
  "date": "2025-10-26",
  "topic_id": "compound-interest",
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
```

Schema（`data/ai/wealth/schemas/finance-daily.schema.json`）：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://fanwan-ai.github.io/schemas/finance-daily.schema.json",
  "title": "Finance Daily Array",
  "type": "array",
  "items": {
    "type": "object",
    "required": ["date", "topic", "summary", "key_points", "practice", "sources", "degraded"],
    "properties": {
      "date": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
      "topic_id": { "type": "string" },
      "topic": { "$ref": "#/definitions/i18nStr" },
      "summary": { "$ref": "#/definitions/i18nStr" },
      "key_points": {
        "type": "object",
        "properties": {
          "zh": { "type": "array", "items": { "type": "string" }, "minItems": 1, "maxItems": 6 },
          "en": { "type": "array", "items": { "type": "string" }, "maxItems": 6 },
          "es": { "type": "array", "items": { "type": "string" }, "maxItems": 6 }
        },
        "additionalProperties": false
      },
      "practice": { "$ref": "#/definitions/i18nStr" },
      "sources": { "type": "array", "items": { "type": "string", "minLength": 1 }, "minItems": 0, "maxItems": 6 },
      "degraded": { "type": "boolean" }
    },
    "additionalProperties": false
  },
  "definitions": {
    "i18nStr": {
      "type": "object",
      "properties": {
        "zh": { "type": "string", "minLength": 1 },
        "en": { "type": "string" },
        "es": { "type": "string" }
      },
      "required": ["zh"],
      "additionalProperties": false
    }
  }
}
```

### 3.2 pulse.json（可选，日/周更）

业务约束：最多保留近 30 组（按 date 聚合）；事实与影响分离；不得输出交易建议。

Schema（`data/ai/wealth/schemas/pulse.schema.json`）：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://fanwan-ai.github.io/schemas/pulse.schema.json",
  "title": "Market Pulse Array",
  "type": "array",
  "items": {
    "type": "object",
    "required": ["date", "items"],
    "properties": {
      "date": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
      "items": {
        "type": "array",
        "minItems": 1,
        "maxItems": 10,
        "items": {
          "type": "object",
          "required": ["title", "source", "facts", "impact_one_liner"],
          "properties": {
            "title": { "type": "string", "minLength": 3 },
            "source": { "type": "string", "minLength": 2 },
            "time_utc": { "type": "string", "format": "date-time" },
            "facts": { "$ref": "#/definitions/i18nStr" },
            "impact_one_liner": { "$ref": "#/definitions/i18nStr" },
            "links": { "type": "array", "items": { "type": "string", "format": "uri" }, "maxItems": 5 }
          },
          "additionalProperties": false
        }
      }
    },
    "additionalProperties": false
  },
  "definitions": {
    "i18nStr": {
      "type": "object",
      "properties": {
        "zh": { "type": "string", "minLength": 1 },
        "en": { "type": "string" },
        "es": { "type": "string" }
      },
      "required": ["zh"],
      "additionalProperties": false
    }
  }
}
```

### 3.3 topics.json（你已有）

- 保持不动；可选附加校验（`schemas/topics.schema.json`）帮助发现字段缺失（如 `level`, `tags`, `related_topics`）。

---

## 4. CI/CD 与运维

### 4.1 Secrets

- `LLM_API_KEY`（必需）：DeepSeek / OpenAI / 兼容 OpenAI API 实现。
- `NEWS_API_KEY`（可选）：用于抓取权威新闻源（若采用外部 API）。

### 4.2 Workflow（增强项）

- 并发控制：`concurrency: group: wealth-daily, cancel-in-progress: true`，避免重叠运行。
- Node 版本：20 LTS；缓存 `~/.npm` 与 `node_modules`。
- 重试策略：生成脚本内部支持 2 次退避（2s→5s），工作流级别不做无限重试。
- 校验步骤：生成后运行 `npm run validate:wealth` 验证 JSON 与 Schema。
- 自动开 Issue（可选）：失败时使用 `actions/github-script` 或 `gh` CLI。

示例（节选，区别于 v1 的增强注释已内联）：

```yaml
name: Wealth Daily
on:
  schedule: [{ cron: "0 0 * * *" }]
  workflow_dispatch: {}
concurrency:
  group: wealth-daily
  cancel-in-progress: true
jobs:
  daily:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - name: Install deps
        run: npm ci || npm i
      - name: Generate daily lesson
        env:
          LLM_API_KEY: ${{ secrets.LLM_API_KEY }}
        run: node tools/wealth/generate-daily.mjs
      - name: Validate schemas
        run: npm run validate:wealth
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

> `wealth-pulse.yml` 保持与 v1 类似，建议先“周一 00:15 UTC”周更；通过后再切日更。

### 4.3 回滚与灰度

- 回滚：所有 JSON 通过 Git 管理，一键回退到上一个绿色版本。
- 灰度：先在 `pulse` 上验证稳定性，再扩展至 `daily`；或将 `generate-daily.mjs` 支持 `dry-run` 输出到 `finance-daily.preview.json`，人工 spot-check 后再合并。

---

## 5. 生成脚本（Node/ESM）

### 5.1 公共工具 `tools/wealth/util.mjs`

职责：读写 JSON、日期/归档、i18n 回退、随机/打分、退避重试、去重、简单哈希、Schema 校验入口。

建议导出：

```js
export const DATA_DIR = "data/ai/wealth";
export const DAILY = `${DATA_DIR}/finance-daily.json`;
export const DAILY_ARCH = `${DATA_DIR}/finance-daily-archive`;
export const PULSE = `${DATA_DIR}/pulse.json`;
export const PULSE_ARCH = `${DATA_DIR}/pulse-archive`;
export const SCHEMAS = `${DATA_DIR}/schemas`;

export const today = () => new Date().toISOString().slice(0, 10);
export async function readJSON(path, fallback = []) { /* 读取 & 容错 */ }
export async function writeJSON(path, obj) { /* 原子写入：写 tmp 后 rename */ }
export async function ensureDir(dir) { /* mkdir -p */ }
export async function rollWindowAndArchive(list, max, archDir, monthPicker = x => x.date?.slice(0,7)) { /* 超出入档 */ }
export function i18nPick(obj, langOrder = ["zh","en","es"]) { /* 字段回退 */ }
export function backoff(attempt) { /* 0->2s,1->5s */ }
export async function validateWithSchema(jsonPath, schemaPath) { /* ajv 校验（可选） */ }
```

### 5.2 选题与生成 `tools/wealth/generate-daily.mjs`

流程：
1) 载入 `topics.json` 与 `finance-daily.json` 历史；
2) 根据 §6 选题算法打分与冷却窗过滤；
3) 构造 LLM Prompt（中英同生，禁止交易建议，带合规说明）；
4) 生成失败重试（2 次退避）；
5) 仍失败：复用上一条并标记 `degraded: true`，但更新 `date`；
6) 合并、滚动窗口与归档；
7) 可选：ES 字段暂留空，后续翻译补全。

输出严格匹配 Schema；写入后执行 Schema 校验（若失败→拒绝覆盖并抛错）。

### 5.3 快讯 `tools/wealth/generate-pulse.mjs`（可选）

- 抓取 3–8 条权威源（RSS/API/你已有源），对每条做：事实改写（通俗但准确）+ 影响一句话。
- 过滤规则：拒绝个股/币交易建议、避免夸大/承诺；不明来源 → 跳过。
- 同日聚合为一组，超出 30 组入档。

### 5.4 校验与本地命令

- `npm run validate:wealth`：对 `finance-daily.json` 与 `pulse.json` 分别跑 Schema 校验，且校验“不超过窗口尺寸”。
- `npm run dryrun:daily`：打印生成内容但不写盘（用于人工审阅）。

---

## 6. 选题算法（细化实现）

目标：推进度 + 多样性 + 低难度优先 + 冷却窗。

评分示意（总分 1.0）：
- 推进分（0.5）：未讲过优于讲过；相同类目按 `level` 由低到高。
- 覆盖分（0.2）：近 7 天标签分布更均衡得分更高。
- 关联分（0.2）：与最近 1–2 日 `related_topics` 有交集 → 加分。
- 多样分（0.1）：隔日引入 1 个新概念或不同类别。

硬约束：
- 同一 `topic_id` 或同义题冷却 ≥ 60 天。
- 难度级别相邻（相差 ≤ 1）。
- 若候选为空→从基础优先队列回退（预算/复利/通胀/风险收益等）。

实现要点：归一化每个子分 0..1 并线性加权；保留前 3 名中随机挑 1（抗抖）。

---

## 7. 前端实现（可用最小合同 + 工程化）

页面：`lab/ai-wealth.html`

- 导航与 hero 区域遵循全站样式（复用现有 `header`/`nav` 结构与 `style.css` 变量）。
- 结构建议：

```html
<section class="container">
  <header class="mb-6">
    <h1>AI 理财助手 · AI Wealth Mentor</h1>
    <p class="notice">本模块仅用于教育与信息分享，不构成任何投资建议。</p>
  </header>
  <main class="grid">
    <section id="daily" class="col-8"></section>
    <aside id="pulse" class="col-4"></aside>
  </main>
</section>
<script type="module" src="/tools/wealth/wealth.js"></script>
```

脚本：`tools/wealth/wealth.js`

- 职责：
  - 首屏仅拉取 `finance-daily.json`；并行预取 `pulse.json`（可选）。
  - 渲染“今日主题（置顶大卡）+ 最近 30 条分页/懒加载”。
  - `degraded=true` 显示徽标与 tooltip（说明为“降级复用上一条，生成失败”）。
  - i18n 回退：`zh > en > es`，缺失使用“占位友好文案”。
  - 缓存：成功拉取后写入 `localStorage`；失败时读取上次缓存并提示“正在使用缓存”。
  - 性能：骨架屏 + 分页渲染（每页 10 条）+ IntersectionObserver 懒加载。
  - a11y：可聚焦卡片、键盘导航、ARIA 标签；色彩对比 ≥ WCAG AA。

- SEO：为今日主题渲染 `<meta name="description">` 与结构化数据（`Article` 简化）。

- PWA（可选）：`sw.js` 增加 wealth JSON 的静态缓存清单；版本哈希跟随提交号。

---

## 8. 内容模板与合规

### 8.1 每日理财课 Prompt 纲要

- 受众：理财小白；风格：简洁/可操作；长度：摘要 ≤ 80 字、要点 3–5、练习 1 条；
- 禁止：交易建议、收益承诺、对时点/标的的“确定性”表述；
- 强制：风险提示、条件性语言（可能、取决于）。
- 输出：严格遵循 §3.1 字段命名与类型（中英同生，ES 可留空）。

### 8.2 市场快讯 Prompt 纲要

- 输入：3–8 条原始事实（标题、来源、时间、摘录/链接），权威优先；
- 输出：`facts`（中英）+ `impact_one_liner`（中英），一条事实仅一句影响；
- 禁止：指向买卖动作、夸大用语；不明来源跳过；链接外开新页。

### 8.3 免责声明（前端统一提示与页脚复用）

> 本模块仅用于教育与信息分享，不构成任何投资建议或买卖邀请。金融市场具有不确定性，过往表现不代表未来。请结合自身风险承受能力，独立判断并自行承担风险。

---

## 9. 质量保证与观测

- Schema 校验：生成后、提交前强制通过；不通过则失败不提交。
- 冒烟检查：
  - `finance-daily.json` 顶部日期 == 今天 或 `degraded=true` 并且上一条存在。
  - 列表长度 ≤ 60；`pulse.json` 组数 ≤ 30。
- 日志与告警：Action 日志中输出“主题、长度、来源数、是否降级”；失败时自动开 Issue（可选模版）。
- 审计：所有 JSON 变更可在 PR/Commit 中直观审阅（建议开启分支保护）。

---

## 10. 安全与隐私

- 前端无密钥；LLM 仅在 CI；敏感参数来自 Secrets。
- DLP：Prompt 不包含个人数据；不上传仓库内容以外的敏感信息。
- 依赖：锁定 Node 20 LTS；限制第三方包最小化（优先自实现/原生 API）。

---

## 11. 实施与里程碑（可核对清单）

里程碑 0（0.5 天）
- 新建目录：`data/ai/wealth/`、`data/ai/wealth/schemas/`、`tools/wealth/`。
- 初始化空文件：`finance-daily.json`、`pulse.json`（均为 `[]`）。
- 放置 Schema 三件套；在 `package.json` 增加 `validate:wealth` 脚本（ajv-cli 或自写小校验器）。
- 新建页面骨架 `lab/ai-wealth.html`。

里程碑 1（1–2 天）
- 实现 `util.mjs`、`generate-daily.mjs`，打通 CI `wealth-daily.yml`；
- 配置 `LLM_API_KEY`；手动触发一次，确认 `finance-daily.json` 产出且通过校验；
- 验证降级路径（模拟 LLM 失败）。

里程碑 2（0.5–1 天）
- 实现 `wealth.js`：渲染 + i18n + 分页 + 降级提示 + a11y；
- 移动端首屏测速与调优（骨架/懒加载/缓存）。

里程碑 3（0.5–1 天，可选）
- 实现 `generate-pulse.mjs` 与 `wealth-pulse.yml`（先周更再日更）。

验收标准（打勾即过）
- [ ] 连续 3 次 CI 通过（至少一次降级场景）。
- [ ] 首屏 ≤ 1.5s（移动端 Lighthouse P75）。
- [ ] Schema 全绿；三语回退正确；
- [ ] finance-daily 滚动与归档正确；
- [ ]（可选）pulse 生成与展示正常。

---

## 12. 未来扩展接口（占位不破坏）

- `wealth.js` 预留 `renderExtras()` 钩子（知识图谱/TTS/测验等）。
- `generate-daily.mjs` 保留 `locale=es` 支持；后续 `translate.mjs` 批量补全西语字段。
- 数据层新增 `related_readings`、`quiz` 字段时，Schema 与前端均可向后兼容（新增可选字段）。

---

## 13. 附：本地开发与命令建议

- 本地预检查：
  - `npm run validate:wealth` 进行 Schema 全量校验；
  - `node tools/wealth/generate-daily.mjs --dry-run` 预览生成结果；
- 可选依赖：`ajv`, `ajv-formats`（若用 ajv 校验）。

---

### 变更记录
- v2.0：新增 Schema、校验命令、CI 并发控制与回滚策略、前端 a11y 与 PWA 缓存建议、内容合规细化与告警/审计方案。
