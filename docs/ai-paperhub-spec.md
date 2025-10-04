# AI Paper Hub 设计与实施规范 (Draft v1)

> 目标：将现有 `scholarpush.html` 升级为“AI Paper Hub”——融合“今日精选 (实时)”与“AI 发展脉络 (结构化里程碑)”的学术聚合中心，形成前沿追踪 + 体系积累的双循环知识入口。

---

## 1. 核心概念与定位

| 模块 | 角色 | 动态性 | 数据来源 | 产出结构 |
|------|------|--------|-----------|-----------|
| 今日精选 (Today’s Highlights) | 当天/近 48h 高价值论文或研究 | ✅ 实时 | `data/ai/scholarpush/index.json` | 8–10 条论文卡片流 |
| AI 发展脉络 (AI Milestones) | 领域演化/关键里程碑/经典汇总 | ⚙️ 半动态 | `data/ai/scholarpush/milestones/tasks/*.json` + 自动注入 | 分任务板块 + 演化结构 |

双循环逻辑：实时层为积累层提供新鲜候选；积累层为实时层提供领域背景与溯源结构。

---

## 2. 目录与资源规划

```text
/lab/ai-paperhub.html          # 新页面 (替换 scholarpush.html)
/data/ai/scholarpush/index.json   # 今日精选 (LLM 生成)
/data/ai/scholarpush/dates.json   # 日期索引 (历史翻阅)
/data/ai/scholarpush/milestones/index.json   # 任务列表索引 (新增)
/data/ai/scholarpush/milestones/tasks/<task>.json  # 每任务静态/里程碑数据
/data/ai/ai_categories.json     # 分类/层级/任务词表（已存在）
/data/cache/translations/...    # 翻译缓存（可选）
/docs/ai-paperhub-spec.md       # 本规范
```

---
## 3. 数据 Schema 设计

### 3.1 今日精选 (scholarpush `index.json` 建议 Schema 扩展)

```jsonc
{
  "generated_at": "2025-10-04T00:00:00Z",
  "items": [
    {
      "id": "arxiv:2509.01234",          // 可派生或 hash(title+url)
      "title": "Scaling Laws for X",
      "title_i18n": {"zh": "X 的扩展规律", "en": "Scaling Laws for X", "es": "Leyes de Escalado de X"},
      "summary_i18n": {"zh": "…", "en": "…", "es": "…"},
      "one_liner": "浓缩一句话要点",
      "quick_read": "更长中文摘要 (可 120–200字)",
      "tags": ["LLM","RAG","Evaluation"],
      "task": "LLM",                      // 主任务类别 (用于快速过滤)
      "impact_score": 68,
      "reproducibility_score": 52,
      "links": {"paper": "…", "code": "…", "project": "…", "pdf": "…"},
      "has_code": true,
      "key_numbers_compact": ["MMLU +3.2%","2.1× speed"],
      "ts": "2025-10-04T00:00:00Z",
      "host": "arxiv.org",
      "auto_injected": false               // 今日精选中恒为 false；复用字段统一
    }
  ]
}
```

### 3.2 发展脉络任务文件 `milestones/tasks/<task>.json`

```jsonc
{
  "task": "rag",
  "display": {"zh": "RAG（检索增强生成）", "en": "RAG", "es": "RAG"},
  "overview": {"zh": "任务简述…", "en": "…", "es": "…"},
  "lineage_graph_hint": true,
  "updated_at": "2025-10-03T00:00:00Z",
  "items": [
    {
      "id": "rag:2020:REALM",
      "phase": "origin",                   // origin | milestone | bridge | frontier | survey
      "year": 2020,
      "venue": "ICML",
      "title": "REALM: Retrieval-Augmented Language Model Pre-Training",
      "title_i18n": {"zh": "REALM：检索增强语言模型预训练", "en": "…", "es": "…"},
      "summary_i18n": {"zh": "…", "en": "…", "es": ""},
      "rationale": "首次… / 引入…",
      "tags": ["RAG","Retrieval","Pretraining"],
      "links": {"paper": "https://arxiv.org/abs/2002.08909", "code": "https://github.com/...", "project": "N/A", "pdf": "…"},
      "importance_score": 85,
      "lineage": {"prev": ["rag:2019:drkit"], "next": ["rag:2022:atlas"]},
      "auto_injected": false
    },
    {
      "id": "rag:2025:paperX",
      "phase": "frontier",
      "year": 2025,
      "title": "Paper X",
      "summary_i18n": {"zh": "…", "en": "…", "es": "…"},
      "links": {"paper": "…", "code": "…", "project": "…", "pdf": "…"},
      "auto_injected": true                 // 来自今日精选自动注入
    }
  ],
  "latest_window_days": 30                  // 可选：保留最新注入论文的时间窗口
}
```

### 3.3 标签别名表 (新增 `data/ai/scholarpush/tag_aliases.json` 示例)

```jsonc
[
  {"canonical": "RAG", "aliases": ["retrieval-augmented","retrieval","rag"]},
  {"canonical": "Agent", "aliases": ["agents","tool-use","tooluse","planner"]},
  {"canonical": "LLM", "aliases": ["large-language-model","gpt","language-model"]}
]
```

---
## 4. 自动注入逻辑 (今日精选 → 发展脉络)
流程：

1. 加载 `milestones/index.json` → 建立任务键→canonical 标签映射。
2. 加载今日精选 `index.json` → 正规化其每条 `tags`（通过 alias 映射）。
3. 匹配规则：`paper.tags ∩ task.accepted_tags ≠ ∅`。
4. 过滤：
  - 已存在相同 `paper.links.paper` 或 `id` → 跳过
  - 若 `impact_score < MIN_IMPACT`（默认 5–10）且无 `has_code` → 跳过
5. 写入：附加到该任务 `items`，`phase` 为空或设 `frontier`，`auto_injected=true`。
6. 修剪：若超过 `latest_window_days` 或条数 > N（建议 8），按时间 / impact_score 双排序后保留前 N。

可选回收：生成 `milestones/diff/<date>.json` 记录当日新增/剔除，供人工审核。

---
## 5. 多语言策略
| 场景 | zh | en | es | 说明 |
|------|----|----|----|------|
| 今日精选标题 | LLM 生成/翻译 | 原文或回译 | 高影响项生成 | 非高影响项延迟 |
| 今日精选摘要 | 主语言 zh | EN 翻译或源 | ES 仅高影响 | 缓存避免重复 |
| 发展脉络静态 | 人工或高质量翻译 | 保留 | 可择期补齐 | 质量优先 |
| 自动注入 | 先 EN -> zh | EN 保留 | es 异步 | 首屏不阻塞 |

缓存 Key： `md5(title + raw_abstract)` → 映射到 `{zh,en,es}`，缺失语言可增量补齐。

---
## 6. 搜索与过滤设计
阶段 1：前端倒排索引 (JS 构建)
```js
index = {
  token: { docId: [fields...] }
}
```
范围：标题 + 标签 + 简短摘要。过滤条件：年份范围 / 任务 / 是否 auto_injected。排序：时间 / impact_score / has_code 优先。

阶段 2（可选）：向量语义索引
- 离线生成 embedding（MiniLM / bge-small）→ `search_index_embeddings.json`。
- 前端 cosine（全量 <2000 文档可直接线性扫描）。

---
## 7. 前端交互与 UI 规范
| 元素 | 规范 |
|------|------|
| 主色 | `#2E6AF2` |
| 辅色 | `#1B2559` 文本 / `#EEF4FF` 背景块 |
| 圆角 | 12px 卡片 / 6px 按钮 |
| 阴影 | base: `0 2px 4px rgba(0,0,0,0.06)` hover: `0 4px 14px rgba(0,0,0,0.12)` |
| 动画 | tab 切换：opacity 0→1 + translateY(8px) 180ms easing |
| 卡片展开 | `max-height` 动画 + 缓动 cubic-bezier(0.4,0,0.2,1) |
| 标签 | 统一小写 / 自动映射 canonical |

组件：
- 顶部 Tab：`Highlights | Milestones`
- 搜索框：即时过滤（300ms debounce）
- 过滤条：任务下拉 + 年份范围 slider + 排序 (最新 / 热度 / 代码优先)
- 任务板：折叠 + “显示更多过渡论文”
- 自动注入徽章：`<span class="badge frontier">⚡ latest</span>`

---
## 8. 性能策略
| 策略 | 说明 |
|------|------|
| 首屏仅加载 highlights + milestones/index | 减少首次 JSON 体积 |
| 任务数据按需加载 | 展开/搜索触发 fetch |
| Gzip 静态 JSON | GitHub Pages 默认支持（确认 .nojekyll 不影响） |
| 预热翻译缓存 | CI 中对高价值论文批量生成多语言 |
| 分离 search index | `search_index.v1.json` 独立加载 |

预算控制：翻译调用层按 impact_score 或 has_code 限制批量。

---
## 9. 质量校验脚本（规划）
输出：`data/ai/scholarpush/milestones/report.json`
```jsonc
{
  "generated_at": "...",
  "tasks": {
    "rag": {
      "years_span": 7,
      "count": 32,
      "frontier": 3,
      "missing_summaries": 2,
      "dead_links": 1,
      "avg_summary_len_zh": 132
    }
  }
}
```
检查规则：
- 重复标题 (大小写忽略)
- 链接 4xx/5xx
- 摘要长度 < 40 标记为 weak
- frontier > 5 警告
- 缺失 es 翻译只做信息提醒

---
## 10. 标签治理流程
1. 每周脚本扫描 highlights 中未映射标签，写入 `tag_unknown.log`。
2. 人工审阅后加入 alias 表或忽略。
3. 避免新增 canonical 时破坏现有 UI（前端容错：未知标签 → 灰色徽章）。

---
## 11. 安全与健壮性
| 方面 | 策略 |
|------|------|
| 外链 | `rel="noopener noreferrer" target="_blank"` |
| XSS | 所有标题/摘要 innerText 而非 innerHTML；必要时 escape |
| 大 JSON | 分块 / 按需 / 限制单文件 < 500KB |
| 回退 | LLM 不可用 → 保留 EN + 标记 `untranslated` 样式 |

---
## 12. 迭代路线 (Roadmap)
| 阶段 | 目标 | 产出 |
|------|------|------|
| P0 | 页面骨架 + tab + 今日精选接入 | `ai-paperhub.html` 初版 |
| P1 | milestones/index + 单任务懒加载 + 注入 | 任务 JSON + 注入逻辑 |
| P2 | 搜索/过滤 + alias 归一 | 搜索组件 + alias.json |
| P3 | 多语言缓存 + 翻译降级策略 | translations 缓存目录 |
| P4 | 质量校验脚本 + 报告 | report.json + docs |
| P5 | 时间轴 / lineage 可视化 | SVG/Canvas 组件 |
| P6 | 收藏到经典 (localStorage) | 用户偏好缓存 |
| P7 | 语义检索 / 向量索引 | embeddings + 前端近似检索 |

---
## 13. 成功度量 (Metrics)
| 指标 | 说明 | 目标初值 |
|------|------|----------|
| 首屏可交互时间 | highlights + tabs 可用 | < 2.5s |
| Milestones tab 进入率 | 日活中访问该 tab 用户比例 | ≥ 40% |
| 自动注入匹配率 | 新论文匹配到某任务的比例 | ≥ 70% |
| 多语言覆盖 | zh≥100%, en≥95%, es≥60% (阶段) | 达成 |
| 平均摘要信息密度 | 关键数字或方法句占比 | 持续提升 |

---
## 14. 风险与缓解
| 风险 | 描述 | 缓解 |
|------|------|------|
| 标签漂移 | 新标签无法归类 | alias 表 + 周期扫描 |
| 噪声注入 | Reddit/HN 热点但学术价值低 | 最低 impact_score + 白名单域名加权 |
| 翻译费用/失败 | LLM 不稳定 | 缓存 + 分层翻译策略 |
| JSON 体积膨胀 | 加载慢 | 按需加载 + gzip |
| 维护成本 | 人工维护里程碑繁杂 | 半自动推荐 + diff 审核流 |

---
## 15. 后续增强构想（非 MVP）
- Timeline 视图（年份柱 + 里程碑凸显）
- “学习路径”自动生成（基础→进阶→前沿）
- 论文相似推荐（余弦相似度筛 TopK）
- RAG QA：对 milestones 摘要做内嵌问答
- 每周/每月“领域进展快照”自动汇总

---
## 16. 下一步执行前准备 Checklist
- [ ] 确认旧 `scholarpush.html` 引用路径与导航更新策略
- [ ] 盘点现有 `milestones/tasks/*.json` 字段差距
- [ ] 起草 `tag_aliases.json` 初稿
- [ ] 生成 1 个示例任务 (rag) 的完整增强文件
- [ ] 定义 impact_score 归一化策略（0–100）
- [ ] 评估浏览器端 JSON 总体积 (目标首屏 < 300KB)
- [ ] 建立翻译缓存目录结构

---
## 17. 术语对照
| 术语 | 说明 |
|------|------|
| frontier | 最近 12 个月内具突破性或代表“当前最优”方向论文 |
| bridge | 连接两代范式的过渡论文 |
| origin | 概念首次提出或原始范式创建 |
| survey | 系统性综述 / benchmark 汇总 |
| auto_injected | 动态从今日精选流中匹配并加入的最新论文 |

---
## 18. 变更记录
| 版本 | 日期 | 说明 |
|------|------|------|
| v1 | 2025-10-04 | 初始草案，含结构 / 数据 schema / 自动注入策略 |

---
**备注**：本文件为实施前蓝图，后续迭代请在“变更记录”中补充。可在 Roadmap 前关闭或拆分部分特性以保证节奏。
