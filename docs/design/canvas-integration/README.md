# Canvas integration — interactive design preview

这是正式前端实施前的独立 HTML 原型。入口为 `index.html`，样式及交互分别在
`style.css`、`app.js`。不依赖构建，也不读取或修改 FinanceBot、Canvas、SAML 的真实数据。
浏览器当前标签页的 sessionStorage 仅保存原型状态；“从头体验”可重置。

## 审阅入口

```sh
python3 -m http.server 8768 --bind 127.0.0.1 --directory docs/design/canvas-integration
```

打开 http://127.0.0.1:8768 。也可以直接用浏览器打开本目录的 `index.html`。

- **从头体验**：My Courses → Connect Canvas → 模拟外部授权 → 选课 → 新建或关联。
- **查看已连接示例**：直接查看已发布的课程，20 人名单，12 人已加入、8 人待首次登录。
- **学生体验**：选择虚构身份并模拟 CWL 登录。包含两个同名学生及一名非本班学生。
- **原型状态预览**：课程关联页或名单页底部可查看身份字段缺失、授权过期、退课后的状态。

## 建议的正式前端改动

| 位置 | 新行为 |
| --- | --- |
| My Courses | From Canvas：先授权，选择有教师权限的课程，再创建 Draft 或关联已有课程。 |
| Canvas connection | 账号级连接、重连、断开及关联课程入口。正式挂载位置可在审阅后调整。 |
| 课程设置 / Canvas integration | 显示双方课程身份、最近成功同步时间、自动入课开关，进入材料和学生管理。 |
| Course Materials | Import from Canvas 文件选择器；显示格式、大小、文件夹、已导入与不支持的文件。导入后保留来源详情。 |
| Students & enrollment | Canvas 状态、身份匹配、FinanceBot 访问状态；姓名/CWL 搜索、状态筛选、异常详情、手动同步。 |
| Student My Courses | 符合条件的学生在 CWL 登录后自动看到课程；展示未发布、无法匹配及无课程资格的提示。 |

产品界面延续当前 FinanceBot 的英语文案、教师绿色侧栏、学生蓝色侧栏及紧凑布局。
中文顶部工具条和测试身份选择器仅用于审阅，正式产品不包含这些控件。
已有课程 Dashboard、手动创建、手动上传、注册码提交、学习内容页均只标注交接点。

## 需要在正式实现中落实的行为

- CWL 提供经过验证的 PUID；toolkit 读取 Canvas `integration_id` 并生成唯一身份匹配。
- 自动入课筛选 active student enrollment；不直接使用 toolkit 默认包含 invited 的名单。
- 教师创建或关联时，分别验证 FinanceBot 本地权限和 Canvas 教师权限。Canvas 教师身份本身不授予本地全局创建权限。
- 新建的本地课程为 Draft。正式发布继续使用现有权威发布检查，不通过连接 Canvas 绕过内容准备。
- 名单匹配包含尚未登录 FinanceBot 的成员；在首次登录时按验证身份赋予本地访问。
- 只有完整、成功且身份数据足够的同步才可用于撤销 Canvas 来源的权限；失败或字段缺失不能当作全班退课。
- 保留权限来源，区分 Canvas 成员资格与人工授予权限。退课后保留历史记录。
- 断开授权会暂停读取和新同步；缓存有效期、旧成员访问宽限、解绑后的处理策略需在正式方案中明确。
- 原型“Every 15 min”是建议频率，不代表后台已实现。真实部署需确定调度、授权刷新和权限复核策略。
- 原型只支持一门当前关联的演示课程；三门可选课均复用 20 人虚构名单。正式产品须将所有数据按真实课程和 section 隔离。
- 材料处理进度和成功结果均为模拟。正式实现复用 contentRuns / SSE，并提供逐文件失败与重试。
- 原型的 Preview published state 只切换展示状态；不表示已经满足真实发布条件。

## 验证

通过本地 Playwright 浏览器检查：模拟 OAuth、新建 Draft、关联已有课程、Draft 阻止入课、
发布状态预览、材料导入和重复导入禁用、20 人名单与同名搜索、学生自动入课、非成员拒绝、
身份缺失提示、授权过期及重连、390px 手机布局和导航。无浏览器脚本错误。

这验证的是原型交互，不是实际 Canvas API、UBC 身份字段、真实 SAML 或生产授权权限。
