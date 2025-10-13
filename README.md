# Personal Website - Fan Wan

[![Website](https://img.shields.io/badge/website-online-brightgreen)](https://fanwan-ai.github.io/)

Welcome to the source code of my personal website:  
👉 **[https://fanwan-ai.github.io/](https://fanwan-ai.github.io/)**

This site serves as my digital hub to showcase my research, publications, projects, and blog posts.  
It is built as a static website hosted on **GitHub Pages**.

---

## 🌐 Features

- **About Me** – background, education, and professional journey.  
- **Publications** – curated list of my academic papers with links.  
- **Blog** – thoughts on AI, research, and technology trends.  
- **Projects** – highlights of selected research and side projects.  
- **Contact** – ways to reach me.

---

## 🚀 Tech Stack

- **Static Site**: HTML5, CSS3, JavaScript  
- **Deployment**: GitHub Pages  
- **Enhancements**: CSP for security, Busuanzi for visitor stats, SEO meta tags  

---

## 📌 Roadmap

Planned improvements:
- Add multilingual support (English, 中文, Español).  
- Improve blog generator (Markdown → HTML workflow).  
- Integrate AI-driven modules (e.g., ScholarPush, Paper Digest).  

---

## 🔒 Security

For security guidelines and how to report vulnerabilities, see [SECURITY.md](./SECURITY.md).

---

## 📄 License

This repository and website content are licensed under the **MIT License** unless otherwise noted.  
Feel free to explore, but please attribute if you reuse any content.

---

## 🖼️ OG Cover Rendering Notes

Recent fix: Chinese characters appeared as garbled squares on OG covers. The root cause was a mismatch between the embedded font MIME/format and the declared `@font-face` format in `assets/og-template.svg`.

What changed:
- We embed Noto Sans SC as TTF via data URIs. The `@font-face` now uses `format('truetype')` (previously incorrectly set to `woff2`).
- The renderers load the SVG inside an HTML wrapper and wait for `document.fonts.ready` before taking screenshots, reducing race conditions.

How to regenerate covers locally:
- Generate per-post SVGs from template: `npm run og:from-template`
- Rasterize SVG → PNG via Sharp (no Chromium needed): `npm run og:rasterize`
- Or render all SVGs to PNG via Puppeteer/Chromium: `npm run og:render`

If Chromium is unavailable in your environment, prefer the Sharp-based rasterizer.
