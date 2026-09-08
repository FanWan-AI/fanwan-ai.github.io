# 运行与故障处理

## 1. GitHub 配置

必需 Secret：

- `DEEPSEEK_API_KEY`

可选配置：

- Repository Variable 或 Secret `DEEPSEEK_BASE_URL`，默认 `https://api.deepseek.com/v1`，Variable 优先。
- Repository Variable `DEEPSEEK_MODEL`，默认 `deepseek-v4-flash`。
- Secret `BRAVE_SEARCH_API_KEY`，用于增强网页发现；缺失时使用受控 RSS 和来源网页正文。当前生成器使用 Chat Completions，不隐式调用模型原生搜索。
- DeepSeek 使用 `deepseek-v4-flash`；写作禁用默认思考模式，校验启用 low 思考。每次写作输出上限 16,384 token、请求默认超时 180 秒、有界重试。密钥只存在于本机 `.env` 和 Actions secrets。

## 2. 本地命令

```bash
npm run startup:test
npm run startup:validate
npm run startup:fixture
node --env-file=.env tools/startup/generate-daily.mjs --output-root .tmp/startup-review
node --env-file=.env tools/startup/generate-case-draft.mjs --topic "company or question" --output-root .tmp/startup-review
```

`startup:fixture` 不访问网络、不需要密钥，用于回归完整发布链。

`--dry-run` 会真实采集与写作，但不运行 LLM 复核、不发布，因此不能作为完整上线验收。完整验收使用上述隔离输出目录，且不加 `--dry-run`。

## 3. 定时计划

- 日报：每天新加坡时间 07:17，避开整点拥塞；也支持手动触发。
- 案例：每周二新加坡时间 08:23 生成草稿；支持手动指定主题。
- 所有工作流设置并发锁，新的同类任务不会与旧任务同时写文件。

## 4. 失败策略

- 采集结果为空、候选低于阈值、LLM 输出不合法或证据覆盖不足：任务失败并保留旧版。
- 单个来源超时：记录警告并继续；若导致某条机会证据不足，则剔除该条。
- 发布前创建临时文件并再次读取校验；只有成功后替换目标文件。
- 任何日志都不得打印环境变量或 Authorization Header。

## 5. 回滚

公开数据均在 Git 中。回滚应只恢复对应的 `data/ai/startup/` 版本，然后重新触发 Pages 部署；不要重置整个仓库。

## 6. 周案例流程

1. 定时或手动生成草稿。
2. 自动检查来源、数字、重复结构和禁止措辞。
3. 在草稿运行产物中阅读；必要时修改正文或来源。
4. 在 GitHub Actions 手动运行 **AI Startup Publish Case**，填写已审阅草稿的 run ID。流程校验它来自本仓库 main 分支成功的周案例任务，再校验 JSON 并加入公开索引。需要修改时可下载 JSON，在本地修订后执行 `node tools/startup/promote-case.mjs --draft <path>`。
5. 提交后由 Pages 工作流部署。

## 7. 静态发布

- `scripts/prepare-pages.mjs` 只复制 Git 已跟踪的公开文件。不复制密钥、后端、草稿、停用页面和学堂历史音频；保留论文 PDF、博客和其他在用模块。
- `.github/workflows/npm-grunt.yml` 负责唯一的自定义 Pages 发布。仓库 Pages 的 Build and deployment 应设为 GitHub Actions。
- 日报、案例发布以及原有内容更新任务成功后，由 `workflow_run` 重新部署最新 main，避免 `GITHUB_TOKEN` 提交不触发普通 push 工作流的问题。
- 本地是稀疏检出，少量文件的本地打包只检查逻辑；发布包完整性与体积必须以 GitHub runner 为准。
