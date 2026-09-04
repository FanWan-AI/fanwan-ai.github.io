# AI 创业模块 · 总设计蓝图与执行路线图

版本：P0（重新审计与总设计）　日期：2026-09-04　作者：总设计 / 总指挥 / 总验收（主会话代理）

本文件是模块的最高执行纲领：记录 P0 阶段对前任工作的完整审计结论、产品设计定稿、技术决策与 P1–P5 路线图。各阶段实施细节见本目录各 `phase-log-P*.md`。

## 0. 角色与协作协议

| 角色 | 承担者 | 职责 |
| --- | --- | --- |
| 总设计 / 总指挥 / 总验收 | 主会话代理（glm-5.3） | 需求定稿、任务分解与任务单下发、diff 审查、验收、git 提交、文档 |
| 实施代理（implementer） | glm-5.3-flash 子会话 | 只做任务单内的编码与修复，自验后交回变更摘要 |
| 探索 / 规划子代理 | 主代理内置子代理（继承主模型） | 只读代码勘察、方案比选，不落盘 |

实施代理的启动方式（模型绑定在会话层，agent 文件只定义角色）：

```bash
kimi -m zai-coding-plan/glm-5.3-flash --agent implementer -p "<任务单>"
```

- 任务单四要素：**目标、允许触碰的路径、验收命令、禁止事项**。
- 实施代理禁止 git 写操作；提交权集中在总验收。
- 文档纪律：每阶段产出 `phase-log-P<n>.md`（做了什么 / 验证结果 / 遗留）；新决策追加 `decisions.md`；验收结论回填 `acceptance.md`。

## 1. 现状审计（P0 结论）

前任已完成大量高质量工作，架构方向正确，**模块整体处于“完成度高但从未上线”状态**。以下清单与风险为独立复核结果（非沿用前任自述）。

### 1.1 已交付资产

| 层 | 位置 | 状态 |
| --- | --- | --- |
| 产品 / 架构文档 | `docs/ai-startup/`（8 份） | 完整，质量高 |
| 后端流水线 | `tools/startup/`：collect → normalize → LLM 生成 → gates → verify → publish，含 4 份 JSON Schema | 完整；`npm run startup:test` 9/9 通过（本次独立复跑） |
| 公开数据 | `data/ai/startup/opportunities/latest.json`（5 条机会，gate=passed）、`cases/index.json` + `cursor-workflow-wedge.json`（已发布种子案例，5 节 / 14 来源） | 契约校验通过 |
| 前端 | `lab/ai-startup.html` + `assets/ai-startup/startup.js`(544 行) + `startup.css`(668 行)：双 Tab、hash 路由、证据抽屉、localStorage 降级缓存、三语、`textContent` 渲染、外链 `noopener noreferrer` | 代码完成，浏览器验收未做 |
| 站点挂载 | `ai-lab.html` 卡片 + 导航下拉 | 完成 |
| 自动化 | `startup-daily.yml`（每日 07:17 SGT 提交发布）、`startup-case-weekly.yml`（周二草稿，只产 artifact 不发布）、`npm-grunt.yml`（含 startup 文件存在性与退休模块排除断言） | 就绪，从未运行 |

### 1.2 风险与缺陷登记表

| # | 等级 | 问题 | 证据 | 处置（阶段） |
| --- | --- | --- | --- | --- |
| R1 | 阻断 | 整个模块**未提交、未上线**；且工作区混有大量无关改动（退休模块禁用、几十个 `M` 状态页面、大量 ModelSwatch 未跟踪临时数据），无法 `git add -A` | `git status`：全部 startup 路径为 `??`；`data/ai/modelswatch/**` 多个 draft 未跟踪 | P4 精确路径白名单提交 |
| R2 | 中 | `story_type` 中英不一致：已发布数据为中文（“技术商业化”），流水线枚举 / fixture 为英文（`technical_commercialization`）；schema 未校验枚举所以测试绿灯，但前端展示将混杂 | `data/ai/startup/cases/*.json` vs `constants.mjs STORY_TYPES` | P1 统一为英文枚举 + 前端 i18n 映射（ADR-006） |
| R3 | 中 | DeepSeek 调用链（`/responses` + `web_search` → `/chat/completions` 降级）从未用真实 API 验证；降级后 `useWebSearch` 静默丢失，证据能力退化为纯 RSS/Brave | `tools/startup/lib/deepseek.mjs` 降级逻辑；本地无 key 运行记录 | P2 真实 dry-run 实测并记录降级行为 |
| R4 | 中 | 前端零浏览器验收记录：三宽度（360/768/1440）、明暗主题、键盘导航、`prefers-reduced-motion`、控制台无错 | `acceptance.md` 前端节全部未勾选 | P3 puppeteer 脚本化验收 + 截图存档 |
| R5 | 低 | `sitemap.xml` 未收录 `/lab/ai-startup.html`（当前 0 处引用） | `grep -c ai-startup sitemap.xml` = 0 | P1 补录 |
| R6 | 低 | 种子数据 provenance 未记录：`latest.json` 与 Cursor 案例是真实流水线产物还是 fixture 改写，无说明 | `fixtures.mjs` 含同 slug 案例原型 | P1 在数据 `quality` 或文档中登记来源 |
| R7 | 低 | 本地 `data/ai/startup/opportunities/archive/` 缺失（CI 首跑会创建），本地基线与线上不一致 | 目录不存在 | P2 首次真实运行后自然补齐 |

### 1.3 值得保留的优点（验收时不得回退）

- 质量门禁全部确定性可测：68 分阈值、0.85 来源覆盖率、≥2 独立来源、禁用措辞扫描、前 3 条必须 deep、分数降序与排名连续性。
- 发布失败即保留旧版（fail-closed）：临时文件 + rename 原子写，verify 不通过不动 `latest.json`。
- 案例走“草稿 → 人工 promote”两段式，与日报全自动发布形成正确的风险分级（ADR-003）。
- 前端渲染全部 `textContent`，无 innerHTML 注入面；fetch 带 payload 校验 + localStorage 陈旧回退。

## 2. 产品设计定稿

模块只回答两个问题（不再扩）：

1. **今天出现了哪些值得验证的 AI 创业机会？**（机会日报，每日 0–10 条，质量不足就少发）
2. **已有公司究竟靠什么赢、为什么输、哪些做法可以迁移？**（案例解剖，每周一篇）

差异化壁垒是**证据链与证伪导向**：每条机会必须回答“最快怎么证明它是错的”，每个案例必须区分事实 / 公司自述 / 编辑推断 / 未知。这是与资讯聚合站的本质区别，任何体验优化不得稀释它。

首屏 60 秒路径：日期与编辑总判断 → 前三深度机会卡 → 一键展开来源。验收标准沿用 `product-requirements.md` 第 6 节。

**非目标（二期也不做）**：海量新闻流、社区、课程、融资数据库、创业工具箱、浏览器端调用 LLM。

二期 backlog（本期结束后再评估，不进 P1–P5）：机会演进追踪（同一机会连续多日出现时的汇总线）、案例库标签筛选与“案例 ↔ 今日机会”联动、模块 RSS 订阅、案例 OG 卡片图自动化。

## 3. 技术决策

沿用 ADR-001～005（静态站点 + Actions 后端、质量优先于配额、日报自动 / 案例审阅发布、单页双状态、退休模块保留历史）。新增两条候选决策，P1 落实后正式追加进 `decisions.md`：

- **ADR-006（候选）story_type 数据层统一英文枚举**：`STORY_TYPES` 六值为唯一合法值，schema 增加枚举校验；前端新增英文枚举 → 三语标签映射。存量中文值随 P1 数据修订一次性迁移，`updated_at` + `revision_note` 记录。
- **ADR-007（候选）提交策略 = 精确路径白名单**：任何提交只 `git add` 明确列出的 startup 相关路径（见 §4 P4 清单）；工作区中退休模块改动与 ModelSwatch 临时数据的去留由总验收在 P4 逐一 diff 审计后单独决定，永不与本模块混提。

部署链路（已验证配置正确）：`startup-daily` 成功 → commit/push → 触发 `npm-grunt`（`workflow_run`）→ Pages。案例 promote 是人工 commit，天然走 push 触发。

## 4. 执行路线图

每阶段 = 一份任务单（或若干）+ 一个 phase log + 明确验收门禁。未过门禁不进入下一阶段。

### P1 修复与统一（实施代理执行）

任务：① story_type 枚举统一（schema 校验 + 存量数据迁移 + 前端三语映射，ADR-006）；② sitemap 补录 `/lab/ai-startup.html`；③ 种子数据 provenance 登记（R6）；④ 受影响的测试同步更新。
验收门禁：`npm run startup:test` 全绿；`npm run startup:validate` 通过；前端枚举映射在三语下无 undefined。

### P2 真实流水线验证（总指挥执行，需 `DEEPSEEK_API_KEY`）

任务：本地 `npm run startup:daily -- --dry-run` 与 `startup:case -- --topic ... --dry-run` 各至少一次；记录：`/responses` 是否可用、`web_search` 工具是否生效、降级路径是否触发、耗时与 token 成本；产出 R7 的 archive 基线。
验收门禁：真实运行产物通过 `startup:validate`；降级行为写入 phase log；无密钥进入日志与产物。

### P3 前端浏览器总验收（总指挥执行）

任务：本地 HTTP 服务 + puppeteer 脚本：360/768/1440 三宽度截图（明暗两主题）、控制台错误收集、键盘 Tab 导航走查、i18n 三语切换、`?case=<slug>#cases` 深链、数据缺失/空日报错误态模拟。
验收门禁：`acceptance.md` 前端节全部可勾选；控制台无 error；截图存档至 phase log 引用的临时目录（不入库）。

### P4 提交与上线（总验收执行）

任务：先对工作区全部 `M` 文件做 diff 审计并分类（本模块 / 退休模块 / 无关）；然后按白名单提交：

```text
.github/workflows/startup-daily.yml
.github/workflows/startup-case-weekly.yml
.github/workflows/npm-grunt.yml
ai-lab.html
lab/ai-startup.html
assets/ai-startup/
data/ai/startup/
tools/startup/
docs/ai-startup/
package.json
.kimi-code/agents/implementer.md
```

（退休模块的 workflow 禁用重命名与页面修改，审计确认后作为独立提交，commit message 单独说明。）
验收门禁：push 后 `startup-daily` 可手动触发且成功；Pages 线上 `https://fanwan-ai.github.io/lab/ai-startup.html` 可访问且数据渲染正确；commit hash 记录进 phase log。

### P5 运营闭环（上线后首周）

任务：观察连续 3 天日报的条数分布与门禁剔除率；周二案例草稿质量抽查；`DEEPSEEK_API_KEY`、`BRAVE_SEARCH_API_KEY` 在 Secrets 中就位确认；失败重放一次（删 latest.json 前先备份，验证 fail-closed 不覆盖线上）。
验收门禁：连续 3 天自动发布无人工干预；`acceptance.md` 全部勾选；模块在 `README.md` 阶段表标记完成。

## 5. P0 阶段记录

- 审计范围：`docs/ai-startup/` 全部 8 份文档、`tools/startup/` 全部源码与 schema、两份公开数据、前端三件、三个 workflow、`ai-lab.html` 挂载、git 工作区状态。
- 方法：逐文件人工审读 + 独立复跑测试（`npm run startup:test` 9/9 通过）+ 配置交叉核对（cron 时区、部署断言、provider 模型表）。
- 关键更正：文档自述“阶段 2 进行中”，实际后端已完成度更高，真正的缺口在**未上线**（R1）与**未实测**（R3/R4）。
- 本阶段产出：本文件、`.kimi-code/agents/implementer.md`、`README.md` 更新。**未修改任何代码与数据。**
