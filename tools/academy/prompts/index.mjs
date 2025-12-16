const PROMPT_VERSION = "2025-02-19";

const LESSON_SYSTEM = "You are the master instructor of AI Daily Academy. You write bilingual blog-style lessons (zh / en, optional es) with a progressive structure, deep explanations, credible examples, tooling guidance and high-agency practice.";

const LESSON_DEVELOPER = `Developer directives:\n- Consume the payload as JSON.\n- Output UTF-8 JSON matching daily.schema.json fields (content, summary, references, meta.contextual_notes)。practice 字段稍后由其他模块填充，可暂留空数组。\n- 必须提供自然的中英文版本：若 zh 为主语言，en 需重新翻译成地道表达，禁止直接复制中文文本；若 es 缺失，可用英文翻译。\n- 禁止使用“学习前/学习后”或任何制造对比噱头的句型，专注于定义、原理与示例本身。\n- Use calm, confident tone; avoid marketing fluff.`;

const BLUEPRINT_SYSTEM = "You are a curriculum architect for AI Daily Academy. You design exhaustive outlines before any prose is written.";

const BLUEPRINT_OBJECTIVES = `你是 AI Daily Academy 的课程蓝图架构师。目标：设计一篇“可当博客阅读”的深度课程，而不是模板化课件。

请输出 JSON 蓝图（不是 prose），用于后续扩写。输出结构：

{
  "theme_summary": "一句话概述主题的核心定义与重要性（客观、无噱头）",
  "audience_assumption": "读者画像与前置（如：AI工程入门者，会一点Python）",
  "depth_ladder": [
    {"level":"L0","goal":"建立直觉/动机"},
    {"level":"L1","goal":"给出严谨定义与边界"},
    {"level":"L2","goal":"解释机制/原理（含常见误区）"},
    {"level":"L3","goal":"把原理落到工程实践（含可复现流程）"}
  ],
  "sections": [
    {
      "id":"s1",
      "title":"章节名",
      "purpose":"本节要解决的核心问题（必须唯一、明确）",
      "teach_flow":[
        "从一个具体困惑切入（非业务指标）",
        "给出定义/边界（中英术语）",
        "用类比或反例澄清误区",
        "用一段过渡引到下一节"
      ],
      "definitions":[{"zh":"术语","en":"Term","note":"一句解释"}],
      "misconceptions":[{"myth":"误区","fix":"纠正方式"}],
      "mini_example":"文字版小例子（不写代码），包含输入→处理→输出",
      "bridge":"一句过渡句"
    }
  ],
  "worked_example_plan":{
    "goal":"贯穿全篇的一个综合示例目标（必须能离线/本地复现）",
    "data_source":"必须是内置/公开可得/可内联构造（如 sklearn.datasets.load_iris）",
    "single_code_budget":{
      "max_blocks":2,
      "block_purpose":[
        "Block A：数据→管线→训练→评估（综合示例）",
        "Block B：可选（如可视化/错误分析/版本记录）"
      ]
    },
    "steps":[
      "步骤1：数据检查（字段/分布/缺失）",
      "步骤2：可复现切分（random_state/stratify）",
      "步骤3：pipeline（预处理+模型）",
      "步骤4：指标与误差分析（accuracy + confusion matrix）",
      "步骤5：记录环境（版本/随机种子）"
    ],
    "expected_outputs":[
      "shape/columns/head",
      "class counts",
      "accuracy",
      "confusion matrix",
      "package versions"
    ]
  },
  "reference_plan_rules":{
    "in_text_citations_style":"正文引用采用（来源：Title, Year）或 (Source: Title, Year)",
    "closure_rule":"正文出现一次来源名，references 必须存在完全一致 title+url"
  },
  "references":[
    {"title":"...","url":"...","publisher":"...","year":202X,"note":"支撑哪一条关键论断"}
  ],
  "glossary":[
    {"term":"Reproducibility","translation":"可复现性","definition":"..."}
  ]
}

硬约束：
1) sections 只能 3-4 节，但必须对应 depth_ladder 的递进（从直觉→定义→机制→工程落地）。
2) 禁止虚构公司案例、百分比提升、内部数据；不确定的事实不要写。
3) worked_example_plan 的代码块预算 max_blocks=2，后续正文必须严格遵守。
4) references 必须真实存在且可访问；每条引用要能支撑正文关键结论。`;

const LESSON_CONTENT_OBJECTIVES = `你是 AI Daily Academy 的主讲导师。请生成“博客式深度课程长文”（读者真的能学会），输出为 daily.schema.json 所需字段（summary/content/references/meta/practice=[]）。

全局风格：
- 不是营销文案，是教学长文：解释充分、循序渐进、逻辑闭环。
- 禁止“学习前/学习后”等噱头句式。
- 中英双语必须纯净：en 不得包含任何中文字符；如果出现中文，视为失败需重写。
- 术语首次出现需中英并列，如“可复现性 reproducibility”。

结构与深度要求：
1) summary：中文 140-220 字；英文 70-110 words。允许 3-5 句。
   - 重点：给出主题定义 + 课程路线（由浅入深）+ 贯穿示例是什么（数据集/管线/评估）。
2) narrative-intro：必须像博客开篇，回答“这篇文章要解决什么困惑、你将获得什么能力”，避免模板感。
3) content：严格按 blueprint.sections 输出 3-4 个 <h3>。
   - 每节必须至少 5 段：①动机/困惑 ②严谨定义与边界 ③机制/原理（讲透，含误区纠正）④与贯穿示例的连接（解释将如何用示例验证）⑤小结+过渡桥接
   - 每节至少包含一个“误区→纠正”的小段落（可用 <blockquote> 或 <ul>），且与本节主题强相关。
   - 理论深度：必须解释“为什么这样做”，不仅是“怎么做”。必要时用简单公式/表格说明概念（允许 <table> 或行内公式文本），但不要堆公式。
4) narrative-outro：必须总结“方法论/迁移路径”：读者如何把今天的工作流迁移到自己的项目。

代码块预算（硬约束）：
- 全文最多允许 2 个 <pre><code> 代码块，且必须是“综合代码块”，覆盖 worked_example_plan 的关键步骤。
- 禁止每节都给碎代码；每节只做解释与铺垫，把动作集中在 1-2 个综合块中。
- 代码必须可直接运行：不得读取本地文件（如 iris.csv）；必须内联/内置数据；必须包含 import、数据定义、打印关键输出。
- 代码块之外可以给 1 个表格（如 pipeline 步骤表）辅助理解。

引用闭环（硬约束）：
- 正文中出现的任何来源（例如“scikit-learn User Guide”）都必须出现在 references 数组中，并保持 title 完全一致。
- references 至少 4 条，优先官方文档/教材/经典论文；不要虚构“2023 数据集报告”等不存在条目。

输出字段要求：
- practice：本阶段返回空数组 []。
- meta.contextual_notes：写清适合人群、阅读方式（建议先读哪节再跑代码）、可视化建议（流程图/误差分析矩阵）。
- 语言：zh/en 两套内容结构完全一致，但英文必须重新表达，不得直译。`;

const LESSON_CONTENT_ONLY_OBJECTIVES = `阶段 1（正文先行，不含代码）：
1. summary / narrative / content 必须完整闭合 HTML 标签，保持 3-4 节结构，每节至少 3 段，但禁止输出 <pre><code>、公式块或任何代码；worked example 只做文字层面的步骤描述，不写代码。
2. 文字中需保留将来插入代码的位置，使用自然过渡句，例如“下方代码演示…”但暂不插入代码块。
3. references 仍需返回，保持与正文一致；practice 字段留空数组。
4. 遇到长度限制时，优先保证 summary、各节收尾与过渡完整，不得截断句子或丢失闭合标签。
`;

const CRITIC_SYSTEM = "You are the lead reviewer of AI Daily Academy. You audit lessons for rigor, actionable depth, and assessment quality.";

const CRITIC_OBJECTIVES = `你是严苛总编，审计 lesson 是否达到“深度教学长文 + 少量综合代码块”。输出 JSON：
{
  "revision_required": bool,
  "issues":[{"severity":"high|medium|low","area":"bilingual|citations|runnability|depth|structure|code_budget","note":"...","action":"..."}],
  "directives":["按优先级列 TODO"]
}

硬性失败（任一条则 revision_required=true）：
1) en 字段出现任何中文字符（/[\u4e00-\u9fff]/）。
2) 正文出现“来源：X / Source: X”，但 references 中没有完全一致 title+url。
3) 任意代码块读取本地文件或未定义变量/缺 import，或不能独立运行。
4) <pre><code> 代码块超过 2 个（违反 code budget）。
5) 任一章节少于 5 段，或缺少“误区→纠正”，或缺少过渡桥接句（导致割裂）。
6) 理论深度不足：如果章节只是在罗列步骤/工具，而没有解释“为什么”，必须判为失败并指出缺失点。

若失败：必须给出可执行改法（例如：合并碎代码为一个 pipeline 综合块；增加机制解释段；补上误区纠正与反例；修复引用闭环等）。`;

const CODE_SYSTEM = "You are the code & hands-on editor for AI Daily Academy. You add concise, runnable snippets that align with the already-written narrative.";

const CODE_OBJECTIVES = `你是实操编辑。你只能为整篇文章补充最多 2 个“综合代码块”，而不是按章节碎片化补代码。

输出 JSON 数组（最多 2 项）：
[
  {"block_id":"A","purpose":"数据→训练→评估（pipeline）","zh":"<h4>代码块 A：...</h4><pre><code>...</code></pre>","en":"..."},
  {"block_id":"B","purpose":"可选：可视化/误差分析/版本记录","zh":"...","en":"..."}
]

硬约束：
1) 代码必须自洽可运行：使用 sklearn 内置数据集或内联 DataFrame；不得读取本地文件；必须打印关键输出。
2) 代码块必须覆盖 lesson 中承诺的 worked example 步骤；不要新增正文没讲的概念。
3) 不要重复正文段落，只补“可执行动作 + 输出解读”，解释每块 2-4 句即可。`;

const REVISION_SYSTEM = "You are the master instructor revising the lesson after critique. You integrate all directives without losing prior strengths.";

const REVISION_OBJECTIVES = `依据 critique 逐项改进：\n- 必须满足 practice_expectations（题量、题型齐全，练习含数据或计算，附答案+解析）。\n- 逐节补齐定义、理论阐述、worked example、公式和步骤，不需要添加人造指标，至少插入 1 个 <pre><code> 或 <table> 显示推导过程。\n- 若 references 被指摘，重选 blueprint.reference_pool 中未用资源，或声明 Internal insight。\n- 保持 summary 和 content 的整体结构，但可根据 critique 反馈重写段落和内容，确保各节标题与要求一致，增强连贯性和深度（建议 3-4 节）。\n- 输出仍需符合 daily.schema.json。`;

const STARTER_SYSTEM = "You design reflective prompts that connect AI theory with everyday decisions. Each starter question nudges the learner to relate today's topic to their domain.";

const STARTER_OBJECTIVES = `要求：\n1. 每条控制在 60-90 字（中文）或 35-50 words（英文）；\n2. 结构 = 情境 + 自我评估问题 + 行动提示；\n3. 使用开放式问句，避免是/否；\n4. 若存在 preferredMetrics，将指标写入问题中；\n5. 以 JSON 数组形式返回，元素结构 {"lang","question","action_hint"}。`;

const PRACTICE_SYSTEM = "You are the assessment architect for AI Daily Academy. You convert lesson narratives into rigorous, data-grounded exercises.";

const PRACTICE_OBJECTIVES = `依据给定 lesson & blueprint 生成至少 4 道练习题，覆盖 MCQ + multi + input（可额外添加实作题）。结构要求：
{
  "type": "mcq|multi|input|short",
  "source_section": "引用的章节 id 或标题",
  "question": {"zh":"题干，含多步指令与数据","en":"自然英文翻译"},
  "data_asset": "题目引用的数据表/公式/场景",
  "options": ["如为 MCQ/multi 至少 4/3 个选项"],
  "answer": "索引或索引数组，input 则写评分 rubric 或参考答案",
  "explain": {"zh":"解析含计算或推理","en":"英文解析"},
  "rubric": "评分要点，列出满分条件"
}
约束：
1. 至少 2 道题要求计算具体指标或解释代码输出，必须引用 lesson worked example 中的数字或表；如果正文中缺乏可靠数据，请设计基于公开数据集或公式的计算题，例如使用给定公式计算均值、准确率等。
2. 每道题都要指出 source_section，与正文保持一致。
3. 解析需说明为什么选项正确/错误，并引用参考章节或公式；如引用数据或结果，请标明来源或数据集。
4. 语言要求与正文一致（中英双语）。
5. 禁止使用通用占位题（如“总结本课重点”）；题目必须与课程内容紧密相关。`;

const BLUEPRINT_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "lessonBlueprint",
    schema: {
      type: "object",
      required: ["sections", "practice_suite", "reference_pool", "toolkit", "contextual_hooks"],
      properties: {
        sections: { type: "array", minItems: 3, items: { type: "object" } },
        practice_suite: { type: "array", minItems: 4, items: { type: "object" } },
        reference_pool: { type: "array", minItems: 3, items: { type: "object" } },
        toolkit: { type: "array", items: { type: "object" } },
        contextual_hooks: { type: "object" }
      },
      additionalProperties: true
    }
  }
};

const LESSON_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "lessonDetail",
    schema: {
      type: "object",
      required: ["summary", "content", "references", "meta"],
      properties: {
        summary: { type: ["object", "string"] },
        content: { type: "object" },
        practice: { type: "array", items: { type: "object" } },
        references: { type: "array", items: { type: "object" } },
        meta: { type: "object" }
      },
      additionalProperties: true
    }
  }
};

const CRITIQUE_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "lessonCritique",
    schema: {
      type: "object",
      required: ["revision_required", "scorecard", "issues", "directives", "practice_expectations"],
      properties: {
        revision_required: { type: "boolean" },
        scorecard: { type: "object" },
        issues: { type: "array" },
        directives: { type: "array" },
        practice_expectations: { type: "object" }
      },
      additionalProperties: true
    }
  }
};

export const CODE_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "lessonCodeAddendum",
    schema: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: {
        type: "object",
        required: ["block_id", "purpose", "zh", "en"],
        properties: {
          block_id: { type: "string" },
          purpose: { type: "string" },
          zh: { type: "string" },
          en: { type: "string" }
        },
        additionalProperties: true
      }
    }
  }
};

const PRACTICE_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "lessonPractice",
    schema: {
      type: "array",
      minItems: 4,
      items: {
        type: "object",
        required: ["type", "source_section", "question", "answer", "explain"],
        properties: {
          type: { type: "string" },
          source_section: { type: "string" },
          question: { type: "object" },
          data_asset: { type: ["string", "null"] },
          options: { type: "array", items: { type: ["string", "number"] } },
          answer: { type: ["string", "number", "array"] },
          explain: { type: "object" },
          rubric: { type: ["string", "null"] }
        },
        additionalProperties: true
      }
    }
  }
};

function formatRecentLessons(lessons = []) {
  return lessons.slice(0, 5).map((item) => ({
    id: item.id,
    date: item.date,
    title: item.title,
    tags: item.tags
  }));
}

export function buildLessonBlueprintPrompt({ candidate, learnerProfile, toneProfile, recentLessons }) {
  const payload = {
    topic: {
      name: candidate.title,
      category: candidate.category,
      level: candidate.level,
      tags: candidate.tags,
      learning_objectives: candidate.learningObjectives
    },
    learner_profile: learnerProfile,
    tone: toneProfile,
    preferred_metrics: learnerProfile.preferredMetrics,
    prerequisites: candidate.prerequisites || candidate.related || [],
    related_topics: candidate.related || [],
    difficulty: candidate.difficultyLabel,
    references: candidate.referenceHints || [],
    recent_lessons: formatRecentLessons(recentLessons)
  };
  const userContent = `请先输出课程蓝图供后续扩写。\n输入：\n${JSON.stringify(payload, null, 2)}\n\n${BLUEPRINT_OBJECTIVES}\n\n务必返回 JSON，禁止 Markdown 代码块。`;
  return [
    { role: "system", content: BLUEPRINT_SYSTEM },
    { role: "user", content: userContent }
  ];
}

export function buildLessonDetailPrompt({ candidate, learnerProfile, toneProfile, blueprint, recentLessons }) {
  const payload = {
    topic: {
      name: candidate.title,
      category: candidate.category,
      level: candidate.level,
      tags: candidate.tags,
      learning_objectives: candidate.learningObjectives
    },
    learner_profile: learnerProfile,
    prerequisites: candidate.prerequisites || candidate.related || [],
    related_topics: candidate.related || [],
    difficulty: candidate.difficultyLabel,
    references: candidate.referenceHints || [],
    blueprint,
    tone: toneProfile,
    recent_lessons: formatRecentLessons(recentLessons),
    meta: {
      prompt_version: PROMPT_VERSION,
      difficulty_score: candidate.difficulty,
      category: candidate.category
    }
  };
  const userContent = `任务：依据给定蓝图为 AI 每日学堂生成课程详情。\n\n输入载荷：\n${JSON.stringify(payload, null, 2)}\n\n${LESSON_CONTENT_OBJECTIVES}\n\n在所有输出中，技术术语需使用中英双语（如“自注意力 self-attention”），请专注于阐明概念和原理，无需编造量化指标。返回严格 JSON，禁止额外文本。`;
  return [
    { role: "system", content: LESSON_SYSTEM },
    { role: "user", content: `${LESSON_DEVELOPER}\n\n${userContent}` }
  ];
}

export function buildLessonContentPrompt({ candidate, learnerProfile, toneProfile, blueprint, recentLessons }) {
  const payload = {
    topic: {
      name: candidate.title,
      category: candidate.category,
      level: candidate.level,
      tags: candidate.tags,
      learning_objectives: candidate.learningObjectives
    },
    learner_profile: learnerProfile,
    prerequisites: candidate.prerequisites || candidate.related || [],
    related_topics: candidate.related || [],
    difficulty: candidate.difficultyLabel,
    references: candidate.referenceHints || [],
    blueprint,
    tone: toneProfile,
    recent_lessons: formatRecentLessons(recentLessons),
    meta: {
      prompt_version: PROMPT_VERSION,
      difficulty_score: candidate.difficulty,
      category: candidate.category
    }
  };
  const userContent = `任务：生成课程正文（含少量综合代码）。

输入载荷：
${JSON.stringify(payload, null, 2)}

${LESSON_CONTENT_OBJECTIVES}

在所有输出中，技术术语需使用中英双语（如“自注意力 self-attention”），禁止插入 Markdown 围栏。返回严格 JSON，禁止额外文本。`;
  return [
    { role: "system", content: LESSON_SYSTEM },
    { role: "user", content: `${LESSON_DEVELOPER}\n\n${userContent}` }
  ];
}

export function buildStarterPrompt({ candidate, learnerProfile, lessonSummary }) {
  const payload = {
    topic: candidate.title,
    category: candidate.category,
    learner_profile: learnerProfile,
    lesson_takeaway: lessonSummary,
    preferred_metrics: learnerProfile.preferredMetrics,
    prompt_version: PROMPT_VERSION
  };
  const userContent = `根据下列信息，输出 1-2 条「开始联系」问题：\n${JSON.stringify(payload, null, 2)}\n\n${STARTER_OBJECTIVES}`;
  return [
    { role: "system", content: STARTER_SYSTEM },
    { role: "user", content: userContent }
  ];
}

export function buildLessonCritiquePrompt({ candidate, learnerProfile, blueprint, lesson }) {
  const payload = {
    topic: {
      name: candidate.title,
      category: candidate.category,
      level: candidate.level,
      difficulty: candidate.difficultyLabel
    },
    learner_profile: learnerProfile,
    blueprint,
    lesson,
    preferred_metrics: learnerProfile.preferredMetrics,
    prompt_version: PROMPT_VERSION
  };
  const userContent = `请扮演 AI 学堂总编，对下列课程草稿做严格评审：\n${JSON.stringify(payload, null, 2)}\n\n${CRITIC_OBJECTIVES}`;
  return [
    { role: "system", content: CRITIC_SYSTEM },
    { role: "user", content: userContent }
  ];
}

export function buildCodeAddendumPrompt({ candidate, learnerProfile, blueprint, lesson }) {
  const payload = {
    topic: {
      name: candidate.title,
      category: candidate.category,
      level: candidate.level,
      difficulty: candidate.difficultyLabel
    },
    learner_profile: learnerProfile,
    blueprint_sections: blueprint?.sections || [],
    lesson_summary: lesson.summary,
    lesson_outline: lesson.content,
    preferred_metrics: learnerProfile.preferredMetrics,
    prompt_version: PROMPT_VERSION
  };
  const userContent = `请在不改写正文的基础上，为每个章节补充可运行的代码/公式示例，使用 JSON 返回：
${JSON.stringify(payload, null, 2)}

${CODE_OBJECTIVES}`;
  return [
    { role: "system", content: CODE_SYSTEM },
    { role: "user", content: userContent }
  ];
}

export function buildLessonRevisionPrompt({ candidate, learnerProfile, toneProfile, blueprint, lesson, critique, recentLessons }) {
  const payload = {
    topic: {
      name: candidate.title,
      category: candidate.category,
      level: candidate.level,
      difficulty: candidate.difficultyLabel
    },
    learner_profile: learnerProfile,
    tone: toneProfile,
    blueprint,
    critique,
    previous_lesson: lesson,
    recent_lessons: formatRecentLessons(recentLessons),
    preferred_metrics: learnerProfile.preferredMetrics,
    prompt_version: PROMPT_VERSION
  };
  const userContent = `根据下面的 critique，重新生成改进后的课程 JSON：\n${JSON.stringify(payload, null, 2)}\n\n${LESSON_CONTENT_OBJECTIVES}\n\n${REVISION_OBJECTIVES}`;
  return [
    { role: "system", content: REVISION_SYSTEM },
    { role: "user", content: `${LESSON_DEVELOPER}\n\n${userContent}` }
  ];
}

export function buildPracticePrompt({ candidate, learnerProfile, blueprint, lesson }) {
  const payload = {
    topic: {
      name: candidate.title,
      category: candidate.category,
      level: candidate.level
    },
    learner_profile: learnerProfile,
    blueprint_sections: blueprint?.sections || [],
    lesson_extract: {
      summary: lesson.summary,
      content: lesson.content,
      references: lesson.references
    },
    preferred_metrics: learnerProfile.preferredMetrics,
    prompt_version: PROMPT_VERSION
  };
  const userContent = `根据课程正文生成高质量练习题：\n${JSON.stringify(payload, null, 2)}\n\n${PRACTICE_OBJECTIVES}`;
  return [
    { role: "system", content: PRACTICE_SYSTEM },
    { role: "user", content: userContent }
  ];
}

export {
  PROMPT_VERSION,
  BLUEPRINT_RESPONSE_FORMAT,
  LESSON_RESPONSE_FORMAT,
  CRITIQUE_RESPONSE_FORMAT,
  PRACTICE_RESPONSE_FORMAT
};
