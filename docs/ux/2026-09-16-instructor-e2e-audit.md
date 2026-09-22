# Instructor Workflow 端到端验收 · 2026-09-16

验收版本：`e3732a0`（主要改版 `a39c745`），本地 `http://localhost:6118`。重新构建成功。MongoDB、Qdrant、Academic API 健康；真实本地 SAML 登录。真实 AI 使用运行环境配置的 `gpt-5.6-luna`，只使用仓库的合成教学资料。

**结论：主链路可以完成，但还不能给新版无条件通过。确认了 6 项产品/体验问题，其中审核按钮被引导遮挡最应优先修复；另有教程回归需单独定位，以及大量旧端到端用例未随导航更新。** 本轮是测试与问题报告，没有修改应用代码、提交或推送。

## 实际走过的完整流程

在新建的独立课程 **QA 916 — Instructor Workflow Audit / Section QA** 中：

1. CWL 登录 → My Courses → 创建课程 → 保存推荐学期日期。
2. 开始课程准备 → 手动创建 Topic 和 LO → 返回页面验证已保存内容。
3. 上传 `tests/fixtures/sample-material.md` → 真实解析、分块、嵌入、索引、分类 → 查看正文。
4. 真实 AI 生成大纲 → 查看证据 → 将 5 个目标应用到课程；已有同名目标得到复用。
5. 选择一个 LO、数量 1 → 提交真实 AI 出题 → 获得完成的参数化题目、计算示例和 AI 检查结果。
6. 进入 Review Queue → 复现引导遮挡 → 退出引导 → 批准 → Question Bank。
7. 发布 Topic → Student Preview → 获取不同参数的题目 → 正确作答，核对反馈中的数值与公式 → 退出 Preview。
8. 发布课程 → 题库显示 Student-visible → 编辑题干 → 保存新版本并回到 Pending Review；题目从 Approved Bank 移除。
9. 结束时将 QA 课程恢复为 **Draft**，保留 Version 2 待审核，用于复现。没有向真实班级发布或修改原有课程内容。

QA 课程：`6aaacafb567c49e10991407f`；Topic：`6aaacb16567c49e109914082`；题目：`6aaadb71567c49e10991409a`。
[打开 QA 课程](http://localhost:6118/#/instructor/course/6aaacafb567c49e10991407f)

## 确认的问题

### F01 · P1 · Setup Guide 遮住审核主操作

**复现：** 桌面 1280×720；从 Course Dashboard 打开 setup guide，进入 Review Queue，选中待审核题。折叠后的引导岛位于页面底部，和题目固定操作栏重叠。

**实际：** Approve 按钮的矩形为约 `x=900.25, y=635, width=73.75, height=36`。其中心的命中元素是 `.setup-island` / `.setup-island__expand`，不是 Approve。手工点击没有完成审批；退出 guide 后批准成功。真实页面的独立命中测试也失败。

**影响：** 老师沿推荐引导路径走到 Review，却无法正常点主要操作。键盘可能仍能操作，不意味着鼠标路径可接受。

**定位：** `client/public/styles/main.css` 的 `#setup-journey` / `.setup-island` 固定定位和 Review 固定页脚组合；仅设置 `.outlet { scroll-padding-bottom: 96px }` 并未给操作栏实际让位。

**验收建议：** 将 guide 与审核操作布局协调；分别测试展开/折叠、1280×720/手机、长题、滚动到底部，确保 Edit/Reject/Approve 的实际点击目标不被覆盖。

![引导遮挡审核按钮](../../audit-results/screens/guided-review-overlap.png)

### F02 · P1 · 概念题要求与隐藏的 calculation 设置冲突且无提示

**复现：** 选计算型 LO，保持 More control 默认收起；填写：

> Create one conceptual multiple-choice question about how increasing the discount rate changes present value. Avoid numeric calculations.

数量设为 1 后生成。

**实际：** 后端持久化 run `efb2079bd363494540a1dd17` 的 `input.prompt` 正是上述指令，但 `input.kind` 为 `calculation`；生成的是“$1000、4 periods、10%”的现值计算题。任务正常完成，未提示冲突。

**原因证据：** `generation-workbench.ts:102` 在自动模式按 LO kind 选题型；约第 136 行的 Concept check 快捷按钮只改文本，没有同步 question focus。More control 中可以手动改 Conceptual understanding，但主界面没有暴露这种优先关系。

**影响：** 老师合理地认为 brief/Concept check 表达了任务，却花费时间等待不符合要求的题。不是“prompt 没发送”，而是矛盾设置被同时发送。

**验收建议：** 快捷意图与具体 focus 联动；提交前摘要显式显示 conceptual/calculation，并处理与 brief 的冲突。保留原 prompt 的持久化行为。

### F03 · P2 · Topic release 保存后左右状态矛盾

**复现：** Question Bank 选中一题，点击阅读区 Release topic → Release now → Save topic release，不改变选中题目。

**实际：** 顶部变成“1 of 1 topics released”，左侧题目变成“Course not published”（已发布课程为 Student-visible），但右侧仍显示“Awaiting topic release / Waiting on: Capital budgeting”，且保留 Release 按钮。重新进入页面后正确。

**独立验证：** 使用原 bank-workbench fixture 增加“保存 release 后当前阅读区立即更新”断言。左侧 Student-visible 断言通过，右侧断言失败，收到旧状态。

**定位：** `bank-workbench.ts:42–49` reload 更新 tree/rows 后仅 draw；约第 182 行只有 activeId 不在列表时才重新 drawReader，当前题仍在列表便留下旧内容。

**验收建议：** release 更新后重绘当前阅读区；同时保护异步读取版本顺序。覆盖立即发布、改为隐藏、改为定时三种状态。

[失败截图](../../audit-results/reproduction/audit-bank-AUDIT-release-r-88039-tly-open-reader-immediately-chromium/test-failed-1.png)

### F04 · P2 · 资料已完成仍持续显示 classifying

**复现：** 上传资料，等待 Processing activity 显示 completed；检查左侧 Files 列表，重新进入页面仍可看到。

**实际：** 同一份资料的左侧为 `reference · classifying`，右侧/活动流为 completed，Structure 页则显示 Ready to use。持久化 ingest run 的 status=completed、stage=classifying。

**定位：** `materials.ts:360–364` 直接使用 `run?.stage ?? material.status`；终态 run 仍保留最后阶段，所以永远优先显示 classifying。

**验收建议：** 活跃 run 才展示阶段；终态展示 Ready/Failed/Stopped 等用户状态。验证 SSE 完成、刷新、重连三条路径。

### F05 · P2 · AI 大纲同一证据段重复 5 次

**复现：** 使用本次单文件大纲，打开第一个 LO 的“1 supporting material · View evidence”。

**实际：** `sample-material.md · Section 1` 和完全相同的全文引用、Show passage in context 连续重复 5 次。材料本身很短，5 条证据均引用了同一整段文本。

**定位：** `structure-ai-workbench.ts:235–237` 按 evidence ID 直接输出，没有按 material/chunk/quote 合并。同一段支撑多个 extracted objective 时会重复。

**验收建议：** 同一 source span 只显示一次，另列所支持的学习点。没有证据表明数据库存了 5 份上传资料；这是引用呈现重复。

附带质量观察：既有 NPV 目标被保留并关联到只解释 PV/annuity/perpetuity 的来源。来源相关不等于完整支撑 NPV；本次未把这一单次模型判断归为确定性生成算法 bug。

### F06 · P2 · 已加载资料页红色按钮对比度不达标

**复现：** 桌面资料页选中已处理资料，在停止动画、等待内容加载后的状态执行 axe WCAG A/AA 扫描。

**实际：** `.btn--danger`（Move to Trash）白字 `#ffffff` / 红底 `#d1495b`，13.6px 普通字，测得 **4.36:1**，要求 4.5:1。正式 Instructor a11y fixture 没有覆盖到这个 populated state，因此其通过不抵消本问题。

**定位：** `client/public/styles/main.css:489` 一带按钮颜色；应同时检查主题 token 与 hover。

[实际资料页](../../audit-results/screens/1280-materials.png)

## 需进一步定因的教程回归

真实 `role-experience-integration` 的 Review 首次教程用例等待 dialog 失败。手工在 Help 选择 Review and approval 重放，首次检查也只看到队列；后来一次交互前出现了教程，所以**不能宣称重放始终无法使用**。

确定的代码问题是第一步 `review-filters` 锚点位于默认折叠的 Bulk actions 中（`review-queue.ts:243,262`），而可见 search/type/sort 在另一个容器。教程目标选择只检查布局矩形/visibility，没有判断折叠 details 祖先（`tutorials.ts:60–63`）。本次观察到 Bulk actions 未展开但 anchor 仍报告非零矩形。

建议独立重现首次进入/重放/后台 enrichment 的时序，改用实际可见筛选工具栏作为锚点，再验证两步教程与完成状态持久化。此次手工测试改变的 Review tutorial 状态已恢复到原先 completed。

## 自动化结果与失败分类

不要把下面不同批次重复覆盖的用例相加成“独立通过数”。所有日志在 [audit-results/logs](../../audit-results/logs)。

| 批次 | 结果 | 说明 |
|---|---:|---|
| Build | 通过 | server/client 均重新编译 |
| 单元/接口测试 | 109 suites / 1432 tests 全通过 | 不代表真实 UI 主链路通过 |
| 新版 UI/相关旧回归混合批次 | 60 通过、5 失败 | 失败：旧 Bank Generate/Saved Setup 入口、3 个旧 Settings tooltip 路径 |
| 原始真实 Instructor 批次 | 3 通过、7 失败、1 跳过 | 旧 guided modal、旧 Edit 标签、旧 Enrollment 路径；live-LLM gated test 默认跳过 |
| 临时适配新版导航后 | 6/6 通过 | 4 个真实 roster CSV/粘贴测试；2 个 Preview/跨标签 flag 隔离测试 |
| 原始全页 Instructor a11y | 超时 | 未切换 Enrollment 就寻找上传控件 |
| 临时适配 Enrollment 的 a11y | 1/1 通过 | 含名单 preview，真实服务 |
| QA 课程 13 页 × 2 宽度 | 手机组通过；桌面组发现 F06 | 1280×720、390×844；均无 document 水平溢出；不是所有页面所有状态的可访问性证明 |
| 新增 guided review 命中测试 | 失败，证实 F01 | 不提交审批，仅检查真实可点击目标 |
| 新增 release reader 测试 | 失败，证实 F03 | 独立模拟 API fixture，无真实修改 |
| 扩展真实回归 | 6 通过、5 失败 | 详见下方 |

扩展回归失败分析：

- Exam Prep 已走过提交前隐藏答案、恢复、提交结果和持久化，失败在最终 Instructor analytics 的旧文本断言。不能把整个用例记为通过。
- numeric-parameterization fixture 的第三个选项没有“一选项恰好一个 computed value”，被更早的内容验证拒绝；旧测试却期望先收到 division by zero。需更新 fixture，不能放宽安全验证来迁就测试。
- Analytics help 用例寻找旧按钮 Replay，新 UI 是 Replay walkthrough。
- aggregate/individual 权限用例的接口 200/403 检查已通过，失败在旧标题 Where to focus；新页面的后续 UI 断言未执行。
- Review 首次教程失败如上，尚未完全定因，不与普通标签失效混为一谈。

这些测试盲点需要修复：当前旧 pipeline 在早期 modal 就停住；旧 live LLM 用例仍寻找 Question Bank Coverage。新增专项 fixture 直接挂载组件，缺少真实 shell + setup island 的组合，所以没有抓到 F01。

## 证据、复跑与边界

- [26 张页面截图及遮挡截图](../../audit-results/screens)
- [日志](../../audit-results/logs)
- [临时测试源码](../../audit-results/repro-source)：为避免默认测试套件依赖本次 QA 课程，已从 tests/ 移出。源码旁 README 说明复跑方式。
- 截图在第二次稳定性补测中关闭动画并等待加载控件消失；最初“无 axe 问题”的快照被最终 F06 结果修正。浏览器文件选择器的一次调用延迟不用于衡量应用上传性能。
- 手工真实 AI 只跑了一个小文件大纲和一道题；不代表长 PDF、大批量、多并发或模型随机输出都已验证。
- 宽度扫描覆盖 Dashboard、Materials、Structure、Generate、Review、Bank、Coverage、Analytics、Flags、Import、Exam Templates、TA、Settings。空的 Flags/TA/Exam 页面扫描不能代替每一个写操作验收。
- 没有发送 TA 邀请邮件、部署、合并、删除真实课程或做负载测试。自动化沿用仓库 fixture 的初始化/清理机制；手工 QA 课程保留为草稿以便复现。
- 用户原有未跟踪目录 `docs/design/people-access/` 未修改。

优先顺序：先修 F01 和 F02，再修 F03/F04 的状态一致性；同时恢复真正的新流程端到端测试，之后处理引用呈现、教程与对比度。当前证据足以开出具体修复项，不适合用“单测全绿”作为上线验收结论。
