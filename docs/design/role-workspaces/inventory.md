# 页面覆盖与设计分类

审阅基准：当前 `client/src/main.ts` 路由、角色 shell 与既有 workflow 设计原型。

Redesign = 剩余工作区视觉缺口；Extend = 对已更新页面的深层延展或新增显式入口；Aligned = 保留更新后的模式用于连贯审核。

## Student

| 页面 | 当前入口 / 位置 | 原型 | 分类 |
| --- | --- | --- | --- |
| My courses | `/` | [打开](index.html#/student/courses) | Extend |
| Course home | `/course/:id` | [打开](index.html#/student/course) | Extend |
| Learning objectives | `/course/:id/theme/:themeId` | [打开](index.html#/student/objectives) | Redesign |
| Topic practice | `/course/:id/practice/:loId` | [打开](index.html#/student/practice) | Redesign |
| Review Book | `/course/:id/review-book` | [打开](index.html#/student/review-book) | Redesign |
| Session summary | `/course/:id/summary` | [打开](index.html#/student/summary) | Redesign |
| Exam Prep | `/course/:id/exams` | [打开](index.html#/student/exams) | Redesign |
| Exam sitting | `/course/:id/exam-attempt/:attemptId` | [打开](index.html#/student/exam) | Redesign |
| Exam results | `/course/:id/exam-attempt/:attemptId/results` | [打开](index.html#/student/results) | Redesign |
| Exam history | `/course/:id/exam-history` | [打开](index.html#/student/history) | Redesign |
| Settings | `/settings` | [打开](index.html#/student/settings) | Extend |
| Help & tutorials | `/help` | [打开](index.html#/student/help) | Aligned |

## Instructor

| 页面 | 当前入口 / 位置 | 原型 | 分类 |
| --- | --- | --- | --- |
| My courses | `/instructor/courses` | [打开](index.html#/instructor/courses) | Extend |
| Create course | `/instructor/courses/new` | [打开](index.html#/instructor/create) | Redesign |
| Course dashboard | `/instructor/course/:id` | [打开](index.html#/instructor/dashboard) | Aligned |
| Course materials | `/instructor/course/:id/materials` | [打开](index.html#/instructor/materials) | Aligned |
| Course structure | `/instructor/course/:id/structure` | [打开](index.html#/instructor/structure) | Aligned |
| Generate questions | `/instructor/course/:id/preseeding` | [打开](index.html#/instructor/generate) | Aligned |
| Advanced generation | `/instructor/course/:id/preseeding?advanced=1` | [打开](index.html#/instructor/advanced) | Redesign |
| Review queue | `/instructor/course/:id/queue` | [打开](index.html#/instructor/review) | Aligned |
| Question Bank | `/instructor/course/:id/bank` | [打开](index.html#/instructor/bank) | Aligned |
| Question editor | `/instructor/course/:id/bank/:questionId` | [打开](index.html#/instructor/question) | Extend |
| Question parameters | `/instructor/course/:id/bank/:questionId/params` | [打开](index.html#/instructor/parameters) | Redesign |
| Coverage Map | `/instructor/course/:id/content-map` | [打开](index.html#/instructor/coverage) | Aligned |
| Student analytics | `/instructor/course/:id/analytics` | [打开](index.html#/instructor/analytics) | Aligned |
| Student profile | `/instructor/course/:id/student/:puid` | [打开](index.html#/instructor/student) | Extend |
| Flags | `/instructor/course/:id/flags` | [打开](index.html#/instructor/flags) | Aligned |
| Import questions | `/instructor/course/:id/import` | [打开](index.html#/instructor/import) | Aligned |
| Exam templates | `/instructor/course/:id/exam-templates` | [打开](index.html#/instructor/exams) | Aligned |
| Teaching team | `/instructor/course/:id/tas + Co-instructors` | [打开](index.html#/instructor/team) | Extend |
| Course settings | `/instructor/course/:id/settings` | [打开](index.html#/instructor/settings) | Aligned |
| Help & tutorials | `/instructor/help` | [打开](index.html#/instructor/help) | Aligned |

## Teaching assistant

| 页面 | 当前入口 / 位置 | 原型 | 分类 |
| --- | --- | --- | --- |
| Assigned courses | `TA shell course switcher` | [打开](index.html#/ta/courses) | Extend |
| Review queue | `/ta/course/:id/review` | [打开](index.html#/ta/review) | Aligned |
| Question review | `/ta/course/:id/question/:questionId` | [打开](index.html#/ta/question) | Extend |
| Flag triage | `/ta/course/:id/flags` | [打开](index.html#/ta/flags) | Aligned |
| Help & tutorials | `/ta/course/:id/help` | [打开](index.html#/ta/help) | Aligned |

## Admin

| 页面 | 当前入口 / 位置 | 原型 | 分类 |
| --- | --- | --- | --- |
| Operations & issues | `/admin/operations` | [打开](index.html#/admin/operations) | Redesign |
| Operation detail | `/admin/operations/:kind/:id` | [打开](index.html#/admin/operation) | Redesign |
| All questions | `/admin/questions` | [打开](index.html#/admin/questions) | Redesign |
| Question reproduction | `/admin/questions/:id` | [打开](index.html#/admin/question) | Redesign |
| User directory | `/admin/users` | [打开](index.html#/admin/users) | Redesign |
| User detail | `User directory detail` | [打开](index.html#/admin/user) | Extend |
| Instructor grants | `/admin/accounts` | [打开](index.html#/admin/grants) | Redesign |
| Capabilities | `/admin/capabilities` | [打开](index.html#/admin/capabilities) | Redesign |
| Platform settings | `/admin/platform-settings` | [打开](index.html#/admin/settings) | Redesign |
| Help & tutorials | `/admin/help` | [打开](index.html#/admin/help) | Aligned |

## Welcome

| 页面 | 当前入口 / 位置 | 原型 | 分类 |
| --- | --- | --- | --- |
| Welcome & sign in | `Signed-out landing` | [打开](index.html#/public/login) | Redesign |
| Access & recovery | `Signed-out / 403 / expired session` | [打开](index.html#/public/access) | Extend |

## Legacy examples

| 页面 | 当前入口 / 位置 | 原型 | 分类 |
| --- | --- | --- | --- |
| Service overview | `Legacy / overview` | [打开](index.html#/legacy/overview) | Redesign |
| Faculty area | `/faculty` | [打开](index.html#/legacy/faculty) | Redesign |
| Student area | `/student` | [打开](index.html#/legacy/student) | Redesign |
| Staff area | `/staff` | [打开](index.html#/legacy/staff) | Redesign |
| Notes example | `/notes` | [打开](index.html#/legacy/notes) | Redesign |
| RAG example | `/rag` | [打开](index.html#/legacy/rag) | Redesign |
| Classes example | `/classes` | [打开](index.html#/legacy/classes) | Redesign |
| Members area | `/members` | [打开](index.html#/legacy/members) | Redesign |

## 复用入口与提案边界

- `/course/:id/practice-theme/:themeId` 与按 LO 练习共用 Topic practice 视图。
- Student Preview 复用 Student 页面，以 `#/student/course?preview=1` 开启标识，可返回 Instructor。
- Instructor TA View 复用 TA 页面与安全操作范围。
- Advanced generation 是同一生成页面的高级入口，不声称是新增生产路由。
- TA Assigned courses 将现有 shell 的课程切换展示为显式列表提案。
- Admin User detail 是目录详情展开方式的提案。
- Teaching team 包含 TA 和协作教师的统一设计提案。
- Help 的角色内容共用页面模式；教程、消息、审核意见、发布检查、授权和确认在弹窗中展示。
- 登录和访问恢复属于路由外的应用壳状态。
- Legacy overview 和 7 个保留示例纳入附录，以免遗漏当前路由中的非核心页面。

以上共 57 个页面视图，另含统一审核目录及各类交互弹窗。
