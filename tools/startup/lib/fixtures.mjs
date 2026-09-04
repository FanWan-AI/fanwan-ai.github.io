import path from "node:path";
import { DEFAULT_DATA_ROOT } from "./constants.mjs";
import { normalizeCase, buildDailyDocument } from "./normalize.mjs";
import { sha256, isoNow } from "./utils.mjs";

function source(title, url, publisher, tier, date = "2026-09-03T00:00:00.000Z") {
  return { id: `src-${sha256(`${title}\n${url}`).slice(0, 14)}`, title, url, publisher, published_at: date, retrieved_at: isoNow(), tier, snippet: `${title} provides a verifiable signal about a customer workflow, cost, or policy change.` };
}

export function buildFixture() {
  const sources = [
    source("European Commission AI Act timeline", "https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai", "European Commission", "primary"),
    source("NIST AI Risk Management Framework", "https://www.nist.gov/itl/ai-risk-management-framework", "NIST", "primary"),
    source("Small teams adopt AI workflow automation", "https://www.technologyreview.com/", "MIT Technology Review", "reputable_secondary"),
    source("OpenAI platform updates", "https://openai.com/news/", "OpenAI", "primary"),
    source("EU AI Act implementation guidance", "https://artificialintelligenceact.eu/implementation-timeline/", "AI Act Explorer", "reputable_secondary")
  ];
  const ids = sources.map((item) => item.id);
  const raw = {
    editorial_note: "今天值得优先验证的不是一个泛化的 AI 行业，而是有明确责任、时间窗口和人工成本的工作流。以下条目都能在两周内做出可收费的窄版本。",
    opportunities: [
      { title: "给受监管中小企业做 AI 供应商证据包", verdict: "合规文件整理正在变成采购阻塞点，但只有能绑定具体审查流程的产品才可能收费。", customer: "需要向客户或审计方证明 AI 风险控制的中小企业合规负责人", pain: "政策节点临近时，团队仍靠表格和邮件收集模型用途、供应商承诺、测试记录和责任人，审查延误会直接推迟上线。", why_now: ["AI Act 实施时间线和企业治理要求持续细化，采购方需要可追溯材料。"], evidence: [{ claim: "监管框架对风险管理与治理提出可追溯要求", source_ids: [ids[0], ids[1]], confidence: "high" }], ai_advantage: "模型可以从合同、模型卡、测试报告中抽取并对齐证据，处理非结构化材料比固定字段自动化更有价值。", smallest_sellable_product: "两周内交付一个面向单一行业的证据包工作台：上传 30 份文件，输出带引用的缺口清单和审查包。", business_model: "按一次审查包收费，再按团队席位和年度审查更新收费。", failure_modes: ["客户不愿上传敏感资料", "输出无法达到法律意见的责任边界"], falsification_test: "访谈 8 家目标企业，拿 3 份脱敏材料做人工交付；若没人愿意为缺口清单付费就停止。", tags: ["合规", "B2B"] },
      { title: "把企业 AI 风险登记变成可复用的变更审查", verdict: "价值不在又一个聊天机器人，而在让每次模型变更都留下可审计的责任链。", customer: "有多个内部 AI 应用、但没有专职治理团队的 IT 或安全负责人", pain: "模型、提示词、数据集和供应商频繁变化，风险评估散落在工单与文档中，出了问题无法迅速定位变更。", why_now: ["企业 AI 使用从试验转入多应用运营，风险管理框架提供了共同语言。"], evidence: [{ claim: "NIST 提供面向 AI 风险识别、衡量和管理的框架", source_ids: [ids[1], ids[2]], confidence: "high" }], ai_advantage: "AI 能将变更说明、评测结果和事故记录映射到风险控制项，并把重复解释压缩为可检索的审查记录。", smallest_sellable_product: "两周内接入 Git 和工单系统，针对一个模型变更流程自动生成影响范围、待测项和责任人清单。", business_model: "按受管应用数量订阅，先卖一个团队的变更审查试点。", failure_modes: ["无法接触真实生产日志", "治理团队没有预算而只有口头认可"], falsification_test: "在一个真实变更流程旁运行 10 次，若不能减少审查时间或遗漏率就不扩展。", tags: ["治理", "工作流"] },
      { title: "为小型出口团队做多语种报价审查助手", verdict: "多语种生成只有在能降低错报和返工成本时才是生意，单纯翻译功能没有护城河。", customer: "没有专职海外销售运营、每天处理询盘和报价的制造业出口团队", pain: "询盘、规格、交期和付款条款分散在多语种邮件中，人工转录和漏读会造成报价返工与跟进丢失。", why_now: ["AI 的抽取和翻译能力已足以覆盖窄领域文本，但企业更在意可追溯与错误复核。"], evidence: [{ claim: "企业 AI 采用讨论开始转向具体工作流和生产率", source_ids: [ids[2], ids[3]], confidence: "medium" }], ai_advantage: "模型可同时抽取规格、识别缺失条件、翻译并生成带原文对照的报价草稿，关键是保留人工复核而不是自动发送。", smallest_sellable_product: "两周内支持一个品类和两种语言：导入邮箱线程，输出结构化询盘、缺失字段和可复核报价草稿。", business_model: "按销售团队订阅，附带每月处理量；先用人工服务保障高风险报价。", failure_modes: ["品类术语错误导致信任损失", "客户邮箱权限和隐私审批拖慢部署"], falsification_test: "用过去 100 条脱敏询盘做回放，若抽取准确率和返工时间没有明显改善就换场景。", tags: ["外贸", "多语种"] }
    ]
  };
  const daily = buildDailyDocument(raw, sources, "2026-09-04", []);
  const caseRaw = {
    slug: "cursor-workflow-wedge", story_type: "technical_commercialization", company: "Cursor", central_question: "当基础模型越来越容易获得，代码编辑器如何仍然成为一个值得付费的工作入口？", title: "Cursor：真正的产品不是模型，而是模型进入工作流的方式", dek: "Cursor 的启发不是“给 IDE 接上模型”，而是把生成、上下文、审查和迭代压缩成一个连续动作。它的脆弱点也同样清楚：关键能力依赖外部模型供给。", verdict: "Cursor 的可迁移优势来自工作流重构和高频反馈，而不是拥有一个不可替代的基础模型；复制者必须先证明入口和留存，再谈模型差异。", timeline: [{ date: "2024", event: "AI 编程工具从补全扩展到代码库级协作，编辑器成为模型交互入口。", source_ids: [ids[2], ids[3]] }], sections: [
      { id: "the-entry", heading: "它抢到的不是模型能力，而是编辑器里的下一步动作", thesis: "产品价值在于减少开发者从发现问题到验证修改之间的切换。", paragraphs: ["把模型放进编辑器并不自动产生优势。真正重要的是，用户可以在正在工作的上下文里提出修改、查看差异、继续追问，再运行验证。这个连续动作比一次问答更接近付费价值。"], source_ids: [ids[2], ids[3]], evidence_labels: [{ label: "editorial_inference", text: "工作流连续性是从产品形态与使用场景推导出的判断，不是公司公开宣称的因果结论。", source_ids: [ids[2]], confidence: "medium" }] },
      { id: "the-loop", heading: "高频反馈让产品迭代速度成为商业资产", thesis: "代码修改天然提供了比泛聊天更短的反馈回路。", paragraphs: ["代码是否能编译、测试是否通过、差异是否被接受，都会迅速反馈给用户和产品团队。这个闭环让产品可以围绕真实工作结果改进，而不必只用点赞或对话长度衡量价值。"], source_ids: [ids[1], ids[2]], evidence_labels: [{ label: "fact", text: "开发工具的结果可以通过编译、测试和代码差异被验证。", source_ids: [ids[1]], confidence: "high" }] },
      { id: "the-dependency", heading: "底层供给越强，产品越要诚实面对依赖", thesis: "模型供应商的能力和价格变化会传导到编辑器体验与毛利。", paragraphs: ["如果核心体验依赖外部模型，产品就必须把路由、缓存、上下文管理和失败降级做成自己的工程能力。否则一次模型升级或价格调整，就可能改变用户感知和单位经济性。"], source_ids: [ids[3], ids[4]], evidence_labels: [{ label: "company_claim", text: "模型平台会持续更新能力与产品接口，这是供应方公开信息中的自述。", source_ids: [ids[3]], confidence: "medium" }, { label: "editorial_inference", text: "依赖会影响毛利与体验是基于供应链关系的推断，具体影响取决于合同和路由策略。", source_ids: [ids[4]], confidence: "medium" }] },
      { id: "the-transfer", heading: "创业者应该抄的是验证回路，不是界面", thesis: "最值得迁移的是把高频专业动作做成可验证闭环。", paragraphs: ["寻找一个用户每天重复、结果可检查、上下文难以迁移的动作，再让 AI 缩短完成路径。先用人工和窄集成证明用户愿意回来，之后才值得投资模型路由、数据沉淀和更宽的产品边界。"], source_ids: [ids[1], ids[2]], evidence_labels: [{ label: "editorial_inference", text: "这是对案例的可迁移总结，不是 Cursor 的公开承诺。", source_ids: [ids[1], ids[2]], confidence: "medium" }] }
    ], unknowns: ["公开资料不足以确认不同模型供应商对 Cursor 毛利的具体影响。", "公开增长信号不能单独证明长期留存或客户终身价值。"], copy: ["从一个高频、可验证的专业动作切入。", "把人工复核、结果反馈和失败降级设计进第一版。", "用真实工作结果而不是对话热度衡量留存。"], avoid: ["不要把接入最新模型当成产品护城河。", "不要在没有客户复购证据时扩张到宽泛的 AI 助手。", "不要把公司自述直接当作因果证据。"], next_experiment: "选一个你熟悉的专业工作流，连续跟踪 10 次真实任务：记录切换次数、人工复核时间、结果错误类型和用户是否愿意为下一周继续使用。"
  };
  return { sources, daily, case: normalizeCase(caseRaw, sources, { status: "draft", now: isoNow() }), DEFAULT_DATA_ROOT };
}
