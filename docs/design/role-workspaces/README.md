# FinanceBot · 全角色 UI 审核原型

审核入口：[打开交互原型](http://127.0.0.1:6133/role-workspaces/index.html?review=final#/review)。也可以直接用浏览器打开本目录的 `index.html`，无需安装或登录。

本次对照当前路由、页面实现和已经更新的课程 workflow 原型，将剩余视觉缺口接入同一套工作区设计。共有 **57 个可直接打开的页面视图**：Student 12、Instructor 20、TA 5、Admin 10、登录/访问恢复 2、保留的参考页面 8。其中 39 个为重设计或延展提案，18 个作为已更新主流程的连贯参考。

这是一套供审核的 HTML/CSS/JavaScript 原型，尚未替换正式应用。界面沿用产品的英文文案；说明与审核文档使用中文。

## 如何审核

1. 从首页选角色或审核路径。顶部可以随时切换 Role / Page。
2. 在页面上实际操作：搜索、筛选、填写表单、查看详情、提交和返回。
3. 点右上角 **Review page**，选择 **Approve design** 或 **Request changes**，填写意见。
4. 返回 **All pages**，查看已审核标记，并用 **Export review notes** 导出 Markdown。
5. **Demo state** 可以检查空状态、加载失败、加载中和无权限的共用处理。月亮按钮切换深浅主题；侧栏支持收起和手机菜单。

审核意见和演示数据保存在当前浏览器中。**Reset demo** 会清除这套原型的数据与审核意见，请先导出需要保留的意见。

## 建议优先走的路径

| 角色 | 审核路径 | 可以实际操作的内容 |
| --- | --- | --- |
| Student | My courses → Course home → Topic practice → Session summary → Review Book | 选择答案、提示、反馈、保存题目、报告问题、重试 |
| Student | Exam Prep → Exam sitting → Results → Exam history | 倒计时、保存答案、标记、刷新后继续、提交、逐题复盘 |
| Instructor | Question Bank → Question editor → Parameters → Version history | 编辑、生成新版本、保留旧快照、计算参数预览 |
| Instructor | Materials → Structure → Generate → Review queue | 文件名预览、Trash/Restore、目标编辑、模拟生成、批准草稿 |
| Instructor | Import / Advanced generation / Team / Course settings | 部分成功导入、保存配方、管理成员、发布与归档确认 |
| TA | Review queue → Question review → Flag triage | 标记已审、独立建议、团队备注、升级问题；最终批准由教师处理 |
| Admin | Operations → Operation detail → Question reproduction → User detail | 按失败筛选、阶段时间线、输入快照、沙盒重试、复现题目、关联用户 |
| Admin | All questions / Users / Instructor grants / Capabilities / Settings | 跨用户题目查询、账号状态、待登录授权、权限差异确认、配置保存 |

课程加入演示码：**FIN-2026**。所有人物、邮箱、课程活动与问题记录都是合成样例。

## 设计依据

参考已有的 `generate-questions`、`question-bank`、`course-structure`、`course-dashboard`、`course-admin` 原型，以及当前 Instructor 工作区实现。

- 深色角色侧栏、浅灰工作画布、白色内容面板、细边框和克制的状态色。
- 沿用源文件 / 核心内容 / 右侧上下文的工作区布局；阅读题目使用衬线字体。
- 主操作清晰，状态与上下文在操作附近显示；深层编辑和调查页面保留返回路径。
- Student 使用蓝色角色识别，Instructor/TA 使用绿色，Admin 使用深灰；组件、布局节奏与表单保持统一。
- 桌面保留多栏，手机改为纵向内容和可展开导航。宽表格在自身容器内横向滚动。

`Redesign` / `Extend` / `Aligned` 是对当前页面的设计审阅分类，不代表每个原页面都完全没有改动，也不代表已更新页面已存在同样的后端功能。完整映射见 [页面清单](inventory.md)，视觉快照见 [截图画廊](gallery.html)。

## 演示边界

这是可操作的设计提案，而非真实数据的端到端环境。生成、上传处理、SAML 登录、审计重试、账号变更和问题复现都在浏览器内模拟；没有调用应用 API、发送邮件、请求模型或修改生产数据。上传仅读取本地文件名；导入文件仅在浏览器解析。

数值预览会真实计算 PV；Admin 复现展示固定版本与种子输入的交互提案。完整后端的公式校验、队列调度、权限执行和审计覆盖范围仍以应用实现为准。图表与历史样例用于审核信息层次，不表示真实统计。

模拟考试使用浏览器本地计时与题目快照。生产应继续以服务端计时、身份和固定题目版本为准。空/错误/加载/权限是共用状态提案，不是 57 页各自独立的业务异常模型。

## 文件与本地运行

- `index.html`：统一页面入口，使用可分享的 hash 路由。
- `data.js`：页面清单、角色与合成样例。
- `style.css`：共享样式、主题、响应式布局。
- `app.js`：页面视图、交互、状态与审核意见。
- `verify.cjs`：独立浏览器验证，不依赖 SAML 或数据库。
- `journeys.cjs`：15 条补充操作链验证。
- `accessibility.cjs`：代表页面的 WCAG A/AA 自动扫描。
- `inventory.md`：生产路由 / 原型 / 设计状态映射。

在仓库根目录运行：

```sh
python3 -m http.server 6133 --bind 127.0.0.1 --directory docs/design
```

保持预览服务运行，再执行：

```sh
node docs/design/role-workspaces/verify.cjs
node docs/design/role-workspaces/journeys.cjs
node docs/design/role-workspaces/accessibility.cjs
```

实际验证结果与截图见 [QA 报告](../../../audit-results/role-workspaces/REPORT.md)。现有 workflow 原型与正式应用文件保留在各自位置。
