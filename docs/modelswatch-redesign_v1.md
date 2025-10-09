## ModelSwatch 重构升级（v1）

本文件在保留 `docs/modelswatch-weekly-upgrade.md` 思路的基础上，基于你的目标（以中文用户为主、低成本可持续的每日热榜）做以下补充：
- 就语料库的组织提出建议（保留 GH/HF 分离的 sidecar 与 hotlist，同时在分析阶段提供可选的统一视图）；
- 明确双语摘要策略与 LLM 的使用场景（用于增强“为何有竞争力 / 能做什么 / 如何使用”三类可操作信息）；
- 说明必须优先改进的工程点与可交付的短中长期计划；
- 说明当前仓库没有 `modelswatch-weekly` 抓取脚本的事实，并给出兼容的迁移路径与小规模修改建议。

---

### 快速结论（要点）
- 保持“快速首发（fast_summary）+ 异步富化（tri_worker/LLM）”的设计原则不变，这能最大化可用性并控制成本。  
- 由于前端与展示目前将 GH 项目与 HF 模型分开，建议在采集与首发阶段保持两个并行但兼容的语料池：`corpus.github.json` 与 `corpus.hf.json`；分析阶段（weekly / corpus builder）可以视需要导出一个统一的 `corpus.json` 视图用于整体覆盖率统计。  
- 中文摘要是你的核心差异化优势：把双语（中/英）作为首要 enrich 目标，并让 LLM 负责“竞争力说明（why）与可操作建议（how/use）”的生成，而非首发必需内容。

---

### 为什么保留 GH/HF 分离语料更方便
- 前端分离：`lab/modelswatch.html` 与相关组件当前按来源（GitHub / Hugging Face）呈现和过滤，保持后端输出与前端契合能简化渲染逻辑与回退策略（snapshot → hotlist → top）。
- 采集差异：GH 的主信号是 stars/forks、repo 结构；HF 的主信号是 downloads/likes、模型卡字段。二者在 schema 与统计维度上不完全一致，分开采集并在分析阶段做统一规范化更稳妥。
- 兼容方案：在 `tools/modelswatch/build_corpus.mjs`（analysis-only）中，输入分别为 `corpus.github.json`、`corpus.hf.json` 与 daily 的归档，输出时可选择生成一个合并视图 `corpus.json`（为全站统计与 coverage 用），或保留两套单独的视图供前端选择。

---

### 摘要与 LLM 使用策略（针对中文用户的强化方案）
1. 首发（关键路径，必须非常快、无或少量 LLM）
  - 使用 `fast_summary`（extractive template）生成 `summary_short.{zh,en,es?}`，保证每日首发有中文简短摘要；对于 HF/ GH 两类来源分别调用 fast_summary 的相同逻辑即可。
2. 异步富化（tri_worker）
  - tri_worker 对 `pending_summaries.json` 批量处理，调用 LLM 生成 enriched summaries：三语（zh/en/es 可选），并额外生成三个辅助字段：
    - why_competitive（为什么有竞争力 / 适合谁）
    - what_can_you_do（能用来做什么 / 典型用例）
    - quick_howto（如何上手 / 使用建议/注意事项）
  - 将以上字段写入 `tri_cache.json` 或 `summary_cache.json` 的 meta 中，便于后续 daily 在渲染时直接使用。
3. prompt 设计要点（示例思路）
  - 指令应明确目标读者（中文工程师/研究者/产品经理），并限制输出长度与格式（例如：1段 40–80 汉字的“为什么”，1段 1–2 行的“怎么用”要点）。
  - 保持可审计：每次 LLM 产物写入时，记录 provider、elapsed、promptHash、generated_at 与警告信息（warnings）。

---

### 必须优先提升的工程点（高优先级）
1. diagnostics 与告警：把 `summaries_diagnostics.json` 作为 CI/运行时 artifact，并建立阈值报警（pending 长度、daily wall_time、tri_cache hit-rate）。
2. canonical key 与去重策略：在 GH/HF 两套 corpus 写入点强制 canonical id（例如 `github:owner/repo`、`hf:model-id` 或 `sha256:<fullhex>`），并在合并/analysis 阶段实现冲突检测与 audit。  
3. 数据合并的可回滚性：每次 summary_cache/tri_cache 的写入必须支持备份（`.bak`）与 dry-run 模式，避免自动化误写入破坏可审计性。  
4. snapshot 占位检测：改进 placeholder 检测逻辑（例如基于规则与轻量分类器）来判断是否使用 snapshot；把阈值暴露为 repo variable（`SNAPSHOT_PLACEHOLDER_THRESHOLD`）。

---

### 升级计划（保持 `modelswatch-weekly-upgrade.md` 的思路，做小规模补充）
短期（立即可做，最小可行改动）
- 在 docs 中写明 `corpus.github.json` 与 `corpus.hf.json` 的 schema（保持与 `data/ai/modelswatch/corpus.json` 兼容字段集合，但允许部分来源特有字段）。
- 修改 `tools/modelswatch/daily.mjs`（小改）：优先读取各自的 `daily_tasklist.json`（可按来源区分），写出 `data/ai/modelswatch/daily/YYYY-MM-DD.github.json` 与 `.hf.json`（或兼容的 `daily_github.json` / `daily_hf.json`），并确保写入 `pending_summaries.json` 时带上 `source` 字段。  
- 实施 fast-first：把 `fast_summary.mjs` 在仓库中追加并把 daily 的关键路径改为 fast-first（只在必须时调用 LLM），开启 `ENABLE_FAST_FIRST` flag。 

中期（实现 analysis-only 构建与审计流程）
- 新增 `tools/modelswatch/build_corpus.mjs`（analysis-only）：读取 `corpus.github.json`、`corpus.hf.json`、daily 归档与 snapshot sidecars，做标准化、覆盖率计算与生成 `daily_tasklist.json`（分来源任务优先级）与 diagnostics。此模块**不主动抓取**外部 API。  
- 在 weekly pipeline（`.github/workflows/modelswatch-weekly.yml`）中运行 `build_corpus.mjs`；在仓库启用 branch protection 时改为创建 PR 自动化分支并提交分析结果与 audit artifact。  
- 在 tri_worker 脚本中，优先写入 `why_competitive` / `what_can_you_do` / `quick_howto` 三个字段；并把 tri_cache hit-rate 纳入 diagnostics 指标。 

长期（自动化与质量提升）
- 增加监控仪表盘（可选小工具）显示 coverage.json、pending 列表与 tri_cache 命中率，便于人工介入。 
- 研究轻量质量分类器（检测 placeholder / low-quality summary），并将其纳入 snapshot 占位判定逻辑与 tri_cache 优先级。 
- 若需要，可在后期引入学习型 re-ranker（使用用户反馈或编辑操作的点击／评分数据训练），但此为高成本项，可作为远期目标。 

---

### 与 `modelswatch-weekly-upgrade.md` 的兼容与差异（简要）
- 保持原文的 audit / merger / dry-run 思路（tri_cache -> summary_cache 的合并必需 dry-run + audit + 备份）；本文件只做小规模修改：
  - 将 corpus 输入区分为 `corpus.github.json` 与 `corpus.hf.json`，并在 build_corpus 时提供可选合并输出 `corpus.json`；
  - 明确在 daily 写出按来源的 daily 文件以简化前端兼容；
  - 更明确地把“中文摘要 & LLM 生成的竞争力说明”作为 tri_worker 的关键产出。

---

### 当前缺失的事实与迁移建议
- 目前仓库**没有**完整的 `modelswatch-weekly` 抓取脚本（即不应在 weekly analysis 中启动抓取）。因此：
  1. 先实现 `build_corpus.mjs`（analysis-only）并在 weekly job 运行分析与 audit（dry-run/backup）；
  2. 同步小改 `daily.mjs` 以支持按来源的 tasklist 与 daily 输出并保证 fast-first 行为；
  3. 后续再实现 tri_worker 的扩展（批量 LLM enrich）并在 CI/weekly 中作为可选 full-run。

---

### 推荐的下一步（3 选项，供你选择）
1. 直接执行短期改动：新增 `fast_summary.mjs`，微调 `daily.mjs`（按来源 tasklist & 输出），并在本地运行 smoke tests。  
2. 先做 analysis-only 的 `build_corpus.mjs` 并把 weekly pipeline 改为运行它（dry-run + 上传 audit），以便避免任何抓取行为被误触发。  
3. 同时推进 1 + 2：并在 tri_worker 中添加生成 `why/what/how` 三字段的支持（这需要 LLM keys 及小规模预算）。

建议优先级：从 1 -> 2 -> 3 依次实施（每步都有可验证的产物与回滚路径）。

---

文件位置：`docs/modelswatch-redesign_v1.md`

如果你同意，我可以把第 1 项做成一个小 patch（仅在 tools 中添加 `fast_summary.mjs` 的骨架并调整 `daily.mjs` 的配置开关与输出路径），并运行本地 smoke test 来验证输出契约。
