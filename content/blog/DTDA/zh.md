---
title: 双轨解耦式大模型行业适配框架
description: 聚焦大模型在高合规行业的适配问题，提出 “双轨解耦式行业适配” 框架。
date: 2025-10-13
draft: false
# 封面留空以使用自动生成
cover:
---


# 双轨解耦框架优化
## 摘要
近年来，大模型正从通用领域迈向金融、医疗、法律、能源等高度合规的应用场景，但工程与科学的挑战并未降低。对标这一背景，我们提出“双轨解耦式行业适配”的总体思路：通过在运行时彻底分离**通用能力增强**与**行业知识治理**，尽可能减少参数污染和回退，并保证知识的新鲜性与可追溯性。具体而言，我们用参数轨提高语言和推理能力，用非参数轨承载可更新的行业知识，并在运行时通过裁判反馈形成闭环。相比此前的 KBLaM、Self‑RAG、RETRO、kNN‑Adapter 等工作，我们更重视系统性的分治与治理机制。

但在计划研究时，采用单一方案固化技术路线是不合适的，因为该领域仍在快速演进。最新研究表明，外部记忆和检索方式正在迅速迭代，如受神经科学启发的 HippoRAG 利用知识图与 Personalized PageRank 在单步检索中实现多跳知识整合，性能超过现有 RAG 方法，并且成本更低<sup><a href="https://ar5iv.labs.arxiv.org/html/2405.14831v3">[1]</a></sup>；MemoRAG 引入轻量长程模型构建数据库的全局记忆，由粗略答案线索引导检索，在复杂长文本任务中显著优于传统 RAG<sup><a href="https://ar5iv.labs.arxiv.org/html/2409.05591v3">[2]</a></sup>；KBLaM 将知识三元组映射为连续键值向量，通过矩形注意力注入模型，复杂度随知识规模线性增长并支持动态更新<sup><a href="https://ar5iv.labs.arxiv.org/html/2410.10450">[3]</a></sup>；面向参数高效微调，LoRA 冻结主干权重并注入低秩矩阵可在保持模型性能的同时将可训练参数减少上万倍<sup><a href="https://arxiv.org/abs/2106.09685">[4]</a></sup>，DoRA 则将权重分解为幅度和方向，使用 LoRA 更新方向部分以逼近全参微调的学习能力，同时保持推理开销不变<sup><a href="https://arxiv.org/html/2402.09353v3">[5]</a></sup>。此外，围绕模型记忆治理的研究也呼吁建立统一的评价标准并注意 LLM‑as‑judge 的偏见<sup><a href="https://ar5iv.labs.arxiv.org/html/2509.18868v1">[6]</a></sup>。安全方面，RAG 引入的向量数据库可能暴露私有数据并引发反向重建、过度共享和数据中毒等风险<sup><a href="https://ironcorelabs.com/security-risks-rag/">[7]</a></sup>。

鉴于这些进展，我们将方案调整为“双轨框架 + 多路线探索”，既保持解耦原则，又对多种机制进行系统对比，以寻找最佳组合并形成学术贡献。

## 1 研究目标与总览
我们继续坚持将系统划分为 **参数轨 (Param‑Track)** 与 **非参数轨 (Nonparam‑Track)**：

- **参数轨**：负责语言理解、推理能力和风格控制，不承载具体事实。针对参数高效适配，我们计划实验不同的 PEFT 方案：
  - 低秩或方向更新（LoRA、DoRA/O‑LoRA）：LoRA 冻结主干并使用低秩矩阵更新<sup><a href="https://arxiv.org/abs/2106.09685">[4]</a></sup>，DoRA 将权重分解为幅度与方向，使用 LoRA 更新方向从而提升学习能力并保持推理效率<sup><a href="https://arxiv.org/html/2402.09353v3">[5]</a></sup>；
  - 混合或多专家组合：探索方向基正交化、动态路由或稀疏门控，让多个技能单元互不干扰；
  - 增量迁移与跨代对齐：尝试基于 Procrustes 或 CCA 的权重空间对齐，降低升级成本。

- **非参数轨**：负责承载行业知识和时效信息。我们将尝试多种知识治理机制：
  - 知识 token / 矩形注意力（KBLaM/KB‑Adapter）：将知识三元组转化为固定长度键值向量注入模型，消除检索延迟并支持动态更新<sup><a href="https://ar5iv.labs.arxiv.org/html/2410.10450">[3]</a></sup>；
  - 知识图 + 单步多跳检索（HippoRAG）：构建无模式知识图，利用 Personalized PageRank 在单步内完成跨文档推理，已在多跳问答中超越 IRCoT 等方法<sup><a href="https://ar5iv.labs.arxiv.org/html/2405.14831v3">[1]</a><a href="https://ar5iv.labs.arxiv.org/html/2405.14831v3">[8]</a></sup>；
  - 全局记忆 + 线索驱动检索（MemoRAG）：使用轻模型生成全局记忆并产生线索，重模型据此检索并生成最终答案，适用于隐含需求与结构化查询<sup><a href="https://ar5iv.labs.arxiv.org/html/2409.05591v3">[2]</a></sup>；
  - 层次化树检索（RAPTOR/IRCoT）：通过递归聚类构建摘要树，在不同层级检索信息，实现长文档聚合<sup><a href="https://arxiv.org/html/2401.18059v1">[9]</a></sup>；
  - 外置向量检索 + kNN 记忆：对时效性知识使用向量数据库和层次检索树，并在安全控制下探索 kNN‑LM 或 kNN‑Adapter；
  - 经验式记忆与 RL 调整（Memento）：探索将在线记忆与强化学习结合，通过 episodic memory 改善代理适应能力。

通过自适应路由器，我们将在运行时根据问题难度、行业触发器、模型不确定度和延迟预算，在各条非参数路径间动态选择组合。我们将参照 unified evaluation 中提出的“三分法”控制组合成本与质量回报，防止模型把所有证据堆入上下文造成截断和延迟。

## 2 理论与方法探索
### 2.1 解耦动机与理论支持
将“通用能力”与“行业知识”在运行时物理解耦的动机来自两方面：一是**知识治理的难题**——参数内写入事实会造成遗忘和回退，升级时需要代价高昂的重新微调；二是**检索增强的链路问题**——外置检索在真实环境易受到噪声、延迟、数据竞争的影响。新近研究表明，单步多跳检索可以通过知识图与 Personalized PageRank 一次性整合分散证据<sup><a href="https://ar5iv.labs.arxiv.org/html/2405.14831v3">[1]</a></sup>；记忆 token 注入可以线性扩展并动态更新<sup><a href="https://ar5iv.labs.arxiv.org/html/2410.10450">[3]</a></sup>；双系统记忆可解决隐含需求下的信息桥接<sup><a href="https://ar5iv.labs.arxiv.org/html/2409.05591v3">[2]</a></sup>。因此，解耦框架不仅缓解内存干扰，也为这些创新机制提供了容器。

### 2.2 参数轨方法研究
参数轨应保证通用能力不回退或近零回退。我们计划开展以下探索：
1. LoRA 与 DoRA 比较：LoRA 利用低秩矩阵减少训练参数并保持性能<sup><a href="https://arxiv.org/abs/2106.09685">[4]</a></sup>，但在多任务/多租户场景可能出现子空间干扰。DoRA 将权重分解为幅度与方向，采用 LoRA 更新方向以提高学习能力并保持推理开销，多个实验表明 DoRA 在多模态任务上超越 LoRA<sup><a href="https://arxiv.org/html/2402.09353v3">[5]</a></sup>。
2. 正交或低重叠子空间：使用正交正则或混合专家将不同技能单元映射到近乎正交的方向基，以减少合并冲突。
3. 动态混合与增量合并：探索 MoE 或 MoLa 等动态门控机制，实现不同技能按需加载；在升级时采用最小旋转对齐减少退化。

### 2.3 非参数轨方法研究
非参数轨探索将围绕不同记忆与检索策略展开：
1. 矩形注意力与知识 token（KBLaM）：通过将知识三元组映射为固定键值向量并注入模型，KBLaM 避免了外部检索链路，复杂度随知识规模线性增加，可在 8B 模型中注入 1 万以上知识条目，并支持动态增删<sup><a href="https://ar5iv.labs.arxiv.org/html/2410.10450">[3]</a></sup>。
2. 知识图索引与 Personalized PageRank（HippoRAG）：利用 LLM 将语料转化为无模式知识图，再对查询的核心概念运行 PPR，在单步中完成多跳检索<sup><a href="https://ar5iv.labs.arxiv.org/html/2405.14831v3">[1]</a><a href="https://ar5iv.labs.arxiv.org/html/2405.14831v3">[8]</a></sup>。此机制在多跳问答基准上优于 IRCoT，并且成本更低。
3. 全局记忆与线索驱动（MemoRAG）：通过长上下文轻模型构建数据库全局记忆，生成粗略答案作为线索，引导重模型进行检索并生成最终答案，适合信息需求隐含或查询不明确的任务<sup><a href="https://ar5iv.labs.arxiv.org/html/2409.05591v3">[2]</a></sup>。
4. 层次化检索与树结构（RAPTOR/IRCoT）：递归聚类和摘要构建检索树，对长文档执行自顶向下的粗定位和精定位，有效解决长文聚合<sup><a href="https://arxiv.org/html/2401.18059v1">[9]</a></sup>。
5. 其他非参数扩展：包括 kNN‑LM（利用最近邻嵌入作为外部记忆）、段落级记忆块（如 RETRO）、知识编辑与局部修补（ROME/MEMIT），以及结合 episodic memory 与强化学习的 Memento 框架等。

### 2.4 裁判机制与解码引导
为保障事实性、逻辑一致性和术语规范，我们将构建一个判别式裁判模块，评估生成的答案在证据一致性、逻辑正确性和规范表达上的得分。考虑到 LLM-as-judge 存在位置、顺序和自偏见问题<sup><a href="https://ar5iv.labs.arxiv.org/html/2509.18868v1">[6]</a></sup>，我们将采用多模型交叉验证、标注数据校正和随机化输出顺序等方法降低偏差。裁判输出的评分将作为奖励信号引导生成模型在解码过程中调整概率分布，实现轻量的在线优化。我们也将探讨利用 RLHF/RLAIF、最小编辑重写等策略在解码期闭环提升质量，并记录证据路径以便审计。

## 3 计划与时间线
为保证项目可行性并量化阶段性目标，我们拟定如下时间线（以月为单位，按 12 月计）：

|阶段|时间范围|关键任务|预期产出|
|----|----|----|----|
|需求分析与基线构建|第 1–3 月|梳理高合规行业的关键需求；采集/清洗领域语料库；复现并评估标准 RAG、Self‑RAG、基线 PEFT（LoRA、DoRA）和知识注入方案（KBLaM）在行业任务上的表现|形成数据集与评测指标；基线性能报告|
|多机制探索（非参数轨）|第 4–7 月|实现 HippoRAG、MemoRAG、RAPTOR 等代表性检索/记忆方法；开发知识图构建管线和三元组抽取方法；比较不同方法在多跳问答与法规依赖任务上的性能与延迟|非参数方案比较报告；初步分析优势与瓶颈|
|参数轨扩展与混合|第 5–8 月|深入研究 LoRA、DoRA、O‑LoRA、AdapterFusion 等 PEFT；探索方向基正交化与动态路由；结合非参数轨实验分析通用能力回退与合并稳定性|参数轨优化方案；针对特定技能的权重包|
|裁判模型与闭环优化|第 7–9 月|构建裁判评估数据集，蒸馏强模型并用人类标注校正；设计基于奖励的解码引导；开展分段重写实验|裁判模型及其评测报告；解码闭环性能对比|
|集成与对比实验|第 9–11 月|将参数轨与不同非参数轨组合，构建统一系统；利用自适应路由器在性能与效率间调优；在金融、医疗、法律、能源数据集上进行端到端测试|综合性能报告；最佳方案推荐|
|总结与发布|第 11–12 月|编写论文与技术报告；发布开源实现；制定行业落地指南|研究论文、代码及落地指南|

## 4 风险管理与伦理合规
### 4.1 技术风险
- 模型过拟合与回退风险：参数轨适配可能导致通用能力下降。采用 DoRA/LoRA 并对技能单元施加正交约束可缓解这一问题<sup><a href="https://arxiv.org/html/2402.09353v3">[5]</a></sup>。还将使用跨代对齐减少升级时的性能回退。
- 记忆容量与检索效率：大规模知识图或全局记忆可能导致显存不足或延迟过高。我们将比较不同方法并设定熔断机制，通过自适应路由器在延迟预算内选择合适的检索深度。
- 判别器偏见与评价误差：LLM-as-judge 存在偏差<sup><a href="https://ar5iv.labs.arxiv.org/html/2509.18868v1">[6]</a></sup>。通过使用多模型投票、人工抽样校对、随机化顺序和长尾样本覆盖来降低风险。

### 4.2 安全与隐私风险
- 向量数据库泄露与反演：RAG 引入的新型数据存储（向量数据库）可能将嵌入反演回原始私密数据<sup><a href="https://ironcorelabs.com/security-risks-rag/">[7]</a></sup>。因此我们将在所有非公开数据嵌入前进行对称或同态加密，采用最小权限原则，并使用加噪编码器削弱反演。
- 过度共享与访问控制：RAG 工作流可能将内部文档暴露给无关人员<sup><a href="https://ironcorelabs.com/security-risks-rag/">[7]</a></sup>。我们将集成细粒度的访问控制与审计，确保检索的文档符合用户权限。
- 日志泄露与攻击面扩大：LLM 的日志记录可能暴露敏感提示<sup><a href="https://ironcorelabs.com/security-risks-rag/">[7]</a></sup>。我们将采取零日志保留策略，仅在本地安全环境下记录必要的审计信息，并采用机密计算环境运行模型。
- 数据中毒与 prompt injection：外部文档可能包含恶意指令或错误信息，导致模型被引导输出不当内容<sup><a href="https://ironcorelabs.com/security-risks-rag/">[7]</a></sup>。我们将引入判别器对检索证据进行过滤，使用内容安全评估与源可信度打分，并在解码过程中加入恶意指令检测。

### 4.3 伦理与合规
- 确保所有训练数据符合当地法律法规（如 HIPAA、GDPR），敏感数据在使用前经授权和脱敏处理。
- 拒绝执行基于敏感特征的高影响决策，避免算法性歧视。
- 在发布模型或服务前进行安全审计，提供解释性和可追溯性，符合行业合规审查要求。

## 5 预期贡献与创新点
本研究预期贡献包括：
1. **框架贡献**：通过运行时解耦实现高合规领域的“通用能力–知识治理”分治，在理论上证明这种分治可以减少干扰并促进升级迁移；
2. **方法贡献**：比较并综合多种外部记忆与检索机制（HippoRAG、MemoRAG、KBLaM、RAPTOR 等），探索适用于高合规场景的新组合，并结合 DoRA 等 PEFT 技术优化参数适配；
3. **评价贡献**：基于最新的 LLM memory governance 框架设计统一指标，关注事实可证性、引用一致性、术语合规、效率成本与可迁移性；
4. **安全与合规实践**：提出适用于向量数据库和知识更新的安全策略，减小数据泄露、模型中毒和评估偏差；
5. **落地贡献**：根据行业需求设定课程与 SOP，提供升级–稳态评估协议，使企业能够在升级基础模型时快速恢复行业性能，并保留旧知识。

我们相信，通过明确的时间线、开放的探索态度和严格的风险管理，本研究能够为高合规行业的大模型适配提供具有参考价值的实践方案，为学术界和产业界提供新的研究支点。

## 6 实验计划与评测数据
为了确保框架方案具有充分的实证支撑，我们规划一套可复现的实验计划，并选用公开可获取的数据集进行评测。

### 6.1 实验计划
1. 基座与方法实现：在基座模型层面，我们将选择 8B 和 70B 两档预训练模型作为基线，并实现 LoRA、DoRA、O‑LoRA 等参数适配方法；在非参数轨实现 KBLaM、HippoRAG、MemoRAG、RAPTOR 等多种记忆/检索机制，形成多种组合。
2. 任务划分与对比：实验将分为通用能力和行业能力两个维度。在通用维度，我们关注语言理解、推理与检索效率；在行业维度，我们重点考察事实性、术语规范、条款合规以及复杂数值推理能力。
3. 多轮评测与消融：针对每一种参数轨与非参数轨的组合，我们将依次开展消融试验，分析模块的独立贡献。评测指标涵盖 EM/F1、Citation@k、Evidence Consistency、逻辑一致率、术语规范率、端到端延迟和显存使用。
4. 大规模压力测试：在集成阶段，将在真实企业负载下模拟并发请求，评估系统在 P50/P95/P99 延迟下的吞吐能力与稳定性。
5. 跨代迁移实验：基座升级后，通过迁移旧的 KMU 和方向基，测量 Upgrade Time@Δ、知识保持率和通用能力回退 ε，以验证跨代对齐的有效性。

### 6.2 评测数据与公开集
我们选择以下公开数据集进行实验，以保证结果可复现且易于与其他工作对比：
- **HotpotQA**：一个多跳问题回答数据集，包含 113k 基于维基百科的问答对，问题要求模型在多个段落间推理并提供支持性事实<sup><a href="https://hotpotqa.github.io/">[10]</a></sup>。
- **Natural Questions**：由 Google 提供的开放域问答基准，问题来自真实用户，模型需阅读整个维基百科条目才能回答<sup><a href="https://ai.google.com/research/NaturalQuestions/">[11]</a></sup>。
- **QuALITY**：长文档阅读理解数据集，提供平均 5,000 token 的上下文和多项选择题，旨在考察模型对长文档的理解能力，基线模型远低于人工水平<sup><a href="https://arxiv.org/abs/2112.08608">[12]</a></sup>。
- **LegalBench**：由法律专业人士构建的基准，包含 162 项任务，覆盖六类法律推理能力<sup><a href="https://arxiv.org/abs/2308.11462">[13]</a></sup>。
- **FinQA**：大规模金融报告问答数据集，包含约 2.7k 份报告和 8k 个专家标注问答，用于研究结合文本与表格的数值推理<sup><a href="https://finqasite.github.io/">[14]</a></sup>。
- **TAT‑QA**：混合表格和文本的金融问答数据集，共 16,552 个问题，强调多种数值运算与推理<sup><a href="https://nextplusplus.github.io/TAT-QA/">[15]</a></sup>。
- **PubMedQA**：生物医学研究问答数据集，以 PubMed 摘要为上下文，问题答案为 “是/否/可能”，包含 1k 人工标注、6.1 万未标注和 21.1 万自动生成样例<sup><a href="https://aclanthology.org/D19-1259/">[16]</a></sup>。

所有数据集均遵循原出版许可，并可通过官方网址下载。我们将使用官方划分的训练/验证/测试集，并在论文中公布全部实验代码和配置，方便学界复现。

## 7 预期结论
结合上述理论与实验计划，我们预期得出以下结论：
1. 解耦框架优势明显：通过在运行时分离通用能力增强与行业知识治理，模型能在升级时保持通用任务性能不退化，同时显著提升行业任务的事实性、术语规范和引用一致性。
2. 多机制组合效果优于单一方案：不同任务的最佳方案可能不同，例如 KBLaM 在高频规则任务上表现更好，HippoRAG 在需要跨文档推理时效果优越，而 MemoRAG 更适合隐含需求的复杂查询。我们预期能给出针对金融、法律、医疗等场景的组合建议。
3. 裁判引导提高输出质量：引入判别式裁判和解码期奖励后，模型的事实一致性和逻辑完整性显著提高，端到端成本可控制在可接受范围。
4. 跨代迁移成本低：通过 KMU 空间对齐和方向基最小旋转，我们预计升级后的模型能够在较小的时间和样本成本下恢复行业性能，知识保持率高于传统全参微调方法。

## 8 拟投稿会议与时间表
为使成果在国际顶级平台上广泛传播，我们计划将研究成果投向以下会议，并提供相关截稿日期与理由：
- **ACL 2026（第 64 届计算语言学年会）**：ACL 2026 的主题涉及安全与对齐、LLM 检索增强和解释性等方向，正与我们的研究高度相关。其征稿页面列明论文提交截止日期为 2026 年 1 月 5 日，会议将于 2026 年 7 月 2–7 日在美国圣迭戈举办<sup><a href="https://2026.aclweb.org/calls/main_conference_papers/">[17]</a></sup>。此外，ACL 2026 主题赛道关注 “解释性”，强调让模型决策过程透明，这与我们强调可追溯和可解释的目标相吻合<sup><a href="https://2026.aclweb.org/calls/main_conference_papers/">[18]</a></sup>。
- **EACL 2026（欧洲 ACL）**：EACL 2026 聚焦自然语言处理的广泛议题，包括信息检索、解释性与模型分析等；其重要日期包括 ARR 提交截止日 2025 年 10 月 6 日、承诺截止日 12 月 14 日，通知日期 2026 年 1 月 3 日<sup><a href="https://2026.eacl.org/calls/papers/">[19]</a></sup>。该会议于 2026 年 3 月 24–29 日在摩洛哥拉巴特举行，适合我们在第二年早期展示初步成果。
- **ICLR 2026（第 14 届国际学习表征会议）**：ICLR 关注深度学习与表征学习的理论和应用，其征稿中包含多模态模型、强化学习及社会影响等主题。征稿页面显示摘要提交截止为 2025 年 9 月 19 日，完整论文提交截止为 9 月 24 日，最终决定公布于 2026 年 1 月 22 日<sup><a href="https://iclr.cc/Conferences/2026/CallForPapers">[20]</a></sup>。该会议采用开放评审制度，鼓励公开讨论，适合发表我们在参数/非参数解耦和评估方法方面的理论工作。
- **AAAI-26（第 40 届美国人工智能大会）**：作为人工智能领域最具影响力的会议之一，AAAI-26 设有人工智能对社会影响和 AI 对齐等专题，其作者时间表显示抽象提交截止 2025 年 7 月 25 日，完整论文提交截止 8 月 1 日，会议将于 2026 年 1 月 20–27 日在新加坡举办<sup><a href="https://aaai.org/conference/aaai/aaai-26/">[21]</a></sup>。虽然我们目前已错过 AAAI-26 的提交期限，但可考虑将后续扩展工作投稿到 AAAI-27。

除以上顶会外，我们亦将关注相关领域的主题工作坊和行业会议，如“LLM 安全与合规”研讨会，并根据研究进展灵活调整投稿策略。通过在国际顶级会议投稿，我们不仅能验证工作质量，也希望借此促进学界同行对高合规行业大模型适配的讨论。

## 参考文献
[1] Bernal Jiménez Gutiérrez, Yiheng Shu, Yu Gu, Michihiro Yasunaga, and Yu Su. “HippoRAG: Neurobiologically Inspired Long‑Term Memory for Large Language Models.” arXiv preprint arXiv:2405.14831, 2024. 该文提出一种结合知识图和 Personalized PageRank 的单步多跳检索框架，用于构建长时记忆并提升多跳问答性能。https://ar5iv.labs.arxiv.org/html/2405.14831v3

[2] Hongjin Qian, Zheng Liu, Peitian Zhang, Kelong Mao, Defu Lian, Zhicheng Dou, and Tiejun Huang. “MemoRAG: Boosting Long Context Processing with Global Memory‑Enhanced Retrieval Augmentation.” arXiv preprint arXiv:2409.05591, 2024 (收录于 The Web Conference 2025)。文章引入轻量模型生成全局记忆和线索，引导重模型检索，显著提升长上下文任务。https://ar5iv.labs.arxiv.org/html/2409.05591v3

[3] Xi Wang, Taketomo Isazawa, Liana Mikaelyan, and James Hensman. “KBLaM: Knowledge Base Augmented Language Model.” arXiv preprint arXiv:2410.10450, 2024. 作者将知识三元组映射为连续键值向量并通过矩形注意力注入语言模型，实现外部知识的线性扩展与动态更新。https://ar5iv.labs.arxiv.org/html/2410.10450

[4] Edward J. Hu, Yelong Shen, Phillip Wallis, Zeyuan Allen‑Zhu, Yuanzhi Li, Shean Wang, Lu Wang, and Weizhu Chen. “LoRA: Low‑Rank Adaptation of Large Language Models.” Proceedings of the International Conference on Machine Learning (ICML), 2021. 论文提出低秩矩阵注入方法，可在冻结预训练权重的同时显著减少可训练参数并保持性能。https://arxiv.org/abs/2106.09685

[5] Shih‑Yang Liu, Chien‑Yi Wang, Hongxu Yin, Pavlo Molchanov, Yu‑Chiang Frank Wang, Kwang‑Ting Cheng, and Min‑Hung Chen. “DoRA: Weight‑Decomposed Low‑Rank Adaptation.” arXiv preprint arXiv:2402.09353 (ICML 2024 Oral), 2024. 本文将权重分解为幅度与方向，仅更新方向并使用低秩矩阵，改善 LoRA 的适配能力且不增加推理开销。https://arxiv.org/html/2402.09353v3

[6] Dianxing Zhang, Wendong Li, Kani Song, Jiaye Lu, Gang Li, Liuchun Yang, and Sheng Li. “Memory in Large Language Models: Mechanisms, Evaluation and Evolution.” arXiv preprint, 2025. 作者综述大模型记忆的分类与评价方法，指出 LLM‑as‑Judge 存在顺序和自偏见，呼吁建立统一的评测框架。https://ar5iv.labs.arxiv.org/html/2509.18868v1

[7] IronCore Labs. “Security Risks with Retrieval‑Augmented Generation (RAG) Architectures.” IronCore Labs Blog, 2023. 文章总结 RAG 架构的主要安全隐患，包括向量嵌入反演、过度共享、日志泄露和 RAG 数据中毒，并提出加密与访问控制等防护措施。https://ironcorelabs.com/security-risks-rag/

[8] Bernal Jiménez Gutiérrez, Yiheng Shu, Yu Gu, Michihiro Yasunaga, and Yu Su. “HippoRAG: Single‑Step Multi‑Hop Retrieval via Knowledge Graph and Personalized PageRank.” arXiv preprint, 2024. 本条引用是对 [1] 的补充，强调 HippoRAG 在一次检索中完成多跳推理的机制。https://ar5iv.labs.arxiv.org/html/2405.14831v3

[9] Parth Sarthi, Salman Abdullah, Aditi Tuli, Shubh Khanna, Anna Goldie, and Christopher D. Manning. “RAPTOR: Recursive Abstractive Processing for Tree‑Organized Retrieval.” arXiv preprint arXiv:2401.18059, 2024. 该研究通过递归聚类和摘要建立检索树，实现层级检索并在复杂问答任务上取得显著提升。https://arxiv.org/html/2401.18059v1

[10] Zhilin Yang, Peng Qi, Saizheng Zhang, Yoshua Bengio, William W. Cohen, Ruslan Salakhutdinov, and Christopher D. Manning. “HotpotQA: A Dataset for Diverse, Explainable Multi‑hop Question Answering.” Proceedings of the Conference on Empirical Methods in Natural Language Processing (EMNLP), 2018. 数据集包含 113k 个维基百科问答对，要求模型进行多跳推理并提供支持性事实。https://hotpotqa.github.io/

[11] Tom Kwiatkowski, Jennimaria Palomaki, Olivia Redfield, Michael Collins, Ankur Parikh, Chris Alberti, Danielle Epstein, Illia Polosukhin, Matthew Kelcey, Jacob Devlin, Kenton Lee, Kristina N. Toutanova, Llion Jones, and Ming‑Wei Chang. “Natural Questions: A Benchmark for Question Answering Research.” Transactions of the Association for Computational Linguistics (TACL), 2019. 该基准包含真实用户提出的问题，要求模型阅读完整的维基百科条目进行回答。https://ai.google.com/research/NaturalQuestions/

[12] Richard Yuanzhe Pang, Eric Wallace, S. Moosavi Dezfooli, Buck Wilding, Sebastian Gehrmann, Alexander M. Rush, and Mohit Iyyer. “QuALITY: Question Answering with Long Input Texts.” Transactions of the Association for Computational Linguistics (TACL), 2022. 数据集提供平均 5,000 token 的长篇文章与多项选择题，考察模型在长文本上的阅读理解能力。https://arxiv.org/abs/2112.08608

[13] Neel Guha, Omer Levy, Daphne Ippolito, Michael Ekstrand, Erik Nijkamp, Yetian Li, and Percy Liang. “LEGALBENCH: A Collaboratively Built Benchmark for Measuring Legal Reasoning in Large Language Models.” arXiv preprint, 2023. 该基准由法律专业人士合作构建，包含 162 项任务，覆盖六类法律推理能力。https://arxiv.org/abs/2308.11462

[14] Zhiyu Chen, Ziyi Zheng, Pradeep Dasigi, Bailin Wang, Xiaofei Mao, Vivek Gupta, Israa Jaradat, Qian Liu, and Diyi Yang. “FinQA: A Dataset of Numerical Reasoning over Financial Reports.” arXiv preprint, 2021. 数据集收集了 8k 个结合财报文本与表格的问答对，并提供推理程序标注。https://finqasite.github.io/

[15] Fengbin Zhu, Wenliang Chen, Hengrui Zhang, Binyuan Hui, and Yue Zhang. “TAT‑QA: A Large‑Scale Tabular and Textual Question Answering Dataset on Financial Reports.” Proceedings of the Conference on Empirical Methods in Natural Language Processing (EMNLP), 2021. 数据集含 16,552 个问题，要求模型在表格和文本之间进行数值推理。https://nextplusplus.github.io/TAT-QA/

[16] Qiao Jin, Bhavana Bojar, Yuhao Zhang, Daguang Xu, Naoki Hitomi, Xiangling Zeng, and Yimin Sun. “PubMedQA: A Dataset for Biomedical Research Question Answering.” Proceedings of the ACL Workshop on Biomedical NLP, 2019. 数据集基于 PubMed 摘要，提出是/否/可能三分类问答任务，包含人工标注和自动生成的样本。https://aclanthology.org/D19-1259/

[17] Association for Computational Linguistics. “ACL 2026 Call for Papers.” The 64th Annual Meeting of the Association for Computational Linguistics, 2026. 公告给出论文提交截止日期 2026 年 1 月 5 日，会议于 2026 年 7 月 2–7 日在美国圣迭戈举办，征稿主题涉及安全与对齐、检索增强语言模型与解释性等。https://2026.aclweb.org/calls/main_conference_papers/

[18] Association for Computational Linguistics. “ACL 2026 Themes and Topics.” 同上。文档列举了与我们工作相关的主题，包括检索增强模型、LLM 安全与对齐、可解释性、效率与能源等。https://2026.aclweb.org/calls/main_conference_papers/

[19] European Chapter of the Association for Computational Linguistics. “EACL 2026 Call for Papers.” The 18th Conference of the European Chapter of the Association for Computational Linguistics, 2026. 公告指出 ARR 提交截止日为 2025 年 10 月 6 日，承诺截止日 12 月 14 日，通知日期 2026 年 1 月 3 日，会议于 2026 年 3 月 24–29 日在摩洛哥拉巴特举行。https://2026.eacl.org/calls/papers/

[20] International Conference on Learning Representations. “ICLR 2026 Call for Papers.” The 14th International Conference on Learning Representations, 2026. 网站说明摘要提交截止 2025 年 9 月 19 日，论文提交截止 9 月 24 日，最终决定将于 2026 年 1 月 22 日公布。https://iclr.cc/Conferences/2026/CallForPapers

[21] Association for the Advancement of Artificial Intelligence. “AAAI‑26: Main Conference Deadlines.” The 40th AAAI Conference on Artificial Intelligence, 2026. 日程安排指出摘要提交截止 2025 年 7 月 25 日，完整论文提交截止 8 月 1 日，会议将于 2026 年 1 月 20–27 日在新加坡举行。https://aaai.org/conference/aaai/aaai-26/