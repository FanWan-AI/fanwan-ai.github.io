# 部署联网搜索代理 (Web Search Proxy) 指南

本文档详细说明如何将 AI 智答助手所需的联网搜索代理服务部署到 Cloudflare Workers。

由于你的网站托管在 GitHub Pages（静态托管），无法直接在服务器端运行代码，因此我们需要使用 Cloudflare Workers 来作为一个“中转站”（Proxy），安全地调用 Brave Search API 并将结果返回给前端。

## 1. 准备工作

在开始之前，请确保你拥有以下账号和密钥：

1.  **Cloudflare 账号**: 用于托管 Worker 服务。[注册 Cloudflare](https://dash.cloudflare.com/sign-up)
2.  **Brave Search API Key**: 用于获取搜索结果。
    *   访问 [Brave Search API](https://api.search.brave.com/app/keys)。
    *   注册并创建一个 Free Plan（免费版通常足够个人使用）。
    *   获取 API Key（通常以 `BSA` 开头）。

## 2. 环境配置

确保你的本地开发环境已安装 Node.js。

在项目根目录下打开终端（PowerShell 或 CMD），运行以下命令安装 Cloudflare 的命令行工具 `wrangler`：

```powershell
npm install -g wrangler
```

登录你的 Cloudflare 账号：

```powershell
npx wrangler login
```
*浏览器会自动弹出，点击“Allow”授权即可。*

## 3. 部署步骤

我已经为你准备好了配置文件 `tools/ai_zhida/wrangler.websearch.toml`。请按照以下步骤操作：

### 第一步：部署代码

运行以下命令将代码上传到 Cloudflare：

```powershell
npx wrangler deploy -c tools/ai_zhida/wrangler.websearch.toml
```

如果成功，你会看到类似以下的输出：
```text
Published websearch-proxy (0.50 sec)
  https://websearch-proxy.<你的子域名>.workers.dev
```
*请记下这个 URL，如果它不是 `fan-wan-uk`，你需要更新前端代码中的配置。*

### 第二步：设置 API 密钥

为了安全起见，API Key 不能直接写在代码里，需要通过“Secret”环境变量设置。

运行以下命令：

```powershell
npx wrangler secret put BRAVE_API_KEY -c tools/ai_zhida/wrangler.websearch.toml
```

*   终端会提示：`Enter a secret value:`
*   **粘贴你的 Brave Search API Key**，然后按回车。
*   终端会提示：`🌀 Uploading secret BRAVE_API_KEY... Success!`

## 4. 验证部署

部署完成后，你可以通过浏览器访问服务的健康检查接口来验证是否成功。

访问地址：
`https://websearch-proxy.<你的子域名>.workers.dev/health`

*   **成功**：页面显示 `{"ok":true, "time":"..."}`
*   **失败**：页面无法访问或显示 Error。

## 5. 更新前端配置 (如果需要)

如果你的 Cloudflare 子域名不是 `fan-wan-uk`（例如变成了 `fanwan-ai.workers.dev`），你需要更新项目中的两个文件：

1.  **`lab/ai-zhida.html`**:
    找到 `webSearch` 配置部分：
    ```javascript
    webSearch: Object.assign({
      endpoint: 'https://websearch-proxy.<你的子域名>.workers.dev/search', // 修改这里
      // ...
    ```

2.  **`tools/ai_zhida/site-assistant.js`**:
    找到 `CONFIG` 对象：
    ```javascript
    const CONFIG = {
      // ...
      webSearchEndpoint: 'https://websearch-proxy.<你的子域名>.workers.dev/search', // 修改这里
      // ...
    };
    ```

## 6. 常见问题排查

**Q: 为什么前端还是显示 "Proxy Unreachable"?**
A:
1.  检查 Worker 是否部署成功（访问 `/health` 接口）。
2.  检查 `BRAVE_API_KEY` 是否设置正确（是否多复制了空格）。
3.  检查前端代码中的 `endpoint` 地址是否与你实际部署的 Worker 地址一致。

**Q: 搜索结果返回 "Origin not allowed"?**
A:
这是 CORS（跨域）安全限制。请检查 `tools/ai_zhida/wrangler.websearch.toml` 文件中的 `ALLOWED_ORIGINS` 设置，确保包含了你的网站域名：
```toml
ALLOWED_ORIGINS = "https://fanwan-ai.github.io,http://127.0.0.1:8080"
```
如果修改了配置，记得重新运行 `npx wrangler deploy ...`。
