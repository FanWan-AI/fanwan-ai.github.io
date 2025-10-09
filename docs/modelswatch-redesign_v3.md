# ModelSwatch 重构设计（v3）——发布闭环与统一上站策略

版本说明
- 文件：`docs/modelswatch-redesign_v3.md`
- 目的：在 v2 基础上优化并明确「何时发布到网站」的闭环流程：Daily 生成快速双语短摘，Corpus Builder 汇总与生成任务清单，tri_worker 使用 LLM 批量富化并产生高质量 enriched summaries，最后统一发布至站点。文档强调顺序、回退、安全与可审计性，适合提交给领导评审。 

更新时间：2025-10-09

作者：产品/工程合写（供评审）

---

## 核心结论（先看要点）
- 我们采用“统一上站（publish-after-enrich）”策略：用户首次访问网站时看到的是 tri_worker 生成并已审计的 enriched summaries（中英双语 + why/what/how），以最大化信息价值与可操作性。  
- 实施路径保持三阶段：Daily（轻量首发草稿）→ Corpus builder（分析与任务清单）→ tri_worker（批量 LLM 富化）→ Publish（统一上站并生成 snapshot sidecars / hotlists）。
- 为兼顾可用性与风险，我们在流程中引入 staging（草稿与侧车）、dry-run/audit、自动化 PR 与回滚点；并保留“应急快速首发”开关（ENABLE_FAST_FIRST）以便 LLM 不可用时临时回退。 

---

## 为什么要在 tri_worker 完成后统一发布？权衡说明

优点（你提出的理由）
- 用户访问网站时获得信息丰富且可操作的摘要（减少用户二次点击去看完整条目），提升产品的差异化价值，特别是对中文用户更有吸引力。  

缺点与缓解
- 延迟增加：tri_worker 可能需要较长时间（取决于 LLM 批次与并发）。缓解策略：
  - 将 tri_worker 设为在 daily 完成后立即触发，并尽量把其运行窗口安排为离峰时段或以并发/批量控制降低超时（SNAPSHOT_MAX_NEW、TRI_BATCH_CONCURRENCY）；
  - 发布策略使用 atomic publish：先在 staging 目录/sidecar 中写入 enriched 产物，待全部或符合通过率阈值后再更新 `latest_snapshot.json` 与 hotlist 文件；
  - 提供 ENABLE_FAST_FIRST 紧急开关以支持在超时或大量失败情况下回退到快速首发。 

结论：对你的产品目标（中文友好、信息可操作优先），统一上站是合理的，只要我们对 tri_worker 的时间、并发与失败率有严格监控与回退策略。 

---

## 推荐的统一发布流水线（更通顺的流程说明）

步骤概览：

1) Daily（每日采集与草稿生成）
  - 任务：基于 `daily_tasklist.json`，进行增量抓取（仅定向小规模 fetch），选择候选，生成 `daily/YYYY-MM-DD.{github,hf}.draft.json`（草稿），并为缺失的条目创建 `pending_summaries.json`（仅包含需要 LLM 丰富的条目）。
  - 产物（非对外发布）：draft daily files、updated corpus sidecars（corpus.github.json / corpus.hf.json）、state.json、dates.json。  

2) Corpus Builder（analysis-only，负责聚合与任务迭代）
  - 任务：读取源语料（`corpus.github.json`, `corpus.hf.json`）、draft daily、snapshots、summary_cache，执行标准化、去重、分类、覆盖率计算，生成 `daily_tasklist.json`（为 next run 调整），并生成 diagnostics。此步不做主动抓取。
  - 产物：coverage.json、daily_tasklist.json、corpus.json（可选合并视图）、classification_stats.json。  

3) tri_worker（异步 LLM 批量富化）
  - 触发：在 Daily 完成后自动触发 tri_worker（CI job 或定时 runner）。
  - 行为：读取 `pending_summaries.json`（或 draft list）并按 SNAPSHOT_MAX_NEW 分批调用 LLM，生成 `tri_cache` 条目（包含 en/zh/es、why/what/how、promptHash、provider、elapsed、warnings）。
  - 产物（staging）：tri_cache.json（staging）、summary_cache.staging.json、audit artifacts（tools/modelswatch/audit/*）。

4) 合并器与 dry-run 审核（apply_tri_to_summary）
  - 在 tri_worker 完成后，运行合并器进行 dry-run 合并（`--dry --audit`），生成 audit 报告。人工或自动化审查通过后，运行正式合并（`--backup --write --audit`），写入正式的 `summary_cache.json` 与 snapshot sidecars（hf_summaries.json / gh_summaries.json）。

5) 生成快照与统一发布（atomic publish）
  - 生成 snapshot sidecars（snapshots/<YYYY-MM-DD>/{hf_summaries.json,gh_summaries.json}）与 hotlists（models_hotlist.json / projects_hotlist.json）。
  - 更新 atomic 发布指针 `data/ai/modelswatch/latest_snapshot.json`（包含 snapshot date 与 checksum）或在 CI 中创建 PR 将这些文件推到 `main`（视 branch protection 策略）。
  - 一旦发布指针更新，前端会读取 snapshot sidecar 并在网站上展示 enriched 内容。 

6) 后续：巡检与回滚
  - 若合并后发现质量问题，可 rollback：用 backups 恢复 `summary_cache.json`，并把 `latest_snapshot.json` 指回前一个日期或上一个稳定 snapshot；同时在 audit 中记录原因并开 issue。

流程要点说明：
- staging 与 dry-run 阶段确保 tri_worker 产物不会直接覆盖线上数据，必须经过合并器的 audit 步骤与人工/半自动审查（这一步可根据团队信任度逐步自动化）。
- 为减少用户等待时间，可采用并行化：tri_worker 对重要来源/类别并行处理，并允许在达到一定 enriched 覆盖率阈值（例如 80% 的 picks 已 enrich）时先发布；但建议初期尽量等待全部 picks 完成以保证上站质量。 

---

## 调度与时间建议（示例日程）

示例：每日周期（以 UTC 假设）
- 02:00 UTC — Weekly snapshots / tops（外部或手工触发，若存在）
- 04:00 UTC — Daily.mjs 启动（增量 fetch，生成 draft daily）
- 04:10 UTC — build_corpus.mjs（analysis-only，计算 coverage 并写 daily_tasklist.json）
- 04:30 UTC — tri_worker 启动（按 SNAPSHOT_MAX_NEW/CONCURRENCY 分批运行）
- 05:30–08:00 UTC — tri_worker 持续／完成（视规模）
- 08:10 UTC — apply_tri_to_summary dry-run + audit（人工或自动审查）
- 08:30 UTC — 合并并 publish（更新 latest_snapshot.json / 提交 PR）

以上时间仅为示例。tri_worker 的时长与并发取决于 `SNAPSHOT_MAX_NEW`、`TRI_BATCH_CONCURRENCY` 与提供者限额。你可以把 daily 推早或把 tri_worker 放在更长的窗口内（例如夜间批量），以保证上站时间在白天之前完成。 

---

## 故障场景与回退策略（关键）

场景 A：tri_worker 超时或错误率高、未能在预期窗口完成
- 回退措施：检查 diagnostics；若超过阈值（pending 未完成 > X% 或失败率 > Y%），自动触发 ENABLE_FAST_FIRST=true 的临时回退，然后 publish 使用 fast summaries；同时提醒运维/编辑团队介入。 

场景 B：合并后发现大量低质量 enriched（人工抽检不合格）
- 回退措施：使用备份恢复 `summary_cache.json`，将 `latest_snapshot.json` 回指到上一个稳定 snapshot；创建 issue 并暂停自动合并直至问题解决。 

场景 C：外部 API（LLM / HF / GH）限流导致连锁失败
- 缓解：tri_worker 的重试/退避策略、降低 TRI_BATCH_CONCURRENCY、调整 SNAPSHOT_MAX_NEW，并在必要时走 manual enrich（少量人工或延长 worker 运行时间）。

---

## CI / 自动化建议（实现时需落地）

1) 分支策略
- 若启用 branch protection：所有自动更改（summary_cache、snapshots、hotlists）应在 automation 分支产生 PR，含 audit artifacts，人工合并后部署；或在有更高信任度时允许 automation 推送到 main（通过 repo variables 控制）。

2) Workflow Steps（建议）
- daily job: run daily.mjs --dry-run/--run -> write draft daily files
- analysis job: run build_corpus.mjs --dry-run -> upload diagnostics
- tri_worker job: run tri_worker.mjs (requires secrets) -> produce audit artifacts
- merge job: run apply_tri_to_summary.mjs --dry --audit -> human review -> apply_tri_to_summary.mjs --backup --write --audit -> generate snapshots & hotlists -> create PR or push

3) Audit artifacts
- tri_cache audit, merge dry-run output, summaries_diagnostics.json 应全部 upload-artifact 到 workflow 的 artifact，以便审阅与存档。 

---

## KPI 与验收（补充说明）

- 为保证用户上站时能看到高质量 enriched 内容，建议在发布前设定最少 enriched 覆盖阈值（例如至少 70–80% 的 picks 拥有 enriched why/what/how），未达到则触发人工审核或按规则回退到 fast-only 发布。 
- 监控指标同 v2：daily wall_time、picks per source、pending 增长率、tri_cache 命中率、placeholder fraction。 

---

## 小结与下一步建议

1) 我同意你提出的“最后一步 tri_worker 完成后再统一发布到网站”的思路，并把它做成默认路径（publish-after-enrich），同时实现 ENABLE_FAST_FIRST 作为紧急回退。 
2) 建议按 A -> B -> C 顺序实现短期改造（fast_summary + daily 小改）、analysis-only build_corpus、tri_worker 与合并器，并在合并器中严格实行 dry-run + audit + backup 流程；完成 tri_worker 后再做统一发布。 

我可以立即开始：
- 若你选择 A（推荐优先），我将实现 `fast_summary.mjs` 骨架与 `daily.mjs` 的改动（写 draft daily、pending），并在本地跑 smoke tests；随后按流程逐步交付 B 与 C。

已选择：方案 A（由你确认）
下面是把方案 A 的具体实施计划与验收细则直接写进本文档，便于 leader / 工程实施与快速审阅：

实施目的（方案 A）
- 立刻把每日关键路径改为 fast-first：即使 LLM 不可用也能快速产出中文短摘并将需要 LLM 的条目写入 `pending_summaries.json` 供后续异步处理。

具体改动（实现清单）
1) 新增 `tools/modelswatch/fast_summary.mjs`（extractive template）
  - 功能：从条目 description/short readme 中提取 1–2 句中文/英文短摘（zh/en），并生成 `summary_short` 结构。必须是本地无网络调用、快速执行的函数。
2) 修改 `tools/modelswatch/daily.mjs`
  - 优先读取 `summary_cache.json` / snapshot sidecars，若不存在则用 `fast_summary` 填充 `summary_short`（确保 `summary_short.zh` 可用）；
  - 写出 draft daily 文件：`data/ai/modelswatch/daily/<YYYY-MM-DD>.github.draft.json` 和 `.hf.draft.json`（暂不对外发布）；
  - 写出 `pending_summaries.json`（只包含需要 LLM 生成 enriched 的条目，记录 `canonical_key`、`promptHash`、`source`、`created_at`）；
  - 更新 `state.json`（运行元信息）与 `dates.json`（archive 索引）。
3) Smoke tests 与本地验证脚本
  - 添加 `scripts/smoke_daily.sh`（或 PowerShell 等）运行 `node tools/modelswatch/daily.mjs --dry-run` 并验证输出字段；
  - 在 repo 中新增简单的单元/集成测试（例如 `tests/fast_summary.test.js`）验证 fast_summary 在不同 description 样式下的稳定性。

影响到的文件（预期）
- `tools/modelswatch/fast_summary.mjs`（新增）
- `tools/modelswatch/daily.mjs`（小改，保留原有抓取/选择逻辑）
- 可能新增测试脚本 `tests/fast_summary.test.js` 与 smoke 脚本 `scripts/smoke_daily.ps1`

本地运行与验证（建议命令）
（PowerShell 示例）
```powershell
# 运行 fast-only smoke run（dry-run 模式不写入仓库）
node tools/modelswatch/daily.mjs --dry-run

# 运行单元测试（若采用 jest 或 node 简单断言脚本）
node tests/fast_summary.test.js
```

验收标准（交付验证）
- daily 在 dry-run 下成功生成 `daily/*.draft.json`，且每个条目包含 `summary_short.zh` 或 `summary_short.en`；
- `pending_summaries.json` 正确列出需要 LLM 丰富的条目（字段完整，含 `canonical_key` 与 `promptHash`）；
- daily 关键路径 wall_time 明显下降（与当前基线比较，理想下降 30–70%）；
- 新增的测试脚本通过，且 CI 在 weekly/daily dry-run 中包含基本字段检查（可选）。

时间估算（建议）
- 设计与实现 fast_summary：0.5–1 天
- 修改 daily.mjs 并本地联调：1 天
- 添加 smoke tests 与 CI 干线：0.5 天
- 合计：约 2–3 个工作日（视可用资源与测试反馈调整）。

下一步（我将执行）
1) 在分支上实现 `fast_summary.mjs` 与对 `daily.mjs` 的小改并运行本地 smoke tests；
2) 提交 PR（包含变更说明、测试结果与运行截图/artifact）；
3) 你/团队 review 后合并并上线（若 main 受保护，PR 合并后 workflow 可自动在 CI 中运行 dry-run 以验证）。

请确认我现在开始实现方案 A（我会在实现后提交 PR 并在此处报告 smoke test 结果）。
