# 模型雷达升级交接（2026-09-10）

## 状态与实施边界

模型包代码与离线回归已完成；真实生成、内容语义审阅、桌面/移动浏览器验收及提交部署由主代理负责。本实施包未运行付费接口、未改公共 `data/`、未提交或推送，未写主代理 `.tmp/research-live-20260910/`。保留其余代理的论文/创业修改。

依据：`docs/ai-research-upgrade-design-20260909.md`、`docs/ai-research-modules-audit-20260909.md`。

## 可运行入口与严格预算

在项目根目录运行，Node 22+，已安装锁文件依赖。代理/密钥由运行方注入，不在浏览器使用，不打印密钥。

```powershell
$env:MODELSWATCH_DATA_DIR = 'D:\your-isolated-run\models'
$env:MODELSWATCH_AUDIT_DIR = 'D:\your-isolated-run\audit'
node tools/modelswatch/daily.mjs --date=2026-09-10 --per-source=4
node tools/modelswatch/enrich.mjs --date=2026-09-10 --per-source=2 --max-calls=4
node tools/modelswatch/data_analysis.mjs --date=2026-09-10
node tools/modelswatch/qualify_publish.mjs --date=2026-09-10 --limit=2
```

- A：`daily.mjs` / `discover.mjs`。每源一个列表请求，无分页、无分类扩散、无历史库 ID 排除。参数 `--per-source` 是每源返回上限，范围 1–20，默认 6；接口请求 25 秒、最多重试一次、最多 1 MB。列表 API 依赖 GitHub Search 和 HF models；GitHub token 推荐，HF token 可选。主题按日轮换 llm、ai-agents、llm-inference、rag、llm-evaluation、fine-tuning；不是广泛的 artificial-intelligence 标签。A 不调用 LLM。
- B：`enrich.mjs`。每源最多读取 `--per-source`（默认 4、最大 8）个发布者 README；按两源交替使用 `--max-calls`（默认 6、最大 10）预算。CLI 强制 DeepSeek 零重试，保证预算指的是实际 HTTP 生成尝试数。每份来源 25 秒、最多重试一次、最多 300 KB；保留最多 28 个完整段落、总计 22,000 字符的节选。默认模型 deepseek-v4-flash，`DEEPSEEK_TIMEOUT_MS` 可设 120000。必需 `DEEPSEEK_API_KEY`，可选 `DEEPSEEK_BASE_URL`。同来源节选 hash 的已合格缓存可免生成复用。
- C：`data_analysis.mjs` 只接受在该日期重新查阅来源的缓存；`qualify_publish.mjs --limit=N` 每源精选上限 1–5，默认 4，不凑满。C 完全不调用网络/LLM。
- `--dry-run` 仅表示不写输出：A 仍访问免费来源，B **仍可能调用付费 LLM**。纯离线请执行测试，而不是把 dry-run 当作离线。
- 环境变量名称是 **`MODELSWATCH_DATA_DIR`**，不是 `MODEL_SWATCH_DATA_DIR`。`MODELSWATCH_SCHEMA_DIR` 可覆盖 schema 路径；默认仍读取仓库中的 schema。

## 数据依赖

### 必需

- 代码验证依赖：`data/ai/modelswatch/schemas/*.json` 全目录。当前老 schema 的顶层与已有字段保持严格；`tools/modelswatch/lib/schema.mjs` 为新的 source/insights/family 字段增加兼容定义，未修改公共 schema 数据。
- B/C：当前日期的 `daily/YYYY-MM-DD.github.draft.json` 与 `daily/YYYY-MM-DD.hf.draft.json`，由 A 创建。
- C：`summary_cache.json` 中至少每源一条当前日期 `reviewed_for_date`、完整中文、来源证据及安全验证建议。由 B 创建；不是旧 `tri_cache.json`。
- 发布：C 分析生成的 `daily_temp_data/YYYY-MM-DD_qualified_gh.json`、`_qualified_hf.json` 和 `daily/YYYY-MM-DD.passonce_gh.json`、`.passonce_hf.json`。

### 可选但正式集成应保留

- `summary_cache.json`：缓存复用；不存在时 B 可从空库开始。
- `corpus.gh.json`、`corpus.hf.json`：保留已有分类库，不因加入 v2 精选门槛整库清除。
- `daily/*.github.json`、`daily/*.huggingface.json`、`daily/*.legacy.json`、`daily/dates.json`、`daily_github.json`、`daily_hf.json`：旧发布历史与内容签名排重。隔离验证不要求复制全部归档；正式发布需保留已有日期索引与库。
- `models_categories.json` 或邻接的 `../ai_categories.json`、`task_aliases.json`、`project_categories.json`：任务与工程分类。隔离目录应复制 `models_categories.json`，或把 ai_categories 放在隔离 models 目录的父目录，避免 taxonomy 路径落空。
- `models_hotlist.json`、`projects_hotlist.json`、`state.json`：已有分类与维护状态。缺失时有空状态处理，不作为源证据。
- 旧 `tri_cache*`、全量 `items/`、年月 corpus JSONL 不再是 A/B 必需输入，B 不再走旧 Python tri_worker/apply_tri 链。

## 发布契约与失败行为

保持主代理最终验证器所需格式：

```text
latest_release.json
  date
  published_at
  github       = daily_github.json = daily/YYYY-MM-DD.github.json
  huggingface  = daily_hf.json     = daily/YYYY-MM-DD.huggingface.json
daily/YYYY-MM-DD.release.json = latest_release.json
```

同一批所有内容先完成校验，再缓冲写入；任一源无合格正文、错误来源身份、日期不符、派生文件 schema 不通过都会失败并保留上一公开版本。写盘失败会回滚已写文件；页面用单个快照避免把不同时期的两个别名拼在一起。快照最后写入，GitHub 发布依然应以成功后的整次 Git commit 为部署单位。这不是对进程被强杀/磁盘硬件故障的跨文件事务承诺。

失效情形不会把原始英文摘要、热度 passonce 或占位文字当成精选。中文必须有完整句末，不得省略号截断、低信息重复灌水或复制英文。canonical_id 必须与 github.com / huggingface.co 的仓库 URL 完全匹配，凭据 URL、本地 IP/localhost 不可作为来源。发布要求来源 URL、README 地址、内容 hash、抓取日期、实际节选与字段引用编号齐备。

模型家族通过明确 base_model / quantized 关系去重；没有血缘证据时只合并同发布者明显量化变体，不能误合并不同微调。corpus 成员资格不是拒绝理由；已精选的同一来源内容签名不重发，实质来源文本变更可再入选。下载量、likes、抓取日期和翻译改写不会单独产生新事件。README 文本变更仍不等于真正重大版本升级，需要审阅。

## 内容与安全修订

- 每项包含完整中文简介、适用任务、关注理由、边界与建议验证。模型/项目名保持原名；没有英语/西语版本时明确语言为中文，不伪装本地化。
- 文本中的数字须在所引用节选中出现；引用编号必须存在。此类规则不能证明语义对应，也不能证明作者的能力宣传；主代理仍需人工核对含义。
- GitHub README 须同时有核心 AI 功能与工程工作流证据，不能只凭 AI topic 通过；这是保守的关键词筛选，不是完成了学术/商业真伪审查。
- `trial` 必须明确为**建议**，限定离线/沙箱/隔离与合成/模拟数据；拒绝实盘、资金动作、提交个人健康/敏感信息、直接执行远程代码、冒充已实测。
- 主代理真实运行反馈过“建议小额实盘”，以及通用 AI 标签采到交易引擎/健身应用；已据此修改生产提示词、代码校验和发现主题。首次旧样本需由主代理移除无关交易引擎、人工修订验证建议；不因凑数放行，不自动重跑付费。

## 前端与工作流

- `lab/modelswatch.html` 接入 `assets/modelswatch/content.mjs`、`render.mjs`、`reading.css`。内容优先的两列卡片、手机单列；正文不截断。用途与关注理由可直接读，边界/验证/引用展开查看；不恢复整排 meta chips，不添加顶层模块。下载与 likes 退为小字关注信号，不叫性能评分。
- 首次加载优先读 `latest_release.json`；选择旧期先读该期成对快照，升级前归档走严格同日期兼容路径。读取失败保留正在展示的版本与实际日期。分类库路径保留，不对历史库套用 v2 精选来源门槛。
- 全流水线调整为一个串行 job，默认每天 UTC 02:30 / 北京时间 10:30；GitHub 排队会延迟实际发布时间。人工 A/B/C 入口保留，共享 publish concurrency。工作流先运行离线回归，安全 rebase 冲突则退出，绝无 force push 兜底。
- taxonomy tagging 工作流仅更新 corpus，不再事后改快照/别名导致成对契约失配，也不再触发付费 fallback。
- 独立 CI 的 sparse checkout 需包含 `lab/modelswatch.html`、`assets/modelswatch`、`.github/workflows/modelswatch*.yml`、`tools/modelswatch`、`tools/startup/lib`、`tests/modelswatch`、`data/ai/modelswatch/schemas`；测试不依赖完整历史库。

## 验证结果

`node --test tests/modelswatch/*.test.mjs`：**20/20 通过**（2026-09-10，本地 Node 24；CI 配置 Node 22）。测试使用 OS 临时目录，无网络、无密钥、无真实 LLM。覆盖：中文完整性/重复、身份与 URL、安全验证建议、家族去重/真实来源内容变化、预算与缓存、双源失败保护、写盘回滚、保留 corpus、别名/快照/当期归档一致、脚本语法、工作流节奏与禁止 force push。

尚待主代理：真实样稿与来源语义审阅；完整发布验证器；浏览器桌面/移动与语言切换、日期归档、分类库交互验收；提交及部署。一次生成成功不能证明长期更新稳定。
