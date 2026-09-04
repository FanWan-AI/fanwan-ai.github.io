# 数据契约

JSON Schema 是发布门禁；本文件说明语义。机器可读 Schema 位于 `tools/startup/schemas/`。

## 1. 日报 `opportunities/latest.json`

根字段：

| 字段 | 语义 |
| --- | --- |
| `schema_version` | 当前为 `1` |
| `kind` | 固定 `startup_opportunity_daily` |
| `date` | 编辑日期，`YYYY-MM-DD` |
| `generated_at` | 带时区 ISO 时间 |
| `editorial_note` | 当日总判断，不写空泛口号 |
| `opportunities` | 0–10 条，按总分降序 |
| `sources` | 去重后的证据字典 |
| `quality` | 门禁结果、覆盖率与警告 |

每条机会至少包含：

```json
{
  "id": "stable-slug",
  "rank": 1,
  "depth": "deep",
  "title": "面向谁的什么机会",
  "verdict": "一句可证伪判断",
  "customer": "具体购买者",
  "pain": "正在发生且有成本的痛点",
  "why_now": ["带来源的时间窗口"],
  "evidence": [{"claim": "事实", "source_ids": ["src-1"], "confidence": "high"}],
  "ai_advantage": "AI 为何不可轻易替换为普通自动化",
  "smallest_sellable_product": "14 天左右可交付的付费版本",
  "business_model": "谁为何付钱",
  "failure_modes": ["最可能失败的原因"],
  "falsification_test": "最快证伪动作",
  "score": {"total": 82, "pain": 18, "timing": 17, "evidence": 18, "ai_fit": 15, "reachability": 14},
  "tags": ["合规", "B2B"]
}
```

前三条必须为 `deep` 且字段完整；其余可为 `brief`，但不得省略来源、风险和证伪动作。

## 2. 案例索引 `cases/index.json`

包含已发布案例的摘要，不包含草稿。每项含 `slug`、`published_at`、`title`、`company`、`story_type`、`dek`、`verdict`、`read_minutes`、`case_path` 与封面主题字段。

## 3. 案例正文 `cases/<slug>.json`

案例正文固定外框、动态章节：

```json
{
  "schema_version": 1,
  "kind": "startup_case_analysis",
  "slug": "cursor-workflow-wedge",
  "status": "published",
  "story_type": "technical_commercialization",
  "central_question": "中心矛盾",
  "title": "标题",
  "dek": "导语",
  "verdict": "可争辩结论",
  "timeline": [{"date": "2024-08", "event": "事件", "source_ids": ["src-1"]}],
  "sections": [{"id": "workflow-wedge", "heading": "动态标题", "thesis": "本节判断", "paragraphs": ["正文"], "source_ids": ["src-1"]}],
  "unknowns": ["公开资料无法确认的事项"],
  "copy": ["可迁移做法"],
  "avoid": ["不可盲抄做法"],
  "next_experiment": "读者可以执行的实验",
  "sources": []
}
```

`sections` 为 3–8 节，标题和顺序由中心矛盾决定，禁止强制套用统一模板。

## 4. 来源对象

每个来源必须包括 `id`、`title`、`url`、`publisher`、`published_at`、`retrieved_at`、`tier`。`tier` 取值：

- `primary`：公司公告、产品文档、监管机构、法院/政府文件、原始数据。
- `reputable_secondary`：有编辑流程的主流商业或技术媒体。
- `discovery_only`：仅用于发现线索，不能单独支撑重大数字或因果结论。

## 5. 兼容策略

前端忽略未知字段；缺失必填字段时整份数据拒绝渲染并回退到内置安全错误态。Schema 的破坏性变更必须提升 `schema_version`。
