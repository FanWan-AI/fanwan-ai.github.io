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

function safeStorageGet(key, fallback = null) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

function resolveLang(defaultLang = 'zh') {
  const docLang = (document.documentElement && document.documentElement.lang) || defaultLang;
  const stored = safeStorageGet('lang', null);
  return (stored || docLang || defaultLang || '').toString();
}

const translations = {
  zh: {
    // Global
    site_title: '万凡 · 个人网站',
    nav_home: '首页',
    nav_about: '关于我',
    nav_research: '学术出版物',
    nav_blog: '博客',
  nav_contact: '联系我',
  nav_ai_lab: 'AI 工坊',
  ai_lab_title: 'AI 工坊',
  ai_lab_intro: '你的AI助手工作台：研究、教学、应用，一站式集成',
  ai_lab_news_title: '自动资讯 & 报告',
  ai_lab_news_desc: '机器识闻：让重要的 AI 资讯主动找到你。',
  ai_lab_daily_title: '学术快报 ScholarPush · 每日一更',
  ai_lab_empty: '暂无数据，敬请期待。',
  // Lab module descriptions
  module_scholarpush_desc: '每日AI顶会/期刊论文精粹，一分钟掌握学术前沿。',
  module_scholarpush_title: '学术快报',
  module_scholarpush_name: '🧠 学术快报 · ScholarPush · ImpulsoAcadémico',
  module_paperhub_title: 'AI 论文中心',
  module_paperhub_desc: '汇聚AI研究的前沿与经典，让你在一页之内洞悉 AI 研究的今日与未来。',
  module_paperhub_name: '🧠 AI 论文中心 · AI Paper Hub · Centro de Investigación AI',
  paperhub_page_title: 'AI 论文中心 · Fan Wan',
  paperhub_meta_description: 'AI 论文中心：汇聚AI研究的前沿与经典，让你在一页之内洞悉 AI 研究的今日与未来。',
  paperhub_meta_og_alt: 'AI 论文中心封面',
  paperhub_hero_title: 'AI 论文中心',
  paperhub_hero_subtitle: '汇聚AI研究的前沿与经典，让你在一页之内洞悉 AI 研究的今日与未来。',
  paperhub_tab_highlights: '今日精选',
  paperhub_tab_milestones: 'AI 演进轨迹',
  paperhub_chip_highlight_aria: '快速筛选',
  paperhub_chip_milestone_aria: '任务标签过滤',
  paperhub_search_highlight_placeholder: '搜索标题、标签或摘要',
  paperhub_search_highlight_aria: '搜索最新论文',
  paperhub_search_milestone_placeholder: '搜索任务、关键字',
  paperhub_search_milestone_aria: '搜索任务',
  paperhub_loading_highlights: '加载今日精选...',
  paperhub_loading_milestones: '加载任务索引...',
  paperhub_empty_highlight: '没有匹配的论文，换个关键词试试。',
  paperhub_empty_milestone: '没有匹配的任务，换个关键词试试。',
  paperhub_stat_highlight_label: '当日精选数量',
  paperhub_stat_highlight_caption: '记录的论文条目',
  paperhub_stat_impact_label: '平均影响评分',
  paperhub_stat_impact_caption: 'Impact Score (0-100)',
  paperhub_stat_code_label: '含代码比例',
  paperhub_stat_code_caption: '{count} 篇附带代码仓库',
  paperhub_stat_range_label: '收录时间范围',
  paperhub_stat_range_caption: '按最新 JSON 统计',
  paperhub_no_summary: '摘要即将上线，敬请期待。',
  paperhub_link_paper: '论文',
  paperhub_link_code: '代码',
  paperhub_link_project: '项目',
  paperhub_link_pdf: 'PDF',
  paperhub_milestone_overview_fallback: '尚未撰写概述，敬请期待。',
  paperhub_milestone_stat_total: '条目：{value}',
  paperhub_milestone_stat_milestone: '里程碑：{value}',
  paperhub_milestone_stat_bridge: '过渡：{value}',
  paperhub_milestone_stat_frontier: '前沿：{value}',
  paperhub_milestone_stat_survey: '综述：{value}',
  paperhub_milestone_updated: '更新：{value}',
  paperhub_milestone_updated_unknown: '更新：—',
  paperhub_milestone_btn_expand: '查看详情',
  paperhub_milestone_btn_loading: '加载中…',
  paperhub_milestone_btn_collapse: '收起',
  paperhub_milestone_btn_retry: '重试',
  paperhub_milestone_empty_detail: '尚未整理该任务的里程碑。',
  paperhub_lineage_prev: '前驱：{list}',
  paperhub_lineage_next: '后继：{list}',
  paperhub_badge_auto: '⚡ 自动',
  paperhub_badge_score: '评分',
  paperhub_badge_impact: '影响力',
  paperhub_badge_impact_title: '影响评分',
  paperhub_badge_repro: '复现性',
  paperhub_badge_repro_title: '复现评分',
  paperhub_badge_code: '代码',
  paperhub_badge_code_title: '包含代码仓库',
  paperhub_error_load_failed: '加载失败：{error}',
  
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
  module_ai_trends_title: 'AI 前沿要闻',
  module_ai_trends_desc: '精选全球AI领域最重要、最前沿的动态与资讯。',
  module_model_watch_title: 'AI 模型雷达',
  module_model_watch_desc: '把握AI模型发展的脉搏，追踪从开源到应用的最新动态与轨迹。',
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
  modelwatch_title: 'AI 模型雷达',
  modelwatch_desc: '把握AI模型发展的脉搏，追踪从开源到应用的最新动态与轨迹。',
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
  radar_top_label: 'Top 8 热度榜',
  radar_top_caption: '自动评估的最新 48 小时内关注度最高的 8 条资讯',
  radar_card_original: '阅读原文',
  radar_card_no_summary: '暂无摘要，点击“阅读原文”了解详情。',
  radar_badge_original: '原文',
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
  module_paperhub_desc: 'From breakthroughs to foundations — explore the evolution of AI research in one place.',
  module_paperhub_name: '🧠 AI Paper Hub · AI 论文中心 · Centro de Investigación AI',
  paperhub_page_title: 'AI Paper Hub · Fan Wan',
  paperhub_meta_description: 'AI Paper Hub: From breakthroughs to foundations — explore the evolution of AI research in one place.',
  paperhub_meta_og_alt: 'AI Paper Hub cover',
  paperhub_hero_title: 'AI Paper Hub',
  paperhub_hero_subtitle: 'From breakthroughs to foundations — explore the evolution of AI research in one place.',
  paperhub_tab_highlights: 'Highlights',
  paperhub_tab_milestones: 'AI Evolution Trail',
  paperhub_chip_highlight_aria: 'Quick filters',
  paperhub_chip_milestone_aria: 'Task tag filters',
  paperhub_search_highlight_placeholder: 'Search titles, tags, or summaries',
  paperhub_search_highlight_aria: 'Search the latest papers',
  paperhub_search_milestone_placeholder: 'Search tasks or keywords',
  paperhub_search_milestone_aria: 'Search tasks',
  paperhub_loading_highlights: 'Loading daily highlights…',
  paperhub_loading_milestones: 'Loading milestone index…',
  paperhub_empty_highlight: 'No papers matched your filters. Try different keywords.',
  paperhub_empty_milestone: 'No tasks matched your filters. Try different keywords.',
  paperhub_stat_highlight_label: 'Daily highlight count',
  paperhub_stat_highlight_caption: 'Recorded entries',
  paperhub_stat_impact_label: 'Average impact score',
  paperhub_stat_impact_caption: 'Impact Score (0-100)',
  paperhub_stat_code_label: 'With code repositories',
  paperhub_stat_code_caption: '{count} entries include code repositories',
  paperhub_stat_range_label: 'Date range',
  paperhub_stat_range_caption: 'Based on latest JSON',
  paperhub_no_summary: 'Summary coming soon.',
  paperhub_link_paper: 'Paper',
  paperhub_link_code: 'Code',
  paperhub_link_project: 'Project',
  paperhub_link_pdf: 'PDF',
  paperhub_milestone_overview_fallback: 'Overview in progress — check back soon.',
  paperhub_milestone_stat_total: 'Entries: {value}',
  paperhub_milestone_stat_milestone: 'Milestones: {value}',
  paperhub_milestone_stat_bridge: 'Bridges: {value}',
  paperhub_milestone_stat_frontier: 'Frontiers: {value}',
  paperhub_milestone_stat_survey: 'Surveys: {value}',
  paperhub_milestone_updated: 'Updated: {value}',
  paperhub_milestone_updated_unknown: 'Updated: —',
  paperhub_milestone_btn_expand: 'View details',
  paperhub_milestone_btn_loading: 'Loading…',
  paperhub_milestone_btn_collapse: 'Collapse',
  paperhub_milestone_btn_retry: 'Retry',
  paperhub_milestone_empty_detail: 'Milestones are being curated — check back soon.',
  paperhub_lineage_prev: 'Predecessors: {list}',
  paperhub_lineage_next: 'Successors: {list}',
  paperhub_badge_auto: '⚡ Auto',
  paperhub_badge_score: 'Score',
  paperhub_badge_impact: 'Impact',
  paperhub_badge_impact_title: 'Impact score',
  paperhub_badge_repro: 'Repro',
  paperhub_badge_repro_title: 'Reproducibility score',
  paperhub_badge_code: 'Code',
  paperhub_badge_code_title: 'Includes code repository',
  paperhub_error_load_failed: 'Failed to load: {error}',
  
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
  module_ai_trends_title: 'AI Frontier Briefing',
  module_ai_trends_desc: 'Curated selection of the most critical and cutting-edge developments in AI.',
  module_model_watch_title: 'AI Model Radar',
  module_model_watch_desc: 'Capture the pulse of AI development. Track the journey of models and tools from open source to production.',
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
  modelwatch_title: 'AI Model Radar',
  modelwatch_desc: 'Capture the pulse of AI development. Track the journey of models and tools from open source to production.',
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
  radar_top_label: 'Top 8 Highlights',
  radar_top_caption: 'Eight stories with the strongest momentum in the past 48 hours.',
  radar_card_original: 'Read original',
  radar_card_no_summary: 'No summary yet—open the original to learn more.',
  radar_badge_original: 'Original',
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
  module_paperhub_title: 'Centro de Investigación AI',
  module_paperhub_desc: 'De los avances más recientes a los fundamentos clásicos: una visión completa de la investigación en IA.',
  module_paperhub_name: '🧠 Centro de Investigación AI · AI 论文中心 · AI Paper Hub',
  paperhub_page_title: 'Centro de Investigación AI · Fan Wan',
  paperhub_meta_description: 'Centro de Investigación AI: De los avances más recientes a los fundamentos clásicos, una visión completa de la investigación en IA.',
  paperhub_meta_og_alt: 'Portada del Centro de Investigación AI',
  paperhub_hero_title: 'Centro de Investigación AI',
  paperhub_hero_subtitle: 'De los avances más recientes a los fundamentos clásicos: una visión completa de la investigación en IA.',
  paperhub_tab_highlights: 'Destacados',
  paperhub_tab_milestones: 'Ruta de la Evolución IA',
  paperhub_chip_highlight_aria: 'Filtros rápidos',
  paperhub_chip_milestone_aria: 'Filtros de etiquetas de tareas',
  paperhub_search_highlight_placeholder: 'Buscar títulos, etiquetas o resúmenes',
  paperhub_search_highlight_aria: 'Buscar los artículos más recientes',
  paperhub_search_milestone_placeholder: 'Buscar tareas o palabras clave',
  paperhub_search_milestone_aria: 'Buscar tareas',
  paperhub_loading_highlights: 'Cargando destacados diarios…',
  paperhub_loading_milestones: 'Cargando índice de hitos…',
  paperhub_empty_highlight: 'No hay artículos que coincidan. Prueba con otros términos.',
  paperhub_empty_milestone: 'No hay tareas que coincidan. Prueba con otros términos.',
  paperhub_stat_highlight_label: 'Conteo de destacados diarios',
  paperhub_stat_highlight_caption: 'Entradas registradas',
  paperhub_stat_impact_label: 'Puntaje de impacto promedio',
  paperhub_stat_impact_caption: 'Puntaje de impacto (0-100)',
  paperhub_stat_code_label: 'Con repositorios de código',
  paperhub_stat_code_caption: '{count} entradas incluyen repositorios de código',
  paperhub_stat_range_label: 'Rango de fechas',
  paperhub_stat_range_caption: 'Basado en el último JSON',
  paperhub_no_summary: 'Resumen disponible pronto.',
  paperhub_link_paper: 'Artículo',
  paperhub_link_code: 'Código',
  paperhub_link_project: 'Proyecto',
  paperhub_link_pdf: 'PDF',
  paperhub_milestone_overview_fallback: 'Resumen en preparación — vuelve pronto.',
  paperhub_milestone_stat_total: 'Entradas: {value}',
  paperhub_milestone_stat_milestone: 'Hitos: {value}',
  paperhub_milestone_stat_bridge: 'Puentes: {value}',
  paperhub_milestone_stat_frontier: 'Fronteras: {value}',
  paperhub_milestone_stat_survey: 'Reseñas: {value}',
  paperhub_milestone_updated: 'Actualizado: {value}',
  paperhub_milestone_updated_unknown: 'Actualizado: —',
  paperhub_milestone_btn_expand: 'Ver detalles',
  paperhub_milestone_btn_loading: 'Cargando…',
  paperhub_milestone_btn_collapse: 'Contraer',
  paperhub_milestone_btn_retry: 'Reintentar',
  paperhub_milestone_empty_detail: 'Los hitos se están curando — vuelve pronto.',
  paperhub_lineage_prev: 'Predecesores: {list}',
  paperhub_lineage_next: 'Sucesores: {list}',
  paperhub_badge_auto: '⚡ Automático',
  paperhub_badge_score: 'Puntaje',
  paperhub_badge_impact: 'Impacto',
  paperhub_badge_impact_title: 'Puntaje de impacto',
  paperhub_badge_repro: 'Repro',
  paperhub_badge_repro_title: 'Puntaje de reproducibilidad',
  paperhub_badge_code: 'Código',
  paperhub_badge_code_title: 'Incluye repositorio de código',
  paperhub_error_load_failed: 'No se pudo cargar: {error}',
  
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
  module_ai_trends_title: 'Resumen de la Vanguardia IA',
  module_ai_trends_desc: 'Selección de los desarrollos más cruciales y avanzados en Inteligencia Artificial.',
  module_model_watch_title: 'Radar de Modelos de IA',
  module_model_watch_desc: 'Capta el pulso del desarrollo de IA. Rastrea la trayectoria de modelos y herramientas, desde código abierto hasta producción.',
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
  modelwatch_title: 'Radar de Modelos de IA',
  modelwatch_desc: 'Capta el pulso del desarrollo de IA. Rastrea la trayectoria de modelos y herramientas, desde código abierto hasta producción.',
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
  radar_top_label: 'Top 8 Destacados',
  radar_top_caption: 'Ocho historias con mayor impulso en las últimas 48 horas.',
  radar_card_original: 'Ver original',
  radar_card_no_summary: 'Sin resumen todavía; abre el original para saber más.',
  radar_badge_original: 'Original',
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
    const mode = safeStorageGet('theme', 'system');
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
    const cur = resolveLang('en');
    if (labelEl) labelEl.textContent = `Language` + (map[cur] ? ` · ${map[cur]}` : '');
    else langBtn.textContent = `Language` + (map[cur] ? ` · ${map[cur]}` : '');
  }

  // Notify others that language changed (for components needing rerender)
  try { window.dispatchEvent(new CustomEvent('language-changed', { detail: { lang } })); } catch {}
}

document.addEventListener('DOMContentLoaded', () => {
  const langSelect = document.getElementById('lang-select');
  // Prefer user's saved choice, else the document's declared language, else zh
  const defaultLang = resolveLang();
  // Expose for other scripts
  try { window.translations = translations; } catch {}
  translatePage(defaultLang);
  if (langSelect) {
    langSelect.value = defaultLang;
    langSelect.addEventListener('change', () => {
      const selected = langSelect.value;
      safeStorageSet('lang', selected);
      translatePage(selected);
    });
  }
});