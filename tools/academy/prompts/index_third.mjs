const PROMPT_VERSION = "2025-11-30";

const LESSON_SYSTEM = "You are the master instructor of AI Daily Academy. You write bilingual multi-section lessons (zh / en, optional es) with expert accuracy, concrete examples, tooling guidance, and high-agency practice.";

const LESSON_DEVELOPER = `Developer directives:\n- Consume the payload as JSON.\n- Output UTF-8 JSON matching daily.schema.json fields (content, summary, references, meta.contextual_notes)。practice 字段稍后由其他模块填充，可暂留空数组。\n- 必须提供自然的中英文版本：若 zh 为主语言，en 需重新翻译成地道表达，禁止直接复制中文文本；若 es 缺失，可用英文翻译。\n- Use calm, confident tone; avoid marketing fluff.`;

const BLUEPRINT_SYSTEM = "You are a curriculum architect for AI Daily Academy. You design exhaustive outlines before any prose is written.";

const BLUEPRINT_OBJECTIVES = `请分阶段构建课程蓝图 JSON，帮助后续生成具有故事线的课件：\n{
  "theme_summary": "一句话说明主题的现实意义，可参考公开研究或行业报告中的结论；如无可靠数据，请用定性描述替代，不要编造指标",
  "sections": [
    {
      "id": "s1",
      "title": "章节名",
      "learner_problem": "学员当下面临的业务痛点，写明数据或指标",
      "narrative_arc": "3 句话串联 why → what → how 的故事线",
      "case": {"org":"真实公司/机构","scenario":"发生背景","actions":"采取的动作","before_metric":"原始指标及数值","after_metric":"改进后指标及数值","citation":{"title":"来源标题","url":"https://...","year":2023}},
      "worked_example": {"dataset":"使用的数据集或表","steps":["列出数学/代码步骤"],"result":"输出的数值/结论","tool":"使用的框架/函数","code":"可选的伪代码或 SQL"},
      "metrics": ["相关性能指标或质量指标","效率或成本指标","其它可定义指标"],
      "tools": [{"name":"工具/模板","url":"https://...","usage":"用途"}],
      "practice_hook": ["根据本节可考察的技能点描述 1-2 个题干提示"],
      "visual_hint": "建议的可视化方式"
    }
  ],
  "references": [{"title":"论文/白皮书","url":"https://...","publisher":"机构","year":2022,"note":"与课程关联"}],
  "glossary": [{"term":"术语","definition":"定义","translation":"英文/中文"}]
}
约束：
1. sections 控制在 3-4 个，按“痛点→推导→工具→实战”自然推进，可重命名但需体现承上启下。
2. 所有数字、案例、引用必须来自真实可公开验证的资料，并在 case.citation / references 中标注；禁止凭空捏造指标或夸大的百分比提升，如无公开数据可说明提升幅度时，请以定性描述替代。
3. 至少选择一个可复现的数据集或代码片段作为 worked_example 基础，写明具体字段与期望输出，优先使用公开数据集（如 Iris、MNIST、CIFAR-10 等）。
4. 各节 practice_hook 要与章节内容强关联，便于后续出题。
5. glossary 需覆盖 2-3 个核心术语，方便跨语言表达。
6. 如 topics 数据或生成脚本已提供 reference hints（推荐文献），请优先引用这些来源，并在 case.citation / references 中准确标注。`;

const LESSON_CONTENT_OBJECTIVES = `扩写要求：
1. summary：zh 需 40-60 字、en 35-60 words，突出“学习前 → 学习后”的变化；若不存在可靠的量化指标，可用“之前不理解、之后理解”等定性描述，并在 en 中自然翻译，避免直译。
2. content：沿用 blueprint.sections 的顺序逐节生成 <h3>，但允许 3-4 节，名称可重写。每节须包含：
   - 开篇 1 句描绘业务情境与指标痛点（引用 blueprint.case.citation）；
   - 由“痛点→策略→结果”组成的 2-3 句叙事，形成清晰故事线；
   - 至少 1 个公式、矩阵或代码片段，来自 worked_example（使用 <pre><code> 或 <table>）；
   - 一个 <ol> 或 <ul> 的三步执行计划，显式写出如何追踪本节中提到的性能或业务指标（如准确率、召回率、F1 值、延迟等），若无可量化指标则用定性描述；
   - 与 references 对应的 "[引用标题]" 标记，帮助读者查阅。
3. 至少 1 节需完整演示 worked example：列出数据字段、计算步骤和最终结果，可包含简单 Python/SQL，并解释结果与业务痛点的关系。
4. content.en 必须是流畅英文，允许与中文结构相同但措辞自然；若模型无法提供 es，可省略。
5. references 只能引用 blueprint.references，保持标题、出版年份一致；若确无真实来源则返回 Internal insight。严禁新增虚构参考资料。
6. 本阶段不要生成 practice，留给后续步骤完成；若字段不可避免，请设为空数组。
7. meta.contextual_notes 继承 blueprint.contextual_hooks，同时说明本次 worked example 可视化方式（如血缘图/折线图等）。
8. 在所有叙述和公式中，如果没有可信数据支撑，请不要编造数值或百分比提升，可用“显著提高”“明显减少”等描述。
9. 每个章节之间应有自然过渡，上一节的结论应引出下一节的问题或方法，形成连贯的学习旅程。`;

const CRITIC_SYSTEM = "You are the lead reviewer of AI Daily Academy. You audit lessons for rigor, actionable depth, and assessment quality.";

const CRITIC_OBJECTIVES = `请审阅 lesson 与 blueprint/learner_profile 的匹配度，给出 JSON：\n{"revision_required": bool, "scorecard": {"structure":{"score":0-5,"notes":""},"accuracy":{"score":0-5,"notes":""},"depth":{"score":0-5,"notes":""},"practice":{"score":0-5,"notes":""},"references":{"score":0-5,"notes":""}}, "issues": [{"area":"content|practice|references|metrics|depth","severity":"high|medium|low","note":"问题描述","action":"建议"}], "strengths": ["亮点..."], "directives": ["按优先级列出需改进的明确 TODO"], "practice_expectations": {"min_questions":4,"required_types":["mcq","multi","input"],"require_data_driven":true}, "content_expectations": {"require_worked_example":true,"require_formula":true,"require_steps":true,"min_sections":4}}。若任意节缺少数字示例/公式/<pre><code>/步骤，必须将 revision_required 设为 true 并给出整改建议。若无问题，可设置 revision_required=false 且 issues 为空。`;

const REVISION_SYSTEM = "You are the master instructor revising the lesson after critique. You integrate all directives without losing prior strengths.";

const REVISION_OBJECTIVES = `依据 critique 逐项改进：\n- 必须满足 practice_expectations（题量、题型齐全，练习含数据或计算，附答案+解析）。\n- 逐节补齐 worked example、公式、步骤与指标，至少插入 1 个 <pre><code> 或 <table> 显示推导过程。\n- 若 references 被指摘，重选 blueprint.reference_pool 中未用资源，或声明 Internal insight。\n- 维持 summary/content 结构但可重写段落与指标，确保 4 节标题与要求一致。\n- 输出仍需符合 daily.schema.json。`;

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
  const userContent = `任务：依据给定蓝图为 AI 每日学堂生成课程详情。\n\n输入载荷：\n${JSON.stringify(payload, null, 2)}\n\n${LESSON_CONTENT_OBJECTIVES}\n\n在所有输出中，技术术语使用中英双语（如“自注意力 self-attention”），并明确量化指标。返回严格 JSON，禁止额外文本。`;
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
