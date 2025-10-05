# 首页升级路线图 (Homepage Upgrade Roadmap)

> 目标：在不引入复杂框架的前提下，系统性提升首页的品牌表达、视觉层次、结构清晰度、转化效率与性能可持续性。以 2~3 个迭代（Sprint）完成从“信息罗列”到“价值清晰 + 可信背书 + 可互动” 的升级。

---

## 0. 当前首页（现状速描）

| 维度 | 现状 | 问题 | 机会 |
|------|------|------|------|
| 品牌定位 | Logo + 名字 + 若干导航 | 没有一句“我是谁/我提供什么价值” | 增加一句精准 Slogan（≤14 中文字 / ≤60 英文字符）|
| 首屏焦点 | 单列信息 + 头像 | 缺乏视觉抓手与节奏 | 引入主视觉（轻动画 / 渐变玻璃 / 科技纹理）|
| 信息结构 | 模块平铺 | 优先级不明显 | 归类成：价值 → 能力 → 项目 → 文章 → 行动 |
| 行动引导 | 缺少明确 CTA | 用户“不知道下一步” | 设计单主 CTA + 次动作（订阅 / 联系）|
| 信任背书 | 论文 / 项目分散 | 无“快速扫一眼”可信区 | 加入徽标/数据徽章（# Papers, # Models 等）|
| 视觉系统 | 若干散色值 | 缺少设计 Token | 建立 --color-* 变量，保证可扩展性 |
| 动画/动效 | 几乎无 | 视觉静态，停留弱 | “可关闭的轻动效” 提升质感（w/ prefers-reduced-motion）|
| 性能 | 基本可用 | 潜在可优化 | 关键 CSS 内联 / 图片自适应 / 延迟非关键 JS |

---

## 1. 设计与实施原则

1. 渐进增强：无 JS 仍能完整呈现核心价值。  
2. 低耦合增量：新增样式集中在 `index.html` + 扩展 `style.css` 的独立段落，避免破坏已有页面。  
3. Token 驱动：所有新增颜色 / 阴影 / 圆角 / 间距先抽象为 CSS 变量。  
4. 可维护：类名遵循 `hp-` 前缀，快速区分“Homepage 专属”。  
5. 性能守护：首屏阻塞 < 50KB（压缩后）；动画在 60fps 上限内，禁用时零额外 Reflow。  
6. 可访问：对比度 ≥ 4.5:1；语义标签（`<section> <h2>`）；动画尊重 `prefers-reduced-motion`。  

---

## 2. 目标拆解 (What Success Looks Like)

| 目标 | 可度量指标 | 验收标准 |
|------|------------|----------|
| 价值清晰 | 3 秒内读懂“你在做什么” | 首屏主标题 + 副标题可独立理解，无滚动 |
| 品牌感 | 统一色 / 字重 / 动效节奏 | 主色使用率 ≥ 70%（非图片区域）|
| 信任建立 | 背书区信息密度高但不压迫 | 数据徽章扫描 ≤ 2 秒 |
| 行动引导 | CTA 点击 / 订阅转化提升 | 相比当前基线 +30%（后续埋点）|
| 性能 | 首屏 LCP < 2.2s（桌面） | Lighthouse ≥ 90 (Performance) |
| 可维护 | 新增 Token < 25 个 | CSS 行数增长 < 12% |

---

## 3. 迭代计划 (Sprints)

### Sprint 1（快速赢面，1–2 天）

重点：让“第一屏 + 结构骨架” 成型。

- 新增：Hero 区域骨架（标题 / 副标题 / 主 CTA / 次 CTA / 轻徽章条）。
- 新增：Slogan（例："打造知识检索与模型理解的智能研究助理" / 英文版对应）。
- 新增：Value Cards（3~4 个）：检索增强 / 模型监测 / 论文推送 / 多语言拓展。  
- 新增：CTA 组件（订阅 / 联系 / GitHub / 关注）。
- 抽象：`design tokens`（颜色、阴影、渐变、圆角、间距 8pt 系列）。
- 动效：按钮 hover 过渡 + Hero 背景轻微粒子/渐变（静态 Fallback）。
- 性能：关键首屏样式内联（≤5KB），延迟加载非首屏脚本（`defer`）。

### Sprint 2（质感与信任，2–3 天）

- Hero 背景升级：自定义 Canvas 微粒 / SVG 流动光带（禁用机制）。
- Portrait/Avatar 区域：添加柔光边框 / 环形进度条（代表研究里程）。
- 信任背书区：突出 论文数量 / 引用次数 （可人工维护 JSON 或自动脚本注入）。
- Recent Activity Strip：最近 3 篇 Blog + 1 项目更新 + 1 Paper。  
- 主题联动：暗色模式渐变与亮色模式差异化（分别一套 tokens）。

### Sprint 3（交互与数据可持续，3+ 天）

- 动态数据：从 JSON 构建“研究雷达 / 模型监控”简化概览卡。  
- A/B 文案试验（Hero 副标题或 CTA 文案）。
- 埋点：点击 / Scroll Depth / CTA 转化（使用轻量脚本或现有统计）。
- SEO 强化：结构化数据（`WebSite`, `Person`, `SoftwareApplication`），首屏主标题 H1 唯一。
- 代码清理：把首页专有 JS 拆分为 `home.js` 并按需加载。

---

## 4. 设计 Tokens（初稿）

```css
:root {
  /* Palette */
  --color-brand: #4b7bff;
  --color-brand-accent: #8aa9ff;
  --color-brand-rgb: 75 123 255;
  --color-bg-hero: radial-gradient(circle at 30% 40%, rgba(var(--color-brand-rgb)/0.18), transparent 60%),
                    linear-gradient(120deg,#0d1117,#141b29 60%,#0d1117);
  --color-surface: #1e2633;
  --color-surface-alt: #253042;
  --color-border: #2f3b4b;
  --color-text-strong: #f4f7fa;
  --color-text: #d6dde5;
  --color-text-muted: #9aa8b9;
  --color-accent-green: #3cc68a;
  --color-accent-orange: #ff9d4d;
  --color-danger: #ff4d61;
  /* Typography */
  --font-size-hero: clamp(2.4rem, 5vw, 3.4rem);
  --font-size-sub: clamp(1.05rem, 1.6vw, 1.35rem);
  --font-weight-hero: 650;
  --line-height-tight: 1.15;
  /* Spacing (8pt scale) */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px; --space-12: 48px; --space-16: 64px;
  /* Radius / Shadows */
  --radius-sm: 6px; --radius-md: 12px; --radius-lg: 20px; --radius-pill: 999px;
  --shadow-sm: 0 2px 4px -2px rgba(0 0 0 / 0.4), 0 4px 8px -2px rgba(0 0 0 / 0.25);
  --shadow-glow: 0 0 0 1px rgba(var(--color-brand-rgb)/0.4), 0 0 18px -2px rgba(var(--color-brand-rgb)/0.55);
  /* Motion */
  --ease-out: cubic-bezier(.16,.8,.24,1);
  --ease-in: cubic-bezier(.5,.05,.8,.15);
  --dur-rapid: .18s; --dur-fast: .28s; --dur-base: .4s; --dur-slow: .7s;
}
@media (prefers-color-scheme: light) {
  :root { --color-surface: #f5f7fa; --color-text: #2a3542; --color-text-muted:#5c6b7c; --color-bg-hero: linear-gradient(120deg,#eef3ff,#ffffff 55%,#eef3ff); }
}
```

---

## 5. 组件蓝图 (Homepage Components)

| 组件 | 结构 | 说明 | 关键类 |
|------|------|------|--------|
| Hero | 标题 / 副标题 / CTA / 次 CTA / 背景层 | 核心价值表达 | `hp-hero`, `hp-hero-bg` |
| Value Cards | 图标 / 标题 / 描述 / 次链接 | 3~4 个并列 | `hp-values`, `hp-value-card` |
| Metrics Strip | Papers / Blog / Models / Subs | 小尺寸徽章 | `hp-metrics` |
| Projects Spotlight | 2~3 重点项目卡 | 手动挑选 | `hp-projects` |
| Recent Activity | 最新动态混合流 | 数据聚合 | `hp-activity` |
| CTA Section | 深色对比区 + 强动词 | 转化驱动 | `hp-cta` |
| Footer Enhancement | 订阅输入 / 版权 / 社交 | 精炼 + 功能 | `hp-footer` |

---

## 6. Hero 初稿（示例片段）

```html
<section class="hp-hero">
  <div class="hp-hero-bg" aria-hidden="true"></div>
  <div class="hp-hero-inner">
    <h1 class="hp-hero-title">智能知识检索与模型洞察工作台</h1>
    <p class="hp-hero-sub">统一论文理解、模型监测、语义增强检索与多语言发布，让研究与应用迭代更高效。</p>
    <div class="hp-hero-actions">
      <a class="hp-btn hp-btn-primary" href="/ai-lab.html">进入 AI 工坊</a>
      <a class="hp-btn hp-btn-secondary" href="/subscribe.html">订阅更新</a>
    </div>
    <ul class="hp-metrics" aria-label="关键数据">
      <li><strong>24+</strong><span>Papers</span></li>
      <li><strong>12</strong><span>Models Watch</span></li>
      <li><strong>68</strong><span>Blog Posts</span></li>
    </ul>
  </div>
</section>
```

---

## 7. 增量 CSS 针对首页（示例）

```css
.hp-hero { position: relative; padding: var(--space-16) var(--space-8) var(--space-12); overflow: hidden; }
.hp-hero-inner { max-width: 1080px; margin: 0 auto; }
.hp-hero-title { font-size: var(--font-size-hero); font-weight: var(--font-weight-hero); line-height: var(--line-height-tight); letter-spacing: .5px; background: linear-gradient(90deg,#fff,rgba(var(--color-brand-rgb)/0.85)); -webkit-background-clip: text; color: transparent; }
.hp-hero-sub { max-width: 720px; font-size: var(--font-size-sub); color: var(--color-text); margin: var(--space-4) 0 var(--space-6); }
.hp-hero-actions { display: flex; gap: var(--space-3); }
.hp-btn { display:inline-flex; align-items:center; gap:6px; padding: 10px 18px; font-weight:560; border-radius: var(--radius-pill); text-decoration:none; position:relative; transition: background var(--dur-fast) var(--ease-out), transform var(--dur-rapid) var(--ease-out); }
.hp-btn-primary { background: linear-gradient(135deg,var(--color-brand),var(--color-brand-accent)); color:#fff; box-shadow: var(--shadow-glow); }
.hp-btn-primary:hover { transform: translateY(-2px); }
.hp-btn-secondary { background: var(--color-surface-alt); color: var(--color-text); border:1px solid var(--color-border); }
.hp-btn-secondary:hover { background: rgba(var(--color-brand-rgb)/0.12); }
.hp-metrics { list-style:none; display:flex; gap: var(--space-6); padding:0; margin: var(--space-8) 0 0; font-size:.85rem; color: var(--color-text-muted); }
.hp-metrics li { display:flex; flex-direction:column; gap:2px; }
.hp-metrics strong { font-size:1.15rem; font-weight:600; color: var(--color-text-strong); }
.hp-hero-bg { position:absolute; inset:0; background: var(--color-bg-hero); opacity:.95; }
@media (max-width: 760px) { .hp-hero { padding: var(--space-12) var(--space-4) var(--space-10); } .hp-metrics { flex-wrap:wrap; gap: var(--space-4); } }
@media (prefers-reduced-motion: reduce) { .hp-btn, .hp-hero-title { transition: none; } }
```

---

## 8. 性能与可访问性清单

- [ ] 关键首屏 CSS 内联（仅 Hero / Buttons / Metrics）。
- [ ] 其余样式保持在现有 `style.css`，用注释分隔：`/* Homepage Additions */`。  
- [ ] 推迟加载：非首页专用脚本不在 index.html 中同步引入。  
- [ ] 图片：若新增插图 → 使用 `width`/`height` + `loading="lazy"` + 合理 `alt`。  
- [ ] 对比度手动检查（深色与亮色模式各一次）。
- [ ] 动画：提供 `prefers-reduced-motion` 降级。  
- [ ] `<h1>` 只出现一次，其他区块 `<h2>` 序列化。  

---

## 9. 数据与埋点（Sprint 3 准备）

埋点字段建议（可后续加）：

- `hp_hero_primary_cta_click`
- `hp_subscribe_cta_click`
- `hp_metrics_view`（首屏曝光）
- `hp_scroll_depth_50` / `hp_scroll_depth_90`
- `hp_value_card_hover_{id}`

简单实现：在现有 `script.js` 追加一个 `logEvent(name, extra)`，本地先 `console.info`，准备接入后端或第三方。

---

## 10. 风险与应对

| 风险 | 影响 | 缓解 |
|------|------|------|
| Token 引入导致老页面颜色偏差 | 视觉不一致 | 首页新增变量，不强制回填旧区块，逐步迁移 |
| 动画性能拖慢首屏 | FCP/LCP 下降 | 初期仅 CSS 渐变 + 轻量 Canvas，监控 FPS |
| 指标数据需人工维护 | 过期失真 | 脚本化：每日构建时统计 JSON 注入 |
| 移动端排版溢出 | 阅读体验差 | 断点调试 ≤360px 宽度；采用 `clamp()` 字号 |
| 文案定位不精准 | 转化欠佳 | A/B 预留可替换区块；收集 2 版候选语句 |

---

## 11. 执行顺序（详细 Checklist）

### Sprint 1

1. 添加 Tokens（根变量）到 `style.css` 顶部或靠前区域。  
2. 为首页追加 `/* Homepage Additions */` 分组 CSS。  
3. 插入 Hero HTML（放在现有内容最上面；原首屏内容下移或合并）。  
4. 添加 Value Cards 容器（占位文案即可）。  
5. 添加 CTA Section（底部或中部实验）。  
6. 内联首屏关键 CSS（初稿 < 5KB）于 `index.html` `<head>`（可标注构建后再外提）。  
7. 快速浏览器测试：Chrome / Safari / 移动模拟。  
8. 校验对比度 + 动效降级。  
9. 提交：`feat(homepage): add hero + tokens + value cards skeleton`。  

### Sprint 2

1. 加入 Metrics Strip / 徽章数字（硬编码占位）。  
2. 实现 Hero 背景轻动效（Canvas / CSS 动画 任选其一）。  
3. 增强头像区域（可选：渐变边框 + 光晕）。  
4. 引入 Projects Spotlight（挑选 2~3 项目）。  
5. 增加 Recent Activity（读取现有 blog 索引脚本产物）。  
6. 可选：暗色与亮色差异化渐变。  

### Sprint 3

1. 轻量埋点方法与事件字典。  
2. Badge 数字脚本化。  
3. A/B 测试文案数据结构。  
4. 结构化数据（JSON-LD）注入。  
5. 代码分离：`home.js`（只在首页加载）。  
6. 性能复测 + 调优（覆盖缓存 / 无缓存场景）。  

---

## 12. 后续可选增强 (Nice to Have)

- 多语言首屏自动匹配：根据现有语言切换机制加载 Slogan 变体。  
- 动态 AI 摘要条：实时抓取最新 Paper 或 Blog 标题做轮播。  
- 夜间模式时间段自动切换（可选）。  
- WebGL 低多边形动态背景（替代粒子）。  

---

## 13. 集成策略

| 改动类型 | 文件 | 策略 |
|----------|------|------|
| Tokens | `style.css` | 添加变量 + 注释块，不破坏原有顺序 |
| 首页专属 CSS | `style.css` | 末尾追加（或新建 `home.css` 并在 index.html 引入）|
| 首页结构 | `index.html` | Hero + Value + CTA 插入；保持原内容下移 |
| 数据徽章 | `index.html` / 脚本 | 初期静态 → 后续脚本填充 |
| 脚本拆分 | 新建 `home.js` | 等 Sprint 3 再抽出 |

---

## 14. 提交约定 (Git Message Template)

```text
feat(homepage): add hero skeleton with tokens and value cards

- add design tokens (colors, spacing, motion)
- implement hero section (title, subtitle, ctas, metrics placeholder)
- add value cards placeholder structure
- inline critical css (temporary) for first paint
```

后续：

```text
feat(homepage): introduce animated hero background (reduced-motion safe)
```

```text
chore(homepage): extract home.js and add lightweight event logging
```

---

## 15. 成功回顾 (Definition of Done)

- [ ] 用户首次进入 3 秒内理解价值。  
- [ ] Lighthouse：Performance / Accessibility / SEO 均 ≥ 90。  
- [ ] 首屏结构可在纯 HTML 模式下完整显示核心消息。  
- [ ] 动画可被系统“减少动画”偏好关闭。  
- [ ] 样式与逻辑模块化，不影响其他页面布局。  
- [ ] 有明确下一步（AI 工坊 / 订阅 / 联系）。  

---

## 16. 附：迭代实施建议（优先级权重参考）

| 项目 | 影响 | 复杂度 | 优先级 |
|------|------|--------|--------|
| Slogan + Hero 骨架 | 极高 | 低 | P0 |
| Tokens 引入 | 高 | 低 | P0 |
| CTA 区 | 高 | 中 | P0 |
| Value Cards | 中高 | 低 | P1 |
| Metrics Strip | 中 | 低 | P1 |
| 背景轻动画 | 中 | 中 | P2 |
| Projects Spotlight | 中 | 中 | P2 |
| Recent Activity 聚合 | 中 | 中 | P2 |
| 数据脚本化 / 埋点 | 中 | 中 | P3 |
| A/B 与 JSON-LD | 中 | 中 | P3 |

---
