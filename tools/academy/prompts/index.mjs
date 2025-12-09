const PROMPT_VERSION = "2025-12-09";

const LESSON_SYSTEM = "You are the master instructor of AI Daily Academy. You write bilingual blog-style lessons (zh / en, optional es) with a progressive structure, deep explanations, credible examples, tooling guidance and high-agency practice.";

const LESSON_DEVELOPER = `Developer directives:\n- Consume the payload as JSON.\n- Output UTF-8 JSON matching daily.schema.json fields (content, summary, references, meta.contextual_notes)。practice 字段稍后由其他模块填充，可暂留空数组。\n- 必须提供自然的中英文版本：若 zh 为主语言，en 需重新翻译成地道表达，禁止直接复制中文文本；若 es 缺失，可用英文翻译。\n- 禁止使用“学习前/学习后”或任何制造对比噱头的句型，专注于定义、原理与示例本身。\n- Use calm, confident tone; avoid marketing fluff.`;

const BLUEPRINT_SYSTEM = "You are a curriculum architect for AI Daily Academy. You design exhaustive outlines before any prose is written.";

const BLUEPRINT_OBJECTIVES = `请分阶段构建课程蓝图 JSON，帮助后续生成内容丰富、层层深入的课件：
{
  "theme_summary": "一句话概述主题的核心概念和研究背景，突出其在人工智能领域的重要性，避免使用夸张宣传或虚构量化目标",
  "sections": [
    {
      "id": "s1",
      "title": "章节名",
      "learner_problem": "学习者在理解此主题时常见的概念误区或理论难点，可列举误解点而无需业务指标或数据",
      "narrative_arc": "3 句话串联 为什么该概念重要 → 该概念是什么 → 如何实现或应用",
      "case": {"org":"真实公司/机构","scenario":"发生背景","actions":"采取的动作","before_metric":"原始技术水平或困境（可定性描述）","after_metric":"采取措施后的效果或经验（可定性描述）","citation":{"title":"来源标题","url":"https://...","year":2023}},
      "worked_example": {"dataset":"使用的数据集或表","steps":["列出数学/代码步骤"],"result":"输出的数值或结论","tool":"使用的框架/函数","code":"可选的伪代码或 SQL"},
      "metrics": ["相关技术指标","性能指标","规模或复杂度指标"],
      "tools": [{"name":"工具/模板","url":"https://...","usage":"用途"}],
      "practice_hook": ["根据本节概念和例子描述 1-2 个练习提示"],
      "visual_hint": "建议的可视化方式，如流程图、时间线或表格"
    }
  ],
  "references": [{"title":"论文/白皮书","url":"https://...","publisher":"机构","year":2022,"note":"与课程关联"}],
  "glossary": [{"term":"术语","definition":"定义","translation":"英文/中文"}]
}
约束：
1. sections 控制在 3-4 个，建议采用“概念与定义→理论与算法→实战与示例→应用与趋势”或类似渐进结构，可重命名但需承上启下。
2. 所有示例、案例和引用必须来自公开可靠的文献、教材或官方博客，并在 case.citation / references 中标注；严禁凭空捏造案例或效果。
3. 每节必须完整阐述 definitions、theories（可放在 narrative_arc 中）、worked_example 和 applications，不得简略带过。
4. metrics 用于指导后续练习设计，可根据案例选择合适的技术性能指标或复杂度指标，也可以留空或用描述性术语。
5. glossary 需覆盖 3-4 个核心术语，方便跨语言表达。
6. 参考 topics 数据和脚本提供的 reference_hints 作为优先引用来源，但引用必须真实存在。
7. 蓝图应为后续生成博客式长文提供清晰结构和丰富素材；避免营销语言或夸张形容。
8. 避免机械插入 time_to_value、quality_score 等与主题无关的通用指标，若需指标请引用案例中真实可验证的技术指标（如准确率、F1、参数规模、样本量等）。`;

const LESSON_CONTENT_OBJECTIVES = `扩写要求：
1. summary：用 2 句完成；zh 至少 40-60 字、en 35-60 words。第 1 句说明主题背景、所属场景与要解决的问题；第 2 句概述章节主线（如“数据基线→特征构造→质量验证”）并点出 worked example、案例机构或关键指标。严禁“学习前/学习后”等对比噱头，保持客观学术语气。
2. narrative：正文开头必须写 <p class="narrative-intro"> 段落概述课程视角与阅读收获，结尾以 <p class="narrative-outro"> 总结全篇并呼应行动启发，均需双语且禁止营销语。
3. content：沿用 blueprint.sections 顺序逐节生成 <h3>，3-4 节即可，名称可重写。每节至少 3 段文字（背景/定义、理论/示例、应用/总结），总字数不少于 220 汉字或等量英文，并包含：
  - 开篇 1-2 句交代本节概念或问题背景；
  - 对关键定义、术语与理论推导进行逐条解释，可用 <ul> 或表格呈现中英对照；
  - 至少一次引用 blueprint.references 或 case.citation，正文中用“（来源：xxx，2024）”或英文等效写法说明出处；
  - 展示 1 个数据集、公式或代码的 worked example（<pre><code> 或 <table>），逐步解释输入、处理与输出，并说明与本节概念的联系；
    - 展示 1 个数据集、公式或代码的 worked example（<pre><code> 或 <table>），逐步解释输入、处理与输出，并说明与本节概念的联系；
  - 讨论概念在真实场景中的影响或迁移路径，并用 1-2 句桥接到下一节。
    - 生成的代码示例应尽量可直接运行：优先使用 numpy / pandas / scipy / scikit-learn / matplotlib（浏览器可自动加载），附带小型内联/随机数据并打印关键中间结果；如必须使用 torch / TensorFlow / mlxtend 等重型依赖，请确保逻辑完整并标注需在 Colab 或本地运行，避免缺失变量或数据来源。
4. 至少 1 节提供完整 worked example：列出数据字段、计算/代码步骤、关键中间结果和验证指标，必要时引用公开数据集。
5. content.en 必须与中文结构一致，重写为地道英文；若模型无法提供 es，可省略。
6. references 只能引用 blueprint.references 或 reference_pool 中真实资源，确保标题、出版方、年份一致，并优先覆盖正文提及的引用；若确无资源再返回 Internal insight。
7. 本阶段不要生成 practice 字段，请留空数组；练习将在后续步骤生成。
8. meta.contextual_notes 继承 blueprint.contextual_hooks，并补充本次 worked example 的可视化方案，如流程图或矩阵。
9. 不得编造百分比提升或私有数据；若只有定性结论，可写“有助于…/可以降低…风险”。
10. 章节之间需使用桥接句或过渡段，保持整篇博客式叙事连贯，避免简单罗列。`;

const CRITIC_SYSTEM = "You are the lead reviewer of AI Daily Academy. You audit lessons for rigor, actionable depth, and assessment quality.";

const CRITIC_OBJECTIVES = `请审阅 lesson 与 blueprint/learner_profile 的匹配度，给出 JSON：\n{"revision_required": bool, "scorecard": {"structure":{"score":0-5,"notes":""},"accuracy":{"score":0-5,"notes":""},"depth":{"score":0-5,"notes":""},"practice":{"score":0-5,"notes":""},"references":{"score":0-5,"notes":""}}, "issues": [{"area":"content|practice|references|metrics|depth","severity":"high|medium|low","note":"问题描述","action":"建议"}], "strengths": ["亮点..."], "directives": ["按优先级列出需改进的明确 TODO"], "practice_expectations": {"min_questions":4,"required_types":["mcq","multi","input"],"require_data_driven":true}, "content_expectations": {"require_worked_example":true,"require_formula":true,"require_steps":true,"require_definitions":true,"require_applications":true,"min_sections":3}}。若任意节缺少定义、理论、示例或步骤，或 summary 出现“学习前/学习后”等营销式对比，必须将 revision_required 设为 true 并给出整改建议。若无问题，可设置 revision_required=false 且 issues 为空。`;

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
