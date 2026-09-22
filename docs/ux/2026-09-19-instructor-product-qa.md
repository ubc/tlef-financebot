# Instructor 新版 UI / 出题流程：产品与 QA 实操报告

> 后续修复状态见 [修复与复验记录](2026-09-19-instructor-bugfix-verification.md)：11 项已验证，QA10 真实模型重测待授权。以下保留原始发现与复现证据。

测试日期：2026-09-18 至 2026-09-19（America/Vancouver）。

**结论：完整主流程可以走通，但当前版本不建议直接验收。共确认 12 项需要处理的问题：4 项 P1，8 项 P2。其中 5 项复现了 9 月 16 日报告的问题，7 项为本轮新发现。** P1 应在这次 Instructor workflow 发布验收前修复；P2 应列入紧接着的修复批次。这里的等级是本次 QA 的产品影响判断。

本轮完成的是实操、复现和记录，没有修改产品代码。工作区原有的 Admin audit 改动保留，未提交、推送或部署。

## 环境、范围与复现入口

| 项目 | 本轮实际情况 |
| --- | --- |
| 应用 | 本地 `http://localhost:6118`，不是线上生产验收 |
| 版本 | HEAD `c42381f`，主要 UI 更新 `bb237eb`；含工作区既有 Admin diagnostics 改动 |
| 登录 | 真实本地 SAML，普通 Instructor 测试账号 `faculty`，不是 Admin 权限替代测试 |
| 课程 | **QA 918 · Instructor Product QA**，Section QA，Winter Term 1, 2026/27 |
| 课程 ID | `6aadf93abc24b94d79fb02b4` |
| 数据 | 单独新建课程，仅上传本次合成文本；未编辑原有真实课程 |
| AI | 真实材料处理、真实大纲和问题生成；运行记录中 generator / validator / reviewer 为 `gpt-5.6-luna` |
| 浏览器 | Codex in-app browser；桌面正常窗口、1280×720/900，手机宽度 390×844；亮色与深色操作 |
| 重点 | Materials → AI Structure → Generation → Review → Bank → Release → Student Preview；版本、恢复、重试、停止、窄屏 |

[打开 QA 课程](http://localhost:6118/#/instructor/course/6aadf93abc24b94d79fb02b4) · [本轮合成材料](../../audit-results/instructor-pm-2026-09-18/qa-918-finance.txt) · [持久化证据](../../audit-results/instructor-pm-2026-09-18/persisted-evidence.json)

截图是实操页面原图，没有重绘或修改页面内容来伪造证据。部分固定尺寸截图受浏览器面板宽度限制，右边缘有裁切；不将裁切作为产品横向溢出问题。问题判断同时依据实际点击、页面文字、持久化记录或代码定位。

## 需要修复的清单

| ID | 优先级 | 问题 | 主要影响 | 与旧报告关系 |
| --- | --- | --- | --- | --- |
| QA01 | P1 | Setup guide 挡住 Approve | 推荐流程中无法正常点击审批 | 再现 F01 |
| QA02 | P1 | 切换页面静默丢失未保存的审核修改 | 老师编辑工作丢失 | 新发现 |
| QA03 | P1 | 改变题意后仍显示旧 AI PASS | 对未经检查的新版本产生错误信任 | 新发现 |
| QA04 | P1 | Concept check 与隐藏的计算题设置冲突 | 明确要求概念题，却生成计算题 | 再现 F02 |
| QA05 | P2 | 保存单题设置实际固定保存为 3 题 | 数量、等待时间和生成消耗超出预期 | 新发现 |
| QA06 | P2 | 编辑后题目从生成活动列表消失 | 无法完整追踪一批题目的去向 | 新发现 |
| QA07 | P2 | 发布主题后当前题目详情不更新 | 同页给出相互矛盾的发布状态 | 再现 F03 |
| QA08 | P2 | 材料完成后仍显示 classifying | 无法判断是否还需要等待 | 再现 F04 |
| QA09 | P2 | 同一来源证据重复显示 | 引用检查冗长且容易误判证据数量 | 再现 F05 |
| QA10 | P2 | AI 把给出题老师的说明变成学生 LO | 课程大纲混入不属于学习内容的目标 | 新发现，模型质量样例 |
| QA11 | P2 | 主动停止被课程首页归为内容故障 | 下一步推荐要求修复一个主动取消的任务 | 新发现，状态与文案 |
| QA12 | P2 | Run exact retry 丢掉题目 kind | “精确重试”实际改变生成约束 | 新发现 |

## 实际走过的步骤

| 阶段 | 实际操作与结果 |
| --- | --- |
| 登录与创建 | 登录 Instructor，新建课程，选择 Winter Term 1，保存建议的 Sep 8–Dec 7 日期。课程保存成功。 |
| 上传与检查来源 | 上传 `qa-918-finance.txt`，经历解析、分块、嵌入、索引和分类；原文可查看，Structure 可使用。发现 QA08。 |
| AI 课程结构 | 指定 2 个 Topic，明确要求沿用材料里的 3 个 LO 和 Topic 名称；生成过程中刷新可恢复进度。得到 2 Topic / 5 LO。发现 QA09、QA10。 |
| 选择性应用 | 取消不合适的 Objective 2.3，只应用 4 个 LO；保存后是 2 Topic / 4 LO，没有把取消的目标加进课程。 |
| 第一批出题 | 选择 PV 的概念与计算两个 LO，各 1 题；点 Concept check，并明确写“不做数值计算”；真实生成 2/2。发现 QA04。 |
| 审核与编辑 | 查看计算示例、选项、解释、AI assessment；测试 Edit、保存版本、切换页面、Approve。发现 QA01、QA02、QA03。 |
| 发布与题库 | 两题审批后进入 Bank；主题 Release now；短暂发布这个空 QA 课程，题库显示 2 道 Student-visible；随后恢复 Draft。发现 QA07。 |
| 学生预览 | 草稿课程进入隔离 Student Preview；只展示已发布 Topic；使用概念题 Version 2，先答错，再做计算题答对；总结为 2 题 / 1 对 / 50%，错题本增加 1 题。 |
| 高级出题 | 保存 NPV 判断题设置，数量选 1；刷新载入后变成 3，Run setup 实际生成 3 道 True/False。发现 QA05。 |
| 拒绝与恢复 | Reject 一题并填写原因，题目进入 Archived；Restore draft 后回到 Review，内部备注仍在。 |
| 已审批题再编辑 | Bank 编辑概念题，保存为 Version 3 / Pending Review，立即从 Approved Bank 移除；重新审批后恢复收录。 |
| 生成历史 | 返回 Generation activity；修改过的概念题不在生成列表中，随后修改过的判断题也消失。发现 QA06。 |
| 精确重试与停止 | 对计算题 run 重试，两个已完成重试均变成概念题；随后快速停止另一重试，持久化为 generation-ended，0 道新增题。发现 QA11、QA12。 |
| 窄屏与自动化 | 实际操作 390×844 的菜单、Question board、编辑、深色模式；Question board 的 document/body width 均为 390。相关 32 项既有 UI fixture 测试通过。 |

## QA01 · P1 · Setup guide 覆盖审批主按钮

**如何触发**

1. 将浏览器视口设为 1280×720。
2. Course Dashboard → Open setup guide，保留向导开启。
3. 进入 Review Queue，选择一题 Draft，向导处于折叠状态。
4. 点击题目底部的 Approve 位置。

**实际：** Approve 的矩形约为 `x=900.23, y=635, width=73.77, height=36`；中心位置命中 `.setup-island`，不是按钮。真实坐标点击未完成审批。展开向导并 Exit guide 后，相同题目可以审批成功。

**期望：** 引导开启时，Edit / Reject / Approve 始终能正常点击。引导不应和固定操作栏争用同一个位置。

**定位与修复验收：** `client/public/styles/main.css` 中 `#setup-journey` / `.setup-island` 与 `.review-workbench__actions` 的固定／sticky 布局需要共同预留空间。补测折叠、展开、长题滚动、1280×720 和窄屏的真实命中目标，不能只检查按钮是否存在。

临时绕过：Expand setup guide → Exit guide。[命中测试 JSON](../../audit-results/instructor-pm-2026-09-18/guide-hit-test.json)。正常窗口更高时未必重现，尺寸是关键条件。

![底部引导与审批操作栏重叠](../../audit-results/instructor-pm-2026-09-18/29-guide-blocks-approve.png)

## QA02 · P1 · 跨页面导航没有未保存修改保护

**如何触发**

1. Review Queue → Edit。
2. 将 Question stem 改成以 `QA UNSAVED EDIT:` 开头的内容，不保存。
3. 点击左侧 Generate Questions。
4. 再返回 Review Queue → 同一题 → Edit。

**实际：** 页面立即切换，没有保存／放弃确认。返回时修改已消失。先在概念题复现，又在判断题复现。截图中的 `QA UNSAVED EDIT` 没有被写入正式题目版本。

**期望：** 有脏编辑时跨页面、浏览器返回、刷新都有明确的离开保护，或可恢复草稿。

**定位与修复验收：** `review-workbench.ts:79` 的 dirty 确认只保护工作台内部换题；路由离开没有同等保护。应覆盖 sidebar、guide、打开题库／详情、浏览器返回和刷新，并验证“继续编辑”保留所有字段。

临时绕过：导航前手动 Save changes。

![离开前未保存的修改](../../audit-results/instructor-pm-2026-09-18/27-unsaved-edit-before-navigation.png)

![返回后原题覆盖了未保存内容](../../audit-results/instructor-pm-2026-09-18/28-unsaved-edit-discarded.png)

## QA03 · P1 · 编辑题意后继续展示旧 AI PASS

**如何触发**

1. 打开已有 `AI check · PASS` 的 Draft 判断题。
2. 在 Review Queue 内 Edit，将题干从“正名义利润仍可能对应负 NPV”改成：

   `QA regression test — True or false: A positive nominal profit ALWAYS guarantees a positive NPV, regardless of the discount rate.`

3. 保持原来 T 为正确答案的选项，Save changes。
4. 点击 Reload question 再检查。

**实际：** 当前已是 Version 2，题意被反转，界面仍同时显示 `AI checks passed` 和 `AI check · PASS`，说明文字仍在评价旧题；重新加载也不消失。没有发生新一轮 AI 评估，却把原来的通过结果呈现在新版本旁边。

**期望：** 内容变更应使旧结果失效，显示“此版本尚未检查”或明确标注“旧版本结果”；只有新版本的检查才能显示 PASS。

**定位与修复验收：** `review-workbench.ts:164–168` 保存后沿用旧 detail；`questions.service.ts:264,298` 只在 `submitForReview` 时清除 `agentDecision`。应在内容版本变化时处理检查失效，并让检查结果关联被检查的版本。覆盖 stem、选项、正确答案和解释修改，以及保存后刷新。

**数据处置：** 测试仅发生在 QA Draft；错误题意从未审批或供学生使用，已用 Version 3 恢复原文。Version 2 保留为历史复现证据。题目 ID `6aae4eaabc24b94d79fb35ea`。

![题意已反转且为 Version 2，右侧仍显示 AI PASS](../../audit-results/instructor-pm-2026-09-18/32-stale-ai-pass-after-semantic-edit.png)

[完整页面文字证据](../../audit-results/instructor-pm-2026-09-18/stale-ai-visible-text.txt)

## QA04 · P1 · Concept check 不会改变隐藏的生成类型

**如何触发**

1. Generate Questions 选中概念 LO 与计算 LO，各 1 题。
2. More control 保持默认收起，点 Concept check。
3. Instructions 填写：`Test conceptual understanding with a familiar everyday scenario. Do not ask for a numerical calculation.`
4. Generate 2 questions，等待完成。

**实际：** 得到 1 道概念题和 1 道 `$1300 / 两年 / 6%` 的 PV 计算题。计算题 run `803510d2831ea466ec0c1e85` 的 prompt 与上文完全一致，但 `input.kind` 是 `calculation`。没有提示设置冲突，两个 run 均完成并通过 AI 检查。

**期望：** Concept check 应同步明确的 Conceptual understanding 设置；或者提交前清楚提示“当前按 LO 类型生成，其中包含计算题”，让老师处理冲突。

**定位与修复验收：** `generation-workbench.ts:97–105` 自动根据 LO 决定 kind；`:136` 的快捷按钮只填写 prompt。摘要没有显示有效 focus。分别覆盖计算 LO + Concept check、概念 LO + Apply a formula、混合 LO 和手动 focus。

临时绕过：More control → Practice focus → Conceptual understanding。

下图是相同输入的再次复现界面，未为补截图重复提交；原始提交与真实生成结果见持久化证据中的 run。

![概念题要求与两个已选目标](../../audit-results/instructor-pm-2026-09-18/33-concept-request-reproduction-input.png)

![Concept check 后隐藏设置仍为 Match each objective](../../audit-results/instructor-pm-2026-09-18/34-hidden-focus-still-auto.png)

[实际生成的计算题截图](../../audit-results/instructor-pm-2026-09-18/13-edited-question-missing-from-generation.png)

## QA05 · P2 · Saved Setup 无视选择的题目数量

**如何触发**

1. More control → Open advanced generation。
2. Target LO 选 NPV；Question Type 选 True/False；Number of Questions 选 **1**。
3. 填写名称 → Save setup。
4. 刷新页面，重新选择保存的设置 → Run setup。

**实际：** 保存后界面一度仍显示 1；刷新载入后显示 3。实际 run `6aae4e9abc24b94d79fb35ca` 生成 **3/3**。数据库中两次不同名称的保存设置均为 `count:3`。三道题内容高度相近，额外增加审核负担。

**期望：** 保存、载入、执行使用同一数量，摘要和实际生成一致。

**定位与修复验收：** `preseeding.ts:558` 保存时写死 `count:3`；加载设置的 change handler 也没有恢复 `formCount`。应保存并恢复实际数量，覆盖 1、2、5；验证 Run setup 的 run 输入与表单一致。

临时绕过：直接用 Generate 提交当前表单，暂不依赖 Run setup 的数量。

![保存前 Number of Questions 为 1](../../audit-results/instructor-pm-2026-09-18/21-setup-before-save-count-one.png)

![刷新载入后 Number of Questions 为 3](../../audit-results/instructor-pm-2026-09-18/22-setup-after-reload-count-three.png)

[生成的三道判断题](../../audit-results/instructor-pm-2026-09-18/23-truefalse-three-drafts.png)

## QA06 · P2 · 已编辑题目从 Generation activity 消失

**如何触发**

1. 完成一批两题生成，确认 2/2 saved。
2. Review Queue 编辑其中一题并保存新版本。
3. 回到 Generate Questions → Generation activity。

**实际：** 计数仍为 2/2 saved，但列表只剩未编辑的一题。后来生成数量增加到 5 时列表只有 4；最终 7 道已保存题中，两道编辑过的题都不在列表，只显示 5 道。题目并未删除，仍可在 Review / Bank 找到。

**期望：** 一批生成题目的去向可持续追踪；编辑后标注“已编辑 / 已审批”等状态，并链接最新版本或原始生成版本。

**定位与修复验收：** `generation-workbench.ts:217` 只按当前版本的 `provenance.kind === 'generated'` 过滤。编辑版 provenance 变为 edited 后被排除。应以 run 的 createdQuestionIds / 稳定的原始关联追踪，覆盖编辑、审批和归档。

临时绕过：在 Review Queue / Question Bank 搜索题目。不要将列表缺失误判为生成没有保存。

![生成活动列表缺少修改过的题目](../../audit-results/instructor-pm-2026-09-18/35-generated-list-missing-edited-versions.png)

[最终生成活动的完整文字与计数](../../audit-results/instructor-pm-2026-09-18/generation-visible-text.txt)

## QA07 · P2 · Topic release 保存后详情保留旧状态

**如何触发**

1. 在 Question Bank 选一题 Approved，所属 Topic 尚未发布。
2. 在阅读区点 Release topic → Release now → Save topic release。
3. 保持同一题选中，不刷新。

**实际：** 成功提示已出现，顶部变为 `1 of 2 topics released`，左侧变为 `Course not published`；右侧仍显示 `Awaiting topic release`、旧的 Waiting on 和 Release 按钮。刷新后才一致。本轮重复执行“隐藏 → 刷新 → 发布”再次复现。

**期望：** 发布设置保存成功后，列表、详情、主题统计即时一致。草稿课程可仍不可见，但原因应是课程尚未发布。

**定位与修复验收：** `bank-workbench.ts:42–49` reload 更新 tree/rows 后只 draw；`:182` 只有当前题不在列表时才重新 drawReader。覆盖当前题仍在列表时的发布、隐藏、定时变更。

临时绕过：刷新页面或切换题目再回来。

![已发布主题与仍提示等待发布的详情并存](../../audit-results/instructor-pm-2026-09-18/14-topic-release-stale-reader.png)

## QA08 · P2 · 来源完成后仍显示 classifying

**如何触发**

1. Course Materials 上传本轮合成文本，等待 Processing activity 为 completed。
2. 查看 Files 列表，刷新或离开再返回。

**实际：** 同一文件显示 `lecture · classifying`，活动流则是 completed，全部阶段打勾；Course Structure 显示 Ready to use。持久化 ingest run 是 `status:completed, stage:classifying`，不是后台仍在工作。

**期望：** 完成后显示 Ready / Completed；仅运行中的任务展示当前阶段。

**定位与修复验收：** `materials.ts:363` 使用 `run?.stage ?? material.status`，最后阶段覆盖终态。覆盖 SSE 完成、刷新恢复和失败／主动停止状态。

临时判断方式：查看 Processing activity 的终态和 Structure 的 Ready to use。

![文件列表 classifying 与处理完成状态冲突](../../audit-results/instructor-pm-2026-09-18/02-material-status-conflict.png)

## QA09 · P2 · 大纲证据重复呈现同一原文

**如何触发**

1. Course Structure → AI draft，打开本轮已完成的大纲。
2. Objective 1.1 → `1 supporting material · View evidence`。

**实际：** 相同 `qa-918-finance.txt · Section 2` 的同一长引用连续显示 **4 次**，每次都有 Show passage in context；随后还有第 5 条不同的续文。这里不是上传了四份文件，而是引用呈现重复。

**期望：** 同一 source span 合并展示一次，可以额外列出它支撑哪些学习点。

**定位与修复验收：** `structure-ai-workbench.ts:235–237` 按 evidence ID 逐条输出，没有按 material/chunk/quote 去重。验证同段支撑多个 evidence ID 时只显示一次，同时保留不同段落。

![相同段落在证据区连续出现](../../audit-results/instructor-pm-2026-09-18/05-duplicate-source-evidence.png)

[完整可见引用文本：可核对四次重复](../../audit-results/instructor-pm-2026-09-18/visible-structure-evidence.txt)

## QA10 · P2 · 出题说明被当成学生学习目标

**如何触发**

1. 上传本轮文本：正文包含两个 Topic、三个明确的学生 LO；末尾另有 Question authoring constraints。
2. AI draft 设置 2 Topics，guidance 填：

   `Use the three learning objectives explicitly listed in the material. Keep conceptual explanation separate from numerical calculation. Preserve the two topic names.`

3. 生成并检查建议大纲。

**实际：** 得到 5 个 LO，两个 Topic 名也被改写。Objective 2.3 是 `Design clear assessment items ...`，要求学生设计题目、分开概念题和计算题、提供唯一正确选项、让解释匹配数值；这些来自给出题系统／老师的说明，不是本课程的金融学习目标。界面同时称 `24/24 learning points mapped`。

**期望：** 区分教学内容和出题／文档元说明；明确指定沿用的 LO 数量和名称不应被静默忽略。来源不确定的目标应提示老师确认。

**证据边界：** 这是一次真实模型输出中确认的质量问题，不声称每次模型调用都产生同一错误。建议将这份材料作为固定质量回归样例，而不是只写一个固定字符串断言。

临时绕过：应用前取消 Objective 2.3；本轮已这样处理，只保存 4 个 LO。[大纲结果与原始输入](../../audit-results/instructor-pm-2026-09-18/structure-result.json)。

![给出题者的说明进入了学生 Objective 2.3](../../audit-results/instructor-pm-2026-09-18/06-authoring-instructions-as-student-objective.png)

## QA11 · P2 · 主动结束生成被首页当作故障

**如何触发**

1. Advanced generation → 对已完成任务点 Run exact retry。
2. 任务运行期间 End run → 确认 End run。
3. 返回 Course Dashboard。

**实际：** 生成页正确显示 `ended · during Generating · 0/1` 和 `Ended by an instructor`；课程首页却新增 `Content Issues: 1`，把最高的下一步推荐变成 `Repair content processing issues / 1 failed or partial ... need attention`。

**期望：** 主动取消与处理故障有不同展示；取消不应自动要求“修复”。必要时提供可选的重新生成入口。

**定位与修复验收：** 停止 run 使用 `status:failed` + `error.code:generation-ended`；`preseeding.ts:190` 已将其显示为 ended，但 `instructor-workflow.service.ts:157–172,413` 的汇总只看 failed/partial。应在 read model 中区分，覆盖真实失败、部分完成和主动结束。

不把此现象描述为“禁止发布”：本轮没有证明它构成发布硬门槛，确认的是误导性故障状态与下一步推荐。

![生成页面正确显示主动结束](../../audit-results/instructor-pm-2026-09-18/30-exact-retry-stopped.png)

![首页却要求修复内容处理故障](../../audit-results/instructor-pm-2026-09-18/36-intentional-stop-shown-as-content-issue.png)

## QA12 · P2 · 精确重试遗漏 kind 并改变出题类型

**如何触发**

1. 打开本轮原计算题 run `803510d2831ea466ec0c1e85`。
2. Advanced generation → Recent Generation Activity → 对该 run 点 Run exact retry。
3. 等待新 run 完成，检查题目及持久化输入。

**实际：** 原 run 有 `kind:calculation`；重试 `6aae504ebc24b94d79fb3683` 没有 kind，虽然 LO、数量、difficulty、prompt 和模型 ID 保留。原题要求计算 `$1300` 的现值，重试变成“哪个变化会降低现值”的纯概念题；第二次重试同样产生概念题。差异不是只换了随机数值。

**期望：** “精确重试”应保留原生成约束，包括 kind。可以产生新措辞／随机参数，但不能悄悄丢掉题目类型约束。

**定位与修复验收：** `generation-blueprints.service.ts:178–198` 重建 enqueue 输入时漏传 `run.input.kind`。比较语义字段时排除正常新增的 retryOfRunId，再检查完整生成约束；覆盖 conceptual、calculation 和 mixed/未指定。

此问题与 QA04 分开：QA04 是首次提交时 UI 意图冲突，QA12 是已存在的任务快照在重试时被改变。

![原计算题任务的重试结果成为概念题](../../audit-results/instructor-pm-2026-09-18/37-exact-retry-changed-calculation-to-concept.png)

[参数差异与原／重试题目内容](../../audit-results/instructor-pm-2026-09-18/persisted-evidence.json)

## 已验证正常的部分

- 真实 SAML Instructor 身份、课程创建、日期保存、材料处理、刷新恢复大纲任务、只应用选中 LO。
- 初始两题成功落库；草稿编辑创建新版本；明确审批后进入题库。
- Bank 编辑已审批题目会回到 Pending Review，并从 Approved Bank 移除；Version 3 可重新审批。
- Reject 会归档，备注保存；Restore draft 会回到 Review，备注保留。
- 主题发布与课程发布是独立条件；短暂发布 QA 课程后，Bank 正确显示 2 道 Student-visible。回到 Draft 后不可供真实学生练习，但 Student Preview 仍可测试。
- Student Preview 使用当时最新的概念题 Version 2，错误反馈指向 D；计算题生成另一组参数 `$1400 / 两年 / 8%`，正确答案 `$1200.27`。独立计算验证 `1300/1.06²=1157.00`、`1400/1.08²=1200.27`，与选项和解释一致。
- Preview 总结与错题本正确。数据库只产生 2 条 previewAttemptRecords 和 1 条 previewStudentSession；同 QA 课程的真实 attempts、mastery、reviewBook、flags、sessionSummaries、roster 均为 0。
- 主动停止后最终无继续落题：该 run 的 createdQuestionIds 为空；所有 QA run 结束，无 queued/running 留下。首次两次停止确认前任务已完成，被保留为 completed，没有误判为停止成功。
- 390×844 下实际 Question board 和编辑可操作；相关现有桌面／深色窄屏可访问性测试通过。

### 自动化结果及其限制

本轮运行相关 **32 项现有 Playwright UI fixture 测试，32 passed（25.4 秒）**：

| Suite | 用例数 |
| --- | ---: |
| bank-workbench | 7 |
| generation-workbench | 9 |
| review-workbench | 10 |
| setup-journey | 3 |
| structure-ai | 3 |

运行命令：`npx playwright test --config audit-results/instructor-pm-2026-09-18/playwright.qa.config.ts`

[运行日志](../../audit-results/instructor-pm-2026-09-18/ui-fixture-run.log) · [结构化结果](../../audit-results/instructor-pm-2026-09-18/ui-fixture-results.json) · [本轮配置](../../audit-results/instructor-pm-2026-09-18/playwright.qa.config.ts)

这些是拦截接口的组件／页面级浏览器测试，与前面的真实服务实操分开统计。现有的“未保存修改”用例只覆盖工作台内换题，不覆盖 sidebar 离开；独立 guide 和 reader 测试也不能证明组合后按钮不被遮挡。修复时必须把上面每项的验收条件加入回归，不能只重跑这 32 项。

本轮未重复运行整个仓库的所有单元、旧版端到端、所有角色与全站 axe；未覆盖所有上传格式、生产网络故障、并发教师冲突、大规模题库、全部模型组合或所有题目数学种子。材料上传期间一次工具调用异常长时间等待，持久化实际处理约 5 秒，因此未将工具等待算作产品性能 bug。

## 产品建议与不计入 bug 的观察

- 自动生成的 LO 很长，直接复用在导航、预览标题和列表中，扫读负担明显。建议使用简短名称配合完整目标描述。这是改进建议，不额外计入上述 12 项。
- 每个 LO 只生成 1 题时，Balanced 实际分配为 easy，而摘要称 Mixed difficulty；建议摘要展示实际数量分布。未独立列为阻断问题。
- Create course 在 9 月默认 Winter Term 2，代码明确意图是预选下一个学期，因此未判为日期计算 bug。可考虑更清楚地标注“下一学期”。
- 多 LO 组合不支持保存为 Saved Setup，界面已禁用 Save setup 并给出说明；不认定为“保存后丢失额外 LO”。
- 生成完成到 setup guide 更新有约一个轮询周期的延迟，随后自行恢复，未判为永久卡住。
- 旧报告 F06 的资料页红色按钮对比度问题本轮没有重新独立验证，不因这里的 scoped axe 全绿就宣称已经解决。

## 最终数据与修复顺序

QA 课程最终为 **Draft / published=false**，2 个 Topic、4 个 LO、7 道题（2 Approved、5 Draft），无真实学生记录、无正在运行的任务。第一 Topic 保持已发布，方便后续用隔离 Preview 复现；第二 Topic 保持未发布。测试错误题干已经恢复，原错误 Version 2 仅留在历史中。

关键复现对象：

| 对象 | ID / 状态 |
| --- | --- |
| 材料 | `6aae4c1bbc24b94d79fb347c` |
| 大纲 run | `6aae4c3bbc24b94d79fb34a2` |
| 原概念题 | `6aae4cd8bc24b94d79fb3529`，Approved Version 3 |
| 原计算题 | `6aae4cdabc24b94d79fb352c`，Approved Version 1 |
| AI PASS 失效复现题 | `6aae4eaabc24b94d79fb35ea`，当前 Draft Version 3 已恢复原文；历史 Version 2 是测试错误题意 |
| 数量错误 Saved Setup | `6aae4e8fbc24b94d79fb35c0`，`QA 918 NPV conceptual TF` |
| 主动停止 run | `6aae508abc24b94d79fb36b1`，generation-ended，0 新题 |

建议先修 **QA01 / QA02 / QA03 / QA04**，再修生成快照与可追踪性 **QA05 / QA06 / QA12**，最后统一状态和证据呈现 **QA07 / QA08 / QA09 / QA10 / QA11**。这是修复优先顺序，不表示后面的确认问题可以忽略。
