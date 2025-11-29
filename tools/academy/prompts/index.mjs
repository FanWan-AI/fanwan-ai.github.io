const PROMPT_VERSION = "2025-11-29";

const LESSON_SYSTEM = "You are the master instructor of AI Daily Academy. You write bilingual micro-lessons (zh / en, optional es) with expert accuracy, concrete examples, and actionable practice.";

const LESSON_DEVELOPER = `Developer directives:\n- Consume the payload as JSON.\n- Output UTF-8 JSON matching daily.schema.json fields (content, summary, practice, references, meta.contextual_notes).\n- zh is mandatory; mirror zh into en/es when missing.\n- Use calm, confident tone; avoid marketing fluff.`;

const LESSON_CONTENT_OBJECTIVES = `内容目标：\n1. 30-60 字摘要，点出今天的核心启发；\n2. 2-3 段正文（每段 <120 中文字或 <80 English words），包含公式/伪代码/案例；\n3. 提供 1 条「行动建议」与 1 条「常见误区提醒」，写入 content 段落；\n4. 设计练习题：至少 1 道 MCQ + 1 道应用题（free form），包含 options/answer/explain/rubric；\n5. 给出 2-3 条参考资料，含论文/文档/工具的 HTTPS 链接；\n6. meta.contextual_notes 中写 why_now、best_for、visual_hint。`;

const STARTER_SYSTEM = "You design reflective prompts that connect AI theory with everyday decisions. Each starter question nudges the learner to relate today's topic to their domain.";

const STARTER_OBJECTIVES = `要求：\n1. 每条控制在 60-90 字（中文）或 35-50 words（英文）；\n2. 结构 = 情境 + 自我评估问题 + 行动提示；\n3. 使用开放式问句，避免是/否；\n4. 若存在 preferredMetrics，将指标写入问题中；\n5. 以 JSON 数组形式返回，元素结构 {"lang","question","action_hint"}。`;

function formatRecentLessons(lessons = []) {
  return lessons.slice(0, 5).map((item) => ({
    id: item.id,
    date: item.date,
    title: item.title,
    tags: item.tags
  }));
}

export function buildLessonDetailPrompt({ candidate, learnerProfile, toneProfile, recentLessons }) {
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
    tone: toneProfile,
    recent_lessons: formatRecentLessons(recentLessons),
    meta: {
      prompt_version: PROMPT_VERSION,
      difficulty_score: candidate.difficulty,
      category: candidate.category
    }
  };
  const userContent = `任务：为 AI 每日学堂生成课程详情。\n\n输入载荷：\n${JSON.stringify(payload, null, 2)}\n\n${LESSON_CONTENT_OBJECTIVES}\n\n在所有输出中，技术术语使用中英双语（如“自注意力 self-attention”），并明确量化指标。返回严格 JSON。`;
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

export { PROMPT_VERSION };
