# FinanceBot 全功能手工测试教程

最后更新：2026-08-03

这份教程面向第一次验收 FinanceBot 的 Instructor、TA、Admin 和开发者。目标不是“把页面点一遍”，而是验证一条数据从课程配置、内容制作、发布、学生作答，最终进入 Review Book、Exam Results 和 Analytics 的完整闭环。

## 1. 测试前准备

### 1.1 启动依赖

首次安装：

```bash
npm install
cp .env.example .env
npm run saml:fetch-cert
npx playwright install chromium
```

需要保持运行的共享服务：

- MongoDB：`localhost:27017`
- SimpleSAML IdP：`localhost:6122`
- Qdrant：`localhost:6333`
- Classes demo 需要 FakeAcademicAPI：`localhost:3689`

启动 FinanceBot：

```bash
npm run dev
```

打开 `http://localhost:6118`。先检查：

```bash
curl http://localhost:6118/api/health
```

预期 MongoDB、Qdrant 和 Academic API 显示可用；如果只测试非 RAG 页面，Qdrant 不可用不会影响大多数工作流。

### 1.2 测试身份

本地 IdP 的密码与用户名相同：

| Persona | 登录名 | 密码 | 用途 |
| --- | --- | --- | --- |
| Instructor | `faculty` | `faculty` | 建课、内容、题库、Analytics、Student Preview |
| Student | `student` | `student` | 注册、Topic Practice、Review Book、Exam Prep |
| TA candidate | `staff` | `staff` | 接受 TA 邀请后测试 TA Workspace |

Admin 不是由 SAML faculty affiliation 自动获得的。把 Admin 测试账号的 PUID 加入 `.env` 的 `ADMIN_CWL_ALLOWLIST`，重启服务，再重新登录。PUID 可以先从 Admin Directory、MongoDB 测试记录或 `/api/auth/me` 获取。不要在共享 staging 上把真实普通用户临时设为 Admin。

### 1.3 建议的验收数据

创建一门专用 Sandbox 课程，例如：

- Course name：`Manual QA 2026-08-03`
- Course code：`QA101`
- Term：`2026W1`
- Topic：`Time Value of Money`
- LO 1：`Calculate present value of a single future cash flow`
- LO 2：`Compare nominal and effective interest rates`

至少准备：

- 一个可解析的 PDF/Markdown material；
- 每个 LO 一道 Approved MCQ；
- 一道 Draft；
- 一道 Pending Review；
- 一个有效的 midterm Exam Template；
- Instructor、Student、TA 三个测试身份。

始终使用 Sandbox 课程。测试完优先 Archive，而不是在共享环境删除真实课程。

## 2. 自动化测试基线

提交人工验收前运行：

```bash
npm run typecheck
npm run lint
npm run build
npm test
npm run test:e2e
npm run test:a11y
```

各层含义：

- `typecheck`：Server/Client strict TypeScript contract。
- `lint`：未处理 Promise、无效代码和风格问题。
- `build`：生产形态的 Server 与原生 ES module Client。
- `test`：服务、状态机、授权、routes、mastery、generation 等单元/集成测试。
- `test:e2e`：真实 SAML、MongoDB 和 Chromium 的用户闭环。
- `test:a11y`：WCAG A/AA 的 axe 扫描。

只复查本次 UI 回归：

```bash
npx playwright test tests/e2e/responsive-workflows.spec.ts
npx playwright test -c playwright.a11y.config.ts tests/a11y/a11y.spec.ts
```

失败时打开报告：

```bash
npm run test:report
```

## 3. Admin 验收

### 3.1 Instructor Grants

1. 以 Admin 登录，进入 **Instructor Grants**。
2. 搜索已有用户，确认姓名、CWL、PUID 与当前 Instructor 状态一致。
3. 输入一个尚未登录的测试 PUID，点击 **Add as Instructor**。
4. 预期出现 `Pending first login`；用户首次以相同 PUID 登录后自动激活。
5. 对已有测试用户 Grant，再 Revoke。
6. Revoke 确认框取消一次，再确认一次。

通过标准：faculty affiliation 本身不能获得 Instructor；Grant/Revoke 后下一请求立即生效；Admin 身份与 Instructor Grant 相互独立。

### 3.2 User Directory

1. 进入 **User Directory**，分别用姓名、CWL、email、PUID 搜索。
2. 检查长 PUID 和 24-character course ID 不被截断。
3. 给测试用户分配 Student、Instructor、TA course role。
4. 移除普通 role；尝试移除课程最后一位 Instructor，确认 orphan warning 出现。
5. 对非 Admin 测试用户执行 Deactivate；取消确认一次，再确认。
6. 用该用户登录，预期无法进入；再 Reactivate 并重新登录。

通过标准：记录不会因 deactivation 删除；Admin 不能在此页被误停用；错误显示在页面 status 区而不是只出现在 console。

### 3.3 Capability Matrix

1. Course ID 留空，点击 **Load matrix**，加载 platform defaults。
2. 检查 Student、Instructor、TA、Admin 四列及 effective source。
3. 修改一个允许修改的 TA/Instructor capability，保存并重新加载。
4. 输入一门 Sandbox 的 24-character course ID，建立 course override。
5. 再次加载，确认 source 从 `default` 变成 override 来源。
6. 尝试观察 Admin checkbox、TA Approve、TA Resolve：必须 disabled。

通过标准：Admin 永远开启；TA 永远不能 Approve question 或 Resolve flag；platform default 与 course override 不互相覆盖。

### 3.4 Platform Settings

1. 检查 Generator、Validator、Reviewer、Mastery evaluator 四个 model ID。
2. 修改一个测试 model ID 后保存，再刷新确认持久化；随后恢复。
3. 修改 `Maximum generations per day`，验证必须大于 0。
4. 关闭 Reviewer Agent：第一次取消确认，设置不应改变；第二次确认。
5. 恢复 Reviewer Agent。
6. 切换 Layer 2 Mastery Evaluator，保存后刷新。

通过标准：设置只作用于新启动的 generation/evaluation；关闭 Reviewer 有明确 quality-impact confirmation；Save 不遮挡其它表单。

## 4. Instructor 课程与内容工作流

### 4.1 My Courses 与 Create Course

1. 进入 **My Courses**，确认 Sandbox、Published、Archived badge 正确。
2. 点击 **Create course**，逐个留空必填字段，确认前端/后端错误可读。
3. 创建 Sandbox，记下 registration code。
4. 创建同 term/code 的重复课程，确认 duplicate warning，而不是静默重复。

### 4.2 Launch Cockpit / Dashboard

1. 打开新课程 Dashboard。
2. 检查 **Launch readiness**：dates、Topic、LO、question coverage 等 blocker 数量。
3. 点击每个 blocker/action，确认进入 Settings、Structure、Materials、Coverage、Analytics 等正确目标。
4. 不满足 checklist 时 Publish 必须失败并指出原因。
5. 补齐条件后 Publish；Archived course 执行 Restore。
6. 点击 **Preview as Student**，见第 7 节。

### 4.3 Course Structure

1. 新增 Topic，再新增两个 LO。
2. 编辑 Topic/LO 名称，刷新确认保存。
3. 调整顺序，确认所有关联页面顺序一致。
4. Archive 一个 LO/Topic，确认历史数据仍存在但新工作流不再选择它。
5. 运行 AI hierarchy suggestion 时，逐项 Accept/Reject；没有 live LLM 时只验证错误可恢复。

### 4.4 Course Materials 与 Content Map

1. 上传 PDF/Markdown；确认状态从 Processing 到 Ready，失败时有 Retry。
2. 用 URL ingest；检查无效 URL、重复 material 和 parser failure。
3. 修改 material kind metadata。
4. 把 material 分配给 Topic/LO；取消/重新分配。
5. 在 **Content Map** 检查 Theme/LO、material source、question、run、coverage gap 的关系。
6. 修改 source 后，相关问题出现 `source-changed` 提醒。

通过标准：刷新页面仍能看到 content run；中断的 run 不会永远停在 Processing；Archived course 只读。

## 5. Instructor 题库工作流

### 5.1 Import

1. 分别上传 CSV、JSON、QTI。
2. Preview 中检查成功行和失败行；部分失败不能阻止合法行 commit。
3. Commit 后所有导入题必须是 Draft，绝不能直接 Approved。
4. 上传 parameterized `generate(random)` script，执行 sandbox preview。
5. 检查 variables/placeholders 后迁移为一题 parameterized Draft。

### 5.2 Question Bank 与 Question Editor

1. 用 Search、Topic、LO、Type、Status 筛选，组合条件后 Clear filters。
2. 特别用很长的 LO 名称；desktop 和 phone 都不能产生横向溢出。
3. 打开 Draft，编辑 stem、difficulty、LO tag、四个 option 与 explanation。
4. 正确答案必须且只能有一个；缺 option/重复 key 保存应失败。
5. 检查 edited-field highlight、Save、Regenerate、Archive、Restore。
6. 打开 **Parameters**，编辑变量范围/选项，连续 preview 多个 seed，确认 placeholders 全部解析。
7. 验证 version lineage、origin/family 与 agent decision 信息仍显示。

### 5.3 Generate / Question Bank Coverage

1. 进入 **Question Bank Coverage**，检查每个 LO 的 Approved count、target、status。
2. 无 Ready material 的 LO 应提示先 Assign Materials。
3. 选择 preset、数量、难度、可选 guidance，启动 generation。
4. 刷新/离开再回来，run history 和进度必须继续存在。
5. 对成功、partial、failed run 分别检查 Retry exact snapshot。
6. 生成结果必须为 Draft；Reviewer reject 也不能静默删除或自动 publish。

Live LLM 测试需设置实际 provider/model，并显式运行：

```bash
LLM_AVAILABLE=1 npm run test:e2e
```

### 5.4 Review Queue 与 Flags

1. 检查 All、Student Flag、Agent Flag/Reject/Pass tabs 和 priority sort。
2. 打开一题 Review，修改后进入 Pending Review/Reviewed/Approved。
3. 勾选多题 Bulk Approve，先取消 confirmation，再确认。
4. Approved 后该题立即离开 awaiting-review queue。
5. 用 Student 产生 flag；回到 Instructor **Flags** 查看 reason/context。
6. Clear、Correct、Archive 三种 resolution 各测一次。
7. 需要 remediation 时建立 replacement link，确认 student-facing remediation 生效。

## 6. Course Settings、TA 与 Analytics

### 6.1 Settings 与 lifecycle

1. 修改 name/code/term、start/end dates、registration code、feedback strategy。
2. 分别选择 Adaptive、A-only、B-only，在 Student Practice 验证反馈行为。
3. 更新 roster identifiers；检查延长期限/状态字段。
4. Archive 后学生不能继续 practice；Instructor 仍可只读并 Restore。

### 6.2 Teaching Assistants

1. 输入测试 IdP 中 Staff 的 UBC email 邀请。
2. Staff 首次登录后，TA invite 必须按 email/PUID 激活。
3. 测试 Standard preset 和五个可编辑 capability。
4. 到期后 Re-invite。
5. 多门课分配不同权限，切换 TA course picker，数据不能串课。

### 6.3 TA Workspace

1. 以 TA 登录，进入 **Review Queue**。
2. Suggest edit、Mark reviewed、Add internal note、Proactive escalation 各执行一次。
3. 进入 **Flag Triage**，选择 Correct/Archive/Clear recommendation，填写 note 并 Escalate。
4. 尝试直接调用 Approve/Resolve UI 和 API。

通过标准：TA 页面完全没有最终 Approve/Resolve 能力；即使 capability 配置错误，server structural guard 仍返回 403。

### 6.4 Student Analytics

1. 在 Topic Practice 与 Exam Prep 各制造至少五次 attempt。
2. 切换 Topic Practice / Exam Prep failure-rate mode。
3. 查看 Theme/LO failure rate；样本少于 5 显示 Insufficient data。
4. 输入 question ID，检查 answer distribution 和 misconception highlight。
5. 检查 questions attempted、sessions/student、average minutes、LO coverage。
6. 下载 weekly CSV，核对列、课程范围、日期。
7. 搜索 Student，打开 profile，核对 attempt history、mastery、flags。
8. 检查 Low engagement list 与 inactive days。

## 7. Student Preview

1. Instructor Dashboard 点击 **Preview as Student**。
2. 确认整个 shell 切换成 Student，而不只是一个小 preview panel。
3. 做题、答错、skip、flag、Review Book、Summary、Exam 页面都走真实 Student renderer。
4. 退出 Preview。
5. 在 live Student Analytics、Flags、notifications 和 Mongo live collections 中确认没有 Preview 数据。

通过标准：Preview 只写短生命周期 `previewAttemptRecords` / `previewStudentSessions`；每次开始都是新的 anonymous student；只看到 Approved 内容。

## 8. Student Topic Practice

### 8.1 Enroll 与 Course Home

1. 以 Student 登录，输入错误 registration code，确认可读错误。
2. 输入正确 code，加入课程；重复加入应幂等。
3. Course Home 检查 Topic status、LO coverage、welcome/continue banner。
4. 打开 Topic，确认 LO 顺序、question availability、Practice/Practice again。

### 8.2 Serve → Submit → Feedback → Next

1. 进入一个 LO；只有 Approved question 能被 serve。
2. 未选 option 时 Submit disabled。
3. 先答错：检查选项颜色、解释、retry/strategy、mastery 更新。
4. 再答对：检查 Correct、Next question。
5. Skip this LO，确认 session summary 记录 skip 且可继续其它 LO。
6. Flag question，填写 reason；重复 flag 不应产生混乱状态。
7. 刷新、后退、快速连点 Submit/Next，不能重复写 attempt 或显示旧题响应。

### 8.3 Review Book 与 Session Summary

1. 检查 Miss、Bookmark、Exam miss 的 source tag。
2. 展开 Topic/LO，点击 Review、Practice Again、Practice All。
3. 删除一个 source 时，其它 source 仍保留；最后 source 删除后条目消失。
4. Session Summary 核对 attempted、correct、accuracy、missed questions、next recommended LO。
5. 从 Summary 跳回 Review Book、Course Home、Next Practice。

## 9. Exam Prep

### 9.1 Instructor Exam Template

1. 在 **Exam Templates** 配置 Midterm/Final。
2. 每个 Theme 设置 MCQ/T-F 数量、points；配置 time limit、availability、LO breakdown。
3. Approved supply 不足时必须显示 shortfall warning；保存仍可 assemble 可用部分并记录 gap。
4. availability 之前/之后 Student 不可开始。

### 9.2 Student single sitting

1. Student 打开 **Exam Prep**，开始 available sitting。
2. 作答中不能看到 correct/incorrect 或 explanation。
3. 用 question map 跳转，检查 answered/unanswered 状态。
4. 刷新浏览器，答案和剩余时间恢复。
5. 剩余 5 分钟出现 warning；到 0 自动提交。
6. 有 unanswered 时手工 Submit，确认 warning；取消后继续，确认后提交。

### 9.3 Results 与 history

1. Results 核对总分、Theme breakdown、可选 LO breakdown。
2. 提交后才显示完整 option explanations。
3. 错题自动进入 Review Book，weak-area link 进入正确 Topic Practice。
4. Exam History 显示 sitting、时间、分数；不能开启第二次 single sitting。
5. Instructor Analytics 中 Exam Prep 数据与 Topic Practice 分开。
6. Mastery 带 `exam-verified` qualifier。

对应自动化：

```bash
npx playwright test tests/e2e/exam-mode.spec.ts
```

## 10. 通用页面与基础集成

如果保留 boilerplate demo，再测试：

- Landing：未登录只能看到 CWL login；返回地址正确。
- Notifications：unread count、mark read、课程范围。
- Theme：light/dark 切换后刷新仍保留；两种主题均无低对比。
- Mobile navigation：390px 下 menu 打开/关闭、backdrop、focus、滚动。
- Notes：新增、列表、删除；signed-out API 返回 401。
- RAG：ingest → query；source refs 可见；Qdrant/LLM 失败可恢复。
- Classes：faculty/student role gate 和 FakeAcademicAPI 数据。
- Members/role pages：401、403 与正确角色显示。
- Logout：session cookie 失效，受保护 API 再次返回 401。

## 11. 每页 UI 快速检查表

每个页面至少在 `1280×720` 与 `390×844` 检查：

- 页面没有横向滚动；长 stem、email、PUID、course ID、LO name 会换行。
- Card 内容距离边框至少约 16px，不贴边。
- Primary action 清楚但不压过 destructive action。
- Delete/Archive/Deactivate/Disable reviewer 都有确认。
- Loading、empty、error、success 四种状态都占据稳定空间。
- 所有 input/select/checkbox 有可读 label；键盘 Tab 顺序合理。
- focus ring 可见；disabled control 仍能看清但不可点击。
- Mobile 下表格转换为 cards，最右侧 Actions 不会被裁掉。
- Sidebar 关闭时不截获点击；打开后 backdrop 可关闭。
- Browser console 无未处理异常；网络失败不会留下永久 spinner。
- Light/dark 均满足 WCAG AA；200% zoom 仍可完成主要动作。

## 12. 缺陷报告模板

```text
Persona / course:
Page / route:
Viewport / theme:
Starting data:
Steps:
Expected:
Actual:
Console/network evidence:
Screenshot/video:
Can reproduce after reload? yes/no
Does it change live student data? yes/no
```

优先级建议：

- P0：越权、数据丢失、Exam integrity 泄漏、Preview 污染 live records。
- P1：主闭环无法完成、按钮不可达、永久 Processing、错误发布。
- P2：手机裁切、错误提示不清、重要状态缺失、WCAG failure。
- P3：间距、文案、非阻断视觉一致性。
