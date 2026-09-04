# P3 阶段日志：前端浏览器总验收

日期：2026-09-04　执行：总验收（主会话代理）；一处修复由 implementer（glm-5.3-flash，任务单 P3-01）完成

## 方法

自建静态服务器 + 系统 Chrome（puppeteer 22.15.0），脚本 `.strata/work/p3-browser-check.mjs`（不入库），结果存 `.strata/work/p3/report.json`，截图存 `.strata/work/p3/*.png`（六张：三宽度 × 明暗）。

## 结果：38/38 通过

- **三宽度 × 双主题**（360/768/1440 × light/dark）：数据加载 ready、3 深度卡 + 2 简报卡、无横向溢出（全部 +0px）、主题切换生效、控制台无错误。
- **功能流**：Tab 切换、案例精选块渲染、详情打开（5 章节）、`story_type` 中文标签（技术商业化）、深链 `?case=cursor-workflow-wedge#cases`、复制链接反馈、外链全部 `noopener noreferrer`、历史返回、证据抽屉展开（16 个来源链接）、键盘 Enter 切换 Tab。
- **国际化**：en/es 首屏切换正确（"Evidence first. Entrepreneurship second." / "Primero la evidencia…"），切回 zh 一致，无控制台错误。
- **降级矩阵**：`prefers-reduced-motion` 无错误；断网（独立无缓存上下文）→ `error` 状态且页面不白屏；仅日报断（有缓存）→ `partial` 状态且内容照常渲染；空日报 → 显式 `.startup-empty` 空态。

## 验收中发现并修复的真实缺陷

**copy-link 按钮异步空引用**（任务单 P3-01，`startup.js:396-399`）：原实现在 `await navigator.clipboard.writeText()` 之后引用 `event.currentTarget`，按 DOM 规范此时必为 `null`，try/catch 两分支均抛 `TypeError`，"链接已复制"反馈永不显示。实施代理修复：await 前捕获 `const button = event.currentTarget`。修复后复跑全套 38/38 通过。

## 测试脚本自身的两次误报（记录以防复发）

1. 首轮把 `/favicon.ico` 404 当作模块回归（实为全站无 favicon 的既有状况，仅每浏览器会话首个页面请求）。
2. 断网测试未真正隔离 localStorage（此前页面写入的缓存使状态变为 `partial` 而非 `error`）；改用独立浏览器上下文后正确断言。

## 备注

- `acceptance.md` 前端节各项对应本轮检查，待 P4 上线后统一回填勾选。
- 站点无 favicon 属全站既有状况，不属本模块，未处理（可另行立项）。
