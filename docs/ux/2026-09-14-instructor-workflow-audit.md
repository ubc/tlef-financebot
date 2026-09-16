# Instructor workflow：问题审查与逐页设计方向

2026-09-14 · 为 Stephen 准备 · 本轮只审查与规划，未修改应用。

## 结论

当前主要问题是：界面把后台的配置和运行方式直接交给老师，却没有持续回答「我已经有什么？现在在做什么？下一步该做什么？」。单独换颜色或加动画不能解决这些问题。需要先修复状态与流程，再统一阅读布局和操作。

本次依据用户提供的 12 张截图，并在独立浏览器标签只读检查 PHYS 100 / Introduction to Physics2 的 Generate Questions、Review Queue、Question Detail、Course Dashboard 和 Guided Setup，结合当前工作区代码核对。实查时有 15 个 LO、75 道待审核题、0 道 Approved；这是该课程的快照，不是所有课程的统计。

没有发起新生成、批准/拒绝题目或修改课程。没有安装技能，没有提交或推送应用代码。已有 loading 和 Admin 改动保留。

证据标记：**S** = 截图可见；**L** = 本轮实际页面确认；**C** = 当前代码确认；**待验证** = 有风险但尚未通过受控实验确认。P0 为状态/重复操作优先项，P1 为主要任务障碍，P2 为视觉及效率优化，不表示安全漏洞等级。

## 用户指出的问题与核实结果

| ID / 优先级 | 页面与问题 | 证据与原因 | 设计方向 |
|---|---|---|---|
| U01 / P1 | 返回 Learning Objectives 看不到已有 LO | S02、L、C：步骤直接进入 `manual-los` 新增表单；上方仍显示 15 LOs Ready | 默认显示按 Topic 分组的已有目标；`Add learning objectives` 才打开表单；保存后回列表 |
| U02 / P1 | Guided Questions 难理解、输入框过多 | S01、L/C：15 个 LO × 3 难度 × 2 类型，默认约 90 个数字输入 | 默认选择目标、数量及简短要求；展示建议摘要；详细配比分配收进 `Customize distribution` |
| U03 / P1 | 底部按钮竞争、含义不清 | S03：Open Workspace、Check sources、Auto、Generate、Continue 同时出现；主按钮是一整句报告 | 一个主操作 `Generate questions`；数量另作摘要；辅助链接降级；生成提交后进入 Review |
| U04 / P0 | 生成后按钮又能点击 | S04–05、C：`generationBusy` 只覆盖入队请求；之后按 LO 活跃任务计算可生成范围。按钮使用的 `plannable` 没有像摘要的 `eligible` 一样检查 `needed > 0`；自动配额依据 Approved 数量 | 以本次批次生命周期驱动主操作；统一可生成数量计算；待审核题与在途任务纳入建议；重复提交由服务端幂等处理 |
| U05 / P1 | 看不到题目逐渐生成 | S04–05、C：存在 SSE，但主要传 content run 阶段/计数。LLM adapter 当前等待完整 `sendMessage` 内容；并非 token stream | 区分真实阶段事件、逐题结果、文本片段三层；逐步在 Review 中展示，不能用已完成文本的打字动画冒充实时生成 |
| U06 / P1 | 看不到 agent 检查和 flag 的过程 | S04–06、L、C：运行列表显示 Run ID / Validating / Reviewing，最终报告在详情页；引导缺少完整检查上下文 | 每题提供 `Drafting → Checking → Ready for review`，显示真实检查摘要、问题原因与证据，必要时展开详情 |
| U07 / P1 | 生成后仍要自己找 Review | S04–06、C：当前没有本次生成成功接受后的自动切换 | 成功接受本次批次后只自动进入一次 Live Review；失败留在原处；不因后续 SSE 抢走用户主动导航 |
| U08 / P1 | Review Queue 按钮位置不齐 | S07、C：难度标签和两个按钮放在同一 flex-wrap 操作区，标签宽度不同会影响布局 | 难度回到题目元信息；操作区固定宽度/顺序；选中行在同页打开完整预览 |
| U09 / P1 | 审核详情干燥、冗长，操作埋底 | S08–09、L：题干编辑框、完整预览、选项编辑框重复；操作在 TA 建议和备注之后 | 默认阅读模式：一道完整题、选项、答案/解释、检查摘要；编辑按需展开；固定 Approve / Reject / Next 区域 |
| U10 / P1 | Standalone Generate Questions 是表格加表单墙 | S11–12、L：导航名 Generate Questions，但标题 Question Bank Coverage；真正生成表单在 15 行之后 | 页面先呈现生成任务；覆盖缺口作为上下文与筛选，不再占据首屏；复用 Guided composer |
| U11 / P2 | Question Bank 不够精致、操作繁杂 | S10：多排筛选、冗长汇总、高行距题干列表、操作区易挤压 | 搜索为主，状态视图切换，额外筛选按需打开；紧凑列表＋同页预览；选择后才显示批量操作 |

U04 已找到足以解释按钮行为的代码路径，但本轮没有再次付费生成来确认重复记录或并发请求结果。不能把「能再次点击」直接等同于「同一题已重复入库」。后续必须用受控测试证明并修复。

## 额外发现

| ID / 优先级 | 问题 | 影响与处理 |
|---|---|---|
| A01 / P1 | 已有 75 道待审核题，Coverage 仍写 15 Empty；另有 0 below target | Approved-only 的统计本身可成立，但 “Empty” 暗示没有题。展示 `0 approved · 5 awaiting review`，优先引导审核；明确 empty 和 below-target 的分类关系 |
| A02 / P1 | 同时出现 75 questions、61 runs、15 LOs、6 runs active | 同一工作被不同单位描述，老师难以判断进度。主界面按本批次题目计数，后台运行 ID 放入详情 |
| A03 / P1 | AI Pass / Flag / Reject 与 Draft / Approved / 学生可见混杂 | AI 检查不等于老师批准；批准也不绕过课程、Topic 发布条件。将 `AI check`、`Review status`、`Student availability` 分开表达 |
| A04 / P1 | 引导审核的参数化题目出现原始占位符 | L、C：引导通过文本节点显示原始 stem/options。复用经过验证的示例值和富文本/公式渲染；没有有效示例时明确提示，不能把原始模板当作学生看到的题 |
| A05 / P1 | Guided Review 与完整 Review 提供的判断信息不一致 | 引导有可读选项，却没有同等可见的 AI 检查摘要；完整页报告过长。共用题目与检查展示组件，权限/操作仍由各入口决定 |
| A06 / P1 | 出现相同题干 | L：两道 “Which statement best defines force as a vector interaction?” 题干相同，选项不同。属于重复教学内容风险，不足以证明重复记录；后续可展示相似题提示，先让老师容易比较 |
| A07 / P1 | AI Reject 项在列表仍有 Approve 操作 | L：需要在作决定前显著显示检查问题；不推断后端允许绕过验证。计划保留现有授权与数值验证，审核面板解释阻断/建议的差别 |
| A08 / P2 | Topic 1 / LO 2 比真实目标名称更突出；Coverage 的 LO 跨 Topic 交错排列 | L：序号不能代替教学含义。主显示目标名称，编号作辅助；按课程 Topic 顺序分组 |
| A09 / P2 | 大标题、步骤栏、通知栏、固定底部区占用大量高度 | S01–06：内容可视区域被压缩，长按钮换行。缩短说明，压缩步骤标题，正文留出充分空间；底部操作不能遮盖最后一条内容 |
| A10 / P2 | 大量边框、浅色面板、徽章权重相同 | 关键内容和元信息没有层次。减少容器嵌套与彩色标签，主内容靠字体、留白、对齐建立层级 |
| A11 / P1 | 实时内容可能导致重绘、跳动和焦点丢失 | 待验证：当前 SSE 会触发重新获取/渲染审核内容。后续新题追加不能替换正在阅读或编辑的题；通知 `3 new questions`，允许用户主动切换 |
| A12 / P1 | 引导 Ready 和已完成的含义不明确 | 15 个 LO Ready 只说明目标存在；Questions “needs attention” 又可能表示需要审核。区分完成、可开始、生成中、需处理；从已保存内容恢复页面，而非仅恢复步骤 |

审核列表的标题与行均为六个网格单元，本轮**没有发现少一列这样的结构错误**；不齐主要来自操作组布局和信息密度。颜色对比、缩放、屏幕阅读器和移动端仍需每页改造时专门验收；本轮未将它们宣称为已复现的无障碍失败。

## 推荐的连续工作流程

`Sources → View learning objectives → Choose what to generate → Live review → Question bank → Student preview`

1. 回到某一步，先看到已有成果及可做的下一步。新增、编辑是明确动作。
2. 生成页只要求老师做最重要的决定：哪些目标、多少题、有什么要求。推荐配比可检查、可修改；高级配置仍保留。
3. 生成被接受后进入本次批次的 Live Review。首题未完成时显示真实阶段和有意义的等待状态。
4. 题目逐个出现。正在写的内容标为 `Drafting`；检查完成并持久化后才能审核。检查过程中展示简明原因和证据。
5. 老师在一个阅读工作区批准、拒绝、修改或暂时跳过；完成后继续下一题。后来到达的题目不抢焦点。
6. Bank 管理所有题目的长期状态；Review 专注待决事项；Coverage 解释供给缺口。这三个任务共享数据，不共享一大张万能表单。

### Learning Objectives 首屏示意

```text
Learning objectives                        + Add learning objectives
15 objectives across 5 topics

Forces and Vectors                                   3 objectives
  Define force as a vector interaction               Edit
  Combine forces to find net force                   Edit
  Identify common forces                             Edit
Newton's First Law                                   3 objectives
  ...

Back                                      Continue to questions →
```

有内容时不显示空白新增表单。可新增到已有 Topic 或新 Topic；取消返回已有列表，保存错误保留输入。

### Questions 首屏示意

```text
Generate questions
What should students practise?
[ Select learning objectives: 15 selected                 ]
[ Suggested question count                               ]
[ Optional instructions                                  ]

Plan summary: objectives · questions · sources
Already available: approved · awaiting review · in progress
Customize distribution ▾                       View sources

Back                                         Generate questions
```

数字来自实际状态，不将“5 道/LO”硬编码为所有课程的强制选择；现有规则决定建议，老师可以调整。缺来源的目标直接显示原因及修复入口。多 LO 组合、配方、材料约束和导入功能保留在合适的高级入口。

### Review 首屏示意

```text
Review questions              This batch: 12 ready · 3 in progress
-----------------------------------------------------------------
Question list     | Full question and options | Checks
Selected question|                           | Sources checked
Next question    | Correct answer            | Needs attention
Drafting...      | Explanation               | Concise reason
                 |                           | View evidence
-----------------------------------------------------------------
Previous   Next          Edit       Reject & archive       Approve
```

宽屏用列表、阅读区、检查摘要；窄屏保留一题阅读与固定操作，列表/检查作为抽屉或折叠区域。不能为塞进“一页”把长题缩小到难读：保证一个工作区、主要判断信息易读、操作始终可达，长解释仍允许滚动。引导版可使用两区布局，但复用同一题目呈现。

## 实时生成：必须真实，而不只是动起来

### 当前基础与缺口

当前已有持久化 content runs、阶段事件、课程 SSE、题目创建结果 ID。生成服务中有逐候选检查与保存，但前端主要按 run 的阶段和结束刷新审核列表；LLM adapter 当前等待完整 JSON 输出。因此「逐题到达」可以建立在已有结果上，「逐字真实输出」还需要模型适配器和结构化片段协议，不是只改 CSS。

建议为一次用户提交明确批次身份和各题身份，关联现有 run，而不是重建所有任务系统。批次状态需要刷新/重连后可恢复，不能仅依赖内存布尔值或最新 30 条运行记录。

### 用户可见事件（待接口设计，不是当前已有 API）

| 事件 | 用户看见什么 | 可操作范围 |
|---|---|---|
| Batch accepted / queued | 本次题目数量、排队状态、来源摘要 | 查看、按现有停止能力结束任务 |
| Question drafting / text delta | 标有 Drafting 的题目片段，逐步更新 | 阅读；不可批准未完成内容 |
| Validation started / result | 结构、数值等真实检查阶段与结果 | 查看简明检查发现 |
| AI review result | Passed checks / Needs attention / Changes recommended，加简短原因 | 查看依据；不当作老师的审核结论 |
| Question saved | 完整题目、版本、可用示例与最终检查信息 | 按现有权限审核 |
| Partial failure / stopped | 哪些已保存、哪些未完成、原因与恢复动作 | 重试明确失败范围；不重复生成成功题 |
| Batch finished | 完成与失败数量、待审核数量 | Review remaining / Generate more |

**展示判断摘要，不展示原始内部思考。** 比如真实检查结果可以写 “The stem assumes constant velocity, but the net force is non-zero.” 并指向对应题干。不要生成一段伪装成 agent 思考的旁白，不显示私有提示词、原始 provider JSON 或敏感服务信息。

流式协议必须处理：稳定 item ID、attempt/version、事件顺序与去重、重连快照、迟到事件、失败和停止、用户离开后恢复、多标签重复提交、课程授权。草稿与最终保存版本必须清晰区分；最终审核使用当前版本冲突保护。

文本按小片段平滑更新，完整数学表达式再渲染公式。若当前模型/工具包不支持真实 streaming，明确呈现阶段＋完成的逐题结果，不能静默宣称已实现 token streaming。该能力差距在第 3 页验收中单独记录。

进度采用真实计数，如 `12 ready · 3 in progress · 1 failed`，不要用阶段索引假装时间百分比。动画只用于新内容到达、按钮反馈与阶段转换；支持 reduced motion；读屏仅播报阶段/计数摘要，不逐 token 播报。用户滚离底部后不自动滚动。

## 视觉方向：安静、清楚的教学审核工作台

特色应该是「完整可读的题目＋可靠的证据与决策区」，而不是发光 AI 图标或大量装饰卡片。

- 沿用现有品牌绿和角色侧栏；本轮方案不改变 Admin 的黑色侧栏＋内容日夜模式。
- 候选浅色色板：画布 `#F7F8FA`、内容 `#FFFFFF`、正文 `#18212B`、次要文字 `#5F6B76`、边线 `#DDE3E8`、主色 `#245F35`。实施时映射现有语义 tokens 并验证对比度，深色模式使用对应语义色。
- 沿用现有字体系统；正文约 16px，页面标题约 24–28px；题干优先可读，编号/时间/来源退为辅助信息。公式复用现有渲染，不新增装饰字体依赖。
- 主按钮只承担一个主要动作，尺寸/间距/顺序统一；元信息不混进按钮组。长数量摘要与按钮标签分开。
- 搜索、列表、分隔线用于组织信息；只为独立对象或操作使用面板，避免卡片套卡片。
- 使用简短英文：`Your learning objectives`、`Generate questions`、`Review questions`、`Awaiting review`；后台 Run ID 仅在详情里。

方法参考：状态可见、用户控制、保持一致、识别优于记忆、减少无关信息，见 [NN/g usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)；高级配比和编辑操作按需展开，见 [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/)。这些原则用于评估本产品，并不意味着照搬某个模板。

## 找到的 skills 与使用建议

| 技能/工具 | 状态 | 本项目用途 |
|---|---|---|
| 本地 `frontend-design` | 已找到并读取 | 以真实用户任务确定视觉层级、布局、配色与动效，减少通用模板感；需要本地代码实现，不能自动解决业务状态 |
| 本地 `writing-plans` | 已读取 | 将审查转成逐页范围、文件定位、可演示验收与停止点 |
| `skill-installer` | 已读取并查询官方目录 | 用于寻找技能，本轮没有安装 |
| 官方 `playwright` / `playwright-interactive` / `screenshot` | 官方目录可用，未安装 | 未来页面浏览器验收；项目已具备 Playwright 测试，本轮已用现有浏览器工具只读检查，无需为了计划先安装 |
| 官方 Figma 系列：`figma`、`figma-generate-design`、`figma-implement-design`、`figma-create-design-system-rules` | 官方目录可用，未安装 | 若后续需要可交接 Figma 设计稿再选用；不作为当前改造前置条件 |

本地文件：

- `/Users/fanhaocheng/.claude/plugins/cache/claude-plugins-official/frontend-design/unknown/skills/frontend-design/SKILL.md`
- `/Users/fanhaocheng/.claude/plugins/cache/superpowers-marketplace/superpowers/6.1.1/skills/writing-plans/SKILL.md`
- `/Users/fanhaocheng/.codex/skills/.system/skill-installer/SKILL.md`

来源：[OpenAI skills 官方目录](https://github.com/openai/skills/tree/main/skills/.curated)、[Anthropic frontend-design 上游](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)。本地缓存版本未假定与上游完全相同。官方目录脚本遇到本机证书验证错误后，使用已登录 GitHub CLI 读取目录；没有关闭 TLS 验证。

## 代码定位与审查边界

| 路径（仓库相对） | 相关范围 |
|---|---|
| `client/src/views/instructor/course-setup-guide.ts` | LO 步骤映射、生成计划/按钮状态、运行订阅、引导审核的文本呈现 |
| `client/src/views/instructor/generation-plan-dialog.ts` | 高级配比、多 LO 组合入口，未来保留能力并收纳 |
| `client/src/views/instructor/preseeding.ts` | 覆盖表与底部长生成表单 |
| `client/src/views/instructor/review-queue.ts` | 行布局、操作组、筛选、批量操作 |
| `client/src/views/instructor/question-detail.ts` | 阅读/编辑混排、报告与底部操作 |
| `client/src/views/instructor/bank.ts` | 题库列表和状态筛选 |
| `client/public/styles/main.css` | `.queue-row`、`.queue-row__actions` 与引导布局，改动必须局部化 |
| `server/src/services/generation-plan.service.ts` | Approved-only 分层配额与逐 cell 入队 |
| `server/src/services/generation.service.ts` | 检查、逐题保存、阶段与结果更新 |
| `server/src/services/content-runs.service.ts` | 持久事件和运行快照基础 |
| `server/src/components/genai/llm/index.ts` | 当前完整 JSON 请求；真实 token streaming 的适配缺口 |

本轮不是全角色、全页面完整验收，也没有重跑自动化或实时 LLM。Student、TA、Admin 只作为共享组件不能破坏的回归边界；后续逐页交付时验证。浏览器实际读取了选项不同的同题干示例，因此不把它们错误记录为完全重复问题。

截图索引：S01 Questions 输入网格；S02 LO 返回；S03 生成按钮栏；S04 刚入队；S05 部分完成后重新可生成；S06 引导审核；S07 完整队列；S08 详情顶部；S09 详情底部；S10 Bank；S11 Coverage；S12 底部生成表单。对应用户本轮附件顺序，未将临时截图文件复制进仓库。

执行顺序与每页验收见 [Stephen 的逐页计划](../superpowers/plans/phase-5/Stephen/2026-09-14-instructor-workflow-redesign.md)。建议先做 Learning Objectives：这是最小而完整的信任修复，能先确认设计风格，再推进生成和审核。
