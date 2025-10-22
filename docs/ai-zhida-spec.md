# “AI 智答”产品与技术方案（设计说明）

> 范围：为 ai-lab 页新增入口（图标+按钮），并新建“AI 智答”页面（导航与全站一致），提供：
> 1) 与 LLM（DeepSeek Chat）对话；2) 本地文档上传后进行轻量 RAG 文档问答。本文仅设计与实施计划，不改动代码。

---

## 1. 背景与目标

- 目标用户：研究/产品/教育等通用用户，快速提问与基于个人文档的问答。
- 目标能力：
  - 与 DeepSeek Chat 对话（支持流式输出、重置、停止、导出对话）。
  - 本地上传常见文档（PDF/Word/Excel/TXT），进行“检索增强问答”（RAG）：在浏览器内解析与检索，不上传原始文件到服务器，仅将被命中的少量片段随提问一并送入 DeepSeek 作为上下文。
  - 与现有站点风格、导航、i18n、CSP 与性能策略保持一致。
- 非目标（初版不做）：向量数据库持久化、团队协作空间、账号系统、长期云端文档存储。

成功标准（V1）：
- 可在桌面与移动端稳定使用；10MB 内的 PDF/Docx/XLSX/TXT 至少可解析并回答基础问题；DeepSeek 代理稳定转发，错误提示清晰；全站导航/主题/i18n/可达性达标。

---

## 2. 用户旅程（关键场景）

1) 从 AI 工坊页 Hero 点击“AI 智答”按钮进入新页 → 看到“AI 智答”Hero 与对话界面 → 输入问题 → 模型流式回复。
2) 点击“上传文档”或拖拽文件 → 浏览器解析、建立临时索引 → 切换到“文档问答”模式 → 提问 → 回复中附带引用/标注命中片段来源。
3) 错误场景：网络不通、超额/限流、文件过大/加密 PDF、解析失败、上下文过长 → 前端分级提示与降级策略。

---

## 3. 功能设计

### 3.1 核心模块
- 聊天区：
  - 消息气泡（用户/助手），支持 Markdown、代码高亮、复制、重新生成、停止。
  - 流式显示（SSE 或分块），显示 token/用时等轻提示（可选）。
  - 上下文控制：系统提示（可编辑，默认“简洁、引用原文、中文优先”等），温度/最大输出（基础滑杆）。
  - 会话管理：清空当前会话；本地持久化最近 N 条（localStorage/IndexedDB），导出为 .json/.md。
- 文档区：
  - 上传：支持拖拽/点击选择；显示文件列表、大小、页数/工作表数、解析进度与失败原因。
  - 解析：浏览器内将 PDF/Docx/XLSX/TXT 提取为纯文本，按固定策略切片（如 800-1200 字/重叠 100-200），构建临时索引。
  - 检索：仅在浏览器内用 TF-IDF/BM25/Lite 关键词匹配（如 minisearch/lunr），Top-K 片段拼接为“资料上下文”。
  - 模式切换：
    - 普通对话（不携带资料上下文）。
    - 文档问答（自动携带检索到的片段）。
  - 引用：回答底部展示引用来源（文件名/页码/位置），可展开查看命中片段。
- 辅助功能：
  - 多语言 UI（沿用 data-i18n）；暗色模式；无障碍（可聚焦、aria-live 流式、键盘操作）。
  - 隐私提示：明确“默认仅在本地解析；仅选中命中的少量文本随问题发送到 LLM”。提供“严格本地模式（不调用 LLM，仅本地检索与高亮）”开关（可选）。

### 3.2 文件支持与限制（V1）
- 支持类型：
  - PDF：文本型优先；图片扫描 PDF 不做 OCR（V1 可提示“无法提取文本”）。
  - Word：.docx（用浏览器库提取段落文本）；.doc 暂不支持（提示转换）。
  - Excel：.xlsx（按工作表读取为 CSV 文本合并）；.xls 暂不支持。
  - TXT/Markdown：直接读取。
- 单文件上限建议：10MB；单次会话最多 5-10 个文件；超限给出提示与建议分拆。
- 安全/隐私：不上传原文件；仅当选择“文档问答”时，将 Top-K 片段（合计不超过设定 token 上限）拼接进 LLM 提示词。

### 3.3 错误与边界
- 网络/API：超时、4xx/5xx、限流、密钥失效 → 顶部 toast + 重试；保留未发送内容。
- 文档：加密/损坏/体积超限/解析失败 → 文件列表内就地标红与说明。
- 上下文溢出：估算 token（启发式按字符数近似），超限时自动降 K/缩短片段并提示。
- 移动端：输入法遮挡、文件选择器兼容、长回复滚动性能。

---

## 4. UI/交互设计

### 4.1 AI 工坊页入口（不在本次提交中实现，仅说明）
- 在 `ai-lab.html` 的 Page Hero CTA 区新增：
  - 左侧图标（建议使用一致的 SVG 线框风格，如 bulb/brain/bolt 组合），按钮文案“AI 智答”。
  - 多语言：
    - zh：AI 智答
    - en：AI Q&A
    - es：AI Respuestas
  - 样式：与现有 `.btn primary` 或 `.btn outline` 统一；加入 data-i18n 键：`ai_lab_cta_ai_qa`。

### 4.2 新页面信息架构
- 路由：`/lab/ai-zhida.html`
- Head 元信息：对齐其他 lab 页面（主题色、CSP、OG/Twitter）。
- 导航：完全复用全站 Navbar、语言切换、主题切换与汉堡菜单。
- Hero：
  - 标题：AI 智答（`data-i18n="ai_qa_title"`）
  - 副标题：本地解析，私密问答，连接 DeepSeek（`data-i18n="ai_qa_intro"`）
- 主体布局：
  - 桌面：左右布局（栅格 7:5 或 2:1）
    - 左侧：对话流 + 输入区（固定在底部，随键盘/移动适配）。
    - 右侧：文档与设置面板（上传、文件列表、RAG 模式切换、参数、隐私说明、清空）。
  - 移动：上下堆叠；面板折叠为抽屉；输入区悬浮置底。
- 视觉样式：沿用 `style.css` 变量与阴影、圆角体系；状态色统一（成功/警告/错误）。
- 可达性：
  - 输入框 `aria-label="提问"`；发送按钮 `aria-label="发送"`；
  - 流式输出容器 `role="log" aria-live="polite"`；
  - 上传控件支持键盘与屏幕阅读器说明；
  - 颜色对比满足 WCAG AA。

### 4.3 关键 UI 组件
- 消息气泡：头像/角色标记/时间；Markdown 渲染（代码块复制按钮）。
- 输入栏：多行/自适应；快捷指令菜单（例如“为我总结”“列出要点”）。
- 上传区：显著的拖拽区域；支持点击选择；文件卡片显示解析状态；失败项支持“移除/重试”。
- 引用区：在助手回复底部展示“引用 3 处”，点击展开显示片段与来源（文件名+页/行）。
- 顶部状态条：网络状态/模型名称/代理可用性（小圆点）。

---

## 5. 技术架构与实现

### 5.1 前端（静态页 + 原生 JS）
- 语言与框架：延续站点约定，纯原生 JS + `style.css`，少量 vendor 库（仅前端可用、无打包器）。
- 模块划分（建议新建 `assets/js/zhida.js`）：
  - ChatState：管理消息数组、当前流式请求、重试/停止、持久化。
  - FileStore：管理已上传文件的原始 `File`、解析状态与纯文本缓存。
  - TextExtractor：针对 PDF/Docx/XLSX/TXT 的提取器（基于浏览器库/轻量实现）。
  - Chunker：文本切片器（大小、重叠、清洗）。
  - Retriever：词法检索（minisearch/lunr 或简单 TF-IDF）；返回 Top-K 片段及位置信息。
  - PromptBuilder：构造系统提示与上下文拼接（限制总字数/近似 token）。
  - DeepSeekClient：与代理端通信（JSON/SSE），支持取消（AbortController）。
  - UI 渲染：列表虚拟化（必要时）、Markdown 渲染（可用 marked/lowlight），代码高亮（highlight.js 可选）。
- 存储：
  - localStorage 保存轻量历史记录与设置（语言、温度、模式）；
  - IndexedDB（可选）缓存解析后文档文本与索引，避免刷新后重复解析。

### 5.2 文档解析策略（浏览器内）
- PDF：优先使用 `pdfjs-dist` 仅文本层；不加载整页位图。若 PDF 加密/扫描 → 明确提示不支持 OCR。
- Docx：`mammoth.browser.min.js` 提取段落文本，移除样式。
- XLSX：`xlsx.full.min.js` 将每个工作表转 CSV 文本，合并入全文（保留表名/行列号作为位置信息）。
- TXT/MD：FileReader 直接读取（注意编码与 BOM）。
- 切片：
  - 归一化空白与段落；每片 800-1200 字，重叠 100-200，保留来源（文件、页/表、偏移）。
  - 建立索引：minisearch/lunr 或简易 TF-IDF；查询时按关键词得分排序，去重相似片段（MMR 简化版）。
- 上下文构造：
  - 限制总上下文近似 token（例如 1500-2500 tokens 等价字符）；
  - 片段前加来源标注，回答后统一列出引用。

### 5.3 DeepSeek API 集成（强制通过代理）
> 注意：GitHub Pages 为纯静态，不能安全地在前端保存 API Key。必须走“受控代理/边缘函数（Worker/Function）”。

- 推荐方案 A：Cloudflare Workers 代理
  - 环境变量：`DEEPSEEK_API_KEY`、可选 `DEEPSEEK_BASE`、来源白名单域名。
  - 路由：`POST /api/llm/chat` 接收与 OpenAI Chat Completions 接近的结构：
    - 请求：`{ model: 'deepseek-chat', messages: [{role,content}], stream: true|false, temperature?, max_tokens? }`
    - 响应：
      - 非流式：JSON 透传 DeepSeek 响应（删去敏感 header）。
      - 流式：SSE 转发 `data: ...\n\n` 片段，兼容前端解析。
  - 保护：CORS 仅允许本站域名；限制每 IP 速率；校验请求体长度；最大 `messages` 条数与 `content` 字符数；屏蔽敏感 header；可加简单“匿名会话令牌”。
  - 错误码：429 限流、400 体积超限、502 上游失败、401 密钥失效。
- 备选方案 B：Vercel Functions/Netlify Functions（同上形态）。
- 本地开发：提供 Node 代理脚本（仅开发使用），通过 `.env` 注入 key。

“接口小约定（前端 <-> 代理）”：
- 输入：`messages`（数组，最后一条为用户输入；若文档问答则自动在系统/assistant 前拼接“资料上下文”）；`config`（温度、max_tokens）。
- 输出：
  - 流式：SSE；每条包含 `delta` 与 `finish_reason`；结束发送 `[DONE]`。
  - 非流式：与 DeepSeek Chat Completions 对齐的 JSON。
- 错误：`{ error: { code, message } }`；前端据此提示。

### 5.4 安全与合规
- API Key 不下发到前端；仅代理端持有。
- 文档默认不上传；仅命中的少量片段会随问题进入 LLM（UI 提示并可关闭）。
- CSP：在新页面 `<meta http-equiv="Content-Security-Policy">` 的 `connect-src` 中加入代理域名；保持 `object-src 'none'` 与 `base-uri 'self'`；SSE 也走同域/白名单域。
- XSS/注入：对 Markdown 渲染进行允许列表/转义；文件解析仅处理文本，移除可执行内容（宏/脚本）。
- 限流与防滥用：代理侧按 IP/来源/会话做速率与体积上限；可增加简单验证码（后续）。

---

## 6. 实施步骤（建议里程碑）

- 里程碑 M1（页面骨架与直连聊天）
  1) AI 工坊页新增“AI 智答”按钮（含 i18n）；
  2) 新建 `/lab/ai-zhida.html` 骨架（Hero/主体两栏、空聊天）；
  3) 完成 Cloudflare Worker 代理与本地可用性测试；
  4) 基础聊天（纯文本，流式/停止/重置）。

- 里程碑 M2（文档解析与轻量检索）
  1) 集成 PDF/Docx/XLSX/TXT 提取库；
  2) Chunk + minisearch/lunr 检索；
  3) “文档问答”模式（注入 Top-K 片段）；
  4) 引用列表与高亮。

- 里程碑 M3（体验完善）
  1) Markdown/代码高亮/复制；
  2) 本地历史记录与导出；
  3) i18n 文案与 A11y 校对；移动端优化；
  4) CSP 补充与错误边界完善。

- 里程碑 M4（上线与监控）
  1) 代理限流与日志；
  2) 文档大小/类型限制与提示；
  3) README/使用说明与免责声明；
  4) 验收清单过一遍，发布。

---

## 7. 页面与文件清单（拟新增）

- `lab/ai-zhida.html`：新页面（Hero、聊天区、侧栏）。
- `assets/js/zhida.js`：前端逻辑（聊天、上传、检索、SSE）。
- `assets/css/zhida.css`（可选）：如需独立样式补充。
- `assets/vendor/`：
  - `pdfjs/`（精简构建，仅取文本）
  - `mammoth.browser.min.js`
  - `xlsx.full.min.js`
  - `marked.min.js` 与 `highlight.min.js`（如需要）
- `edge/worker.js`（或 `api/llm/chat.js`）：代理实现（不在 GitHub Pages 内托管，部署到 Cloudflare/Vercel）。

i18n 键（部分示例）：
- `ai_lab_cta_ai_qa`：按钮“AI 智答/AI Q&A/AI Respuestas”
- `ai_qa_title`：AI 智答
- `ai_qa_intro`：本地解析，私密问答，连接 DeepSeek
- `ai_qa_mode_chat`：普通对话
- `ai_qa_mode_rag`：文档问答
- `ai_qa_upload`：上传文档
- `ai_qa_privacy_note`：隐私提示文案
- `ai_qa_clear`：清空会话
- `ai_qa_stop`：停止
- `ai_qa_regen`：重新生成
- `ai_qa_citations`：引用

---

## 8. 质量保障（测试与验收）

- 功能测试用例（摘选）：
  - 发送短问题并收到流式回复；停止后可重试；
  - 上传 1 个 PDF（文本型）→ 解析成功 → 文档问答命中引用；
  - 上传加密/图片 PDF → 明确失败提示；
  - 上传 docx/xlsx/txt → 解析成功并可检索；
  - 大文本提问触发上下文裁剪提示；
  - 网络断开/代理 429/500 → 可重试，错误提示不遮挡输入；
  - 移动端软键盘与滚动不冲突；深浅色主题可用。
- 边界与回归：
  - 多文件并行解析与进度；
  - 清空会话清除本地历史与临时索引；
  - i18n 切换（语言与文案）即时生效；
  - CSP 校验：仅允许本站与代理域 `connect-src`。
- 验收标准：
  - Lighthouse PWA/性能/A11y 均不低于现有页面；
  - 错误率可控（代理 5xx < 1%）；
  - 文档问答引用可复核（点击可展开查看原片段）。

---

## 9. 运维与配置

- 代理部署：
  - Cloudflare：`wrangler.toml` 配置路由与 KV/R2（如需临时记忆）；`DEEPSEEK_API_KEY` 写入环境；开启日志。
  - Vercel：项目环境变量、地域、内存与超时参数；保护路径仅允许本站域名来源。
- 站点配置：
  - 新页的 CSP `connect-src` 添加代理域名；
  - 根据需要将 `lang.js` 中新增 i18n 键值补充；
  - `script.js` 的可见动画/导航行为可复用；
  - RSS/Sitemap 无需变更（普通功能页）。

---

## 10. 未来增强（路线图）

- 嵌入式向量检索：
  - 方案 1：浏览器端轻量向量模型（WebAssembly/WebGPU），隐私最优，设备要求高；
  - 方案 2：边缘向量服务（Supabase pgvector/Pinecone），效果更稳，涉及存储合规与鉴权。
- 文档可视化与定位：PDF 页面高亮与定位、表格智能抽取与结构化问答。
- 语音：ASR 输入与 TTS 朗读（多语言）。
- 模型多样化：按环境变量启用 OpenAI/DeepSeek/阿里 DashScope 等回退；在 UI 中可选。
- 分享：生成可共享的只读会话链接（需服务端临时存储与签名）。

---

## 11. 附录：代理最小实现（思路）

以 Cloudflare Workers 为例（伪代码要点）：

- 接收 `POST /api/llm/chat`：
  - 校验 `Origin` 是否在白名单；校验体积；
  - 将请求转换为 DeepSeek Chat Completions；URL：`https://api.deepseek.com/v1/chat/completions`；
  - 携带 `Authorization: Bearer <env.DEEPSEEK_API_KEY>`；
  - 若 `stream=true`：将上游流以 SSE 方式逐段转发；
  - 设置 CORS 响应头：`Access-Control-Allow-Origin: https://fanwan-ai.github.io`（或自域名）；`Vary: Origin`；
  - 限流（Durable Object/内存计数 + IP 哈希）。

- 错误映射：Upstream 429→传递；其他 5xx 归一为 502 并附统一 message；前端据此展示。

注：以上实现与现仓库保持解耦，不在 Pages 内直接提交，部署到边缘平台即可。

---

本设计确保：
- 与现有站点的导航、主题、i18n、CSP 风格一致；
- 前端仅做本地解析与轻检索，尽量减少隐私风险；
- 通过代理安全调用 DeepSeek，实现可迭代的聊天与文档问答体验。
