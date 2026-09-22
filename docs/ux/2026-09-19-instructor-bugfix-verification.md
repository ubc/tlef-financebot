# Instructor workflow — 修复与复验记录

日期：2026-09-19。对应 [产品 QA 报告中的 QA01–QA12](2026-09-19-instructor-product-qa.md)。

**11 项已修复并验证；QA10 已改进实现，真实模型质量复验待授权。** 修改已在本地编译运行，未提交、推送或部署。工作区原有 Admin diagnostics 和其他用户改动保留。

## 逐项结果

| ID | 修复 | 验证与状态 |
| --- | --- | --- |
| QA01 | 引导条按实际高度预留页面空间，展开/收起自动更新；审批操作保持在可点击区域 | 已通过。真实 QA 课程 1280×720：收起时 Approve 底边 571、引导顶边 640；展开时分别 416、485。两次按钮中心命中 Approve。自动测试检查页面操作与引导区域分离 |
| QA02 | 审核编辑增加离页确认，取消保留输入；刷新/关闭有浏览器提示；角色切换前也执行保护 | 已通过。真实侧栏跳转弹出确认；自动测试验证取消、确认、浏览器离页事件及先于 shell 的拦截。引导步骤只在导航被接受后更新 |
| QA03 | 内容新版本保存时清除旧 AI 评估；内联编辑使用版本号避免覆盖；页面同步清除评估；读取旧 edited 版本时隐藏历史遗留评估 | 已通过。服务及 UI 测试通过；真实 QA 的旧 Version 3 已显示 AI check unavailable，原题数据未被批量修改 |
| QA04 | Concept check / Spot a misconception 显式选择 conceptual；Apply a formula 选择 calculation；批次摘要显示实际模式 | 已通过。3 个快捷项逐一检查提交参数；真实界面显示 Conceptual understanding |
| QA05 | 保存 setup 使用当前题数，选回 setup 恢复其题数 | 已通过。UI 回归：选择 1 → 保存请求 count=1 → 改为 5 → 重新选择 setup → 恢复 1 |
| QA06 | 生成历史通过 run.result.createdQuestionIds 关联题目，保留旧 provenance 的兼容读取；Review 链接仍指向原 run | 已通过。模拟 edited 版本仍出现在列表；真实课程 7 道题全部可见，包含已编辑的概念题与判断题 |
| QA07 | 主题发布后刷新当前打开的题目详情，而不只刷新左侧列表 | 已通过。保存发布后，不切换题目即显示 Student-visible |
| QA08 | 只有 queued/running 显示处理阶段；完成后显示材料终态 | 已通过。模拟和真实材料均显示 lecture · ready，未残留 classifying |
| QA09 | 相同 materialId、chunkIndex、quote 的证据合并显示；不同来源或不同原文保留 | 已通过。3 条证据含 1 条重复时显示 2 段原文 |
| QA10 | 提取阶段明确排除教师/AI/出题规则，提前传入教师指导；要求保留显式目标；综合阶段增加原文证据，避免只看到改写后的学习点 | **未关闭。** 类型、构建和现有结构服务测试通过，但没有重新调用真实模型，不能据此保证原来的质量样例已解决 |
| QA11 | 聚合状态带上失败原因；主动结束 generation-ended 不计为故障，也不触发修复推荐 | 已通过。服务测试通过；真实课程 Content Issues 从 1 变为 0，推荐恢复为 Review pending questions；停止记录仍保留 |
| QA12 | exact retry 复制原始 kind，保留概念/计算约束 | 已通过。服务测试比较原始输入、模型、来源与 calculation kind 的重试请求 |

## 自动验证

- `npm run build`、`npm run typecheck`、`npm run lint`、`git diff --check`。
- 全量单元/集成：114 suites、1457 tests 全部通过。[结果 JSON](../../audit-results/instructor-fixes-2026-09-19/unit-results.json)。
- Instructor 浏览器回归 **40 tests 全部通过**，使用 `npx playwright test --config playwright.instructor-qa.config.ts`；接口使用隔离 fixture，不创建真实学生数据。[结果 JSON](../../audit-results/instructor-fixes-2026-09-19/ui-results.json)。
- 本地真实页面复验使用既有隔离课程 `QA 918 · Instructor Product QA`，未发布课程、未写入学生练习记录。本轮临时编辑文字已取消，没有保存。

## 修复后截图

审批按钮与引导条分离，且旧评估已隐藏：

![1280×720 审核页](../../audit-results/instructor-fixes-2026-09-19/review-guide-clear-1280.png)

[展开引导后审批仍可点击](../../audit-results/instructor-fixes-2026-09-19/review-expanded-guide-clear.png) · [未保存离页提示](../../audit-results/instructor-fixes-2026-09-19/unsaved-navigation-warning.png) · [明确的概念模式](../../audit-results/instructor-fixes-2026-09-19/concept-focus-explicit.png) · [编辑后的题目仍在生成历史](../../audit-results/instructor-fixes-2026-09-19/edited-questions-retained.png) · [材料 ready](../../audit-results/instructor-fixes-2026-09-19/material-ready.png) · [课程首页不再误报故障](../../audit-results/instructor-fixes-2026-09-19/dashboard-no-false-failure.png)。

## QA10 的剩余验收

自动审批拒绝了真实模型重测：理由是会把本地 QA 教学文本发送给配置的 AI 服务，要求明确授权。已经询问是否允许发送这份虚构测试文本；收到允许前不执行，也不将该项标记为通过。

待运行的 [验证脚本](../../audit-results/instructor-fixes-2026-09-19/check-structure.ts) 仅用 [原 QA 合成材料](../../audit-results/instructor-pm-2026-09-18/qa-918-finance.txt)，创建隔离临时材料并在结束时清理。验收要求：保留原来的 2 个主题名、恰好 3 个学生学习目标、不把教师出题要求提升为 LO。输出将保存为 `structure-live-result.json`；如果仍失败，继续调整并重新验证。
