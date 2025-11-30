const PROMPT_VERSION = "2025-11-30";

const LESSON_SYSTEM = "You are the master instructor of AI Daily Academy. You write bilingual multi-section lessons (zh / en, optional es) with expert accuracy, concrete examples, tooling guidance, and high-agency practice.";

const LESSON_DEVELOPER = `Developer directives:\n- Consume the payload as JSON.\n- Output UTF-8 JSON matching daily.schema.json fields (content, summary, practice, references, meta.contextual_notes).\n- zh is mandatory; mirror zh into en/es when missing.\n- Use calm, confident tone; avoid marketing fluff.`;

const BLUEPRINT_SYSTEM = "You are a curriculum architect for AI Daily Academy. You design exhaustive outlines before any prose is written.";

const BLUEPRINT_OBJECTIVES = `请基于输入构建课程蓝图（JSON），用于后续扩写：\n1. sections: 4 节以内，根据 topic.category / level 匹配模板（可从「概念诊断」「案例飞轮」「推导演练」「实践冲刺」「架构拆解」中选择或自定义），每节必须包含 {"id","title","angle","pain_signal","key_questions","case","metrics","tools","steps","worked_example"}；其中 pain_signal 写真实业务痛点，case 要交代主体/场景/结果，worked_example 需列出 1 个含具体数字/矩阵/代码片段的示例，metrics 必须引用 preferredMetrics 或新增可计算指标，tools 至少给出一个可公开查阅的论文/项目/产品（若真缺则写“敬请期待”并解释用途）。\n2. practice_suite: 至少 4 题（1 道 MCQ + 1 道 multi-step + 1 道 input + 任选题型），每题包含 {"type","prompt","steps","options","answer","explain","data_asset"}，并显式描述多步操作；MCQ 至少给 4 个选项，multi 至少给 3 个选项且 answer 使用索引数组，input 提供评分要点作为 answer，data_asset 应描述题目引用的数据/公式/情境。\n3. reference_pool: 3-5 条真实 HTTPS 公开来源 + 8-12 字 note，禁止 example.com/占位符/失效链接，如无法确认请不要臆造。\n4. toolkit: 2-3 个可操作工具或模板下载提示，每项 {"name","url","usage"}；若暂缺真实链接写“敬请期待”并解释用途。\n5. contextual_hooks: why_now / best_for / visual_hint，结合候选人画像说明紧迫性。`;

const LESSON_CONTENT_OBJECTIVES = `扩写要求：\n1. content.zh 必须使用 4 个 <h3> 子标题对应：①痛点与直觉 ②推导演练 ③工具与评估 ④实践冲刺；每节 110-160 中文字（或 70-110 English words），结构包含：开头 1 句描述真实业务/数据痛点（含具体数字或百分比）、至少 1 个公式/矩阵/伪代码块（用 <pre><code> 或 <table> 呈现），以及 3 步可执行清单（<ol> 或 <ul>）。\n2. 至少一节需要给出完整的 worked example：展示具体矩阵/数据、逐步计算过程、最终数值结果；若 topics 偏业务，则给出 A/B 实验或 KPI 计算示例。\n3. summary 30-60 字，突出可量化结果或对比洞察。\n4. practice 数组需严格沿用 blueprint.practice_suite，至少 4 题：包含 >=1 道 MCQ、>=1 道 multi、>=1 道 input；MCQ/multi 必须提供 >=4 / >=3 个 options，answer 只能使用与 options 对齐的索引或索引数组，input 题 answer 填评分 rubric；至少 1 道题引用题干中的数据表/矩阵/公式并要求学习者算数；explain 给出评分要点与参考解法。\n5. references 只能来自 blueprint.reference_pool 的真实 HTTPS 链接；若模型无法确认真实性，应写“暂无公开参考（Internal insight）”且 url 为空。\n6. meta.contextual_notes 结合 blueprint.contextual_hooks，写出 why_now / best_for / visual_hint，且 visual_hint 需点出我们提供的 worked example 如何可视化。`;

const CRITIC_SYSTEM = "You are the lead reviewer of AI Daily Academy. You audit lessons for rigor, actionable depth, and assessment quality.";

const CRITIC_OBJECTIVES = `请审阅 lesson 与 blueprint/learner_profile 的匹配度，给出 JSON：\n{"revision_required": bool, "scorecard": {"structure":{"score":0-5,"notes":""},"accuracy":{"score":0-5,"notes":""},"depth":{"score":0-5,"notes":""},"practice":{"score":0-5,"notes":""},"references":{"score":0-5,"notes":""}}, "issues": [{"area":"content|practice|references|metrics|depth","severity":"high|medium|low","note":"问题描述","action":"建议"}], "strengths": ["亮点..."], "directives": ["按优先级列出需改进的明确 TODO"], "practice_expectations": {"min_questions":4,"required_types":["mcq","multi","input"],"require_data_driven":true}, "content_expectations": {"require_worked_example":true,"require_formula":true,"require_steps":true,"min_sections":4}}。若任意节缺少数字示例/公式/<pre><code>/步骤，必须将 revision_required 设为 true 并给出整改建议。若无问题，可设置 revision_required=false 且 issues 为空。`;

const REVISION_SYSTEM = "You are the master instructor revising the lesson after critique. You integrate all directives without losing prior strengths.";

const REVISION_OBJECTIVES = `依据 critique 逐项改进：\n- 必须满足 practice_expectations（题量、题型齐全，练习含数据或计算，附答案+解析）。\n- 逐节补齐 worked example、公式、步骤与指标，至少插入 1 个 <pre><code> 或 <table> 显示推导过程。\n- 若 references 被指摘，重选 blueprint.reference_pool 中未用资源，或声明 Internal insight。\n- 维持 summary/content 结构但可重写段落与指标，确保 4 节标题与要求一致。\n- 输出仍需符合 daily.schema.json。`;

const STARTER_SYSTEM = "You design reflective prompts that connect AI theory with everyday decisions. Each starter question nudges the learner to relate today's topic to their domain.";

const STARTER_OBJECTIVES = `要求：\n1. 每条控制在 60-90 字（中文）或 35-50 words（英文）；\n2. 结构 = 情境 + 自我评估问题 + 行动提示；\n3. 使用开放式问句，避免是/否；\n4. 若存在 preferredMetrics，将指标写入问题中；\n5. 以 JSON 数组形式返回，元素结构 {"lang","question","action_hint"}。`;

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
      required: ["summary", "content", "practice", "references", "meta"],
      properties: {
        summary: { type: ["object", "string"] },
        content: { type: "object" },
        practice: { type: "array", minItems: 4, items: { type: "object" } },
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

export {
  PROMPT_VERSION,
  BLUEPRINT_RESPONSE_FORMAT,
  LESSON_RESPONSE_FORMAT,
  CRITIQUE_RESPONSE_FORMAT
};
