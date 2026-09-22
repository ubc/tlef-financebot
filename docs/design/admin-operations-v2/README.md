# FinanceBot Admin · 紧凑后台原型

这一套原型将已认可的 Operations & issues 设计延伸到全部七个 Admin 页面。统一使用细侧栏、横向概览、紧凑表格、全高详情面板和明确的编辑确认流程。

**审核入口：[All questions](http://127.0.0.1:6133/admin-operations-v2/workspace.html?page=questions)**。侧栏可切换全部页面，Operations 页面也已接入新的导航。

## 页面与可操作流程

| 页面 | 可审核的主要流程 | 桌面截图 |
| --- | --- | --- |
| [Operations & issues](http://127.0.0.1:6133/admin-operations-v2/) | 搜索筛选、事件关联、时间线、导出、记录参数复现 | [查看](screenshots/qa-1440-inspector.png) |
| [All questions](http://127.0.0.1:6133/admin-operations-v2/workspace.html?page=questions) | 跨课程查题、原始作者筛选、版本、标记、记录回放与新种子样例 | [查看](screenshots/admin-questions-1440.png) |
| [User directory](http://127.0.0.1:6133/admin-operations-v2/workspace.html?page=users) | 账号搜索、课程角色修改、停用/恢复、活动与创建题目的关联 | [查看](screenshots/admin-users-1440.png) |
| [Instructor grants](http://127.0.0.1:6133/admin-operations-v2/workspace.html?page=grants) | PUID 查找、授权审核、首次登录前预授权、撤销、导出 | [查看](screenshots/admin-grants-1440.png) |
| [Capabilities](http://127.0.0.1:6133/admin-operations-v2/workspace.html?page=capabilities) | 13 项权限矩阵、平台/课程范围、继承来源、覆盖值、审核保存/放弃 | [查看](screenshots/admin-capabilities-1440.png) |
| [Platform settings](http://127.0.0.1:6133/admin-operations-v2/workspace.html?page=settings) | 模型流程、参数配置、质量开关、每日额度、自定义模型、草稿审核 | [查看](screenshots/admin-settings-1440.png) |
| [Help & tutorials](http://127.0.0.1:6133/admin-operations-v2/workspace.html?page=help) | 六个分步指南、搜索分类、完成/跳过/重播、重置、常见问题 | [查看](screenshots/admin-help-1440.png) |

桌面详情停靠在右侧并占满工作区高度；窄面板使用抽屉。列表和详情分别滚动。小屏可通过顶部导航按钮打开完整菜单。`/` 聚焦搜索；`Esc` 关闭详情或弹层。

## 建议审核路径

1. All questions 打开 **Q-1042**，查看保存的数值和生成答案差异，再打开其关联的 **RUN-2087**。两个页面使用相同的题目、选项和课程身份。
2. User directory 打开 **Jordan Lee → Course access**，尝试移除其 COMM 298 Instructor 角色。原型会保护最后一个有效 Instructor；审核时可以给 Sam Kim 添加 Instructor 角色后再次尝试。
3. Instructor grants 点击 **Add Instructor**，输入虚构 PUID `DEMO-NEW-012`，审核后保存为 Pending first login，再尝试撤销。用 `DEMO-JLEE-001` 可检查重复授权提示。
4. Capabilities 切换 **COMM 298**，查看权限来源，调整一个可编辑值，再审核差异。Admin 权限和 TA 的 approval / flag resolution 固定限制不会被覆盖。
5. Platform settings 编辑 Generator 的参数；切换 Quality controls 关闭 Reviewer，检查保存时的影响说明与确认；在 Usage & limits 检查无效额度的提示。
6. Help 完成一个指南，刷新确认进度保留，再重播或重置。

## 数据与边界

这是可操作的设计审核原型，没有连接生产 API。记录、账户、模型配置与用量都是样例。保存课程角色、授权和设置仅改变当前浏览器的本地状态，不会修改真实账户、权限、课程或模型服务。

- 平台 Instructor 授权、Admin 身份和具体课程角色分别显示。撤销平台授权保留已有课程角色；停用保留历史记录。
- 设置与权限草稿刷新后保留，只有明确审核并应用后才成为本地已保存值。离开页面时会提示草稿状态。
- 人员变更记录显示在该用户的 Activity 中；Operations 保持原来的固定演示快照，不代表实时收集本地原型事件。
- Accepted 不等于后台任务成功；Interrupted 不证明数据没有写入；浏览器报告明确标记为未核实。
- 历史复现使用样例保存的版本和值；新种子样例不充当历史证据。缺失快照时明确说明。
- 通用设置中的模型标识和能力档案用于演示现有配置界面，不代表对供应商当前能力、可用性或价格的验证。
- Help 新增 Operations 和 All questions 的引导提案，并保留现有账号、授权、权限和设置的帮助主题。

## 设计参考

参考 [Ant Design Table](https://ant.design/components/table/) 的紧凑数据表、筛选排序与固定表头，以及 [IBM Carbon Data table](https://carbondesignsystem.com/components/data-table/usage/) 的工具栏、渐进展开和相关详情模式。此原型使用独立 HTML/CSS/JS，没有引入这些组件库或外部资源。

## 验证与运行

完整新增页面验证见 [ADMIN-QA.md](ADMIN-QA.md)；Operations 原有验证见 [QA.md](QA.md)。截图及机器结果均在 [screenshots/](screenshots/)。

从仓库根目录运行：

```sh
python3 -m http.server 6133 --bind 127.0.0.1 --directory docs/design
```

浏览器打开上述审核入口即可；原型无需构建。`index.html` 是 Operations 入口，`workspace.html?page=…` 是其余六页入口。本轮文件仅位于此设计目录，不替换生产应用。
