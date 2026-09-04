# 运行与故障处理

## 1. GitHub 配置

必需 Secret：

- `DEEPSEEK_API_KEY`

可选配置：

- Repository Variable `DEEPSEEK_BASE_URL`，默认 `https://api.deepseek.com/v1`。
- Repository Variable `DEEPSEEK_MODEL`，默认 `deepseek-v4-flash`。
- Secret `BRAVE_SEARCH_API_KEY`，用于增强网页发现；缺失时使用受控 RSS 与 DeepSeek 搜索能力。

## 2. 本地命令

```bash
npm run startup:test
npm run startup:validate
npm run startup:fixture
npm run startup:daily -- --dry-run
npm run startup:case -- --topic "company or question" --dry-run
```

`startup:fixture` 不访问网络、不需要密钥，用于回归完整发布链。

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
4. 执行 promote 命令，将案例加入公开索引。
5. 提交后由 Pages 工作流部署。
