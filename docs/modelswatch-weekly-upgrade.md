# ModelsWatch Weekly — 升级计划与实施清单

版本 & 目的
- 版本: 2025-09-30
- 目的: 统一 tri_cache 作为 LLM 输出的可信持久层，确保 tri_cache 中的高质量三语摘要被稳定地应用到 site sidecars（`hf_summaries.json` / `gh_summaries.json`）、`projects_hotlist.json`、`models_hotlist.json` 以及 snapshots 对应的 `hf_summaries.json`。同时改进可观测性、可回滚与 CI 安全策略。

快速检查结论（思路评审）
- 总体思路正确，建议补强如下：
  1. 统一 canonical key（建议：`sha256:<fullhex>`），并在 tri_cache 条目中显式保存 `canonical_key` 字段。
  2. 明确 tri_cache 与 summary_cache 的职责边界：tri_cache = LLM 生成/评估层；summary_cache = sidecar 的“最终源”。在生成 sidecar 前由合并器（merger）将 tri_cache 的高质量条目回填到 summary_cache。
  3. 所有写入 summary / hotlist 的操作必须先备份并产出 audit 文件，支持人工复核与回滚。
  4. 引入合并器（tri_cache -> summary_cache），在 CI 中作为独立步骤运行且支持 dry-run。
  5. 增强匹配（short-key、canonical、启发式扫描）与质量标注（quality, score, provider），避免误填或低质量覆盖。

需要修改 / 新增的文件与函数（单页清单）

- 规范哈希与校验
  - `tools/modelswatch/fast_summary.mjs`
    - 导出/确认 `promptHash(...)`，输出 `sha256:<hex>`（并与 Python 实现保持一致）。
  - `tools/tri_summarizer.py`
    - 写入 tri_cache 时保存 `canonical_key`, `generated_at`, `provider`, `quality` 字段。

- tri_worker / LLM 调度
  - `tools/modelswatch/tri_worker.mjs`（或仓库中实际 tri_worker 脚本）
    - `processPending` 主流程：生成后写 tri_cache（带 canonical_key），并可选择触发合并器将高质量摘要回填 summary_cache（由合并策略控制）。

- 合并器（新）
  - `tools/modelswatch/apply_tri_to_summary.mjs`（新增）
    - 功能: tri_cache -> summary_cache 的合并；支持 `--dry`、`--backup`、`--write` 和 `--audit <file>`。
    - 规则: 仅当 summary_cache 字段为空/占位/低质量且 tri_cache 标注为高质量时覆盖；写入 provenance（source, provider, generated_at）。

- snapshot / sidecar 生成
  - `tools/modelswatch/generate_snapshot_summaries.mjs`
    - 改为优先读取 `summary_cache`；若缺值再 fallback tri_cache（支持 canonical & short-key），并为每条记录写入 `provenance`。

- hotlist 构建
  - `tools/modelswatch/build_hotlists.mjs` 或 `tools/update_hotlist_from_tricache.mjs`
    - 使用更新后的 sidecars 生成 hotlists；在 sidecar 缺失时 fallback tri_cache；在 hotlist 条目写入 provenance 和质量标记。

- 校验与测试
  - `tools/modelswatch/check_hash_compat.mjs`（新增/增强）
    - 对 Node/Python 的 hash 算法一致性做检测，输出 `tools/modelswatch/audit/hash_compat.json`。
  - 测试: `tests/hash_compat.test.js`（单元测试，确保 promptHash 两端一致）。

- 数据与备份位置
  - `data/ai/modelswatch/tri_cache.json`（schema 要求：version, generated_at, items:{ shortKey: { canonical_key, id, summary_en/zh/es, quality, provider, generated_at } }）
  - `data/ai/modelswatch/summary_cache.json`（合并器写入目标）
  - 备份路径: `data/ai/modelswatch/backups/<file>.<timestamp>.bak`

CI workflow（可直接复制粘贴）
- 文件: `.github/workflows/modelswatch-weekly.yml`
- 思路: 两阶段（lightweight-check 无 LLM，full-run 可调用 LLM 与创建 PR）。

```yaml
name: modelswatch-weekly

on:
  workflow_dispatch:
  schedule:
    - cron: '0 3 * * 0'  # weekly Sunday 03:00 UTC

jobs:
  lightweight-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install deps
        run: npm ci
      - name: Hash compatibility check
        run: node tools/modelswatch/check_hash_compat.mjs
      - name: Tri->Summary merger (dry-run)
        run: node tools/modelswatch/apply_tri_to_summary.mjs --dry --out tools/modelswatch/audit/merger_dry.json
      - name: Upload audit
        uses: actions/upload-artifact@v4
        with:
          name: modelswatch-audit
          path: tools/modelswatch/audit/*.json

  full-run:
    needs: lightweight-check
    runs-on: ubuntu-latest
    if: ${{ secrets.OPENAI_API_KEY != '' }}
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install deps
        run: npm ci
      - name: Tri->Summary merger (write)
        run: node tools/modelswatch/apply_tri_to_summary.mjs --backup --write --audit tools/modelswatch/audit/merger_write.json
      - name: Run tri_worker (LLM)
        env:
          PROCESS_ALL_PENDING: '1'
          SPEED_MODE: '0'
          POST_REFRESH_SNAPSHOTS: '1'
          TRI_CACHE_PERSIST: '1'
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: node tools/modelswatch/tri_worker.mjs
      - name: Rebuild snapshots & hotlists
        run: |
          node tools/modelswatch/generate_snapshot_summaries.mjs
          node tools/modelswatch/build_hotlists.mjs
      - name: Create Pull Request
        uses: peter-evans/create-pull-request@v5
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          commit-message: chore(modelswatch): auto-update data from tri_cache
          branch: auto/modelswatch-update-${{ github.run_id }}
          title: Auto update modelswatch data from tri_cache
          body: Automated tri_cache -> summary_cache -> snapshots -> hotlists update.
```

分阶段执行计划（含命令与备份）

- 备份约定（在所有写入前执行）
  - `mkdir -p data/ai/modelswatch/backups`
  - 示例备份命令（PowerShell）：

```powershell
$ts = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
Copy-Item data/ai/modelswatch/summary_cache.json data/ai/modelswatch/backups/summary_cache.json.$ts.bak
Copy-Item data/ai/modelswatch/tri_cache.json data/ai/modelswatch/backups/tri_cache.json.$ts.bak
Copy-Item data/ai/modelswatch/projects_hotlist.json data/ai/modelswatch/backups/projects_hotlist.json.$ts.bak
```

阶段 0 — 兼容检测（低风险）
- 目的: 发现 hash / key 不兼容的条目并汇报
- 命令:
```bash
node tools/modelswatch/check_hash_compat.mjs > tools/modelswatch/audit/hash_compat.json
```
- 人工 review `tools/modelswatch/audit/hash_compat.json`。

阶段 1 — 合并器 dry-run（审计）
- 目的: 检查 tri_cache 能回填多少 summary_cache
- 命令:
```bash
node tools/modelswatch/apply_tri_to_summary.mjs --dry --out tools/modelswatch/audit/merger_dry.json
```

阶段 2 — 合并器正式写入（备份+写）
- 目的: 把 tri_cache 的高质量摘要写回 summary_cache（并生成 audit）
- 命令:
```powershell
# 本地或 CI 写模式
$ts = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
mkdir data/ai/modelswatch/backups -ErrorAction SilentlyContinue
Copy-Item data/ai/modelswatch/summary_cache.json data/ai/modelswatch/backups/summary_cache.json.$ts.bak
node tools/modelswatch/apply_tri_to_summary.mjs --backup --write --audit tools/modelswatch/audit/merger_write.json
```

阶段 3 — 重建 snapshots & hotlists（本地先行审查）
- 命令:
```bash
node tools/modelswatch/generate_snapshot_summaries.mjs
node tools/modelswatch/build_hotlists.mjs
```

阶段 4 — tri_worker 处理剩余 pending（需要 LLM keys）
- 环境: 在 CI 中或本地设置 LLM keys（谨慎）
- 命令 (PowerShell)：
```powershell
$env:PROCESS_ALL_PENDING='1'
$env:SPEED_MODE='0'
$env:POST_REFRESH_SNAPSHOTS='1'
$env:TRI_CACHE_PERSIST='1'
$env:OPENAI_API_KEY='__YOUR_KEY__'
node tools/modelswatch/tri_worker.mjs
```

回滚命令示例

```powershell
Copy-Item data/ai/modelswatch/backups/summary_cache.json.20250930T120000Z.bak data/ai/modelswatch/summary_cache.json -Force
```

验收准则（MVP）
- `check_hash_compat` 的 tri_cache_hits / total >= 0.8（可调整阈值）
- sidecar 中 placeholder 数量显著下降
- 所有写入有 `.bak` 备份与 `tools/modelswatch/audit/*.json` 审计文件
- PR 包含 audit artifact，供人工复核

补充建议/风险点
- 避免在没有人工审查的情况下直接自动 push 到受保护的 `main`。建议 CI 创建 PR，由人工合并。
- quality 字段的定义需要明确（boolean vs 分数），并在 tri_worker 中产出。
- 启发式匹配可能带来误填，默认应为“建议/审阅模式”，只在高置信或白名单中自动写回。

下一步建议（你选其一）
1. 我生成 `.github/workflows/modelswatch-weekly.yml` 与 `tools/modelswatch/apply_tri_to_summary.mjs` 的骨架代码（含 dry-run/audit），并运行 lightweight-check。
2. 我先把需要修改的具体代码行列表（patch）准备好，供你 review 与 commit。
3. 仅生成 `docs/modelswatch-weekly-upgrade.md`（已完成）并等待你手动推进。

---

*文档结束*
