/*
 * Simple multilingual support for Fan Wan's personal website.
 *
 * This script defines translation dictionaries for Chinese (zh), English (en)
 * and Spanish (es). Each piece of text on the page is associated with a
 * `data-i18n` attribute whose value corresponds to a key in the
 * dictionaries below. Input placeholders are annotated using the
 * `data-i18n-placeholder` attribute. When the language selector changes or
 * when the page loads, the script updates the text and placeholders to
 * reflect the chosen language. The selected language is persisted in
 * localStorage so that navigation between pages retains the user's
 * preference.
 */

const translations = {
  zh: {
    // Global
    site_title: '万凡 · 个人网站',
    nav_home: '首页',
    nav_about: '关于我',
    nav_research: '学术出版物',
    nav_blog: '博客',
  nav_contact: '联系我',
  nav_ai_lab: 'AI Studio',
  ai_lab_title: 'AI Studio',
  ai_lab_intro: '你的AI助手工作台：研究、教学、应用，一站式集成',
  ai_lab_news_title: '自动资讯 & 报告',
  ai_lab_news_desc: '机器识闻：让重要的 AI 资讯主动找到你。',
  ai_lab_daily_title: '学术快报 ScholarPush · 每日一更',
  ai_lab_empty: '暂无数据，敬请期待。',
  // Lab module descriptions
  module_scholarpush_desc: '每日AI顶会/期刊论文精粹，一分钟掌握学术前沿。',
  module_scholarpush_title: '学术快报',
  module_scholarpush_name: '🧠 学术快报 · ScholarPush · ImpulsoAcadémico',
  module_paperhub_title: 'AI Paper Hub',
  module_paperhub_desc: '今日精选 × 发展脉络：从最新突破到长期演化，一站式掌握 AI 研究。',
  module_paperhub_name: '🧠 AI Paper Hub · 学术快报 2.0 · Centro de Papers IA',
  
  module_ai_teacher_desc: '孩子的专属AI导师，适配个性化学习路径，答疑解惑无所不能。',
  module_ai_teacher_title: 'AI 教师',
  module_ai_teacher_name: '🧑‍🏫 AI 教师 · AI Teacher · Maestro IA',
  module_ai_career_desc: '智能匹配职缺，优化简历投递，让下一个机会主动来敲门。',
  module_ai_career_title: 'AI 求职助手',
  module_ai_career_name: '💼 AI 求职助手 · AI Career Coach · Coach de Carrera IA',
  // Finance mentor
  module_ai_finance_title: 'AI 理财助手',
  module_ai_finance_desc: '让AI为您的财富增值',
  // New modules
  module_ai_trends_title: 'AI 风向标',
  module_ai_trends_desc: '全球AI热点实时同步，洞察技术浪潮下的每一次脉动。',
  module_model_watch_title: '模型追踪器',
  module_model_watch_desc: '从开源仓库到生产环境，追踪最新模型与工具的迭代与应用。',
  module_news_radar_desc: '多源聚合与主题热度追踪，分钟级更新。',
  module_news_radar_title: '快讯雷达',
  module_news_radar_name: '🛰️ 快讯雷达 · News Radar · Radar de Noticias',
  module_release_tracker_desc: '模型/工具版本、变更日志与兼容性一览。',
  module_release_tracker_title: '发布追踪器',
  module_release_tracker_name: '📦 发布追踪器 · Release Tracker · Seguimiento de Lanzamientos',
  module_ai_startup_desc: '从 0 到 1 的方向验证、路线图与合规检查表。',
  module_ai_startup_title: 'AI 创业指南',
  module_ai_startup_name: '🚀 AI 创业指南 · AI Startup · Guía de Startups IA',
  module_auto_reports_desc: '一键生成行业/竞品月报，数据可追溯。',
  module_auto_reports_title: '智能报告机',
  module_auto_reports_name: '📊 智能报告机 · Auto Reports · Informes Automáticos',
  // ScholarPush page titles
  scholarpush_title: '学术快报 - 每日精选论文推荐',
  scholarpush_subtitle: '每日自动精选最新论文，服务于研究者、开发者与技术爱好者',
  ai_lab_apps_title: '站内智能小应用',
  ai_lab_apps_desc: 'AI Teacher、Ask My Site、Long-form to Slides/Audio 等交互 Demo。',
  coming_soon: '功能开发中，敬请期待…',
  module_enter: '进入模块',
  // ScholarPush (local labels)
  sp_overview: '概览（5 分钟）',
  sp_must_read: '必读（15 分钟）',
  sp_nice_read: '扩展阅读（10 分钟）',
  sp_deep_dive: '主题深读',
  sp_stat_total: '总条目',
  sp_stat_code: '含代码',
  sp_stat_bench: '新基准/数据',
  sp_stat_top_tasks: 'Top 任务',
  sp_reusability: '可复用',
  sp_limitations: '局限',
  // ScholarPush filters & UI
  filter_label: '筛选',
  all_label: '全部',
  search_placeholder: '搜索标题/摘要/来源…',
  date_range_7: '7天',
  date_range_30: '30天',
  date_range_all: '全部',
  load_more: '加载更多',
  // Model Watch page
  modelwatch_title: '模型追踪器',
  modelwatch_desc: '跟踪 GitHub 与 Hugging Face 热门模型/项目的热度趋势、榜单与详情',
  mw_sort_score: '综合分',
  mw_sort_delta7: '7日增量',
  mw_sort_stars: 'Stars',
  mw_sort_downloads: 'Downloads',
  mw_sort_stars7: 'Stars 7日',
  mw_sort_forks7: 'Forks 7日',
  mw_sort_downloads7: '下载 7日',
  mw_sort_likes7: 'Likes 7日',
  mw_top_overall: '全站 Top',
  mw_top_darkhorse: '黑马榜 · 7天增长',
  mw_top_github: 'GitHub Top',
  mw_top_hf: 'Hugging Face Top',
  mw_top_new: '新上榜',
  mw_top_bycat: '分类 Top',
  // Model Watch modes
  // Updated mode labels
  mw_mode_daily: '今日灵感',
  mw_mode_gh_top: '工程热榜',
  mw_mode_hf_top: '模型实验场',
  mw_section_gh: 'GitHub 开源项目',
  mw_section_hf: 'Hugging Face 开源模型',
  visit_label: '访问',
  // AI Radar toolbar
  radar_search_placeholder: '全局搜索…',
  radar_filter_source_all: '全部来源',
  radar_filter_tag_all: '全部标签',
  radar_filter_tag_industry: '行业',
  radar_filter_tag_policy: '政策',
  radar_filter_tag_research: '研究',
  radar_filter_tag_tools: '工具',
  radar_filter_tag_funding: '融资',
    // Hero
    hero_title: '你好，我是万凡',
  hero_subtitle: '杜伦大学计算机科学专业博士 — 打造可靠、可控、可解释的 AI 系统。',
  hero_btn_contact: '联系我',
  hero_btn_selected: '精选作品',
  hero_btn_cv: '下载简历',
    // Home – About summary
    about_title: '关于我',
    about_p1: '我是一名专注于大语言模型产业化的研究者，获英国纽卡斯尔大学硕士、杜伦大学计算机科学博士（2025），曾任杜伦大学 HI-Lab 实验室主管。我的目标是把研究做成可运行的系统：让模型理解企业知识、保护隐私，并给出可验证答案。',
    about_p2: '当前在一家中央企业从事 AI 研发，与产品和业务团队协作，将前沿方法打磨为稳定、可运维的能力。我的方法论是 可复现、可评测、可维护。近期工作聚焦于知识增强型 LLM、联邦学习、以及 LLM 微调与下游任务，并通过复盘与开源持续推进迭代。',
    // Research summary
    research_title: '学术出版物',
    research_desc: '我在机器学习、计算机视觉和多媒体分析等领域发表了多篇论文，涵盖联邦学习、神经辐射场和零样本学习等主题。点击下方按钮查看完整列表。',
    research_btn: '查看研究成果',
    // Blog summary
  blog_title: '博客',
  blog_subtitle: '关于人工智能、研究和工程的笔记',
    blog_desc: '在这里，我将分享关于机器学习、计算机视觉、大语言模型以及职业发展的思考与心得。敬请期待我的最新文章。',
    blog_btn: '进入博客',
    blog_coming_soon_title: '敬请期待',
    blog_coming_soon_desc: '博客内容正在筹备中，请稍后再来。',
  // Portfolio
  portfolio_title: '作品集',
  portfolio_filter_all: '全部',
  portfolio_filter_llm: 'LLM',
  portfolio_filter_cv: 'CV',
    // Contact summary
    contact_title: '联系我',
    contact_desc: '如果你对合作或交流感兴趣，欢迎通过邮件或社交媒体与我取得联系。',
    contact_btn: '联系页面',
  contact_or_email: '或通过邮箱：',
  // Footer CTA
  footer_cta_title: '一起合作？',
  footer_cta_desc: '我可提供 LLM 应用、计算机视觉与多媒体分析相关的咨询与合作。',
  // Counters
  uv_label: '访客数 (UV)',
  pv_label: '浏览量 (PV)',
    // Biography page
    bio_title: '个人简介',
    bio_p1: '我是一名专注于大语言模型产业化的研究者，获英国纽卡斯尔大学硕士、杜伦大学计算机科学博士（2025），曾任杜伦大学 HI-Lab 实验室主管。我的目标是把研究做成可运行的系统：让模型理解企业知识、保护隐私，并给出可验证答案。',
    bio_p2: '当前在一家中央企业从事 AI 研发，与产品和业务团队协作，将前沿方法打磨为稳定、可运维的能力。我的方法论是 可复现、可评测、可维护。近期工作聚焦于知识增强型 LLM、联邦学习、以及 LLM 微调与下游任务，并通过复盘与开源持续推进迭代。',
    education_title: '教育经历',
    edu_phd_title: '杜伦大学 · 博士 (2020.10 – 2025.01)',
    edu_phd_desc: '计算机科学专业，研究方向涵盖计算机视觉、多模态算法和大语言模型。',
    edu_msc_title: '纽卡斯尔大学 · 硕士 (2017.09 – 2018.08)',
    edu_msc_desc: '计算机科学专业，以优秀成绩毕业，主修编程、数据库和软件工程等课程。',
    edu_bsc_title: '山西农业大学 · 学士 (2013.09 – 2017.07)',
    edu_bsc_desc: '软件工程专业，掌握数据结构、计算机网络、Web 开发等基础课程。',
    interests_title: '研究兴趣',
    interest_ml: '机器学习与联邦学习',
    interest_cv: '计算机视觉与多媒体分析',
    interest_llm: '大语言模型与 AI 智能体',
    interest_privacy: '隐私保护算法与分布式 AI',
  publications_more_title: '更多论文',
  co_corresponding: '\u2020共同通讯',
  co_first: '*共同一作',
  phd_thesis: '博士学位论文',
    // Share UI
    share_label: '分享',
    share_wechat: '微信',
    share_whatsapp: 'WhatsApp',
    share_copy: '复制链接',
    share_copied: '已复制',
    share_download: '下载封面',
    share_share: '系统分享',
    share_close: '关闭',
    share_wechat_qr_tip: '使用微信“扫一扫”分享本文',
    // Publications page
    publications_list_title: '代表性论文',
  view_pdf: '在线阅读 PDF',
  download_pdf: '下载 PDF',
  pdf_viewer_title: 'PDF 阅读器',
  pdf_not_found: '未找到 PDF 文件',
    // Contact form
    form_name: '姓名',
    form_name_placeholder: '你的名字',
    form_email: '邮箱',
    form_email_placeholder: '你的邮箱',
    form_message: '留言',
    form_message_placeholder: '你的留言',
  form_send: '发送',
  form_success: '已发送！我会尽快回复你。',
  form_error: '发送失败，请稍后重试或直接邮件至：',
  form_required: '请填写所有必填项',
  form_invalid_email: '邮箱格式不正确'
  ,
  // Contact verification
  verify_title: '验证',
  verify_slide_label: '向右滑动完成验证',
  verify_needed: '请先完成验证再提交',
  // Theme toggle
  theme_toggle_label: '主题切换',
  theme_mode_system: '跟随系统',
  theme_mode_dark: '深色模式',
  theme_mode_light: '浅色模式',
  theme_switch_to_light: '切换为浅色模式',
  theme_switch_to_dark: '切换为深色模式'
  ,
  // Reason label badges (模型追踪器 Daily/Hotlists)
  mw_reason_trending_growth: '飙升',
  mw_reason_agent_workflow: 'Agent/工作流',
  mw_reason_model_optimization: '模型优化',
  mw_reason_distillation: '蒸馏',
  mw_reason_benchmark_update: '基准更新',
  mw_reason_security_safety: '安全',
  mw_reason_new_release: '新发布',
  mw_reason_notable: '值得关注',
  mw_reason_multi: '多列',
  // Mode new names (ensure i18n keys exist if reused)
  mw_mode_daily_new: '今日灵感',
  mw_mode_gh_hotlist: '工程热榜',
  mw_mode_hf_lab: '模型实验场'
  },
  en: {
    site_title: 'Fan Wan · Personal Website',
    nav_home: 'Home',
    nav_about: 'About',
    nav_research: 'Research',
    nav_blog: 'Blog',
  nav_contact: 'Contact',
  nav_ai_lab: 'AI Studio',
  ai_lab_title: 'AI Studio',
  ai_lab_intro: 'Your AI Assistant Hub: Research, Learning, Deployment — All in One.',
  ai_lab_news_title: 'Automated Briefings & Reports',
  ai_lab_news_desc: 'Daily AI read: ScholarPush, News Radar, and Release Tracker.',
  ai_lab_daily_title: 'ScholarPush · Daily Update',
  ai_lab_empty: 'No data yet. Stay tuned.',
  // Lab module descriptions
  module_scholarpush_desc: 'Daily highlights from top AI venues—grasp the frontier in a minute.',
  module_scholarpush_title: 'ScholarPush',
  module_scholarpush_name: '🧠 学术快报 · ScholarPush · ImpulsoAcadémico',
  module_paperhub_title: 'AI Paper Hub',
  module_paperhub_desc: 'Highlights × Milestones: daily breakthroughs and long-term evolution in one place.',
  module_paperhub_name: '🧠 AI Paper Hub · ScholarPush 2.0 · AI Paper Center',
  
  module_ai_teacher_desc: 'A personal AI tutor for your child—tailored learning paths and instant, patient answers.',
  module_ai_teacher_title: 'AI Teacher',
  module_ai_teacher_name: '🧑‍🏫 AI 教师 · AI Teacher · Maestro IA',
  module_ai_career_desc: 'Match roles smartly, refine applications, and let the next opportunity find you.',
  module_ai_career_title: 'AI Career Coach',
  module_ai_career_name: '💼 AI 求职助手 · AI Career Coach · Coach de Carrera IA',
  // Finance mentor
  module_ai_finance_title: 'AI Finance Mentor',
  module_ai_finance_desc: 'Empower Your Wealth with AI.',
  // New modules
  module_ai_trends_title: 'AI Trends',
  module_ai_trends_desc: 'Real‑time global AI hotspots—track the pulse of every wave of innovation.',
  module_model_watch_title: 'Model Watch',
  module_model_watch_desc: 'From open source to production, follow the latest models and tools across releases and adoption.',
  module_news_radar_desc: 'Multi-source aggregation with hot-topic tracking, minute-level updates.',
  module_news_radar_title: 'News Radar',
  module_news_radar_name: '🛰️ 快讯雷达 · News Radar · Radar de Noticias',
  module_release_tracker_desc: 'Track model/tool versions, changelogs and compatibility.',
  module_release_tracker_title: 'Release Tracker',
  module_release_tracker_name: '📦 发布追踪器 · Release Tracker · Seguimiento de Lanzamientos',
  module_ai_startup_desc: 'Zero-to-one validation, roadmap and compliance checklists.',
  module_ai_startup_title: 'AI Startup',
  module_ai_startup_name: '🚀 AI 创业指南 · AI Startup · Guía de Startups IA',
  module_auto_reports_desc: 'One-click industry/competitor reports with traceable data.',
  module_auto_reports_title: 'Auto Reports',
  module_auto_reports_name: '📊 智能报告机 · Auto Reports · Informes Automáticos',
  scholarpush_title: 'ScholarPush - Daily AI Paper Recommender',
  scholarpush_subtitle: 'Daily curated AI papers for researchers, developers, and enthusiasts',
  ai_lab_apps_title: 'In-site AI Apps',
  ai_lab_apps_desc: 'AI Teacher, Ask My Site, and Long-form to Slides/Audio demos.',
  coming_soon: 'Coming soon…',
  module_enter: 'Enter module',
  // ScholarPush (local labels)
  sp_overview: 'Overview (5 min)',
  sp_must_read: 'Must Read (15 min)',
  sp_nice_read: 'Nice to Read (10 min)',
  sp_deep_dive: 'Deep Dive',
  sp_stat_total: 'Total items',
  sp_stat_code: 'With code',
  sp_stat_bench: 'New benchmarks/data',
  sp_stat_top_tasks: 'Top tasks',
  sp_reusability: 'Reusability',
  sp_limitations: 'Limitations',
  // ScholarPush filters & UI
  filter_label: 'Filter',
  all_label: 'All',
  search_placeholder: 'Search title/summary/source…',
  date_range_7: '7d',
  date_range_30: '30d',
  date_range_all: 'All',
  load_more: 'Load more',
  // Model Watch page
  modelwatch_title: 'Model Watch',
  modelwatch_desc: 'Track trends, leaderboards, and details for top models/projects on GitHub and Hugging Face.',
  mw_sort_score: 'Composite score',
  mw_sort_delta7: '7‑day growth',
  mw_sort_stars: 'Stars',
  mw_sort_downloads: 'Downloads',
  mw_sort_stars7: 'Stars 7d',
  mw_sort_forks7: 'Forks 7d',
  mw_sort_downloads7: 'Downloads 7d',
  mw_sort_likes7: 'Likes 7d',
  mw_top_overall: 'Top overall',
  mw_top_darkhorse: 'Dark horses · 7‑day growth',
  mw_top_github: 'GitHub Top',
  mw_top_hf: 'Hugging Face Top',
  mw_top_new: 'Newcomers',
  mw_top_bycat: 'Top by category',
  // Model Watch modes
  // Updated mode labels
  mw_mode_daily: 'Inspiration Today',
  mw_mode_gh_top: 'Engineering Hotlist',
  mw_mode_hf_top: 'Model Lab',
  mw_section_gh: 'GitHub open-source projects',
  mw_section_hf: 'Hugging Face open-source models',
  visit_label: 'Visit',
  // AI Radar toolbar
  radar_search_placeholder: 'Global search…',
  radar_filter_source_all: 'All sources',
  radar_filter_tag_all: 'All tags',
  radar_filter_tag_industry: 'Industry',
  radar_filter_tag_policy: 'Policy',
  radar_filter_tag_research: 'Research',
  radar_filter_tag_tools: 'Tools',
  radar_filter_tag_funding: 'Funding',
    hero_title: "Hi, I'm Fan Wan",
  hero_subtitle: 'Durham CS PhD — Engineering Trustworthy, Controllable, Explainable AI.',
  hero_btn_contact: 'Contact me',
  hero_btn_selected: 'Selected Work',
  hero_btn_cv: 'Download CV',
    about_title: 'About Me',
    about_p1: "I obtained my Master’s degree in Computer Science from Newcastle University in 2018 (with distinction) and completed my Ph.D. in Computer Science at Durham University in January 2025. I currently work as a researcher at Tongfang Knowledge Network Digital Technology Co., Ltd., part of China National Nuclear Corporation.",
    about_p2: 'My research focuses on applying large language models (LLMs) in real-world nuclear industry scenarios. I am passionate about machine learning, computer vision, multimedia analysis and developing LLM-based agents and downstream tasks.',
    research_title: 'Research Publications',
    research_desc: 'I have published several papers in areas such as machine learning, computer vision and multimedia analysis, covering topics like federated learning, neural radiance fields and zero-shot learning. Click the button below to view the full list.',
    research_btn: 'View Research',
  blog_title: 'Blog',
  blog_subtitle: 'Notes on AI, research, and engineering',
    blog_desc: 'Here I will share my thoughts and insights on machine learning, computer vision, large language models and career development. Stay tuned for my latest posts.',
    blog_btn: 'Visit Blog',
    blog_coming_soon_title: 'Coming Soon',
    blog_coming_soon_desc: 'Blog content is being prepared, please come back later.',
  // Portfolio
  portfolio_title: 'Portfolio',
  portfolio_filter_all: 'All',
  portfolio_filter_llm: 'LLM',
  portfolio_filter_cv: 'CV',
    contact_title: 'Contact Me',
    contact_desc: 'If you are interested in collaboration or communication, feel free to contact me via email or social media.',
    contact_btn: 'Contact Page',
  contact_or_email: 'Or email:',
  // Footer CTA
  footer_cta_title: 'Collaborate?',
  footer_cta_desc: 'I can help with LLM applications, computer vision and multimedia analysis.',
  // Counters
  uv_label: 'Visitors (UV)',
  pv_label: 'Views (PV)',
    bio_title: 'Biography',
    bio_p1: "I obtained my Master’s degree in Computer Science from Newcastle University in 2018 (with distinction) and completed my Ph.D. in Computer Science at Durham University in January 2025. During my doctoral studies, I focused on computer vision and multimodal algorithms and actively explored large language models and their applications to real-world problems.",
    bio_p2: 'Currently, I work as a researcher at Tongfang Knowledge Network Digital Technology Co., Ltd., part of China National Nuclear Corporation, dedicated to applying large language models to nuclear industry scenarios. I am passionate about machine learning, federated learning, computer vision, multimedia analysis and AIGC technologies, and participate in various interdisciplinary collaborations.',
    education_title: 'Education',
    edu_phd_title: 'Durham University · Ph.D. (Oct 2020 – Jan 2025)',
    edu_phd_desc: 'Computer Science with a focus on computer vision, multimodal algorithms and large language models.',
    edu_msc_title: 'Newcastle University · M.Sc. (Sep 2017 – Aug 2018)',
    edu_msc_desc: 'Computer Science, graduated with distinction; major courses included programming, databases and software engineering.',
    edu_bsc_title: 'Shanxi Agricultural University · B.Sc. (Sep 2013 – Jul 2017)',
    edu_bsc_desc: 'Software Engineering, learned fundamentals such as data structures, computer networks and web development.',
    interests_title: 'Research Interests',
    interest_ml: 'Machine Learning & Federated Learning',
    interest_cv: 'Computer Vision & Multimedia Analysis',
    interest_llm: 'Large Language Models & AI Agents',
    interest_privacy: 'Privacy‑Preserving Algorithms & Distributed AI',
    publications_list_title: 'Selected Publications',
  publications_more_title: 'More Publications',
  co_corresponding: '\u2020Co‑corresponding',
  co_first: '*Co‑first author',
  phd_thesis: 'Ph.D. thesis',
    // Share UI
    share_label: 'Share',
    share_wechat: 'WeChat',
    share_whatsapp: 'WhatsApp',
    share_copy: 'Copy link',
    share_copied: 'Copied',
    share_download: 'Download cover',
    share_share: 'Share…',
    share_close: 'Close',
    share_wechat_qr_tip: 'Scan in WeChat to share this post',
  view_pdf: 'View PDF',
  download_pdf: 'Download PDF',
  pdf_viewer_title: 'PDF Viewer',
  pdf_not_found: 'PDF not available',
    form_name: 'Name',
    form_name_placeholder: 'Your name',
    form_email: 'Email',
    form_email_placeholder: 'Your email',
    form_message: 'Message',
    form_message_placeholder: 'Your message',
  form_send: 'Send',
  form_success: 'Sent! I will get back to you soon.',
  form_error: 'Failed to send. Please try again later or email me at:',
  form_required: 'Please fill in all required fields',
  form_invalid_email: 'Invalid email address',
  // Contact verification
  verify_title: 'Verification',
  verify_slide_label: 'Slide right to verify',
  verify_needed: 'Please complete verification before submitting',
  // Theme toggle
  theme_toggle_label: 'Toggle theme',
  theme_mode_system: 'Follow system',
  theme_mode_dark: 'Dark mode',
  theme_mode_light: 'Light mode',
  theme_switch_to_light: 'Switch to light theme',
  theme_switch_to_dark: 'Switch to dark theme'
  ,
  // Reason label badges
  mw_reason_trending_growth: 'Surging',
  mw_reason_agent_workflow: 'Agent Workflow',
  mw_reason_model_optimization: 'Optimization',
  mw_reason_distillation: 'Distillation',
  mw_reason_benchmark_update: 'Benchmark Update',
  mw_reason_security_safety: 'Security & Safety',
  mw_reason_new_release: 'New Release',
  mw_reason_notable: 'Notable',
  mw_reason_multi: 'Multi',
  // New mode names
  mw_mode_daily_new: 'Inspiration Today',
  mw_mode_gh_hotlist: 'Engineering Hotlist',
  mw_mode_hf_lab: 'Model Lab'
  },
  es: {
    site_title: 'Fan Wan · Sitio personal',
    nav_home: 'Inicio',
    nav_about: 'Acerca de',
    nav_research: 'Investigación',
    nav_blog: 'Blog',
  nav_contact: 'Contacto',
  nav_ai_lab: 'Taller de IA',
  ai_lab_title: 'Taller de IA',
  ai_lab_intro: 'Tu asistente IA integral: investigación, enseñanza y aplicación, todo en uno.',
  ai_lab_news_title: 'Informes automáticos y resúmenes',
  ai_lab_news_desc: 'Lectura diaria: ScholarPush, Radar de noticias y seguimiento de lanzamientos.',
  ai_lab_daily_title: 'ImpulsoAcadémico · Actualización diaria',
  ai_lab_empty: 'Sin datos por ahora. Próximamente.',
  // Lab module descriptions
  module_scholarpush_desc: 'Lo esencial de los congresos y revistas de IA, cada día en un minuto.',
  module_scholarpush_title: 'ImpulsoAcadémico',
  module_scholarpush_name: '🧠 学术快报 · ScholarPush · ImpulsoAcadémico',
  module_paperhub_title: 'AI Paper Hub',
  module_paperhub_desc: 'Destacados × hitos: síntesis diaria y evolución a largo plazo en un mismo lugar.',
  module_paperhub_name: '🧠 AI Paper Hub · ScholarPush 2.0 · Centro de Papers IA',
  
  module_ai_teacher_desc: 'El tutor de IA personal de tus hijos: rutas de aprendizaje a medida y respuestas al instante.',
  module_ai_teacher_title: 'Maestro IA',
  module_ai_teacher_name: '🧑‍🏫 AI 教师 · AI Teacher · Maestro IA',
  module_ai_career_desc: 'Encuentra el puesto ideal, mejora tu candidatura y deja que la próxima oportunidad te encuentre.',
  module_ai_career_title: 'Coach de Carrera IA',
  module_ai_career_name: '💼 AI 求职助手 · AI Career Coach · Coach de Carrera IA',
  // Finance mentor
  module_ai_finance_title: 'Asesor Financiero con IA',
  module_ai_finance_desc: 'Potencie Su Patrimonio con IA.',
  // New modules
  module_ai_trends_title: 'Tendencias IA',
  module_ai_trends_desc: 'Calor global de la IA en tiempo real: toma el pulso a cada ola de innovación.',
  module_model_watch_title: 'Vigilancia de Modelos',
  module_model_watch_desc: 'Del código abierto a producción: sigue la evolución y adopción de modelos y herramientas.',
  module_news_radar_desc: 'Agregación multi‑fuente y seguimiento de temas en tendencia.',
  module_news_radar_title: 'Radar de Noticias',
  module_news_radar_name: '🛰️ 快讯雷达 · News Radar · Radar de Noticias',
  module_release_tracker_desc: 'Versiones de modelos/herramientas, cambios y compatibilidad.',
  module_release_tracker_title: 'Seguimiento de Lanzamientos',
  module_release_tracker_name: '📦 发布追踪器 · Release Tracker · Seguimiento de Lanzamientos',
  module_ai_startup_desc: 'Validación 0‑1, hoja de ruta y listas de verificación de cumplimiento.',
  module_ai_startup_title: 'Guía de Startups IA',
  module_ai_startup_name: '🚀 AI 创业指南 · AI Startup · Guía de Startups IA',
  module_auto_reports_desc: 'Informes industriales/competencia con datos rastreables.',
  module_auto_reports_title: 'Informes Automáticos',
  module_auto_reports_name: '📊 智能报告机 · Auto Reports · Informes Automáticos',
  scholarpush_title: 'Impulso Académico - Recomendador Diario de Artículos IA',
  scholarpush_subtitle: 'Selección diaria de papers de IA para investigadores, desarrolladores y entusiastas',
  ai_lab_apps_title: 'Apps de IA en el sitio',
  ai_lab_apps_desc: 'AI Teacher, Ask My Site y demo de convertir a diapositivas/audio.',
  coming_soon: 'Próximamente…',
  module_enter: 'Entrar al módulo',
  // ScholarPush (local labels)
  sp_overview: 'Resumen (5 min)',
  sp_must_read: 'Lectura obligatoria (15 min)',
  sp_nice_read: 'Lectura ampliada (10 min)',
  sp_deep_dive: 'Análisis en profundidad',
  sp_stat_total: 'Total',
  sp_stat_code: 'Con código',
  sp_stat_bench: 'Nuevos benchmarks/datos',
  sp_stat_top_tasks: 'Tareas destacadas',
  sp_reusability: 'Reutilizable',
  sp_limitations: 'Limitaciones',
  // ScholarPush filters & UI
  filter_label: 'Filtrar',
  all_label: 'Todo',
  search_placeholder: 'Buscar título/resumen/fuente…',
  date_range_7: '7 días',
  date_range_30: '30 días',
  date_range_all: 'Todo',
  load_more: 'Cargar más',
  // Model Watch page
  modelwatch_title: 'Vigilancia de Modelos',
  modelwatch_desc: 'Sigue tendencias, rankings y detalles de modelos/proyectos destacados en GitHub y Hugging Face.',
  mw_sort_score: 'Puntuación compuesta',
  mw_sort_delta7: 'Crecimiento 7 días',
  mw_section_gh: 'Proyectos open-source de GitHub',
  mw_section_hf: 'Modelos open-source de Hugging Face',
  visit_label: 'Visitar',
  mw_sort_stars: 'Estrellas',
  mw_sort_downloads: 'Descargas',
  mw_sort_stars7: 'Estrellas 7d',
  mw_sort_forks7: 'Forks 7d',
  mw_sort_downloads7: 'Descargas 7d',
  mw_sort_likes7: 'Likes 7d',
  mw_top_overall: 'Top general',
  mw_top_darkhorse: 'Revelaciones · crecimiento 7 días',
  mw_top_github: 'Top de GitHub',
  mw_top_hf: 'Top de Hugging Face',
  mw_top_new: 'Nuevos',
  mw_top_bycat: 'Top por categoría',
  // Model Watch modes
  // Updated mode labels
  mw_mode_daily: 'Inspiración Hoy',
  mw_mode_gh_top: 'Ranking Ingeniería',
  mw_mode_hf_top: 'Laboratorio de Modelos',
  // AI Radar toolbar
  radar_search_placeholder: 'Búsqueda global…',
  radar_filter_source_all: 'Todas las fuentes',
  radar_filter_tag_all: 'Todas las etiquetas',
  radar_filter_tag_industry: 'Industria',
  radar_filter_tag_policy: 'Política',
  radar_filter_tag_research: 'Investigación',
  radar_filter_tag_tools: 'Herramientas',
  radar_filter_tag_funding: 'Financiación',
    hero_title: 'Hola, soy Fan Wan',
  hero_subtitle: 'Ph.D. en Ciencias de la Computación (Durham) — Ingeniería de IA confiable, controlable y explicable.',
  hero_btn_contact: 'Contáctame',
  hero_btn_selected: 'Trabajos destacados',
  hero_btn_cv: 'Descargar CV',
    about_title: 'Sobre mí',
    about_p1: 'Obtuve mi maestría en Ciencias de la Computación en la Universidad de Newcastle en 2018 (con distinción) y completé mi doctorado en Ciencias de la Computación en la Universidad de Durham en enero de 2025. Actualmente trabajo como investigador en Tongfang Knowledge Network Digital Technology Co., Ltd., parte de la Corporación Nacional Nuclear de China.',
    about_p2: 'Mi investigación se centra en aplicar modelos de lenguaje grandes (LLM) en escenarios reales de la industria nuclear. Me apasionan el aprendizaje automático, la visión por computadora, el análisis multimedia y el desarrollo de agentes basados en LLM y tareas posteriores.',
    research_title: 'Publicaciones de investigación',
    research_desc: 'He publicado varios trabajos en áreas como aprendizaje automático, visión por computadora y análisis multimedia, cubriendo temas como aprendizaje federado, campos de radiancia neural y aprendizaje de cero muestras. Haga clic en el botón de abajo para ver la lista completa.',
    research_btn: 'Ver investigación',
  blog_title: 'Blog',
  blog_subtitle: 'Notas sobre IA, investigación e ingeniería',
    blog_desc: 'Aquí compartiré mis pensamientos e ideas sobre aprendizaje automático, visión por computadora, modelos de lenguaje grandes y desarrollo profesional. Mantente al tanto de mis publicaciones más recientes.',
    blog_btn: 'Visitar blog',
    blog_coming_soon_title: 'Próximamente',
    blog_coming_soon_desc: 'El contenido del blog está en preparación, por favor vuelve más tarde.',
  // Portfolio
  portfolio_title: 'Portafolio',
  portfolio_filter_all: 'Todo',
  portfolio_filter_llm: 'LLM',
  portfolio_filter_cv: 'CV',
    contact_title: 'Contáctame',
    contact_desc: 'Si estás interesado en colaborar o conversar, no dudes en contactarme por correo electrónico o redes sociales.',
    contact_btn: 'Página de contacto',
  contact_or_email: 'O por correo:',
  // Footer CTA
  footer_cta_title: '¿Colaboramos?',
  footer_cta_desc: 'Puedo ayudar con aplicaciones LLM, visión por computadora y análisis multimedia.',
  // Counters
  uv_label: 'Visitantes (UV)',
  pv_label: 'Vistas (PV)',
    bio_title: 'Biografía',
    bio_p1: 'Obtuve mi maestría en Ciencias de la Computación en la Universidad de Newcastle en 2018 (con distinción) y completé mi doctorado en Ciencias de la Computación en la Universidad de Durham en enero de 2025. Durante mis estudios de doctorado me enfoqué en visión por computadora y algoritmos multimodales y exploré activamente modelos de lenguaje grandes y sus aplicaciones a problemas reales.',
    bio_p2: 'Actualmente trabajo como investigador en Tongfang Knowledge Network Digital Technology Co., Ltd., parte de la Corporación Nacional Nuclear de China, dedicado a aplicar modelos de lenguaje grandes a los escenarios de la industria nuclear. Me apasionan el aprendizaje automático, el aprendizaje federado, la visión por computadora, el análisis multimedia y las tecnologías AIGC, y participo en diversas colaboraciones interdisciplinarias.',
    education_title: 'Educación',
    edu_phd_title: 'Universidad de Durham · Doctorado (octubre 2020 – enero 2025)',
    edu_phd_desc: 'Ciencias de la Computación, con enfoque en visión por computadora, algoritmos multimodales y modelos de lenguaje grandes.',
    edu_msc_title: 'Universidad de Newcastle · Maestría (septiembre 2017 – agosto 2018)',
    edu_msc_desc: 'Ciencias de la Computación, graduado con distinción; cursos principales como programación, bases de datos e ingeniería de software.',
    edu_bsc_title: 'Universidad Agrícola de Shanxi · Licenciatura (septiembre 2013 – julio 2017)',
    edu_bsc_desc: 'Ingeniería de Software, aprendió fundamentos incluyendo estructuras de datos, redes informáticas y desarrollo web.',
    interests_title: 'Intereses de investigación',
    interest_ml: 'Aprendizaje automático y aprendizaje federado',
    interest_cv: 'Visión por computadora y análisis multimedia',
    interest_llm: 'Modelos de lenguaje grandes y agentes de IA',
    interest_privacy: 'Algoritmos de preservación de privacidad y IA distribuida',
    publications_list_title: 'Publicaciones seleccionadas',
  publications_more_title: 'Más publicaciones',
  co_corresponding: '\u2020Autor corresponsal conjunto',
  co_first: '*Autor/a co‑principal',
  phd_thesis: 'Tesis doctoral',
    // Share UI
    share_label: 'Compartir',
    share_wechat: 'WeChat',
    share_whatsapp: 'WhatsApp',
    share_copy: 'Copiar enlace',
    share_copied: 'Copiado',
    share_download: 'Descargar portada',
    share_share: 'Compartir…',
    share_close: 'Cerrar',
    share_wechat_qr_tip: 'Escanea en WeChat para compartir este artículo',
  view_pdf: 'Ver PDF',
  download_pdf: 'Descargar PDF',
  pdf_viewer_title: 'Visor de PDF',
  pdf_not_found: 'PDF no disponible',
    form_name: 'Nombre',
    form_name_placeholder: 'Tu nombre',
    form_email: 'Correo electrónico',
    form_email_placeholder: 'Tu correo electrónico',
    form_message: 'Mensaje',
    form_message_placeholder: 'Tu mensaje',
  form_send: 'Enviar',
  form_success: '¡Enviado! Te responderé pronto.',
  form_error: 'No se pudo enviar. Inténtalo más tarde o escríbeme a:',
  form_required: 'Completa los campos obligatorios',
  form_invalid_email: 'Correo electrónico no válido',
  // Contact verification
  verify_title: 'Verificación',
  verify_slide_label: 'Desliza a la derecha para verificar',
  verify_needed: 'Completa la verificación antes de enviar',
  // Theme toggle
  theme_toggle_label: 'Cambiar tema',
  theme_mode_system: 'Seguir sistema',
  theme_mode_dark: 'Modo oscuro',
  theme_mode_light: 'Modo claro',
  theme_switch_to_light: 'Cambiar a modo claro',
  theme_switch_to_dark: 'Cambiar a modo oscuro'
  ,
  // Reason label badges
  mw_reason_trending_growth: 'En Auge',
  mw_reason_agent_workflow: 'Flujo de Agentes',
  mw_reason_model_optimization: 'Optimización',
  mw_reason_distillation: 'Destilación',
  mw_reason_benchmark_update: 'Actualización Benchmark',
  mw_reason_security_safety: 'Seguridad',
  mw_reason_new_release: 'Nuevo Lanzamiento',
  mw_reason_notable: 'Destacado',
  mw_reason_multi: 'Múltiple',
  // New mode names
  mw_mode_daily_new: 'Inspiración Hoy',
  mw_mode_gh_hotlist: 'Ranking Ingeniería',
  mw_mode_hf_lab: 'Laboratorio de Modelos'
  }
};

/**
 * Apply translations to all elements annotated with data-i18n and
 * data-i18n-placeholder attributes. The HTML document's lang attribute
 * will also be updated accordingly.
 *
 * @param {string} lang The language code to apply (zh, en or es).
 */
function translatePage(lang) {
  // Set the lang attribute on the document root
  document.documentElement.setAttribute('lang', lang);
  // Translate text content
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (translations[lang] && translations[lang][key]) {
      el.textContent = translations[lang][key];
    }
  });
  // Translate placeholders
  const placeholders = document.querySelectorAll('[data-i18n-placeholder]');
  placeholders.forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (translations[lang] && translations[lang][key]) {
      el.setAttribute('placeholder', translations[lang][key]);
    }
  });
  // Translate attributes for meta/content using data-i18n-content
  const contentAttrs = document.querySelectorAll('[data-i18n-content]');
  contentAttrs.forEach(el => {
    const key = el.getAttribute('data-i18n-content');
    if (translations[lang] && translations[lang][key]) {
      try { el.setAttribute('content', translations[lang][key]); } catch {}
    }
  });
  // Update the document title if it has data-i18n attribute
  const titleEl = document.querySelector('title[data-i18n]');
  if (titleEl) {
    const key = titleEl.getAttribute('data-i18n');
    if (translations[lang] && translations[lang][key]) {
      titleEl.textContent = translations[lang][key];
    }
  }

  // Update theme toggle tooltip/title
  const toggleBtn = document.getElementById('theme-toggle');
  if (toggleBtn) {
    const mode = localStorage.getItem('theme') || 'system';
    const modeText = mode === 'system' ? translations[lang].theme_mode_system
                     : mode === 'dark' ? translations[lang].theme_mode_dark
                     : translations[lang].theme_mode_light;
    toggleBtn.setAttribute('aria-label', translations[lang].theme_toggle_label);
    toggleBtn.setAttribute('title', `${translations[lang].theme_toggle_label}（${modeText}）`);
  }

  // Update language button text without removing its icon
  const langBtn = document.getElementById('lang-button');
  if (langBtn) {
    const map = { en: 'English', zh: '中文', es: 'Español' };
    const labelEl = langBtn.querySelector('.label');
    const cur = localStorage.getItem('lang') || 'en';
    if (labelEl) labelEl.textContent = `Language` + (map[cur] ? ` · ${map[cur]}` : '');
    else langBtn.textContent = `Language` + (map[cur] ? ` · ${map[cur]}` : '');
  }

  // Notify others that language changed (for components needing rerender)
  try { window.dispatchEvent(new CustomEvent('language-changed', { detail: { lang } })); } catch {}
}

document.addEventListener('DOMContentLoaded', () => {
  const langSelect = document.getElementById('lang-select');
  // Prefer user's saved choice, else the document's declared language, else zh
  const defaultLang = localStorage.getItem('lang') || document.documentElement.lang || 'zh';
  // Expose for other scripts
  try { window.translations = translations; } catch {}
  translatePage(defaultLang);
  if (langSelect) {
    langSelect.value = defaultLang;
    langSelect.addEventListener('change', () => {
      const selected = langSelect.value;
      localStorage.setItem('lang', selected);
      translatePage(selected);
    });
  }
});