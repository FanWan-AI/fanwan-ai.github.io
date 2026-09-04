# 公开数据来源登记（provenance）

记录 `data/ai/startup/` 下每份数据的产生方式，供验收与回滚时判断可信度。上线后由流水线产生的数据以 `pipeline_version` 与 Git 历史为准。

| 文件 | 产生方式 | 说明 |
| --- | --- | --- |
| `opportunities/latest.json`（2026-09-04 期，5 条机会） | **手工种子数据**（前任实施者以 `tools/startup/lib/fixtures.mjs` 的结构与风格为模板扩充编写） | 未经真实采集 / 生成流水线；来源 URL 为人工整理，未做机器可达性复核；通过全部确定性门禁与 schema 校验。将在首次真实流水线运行（蓝图 P2 / 线上日更）后被真实产物替换 |
| `cases/cursor-workflow-wedge.json`（5 节 / 14 来源） | **手工种子数据**（同上；fixture 中同名案例为 4 节 / 5 来源的简化原型，二者标题不同） | 作为 ADR-003 所述"黄金样本"的初版；其论证结构是后续周案例的质量参照，不是事实核对基准 |
| `cases/index.json` | 随种子案例手工建立 | 首次 `promote-case` 后由流水线维护 |

判定依据：`generate-fixture.mjs` 默认输出到系统临时目录而非 `data/`；本地无 `DEEPSEEK_API_KEY` 运行痕迹；种子内容与 fixture 内容同构不同文。

## 处置原则

- 种子数据仅用于上线首日的页面完整性，**不作为事实依据对外引用**。
- P2 真实 dry-run 通过后，用真实流水线产物覆盖 `latest.json`（案例可保留为种子，`revision_note` 注明）。
- 任何手工修订都必须带 `updated_at` + `revision_note`（编辑政策 §6）。
