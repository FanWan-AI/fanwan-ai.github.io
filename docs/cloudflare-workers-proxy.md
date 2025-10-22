# Cloudflare Workers 代理（DeepSeek）部署指南

本指南手把手带你在 Cloudflare Workers 上部署一个安全的 DeepSeek 代理，满足本站 AI 智答前端的流式 SSE 需求，同时具备最基本的 CORS 和限流。

适用对象：
- 你使用 GitHub Pages 托管静态站点（例如 https://fanwan-ai.github.io）。
- 你不想在前端暴露 API Key，且需要一个支持 SSE 的中转层。
- 你使用 Windows，PowerShell 作为默认终端（以下命令均兼容）。

---

## 1) 准备工作（一次性）

- 注册 Cloudflare 账号：https://dash.cloudflare.com/
- 安装 Node.js（>= 18）
- 安装 Wrangler CLI：

```powershell
npm i -g wrangler
wrangler --version
```

- 拿到 DeepSeek API Key（形如 `sk-...`）。

---

## 2) 新建 Worker 项目

你可以直接让脚手架创建一个新项目，也可以手动新建。下面用脚手架方式：

```powershell
npm create cloudflare@latest deepseek-proxy
# 交互中选择：
# - "Hello World" 模板（JS）或任意 JS 模板
# - 是否使用 TypeScript 按需
# 完成后进入目录：
Set-Location deepseek-proxy
```

将本仓库里的示例 Worker 源码复制过去，覆盖入口文件：

- 源文件：`tools/deepseek-proxy-worker.js`
- 目标文件：`src/index.js`（或项目入口，取决于脚手架提示；若是根目录 index.js，请粘贴到对应文件）

同时，配置 `wrangler.toml`（脚手架已生成）。示例：

```toml
name = "deepseek-proxy"
main = "src/index.js"
compatibility_date = "2025-10-22"

[vars]
UPSTREAM_URL = "https://api.deepseek.com/chat/completions"
DEFAULT_MODEL = "deepseek-reasoner"
# 允许的前端来源（逗号分隔，按需添加你的自定义域）
ALLOWED_ORIGINS = "https://fanwan-ai.github.io"
# 可选：限定最大输出 tokens
MAX_TOKENS = "2048"
```

设置密钥（Secrets）：

```powershell
wrangler secret put DEEPSEEK_API_KEY
# 粘贴你的 DeepSeek API Key，回车确认
```

登录 Cloudflare：

```powershell
wrangler login
```

---

## 3) 本地预览（可选）

Wrangler 能在本地模拟 Worker，但注意本地不具备完整的边缘流式表现，仅用于基本联通验证。

```powershell
wrangler dev
```

打开终端显示的本地地址（一般为 http://127.0.0.1:8787/health），应返回：

```json
{"ok":true,"time":"..."}
```

---

## 4) 部署到 Cloudflare 边缘

```powershell
wrangler deploy
```

成功后，你会得到一个 `*.workers.dev` 的公开地址，记下它，例如：

```
https://your-subdomain.workers.dev
```

接口路径：
- 健康检查：`GET /health`
- Chat 流式代理：`POST /chat`

---

## 5) 线上联通测试（SSE）

使用系统自带的 curl.exe 进行一次最小化流式请求（PowerShell 下建议显式使用 `curl.exe` 而非 `curl` 别名）：

```powershell
$URL = "https://your-subdomain.workers.dev/chat"
$BODY = '{
  "model": "deepseek-reasoner",
  "messages": [
    {"role":"system","content":"You are a helpful assistant."},
    {"role":"user","content":"Say hello in 5 words."}
  ],
  "temperature": 0.7,
  "max_tokens": 256,
  "stream": true
}'

curl.exe -N -s -X POST "$URL" -H "Content-Type: application/json" -d "$BODY"
```

预期输出是以 `data: ...` 为前缀的一系列事件，最后包含 `data: [DONE]`。

若返回 `CORS: Origin not allowed`，请检查 `wrangler.toml` 的 `ALLOWED_ORIGINS` 是否包含你实际请求的前端来源（本地 curl 无需 Origin，浏览器才有）。

---

## 6) 回填前端站点配置

你的站点文件：`lab/ai-zhida.html`

- 在 `<body>` 标签上设置代理地址：

```html
<body class="zhida-page" data-proxy-endpoint="https://your-subdomain.workers.dev">
```

- 更新 CSP（Content-Security-Policy）中的 `connect-src`，将 Worker 域名加入白名单：

找到页面 `<head>` 中的 CSP meta（已有类似）：

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; ...; connect-src 'self' https://api.countapi.xyz ...; ...">
```

在 `connect-src` 末尾追加你的 Worker 地址，例如：

```html
connect-src 'self' https://api.countapi.xyz https://counterapi.dev https://api.counterapi.dev https://busuanzi.ibruce.info https://your-subdomain.workers.dev;
```

保存并推送站点后，浏览器访问 `/lab/ai-zhida.html`，打开开发者工具 Network/Console，发送一条消息，确认能正常流式返回。

---

## 7) 常见问题与排查

- 403 CORS: Origin not allowed
  - 确认 `wrangler.toml` 的 `ALLOWED_ORIGINS` 包含页面实际来源（例如 https://fanwan-ai.github.io 或你的自定义域）。修改后 `wrangler deploy` 生效。

- 401/403 Upstream error
  - 检查 `DEEPSEEK_API_KEY` 是否正确；如需轮换，重新执行 `wrangler secret put DEEPSEEK_API_KEY` 并部署。

- 流式卡住或无法停止
  - 前端通过 `AbortController` 取消请求，后端无需特殊处理；若网络代理或中间层有缓冲（如 Nginx 反代），确保禁用响应缓冲。Worker 已设置 `X-Accel-Buffering: no` 与合适的 `Cache-Control`。

- 需要更强的限流/指标
  - 当前 Worker 内置的是“每实例”内存滑窗（示例）。生产建议使用 Cloudflare 的 Rate Limiting Rules、Durable Objects 或 Logs + Analytics。

- 自定义域绑定
  - 在 Cloudflare Dashboard 将自有域名路由到该 Worker（Routes），并在 `connect-src` 中加入该自定义域（同时保留 workers.dev 以便回退）。

---

## 8) 安全建议（务必阅读）

- 永远不要在前端暴露 API Key。
- 严格的 CORS 白名单，仅允许你的站点来源（不要使用 `*`）。
- 根据需要开启 Cloudflare Turnstile（站点验证码）并在 Worker 中校验 `cf-turnstile-response`，可有效减少滥用。
- 如果要支持文件上传或更复杂路由，务必做大小/类型限制，并考虑请求签名与审计日志。

---

## 附录：文件索引

- Worker 源码（本仓库示例）：`tools/deepseek-proxy-worker.js`
- 需要编辑的页面：`lab/ai-zhida.html`
- 相关 JS 客户端：`tools/ai_zhida/zhida.js`（会从 `<body data-proxy-endpoint>` 读取代理地址，并通过 SSE 流式消费）

祝部署顺利！
