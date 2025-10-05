# 站点改进与首页升级路线图 (2025-10-05)

本文档整理了前期会话中的问题分析、已完成修复，以及后续首页与品牌体验升级的执行计划，作为后续迭代的可操作手册。可直接按“执行步骤”章节逐项落地。

---

## 1. 背景概述

- 站点为多页面静态站点 (HTML + CSS + `script.js`)；多语言通过 `data-i18n` / `.i18n.l-xx` 结构与本地存储语言偏好实现。
- 已处理问题：
  1. Blog 列表卡片内：标题 / 日期 / 摘要 水平与垂直间距不一致 → 通过统一 `.post-card-content` 内边距 + 移除内联 margin 修复。
  2. 顶部导航“AI 工坊”子目录页面点击 404 → 将所有相关链接改为根路径 `/ai-lab.html` + 在 `script.js` 中加入导航链接归一化防御逻辑。
- 现阶段目标：聚焦首页品牌表达、首屏转化、价值主张清晰度与轻量动效。

---

## 2. 已完成 (Done)

| 模块 | 动作 | 成果 | 备注 |
|------|------|------|------|
| Blog 卡片排版 | 统一结构与间距 | 文本区对齐整齐 | 避免后续新增 inline style |
| 导航链接可靠性 | 全量改为 root-relative | 各子目录不再 404 | 防御函数双保险 |
| 诊断与规划 | 制定首页 Sprint 1~3 路线 | 行动分层可控 | 本文档固化 |

---

## 3. 待实施改进分层

### Sprint 1 (快速提升感知与转化)

1. Hero 主标语 (Slogan) + 副文本价值主张  
2. 主 CTA 区域 (按钮：立即体验 / GitHub / 订阅)  
3. 3~4 价值点 (Value Cards) 重组为语义化 `<section>`+ 图标/简要标题/一句解释  
4. 设计 Tokens（色彩/排版/间距）第一批引入，并替换首页直接用到的硬编码色值  
5. Portrait / 视觉主图比例 & 可选淡入动画（尊重 prefers-reduced-motion）  
6. 细节动效：CTA hover、Value Card 轻微阴影/位移、主题切换平滑过渡

### Sprint 2 (品牌与系统性优化)

1. 动态 Hero 背景 (CSS 粒子/渐变流动/低频噪声)  
2. OG / Meta 重审：标题格式统一 (Brand | Page Title)  
3. 响应式断点微调 (确保 320px 与 768px 优雅)  
4. 图片资源：`srcset` + `sizes` + WebP 兜底  
5. Critical CSS 内联 + 延迟加载非首屏脚本

### Sprint 3 (深度体验与扩展)

1. 站点级 Design Tokens 全量替换  
2. 可访问性 (A11y) 对比度审计 + 键盘焦点环样式化  
3. 统一 Icon 体系（Sprite 或组件化生成）  
4. Blog / Lab 列表虚拟化或渐进渲染（如未来规模扩大）  
5. Lighthouse ≥ 95 / 95 / 100 / 100 （Performance / Accessibility / Best Practices / SEO）

---

## 4. 设计 Tokens (初始集提案)

在 `:root` 中添加（建议放置到 `style.css` 顶部 30 行内，或创建 `tokens.css` 再在 `<head>` 顶部引入）：

```css
:root {
  /* Brand Core */
  --brand-primary: #2563eb; /* 蓝：主要强调 */
  --brand-primary-rgb: 37 99 235;
  --brand-accent: #6366f1;  /* 次级 / 渐变过渡 */
  --brand-accent-rgb: 99 102 241;
  --brand-bg: #0d1117;      /* 深背景 (若暗色首屏) */
  --brand-bg-alt: #111827;  

  /* Semantic */
  --color-text-strong: #111827;
  --color-text: #1f2937;
  --color-text-soft: #4b5563;
  --color-border: #e2e8f0;
  --color-border-strong: #cbd5e1;
  --color-surface: #ffffff;
  --color-surface-alt: #f8fafc;
  --color-surface-hover: #f1f5f9;

  /* States */
  --color-success: #16a34a;
  --color-warning: #d97706;
  --color-danger:  #dc2626;

  /* Typography */
  --font-sans: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --font-size-hero: clamp(2.2rem, 5vw, 3.4rem);
  --font-size-h2: clamp(1.4rem, 2.4vw, 2rem);
  --font-size-body: 1rem;

  /* Radius / Elevation / Motion */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 16px;
  --shadow-sm: 0 1px 2px rgba(0 0 0 / 0.06);
  --shadow-md: 0 4px 12px -2px rgba(0 0 0 / 0.12);
  --shadow-hover: 0 6px 18px -2px rgba(0 0 0 / 0.18);
  --motion-fast: 150ms ease;
  --motion-base: 240ms cubic-bezier(.4,.2,.2,1);
  --motion-bounce: 420ms cubic-bezier(.34,1.56,.64,1);

  /* Layout */
  --container-max: 1180px;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-12: 3rem;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-text-strong: #f1f5f9;
    --color-text: #e2e8f0;
    --color-text-soft: #94a3b8;
    --color-border: #1e293b;
    --color-border-strong: #334155;
    --color-surface: #0f172a;
    --color-surface-alt: #1e293b;
    --color-surface-hover: #243449;
  }
}
```

### Sprint 1 Token 替换范围建议

- 只替换首页首屏、价值卡片、CTA 区的背景/文字/按钮/阴影类颜色；其余页面延后。
- 避免一次性大规模重构导致回归风险。

---

## 5. 首页结构 (目标语义草图)

```html
<header class="site-hero">
  <div class="hero-inner">
    <p class="hero-eyebrow">AI Research & Engineering</p>
    <h1 class="hero-title">让智能信息流动得更安全、更可信、更高效</h1>
    <p class="hero-sub">聚焦 RAG · 多模态 · 模型监控 与 学术情报自动化，加速从论文到产品的路径。</p>
    <div class="hero-ctas">
      <a class="btn btn-primary" href="/ai-lab.html">进入实验室</a>
      <a class="btn btn-outline" href="/blog.html">浏览洞察</a>
      <a class="btn btn-ghost" href="/subscribe.html">订阅更新</a>
    </div>
  </div>
  <div class="hero-art" aria-hidden="true"><!-- 动态/静态图层 --></div>
</header>

<section class="value-grid" aria-labelledby="values-heading">
  <h2 id="values-heading" class="visually-hidden">核心价值</h2>
  <article class="value-card">
    <h3>可信 RAG</h3>
    <p>结构化检索 + 质量度量，降低幻觉风险。</p>
  </article>
  <article class="value-card">
    <h3>多模态监测</h3>
    <p>统一追踪文本 / 图像 / 表格 输出质量与漂移。</p>
  </article>
  <article class="value-card">
    <h3>轻量自动化</h3>
    <p>脚本化指标管线与数据摘要，加速迭代。</p>
  </article>
  <article class="value-card">
    <h3>开放透明</h3>
    <p>公开路线、方法论与实验记录，降低重复造轮子。</p>
  </article>
</section>
```

---

## 6. 样式与组件 (Sprint 1 重要片段示例)

```css
.site-hero {
  position: relative;
  padding: var(--space-12) var(--space-4) var(--space-8);
  max-width: var(--container-max);
  margin: 0 auto;
  display: grid;
  gap: var(--space-8);
}
.hero-title { font-size: var(--font-size-hero); line-height: 1.1; font-weight: 600; }
.hero-sub { max-width: 620px; font-size: 1.1rem; color: var(--color-text-soft); }
.hero-ctas { display: flex; flex-wrap: wrap; gap: var(--space-4); }
.btn { inline-size: auto; padding: 0.75rem 1.25rem; font-weight: 500; border-radius: var(--radius-md); text-decoration: none; position: relative; }
.btn-primary { background: linear-gradient(135deg,var(--brand-primary),var(--brand-accent)); color:#fff; box-shadow: var(--shadow-md); transition: transform var(--motion-base), box-shadow var(--motion-base); }
.btn-primary:hover { transform: translateY(-2px); box-shadow: var(--shadow-hover); }
.btn-outline { border:1px solid var(--color-border-strong); color: var(--color-text-strong); }
.btn-outline:hover { background: var(--color-surface-hover); }
.btn-ghost { color: var(--color-text-soft); }
.btn-ghost:hover { color: var(--color-text-strong); }

.value-grid { max-width: var(--container-max); margin: 0 auto var(--space-12); padding: 0 var(--space-4); display: grid; gap: var(--space-6); grid-template-columns: repeat(auto-fit,minmax(220px,1fr)); }
.value-card { background: var(--color-surface); border:1px solid var(--color-border); padding: var(--space-6) var(--space-4); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); transition: background var(--motion-base), transform var(--motion-fast), box-shadow var(--motion-fast); }
.value-card:hover { background: var(--color-surface-alt); transform: translateY(-3px); box-shadow: var(--shadow-md); }
@media (prefers-reduced-motion: reduce) { .btn-primary, .value-card { transition: none; } }
```

---

## 7. 执行步骤 (Sprint 1 具体操作手册)

| 顺序 | 步骤 | 文件 | 动作要点 | 验证 |
|------|------|------|----------|------|
| 1 | 备份现有首页 | `index.html` | 复制为临时文件 `index.backup.html` | 正常打开原首页 |
| 2 | 引入 tokens | `style.css` | 添加 `:root` 变量；不移除旧色值 | 页面不报错，样式不乱 |
| 3 | 插入 Hero 结构 | `index.html` | 放在 `<main>` 现有首屏上方 / 替换旧首屏 | 语义结构正确 |
| 4 | 添加 CTA 按钮样式 | `style.css` | 按示例追加，不覆盖已有类冲突 | 按钮展示正常 |
| 5 | 增加 Value Cards 区 | `index.html` | 语义化 `<section>` + `<article>` | 格栅响应式良好 |
| 6 | Portrait/艺术图层 | `index.html` | `<div class="hero-art">` 内可先放静态 SVG | 不遮挡文本 |
| 7 | prefers-reduced-motion | `style.css` | 添加 motion 降级片段 | 系统设为减少动画后无抖动 |
| 8 | 颜色替换 (局部) | `index.html`+`style.css` | 首页旧硬编码 -> tokens | 无明显色彩对比下降 |
| 9 | 多语言兼容 | `index.html` | 为新文本加 `.i18n` 结构 (可后补翻译) | 切换语言不报错 |
|10 | 可访问性审查 | 所有 | 确保按钮有可见焦点，标题层级不跳级 | Keyboard Tab 可聚焦 |
|11 | 性能初筛 | DevTools | Lighthouse 运行 (Performance ≥ 85 立即记分) | 记录数值供 Sprint 2 |

---

## 8. 多语言占位策略

新加文案先写中文为主：

```html
<h1 class="hero-title"><span class="i18n l-zh">让智能信息流动得更安全、更可信、更高效</span><span class="i18n l-en" hidden>Make intelligent information flow safer, more trustworthy, and more efficient</span></h1>
```

等后续再批量翻译填充英文 / 西班牙语；未翻译语言可临时复用英文。

---

## 9. 验证清单 (Checklist)

- [ ] Hero 标题在 375px / 768px / 1280px 均未换行失控
- [ ] CTA 按钮 Hover 与 Focus 样式各不相同且清晰
- [ ] Value Cards 最低 220px 宽自动换行无重叠
- [ ] 主题切换 (若有) 不影响新区域视觉一致性
- [ ] 语言切换后新文本不会残留隐藏错位
- [ ] Lighthouse Performance ≥ 85 / A11y ≥ 95 / SEO ≥ 95
- [ ] 无多余未使用的 token (Sprint 1 范围内)

---

## 10. 风险与回滚

| 风险 | 影响 | 缓解 | 回滚方法 |
|------|------|------|----------|
| Tokens 与旧样式冲突 | 样式层叠异常 | 分阶段替换 & 类选择器权重控制 | 用备份 `index.backup.html` 与 Git diff 比对恢复 |
| Hero 动效影响性能 | 首屏渲染延迟 | 使用纯 CSS/轻量 Canvas，不阻塞主线程 | 移除 `.hero-art` 动效相关样式 |
| 多语言未补齐 | 语言切换露英文/空白 | 设置默认语言 fallback | 临时只保留中文 span |

---

## 11. 后续迭代提示

- 若计划引入构建工具（Vite / Astro / Next），请在 tokens 与结构稳定后再迁移，避免双重变更。
- 设计稿如需固化：可在 `docs/` 新增 `homepage-wireframe.png` 与 `homepage-hero-motion.webm` 说明。
- 监控回归：考虑添加一个轻量的 `scripts/smoke_test_homepage.mjs` 访问首页并断言关键节点存在。

---

## 12. 可选脚本 (占位示例) – 自动扫描 root-relative 链接

```bash
# （如日后使用 Node 环境，可在 PowerShell 中运行）
node - <<'EOF'
import { readdirSync, readFileSync } from 'fs';
const files = readdirSync('.', { withFileTypes: true })
  .filter(f=>f.isFile() && f.name.endsWith('.html'))
  .map(f=>f.name);
let bad = [];
for (const f of files) {
  const txt = readFileSync(f,'utf8');
  if (/href="(?:\.\.|ai-lab\.html)"/.test(txt)) bad.push(f);
}
console.log('导航潜在问题文件:', bad);
EOF
```

(当前不必提交脚本，列这里做未来参考)

---

## 13. 总结

Sprint 1 目标聚焦“表达清晰 + 转化路径 + 风险可控”。请优先完成 Tokens 引入与 Hero/Value/CTA 结构落地，再逐步推进动画与性能。完成后再运行 Lighthouse 记录基线，为 Sprint 2 性能与品牌深化提供量化参照。

如需我直接开始应用这些变更，请在会话中告知：例如 “开始执行 Sprint 1” 或 指定具体子任务（如 “先加 tokens”）。

---

最后更新：2025-10-05
