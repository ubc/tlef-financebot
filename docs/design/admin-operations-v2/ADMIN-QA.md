# Admin 全页面原型 · 验证记录

验证日期：2026-09-20。范围：新增的 All questions、User directory、Instructor grants、Capabilities、Platform settings、Help & tutorials，以及它们与 Operations 的导航关联。验证使用独立 Chromium 上下文；没有改动真实账户或生产数据。

## 验证结果

| 检查范围 | 结果 | 证据 |
| --- | --- | --- |
| 六页布局、共享导航、Help 交互与资源加载 | 31/31 通过 | [报告](screenshots/workspace-verification.json) · [脚本](verify-workspace.cjs) |
| 用户与授权流程 | 20 项通过 | [报告](screenshots/people-verification.json) · [脚本](verify-people.cjs) |
| 权限与平台配置流程 | 15/15 通过 | [报告](screenshots/configuration-verification.json) · [脚本](verify-configuration.cjs) |
| 配置的额外可访问性状态 | 12 个状态无 WCAG A/AA 违规 | [报告](screenshots/configuration-accessibility.json) |
| All questions 定向交互 | 搜索、组合筛选、分页、版本、历史复现、新样例、缺失快照和 Esc 检查通过 | 独立页面检查；布局与可访问性另包含在全页面报告 |
| 静态检查 | 修改后的页面脚本与共享脚本 ESLint 通过 | 本地执行 |

全页面检查覆盖 **1440、1280、580、390px**。六个新增页面均无整页横向溢出；窄屏表格优先保留主要信息，筛选栏和详情内部可滚动。桌面与手机默认视图及 Help 引导详情均通过可访问性扫描。未发现脚本错误或失败资源请求。

这些结果验证设计原型，不代表真实 API、身份验证、授权执行或后台审计完整性的端到端测试。

## 重要流程

- **All questions：** 18 条样例的来源、状态和计数一致；Q-1042 与 Operations 的记录选项一致。历史标记回放采用记录版本，缺失快照不会伪装成成功复现。
- **User directory：** 修改课程角色需审核；取消保留原值；最后一个 Instructor 的移除与停用被阻止；分配替代 Instructor 后可操作；恢复账号保留原课程角色。
- **Instructor grants：** 重复 PUID、误填邮箱与已知 CWL 均有校验；新 PUID 保存为首次登录前预授权；授权与撤销刷新后保留；撤销不会移除课程角色。
- **Capabilities：** 13 项权限、平台和课程范围、继承值、覆盖值、草稿保存与放弃；Admin 与两个 TA 限制保持锁定。
- **Settings：** 模型切换清除旧参数；推理开关与温度配置互斥；额度校验；Reviewer 关闭需明确确认；自定义模型重复和占用检查；草稿刷新保留并可放弃。
- **Help：** 逐字符搜索、空结果恢复、引导完成/重播/重置、取消重置不丢失进度、FAQ 展开和页面入口。
- **导航：** Operations 可进入全部六页；新增页面相互切换；窄面板通过菜单访问所有 Admin 页面。

## 本轮修正

- 将 Operations 中指向旧原型的导航全部接到新页面，并补齐 Help。
- 修复窄屏图标导航中 Design notes 缺少可访问名称的问题。
- 调整手机表格、分页和详情的布局，避免内容或操作按钮被截断。
- 统一跨页面题目选项、作者、课程与任务关联，移除错误的样例来源链接。
- 权限矩阵直接点击复选框时稳定更新；模型流程概览随质量开关正确更新。
- 导航提示准确表达“草稿尚未应用、仍保留在本地”；窄屏导航按钮打开完整菜单。
- 对完成版静态资源增加版本标识，避免开发期间旧缓存造成预览加载不完整。

## 截图

| 页面 | 桌面 1440px | 窄面板 580px | 手机 390px |
| --- | --- | --- | --- |
| Questions | [截图](screenshots/admin-questions-1440.png) | [截图](screenshots/admin-questions-580.png) | [截图](screenshots/admin-questions-390.png) |
| Users | [截图](screenshots/admin-users-1440.png) | [截图](screenshots/admin-users-580.png) | [截图](screenshots/admin-users-390.png) |
| Grants | [截图](screenshots/admin-grants-1440.png) | [截图](screenshots/admin-grants-580.png) | [截图](screenshots/admin-grants-390.png) |
| Capabilities | [截图](screenshots/admin-capabilities-1440.png) | [截图](screenshots/admin-capabilities-580.png) | [截图](screenshots/admin-capabilities-390.png) |
| Settings | [截图](screenshots/admin-settings-1440.png) | [截图](screenshots/admin-settings-580.png) | [截图](screenshots/admin-settings-390.png) |
| Help | [截图](screenshots/admin-help-1440.png) | [截图](screenshots/admin-help-580.png) | [截图](screenshots/admin-help-390.png) |

其他状态：[用户详情](screenshots/admin-users-detail.png)、[授权审核](screenshots/admin-grants-review.png)、[帮助指南](screenshots/admin-help-guide.png)。

运行本地预览服务后，可从仓库根目录分别执行上表的验证脚本。它们使用独立测试浏览器上下文，不会清空用户正在审核的浏览器数据。
