# 14. 单流程复制（导出 / 导入）— `pcopy-content.js` + `pcopy-page.js`（v1.4.0）

## 做什么
在 Process Builder 的工具栏（快捷键按钮右边）加两个按钮：
- **⬇ 导出此流程**：把当前打开的流程，连同它用到的参与者、三张绑定表（参与者 / 表单 / 插件），下载成 `<appId>_<版本>_<流程id>.process.json`。
- **⬆ 导入流程**：选一个这样的 JSON 文件，先检查、弹出确认框，按「导入」后把流程追加到当前 app 的设计器里。**不会自动保存**，检查无误后自己按 Save；不想要就刷新页面放弃。

适合把远端 Joget 上的某一个流程搬到本机 app，而不用导出 / 导入整个 app。远端只需要读（导出），写只发生在你自己按 Save 的那个设计器。

## 文件
| 文件 | 作用 |
|---|---|
| `pcopy-content.js` | 内容脚本（只顶层）。按钮、文件选择、确认框、下载。注入 `pcopy-page.js`，用 `window.postMessage` 跟它说话 |
| `pcopy-page.js` | 用 `<script src>` 注入到页面里（`manifest.json` → `web_accessible_resources`），直接调用 Joget 的 `ProcessBuilder` / `CustomBuilder`。不用 `wrappedJSObject` |
| `builder.css` 末尾 | 按钮、确认框、提示条的样式（都在 `html.joget-skin` 之下） |

`pcopy-content.js` 跟 hotkeys.js 一样注入在 `/jw/web/console/app/*/builder*`（Joget 可以不刷新就切 Builder），但只在路径是 `.../process/builder` 时显示按钮。皮肤关掉（`<html>` 没有 `joget-skin`）时按钮移除。

### 消息通道
- 内容脚本 → 页面：`{ source: "jskin-pcopy-content", id, cmd: "ping" | "export" | "check" | "apply", text? }`
- 页面 → 内容脚本：`{ source: "jskin-pcopy-page", id, ok, error?, ... }`
- 都是 JSON 字符串；两边只收 `e.source === window` 且 `e.origin === location.origin` 的消息。
- 内容脚本先发 `ping`（幂等）直到页面脚本回应，再发真正的命令，保证 `apply` 只发一次。

## 文件格式（v1）
```json
{
  "kind": "joget-process-bundle", "v": 1,
  "source": { "origin", "appId", "appVersion", "packageVersion", "processId", "processName", "exportedAt", "unsavedChanges" },
  "process": "XPDL 里这个 WorkflowProcess 的 JSON（活动、转移、泳道顺序、DataFields 变量）",
  "participants": ["这个流程用到的 XPDL Participant 定义"],
  "applications": ["工具活动用到的 XPDL Application（通常是 default_application）"],
  "participantMap": { "<参与者id> 或 processStartWhiteList": { "type", "value", "properties" } },
  "activityForms":  { "<活动id> 或 runProcess": { "formId", "type", ... } },
  "activityPlugins": { "<活动id>": { "className", "properties" } },
  "requires": { "forms": ["..."], "plugins": ["..."] },
  "sensitive": ["activityPlugins.tool1.properties.password", "..."],
  "subflows": [{ "activity", "target" }]
}
```
- 三张表的 key 去掉了 `processId::` 前缀，导入时按新的流程 id 加回去。
- `requires` 只是清单（表单不会打进包里）。表单 = `activityForms.*.formId` + 属性里的 `formDefId` / `formId`；插件 = 所有 `className` + 参与者 `type:"plugin"` 的 `value`。
- **敏感字段**：属性名像 password / passwd / secret / token / apiKey / privateKey / credential / authorization / username / smtpUser 的非空字符串，导出时清空，路径记在 `sensitive`。只是 `#envVariable.x#` 这类 hash variable 引用的值保留（不是密码本身）。

## 导入步骤（`pcopy-page.js` 的 `plan()` + `apply()`）
1. **检查结构**（`shapeError()`）：`ProcessBuilder.getArray / setArray / updateProcessSelector`、`CustomBuilder.update`、`CustomBuilder.Builder.triggerChange`、`CustomBuilder.data.xpdl.Package`、三张表是对象、不是只读、有当前流程。任何一项对不上就停下，显示原因，什么都不写。
2. **检查文件**：`kind`、`v`、`process['-Id']`、`participants` 是数组、三张表是对象。
3. **改 id（照抄 `cloneProcess`）**
   - 流程 id 撞名时：`id + "_" + ++count`，从 `_2` 开始（pbuilder.js:4477-4486），名称后面加 `get_cbuilder_msg("pbuilder.label.copy")`，即 “(Copy)”。不撞名就保持原 id 和名称。
   - 参与者 id 在本地已有时：以流程 id 开头 → 换成新流程 id 开头；否则 `新流程id + "_" + 原id`（pbuilder.js:4528-4532）。仍撞名再加 `_2`、`_3`。
   - 跟 cloneProcess 一样改：`JaWE_GRAPH_WORKFLOW_PARTICIPANT_ORDER`、`JaWE_GRAPH_START_OF_WORKFLOW` / `END_OF_WORKFLOW` 里的 `JaWE_GRAPH_PARTICIPANT_ID=`、每个活动的 `Performer` 和 `JaWE_GRAPH_PARTICIPANT_ID`。活动 id 不变。
4. **依赖检查（只读）**：表单对照 `ProcessBuilder.availableForms`（`getForms`，pbuilder.js:7348，就是 `/web/json/console/app/<app>/<ver>/forms/options`）；插件对照 `GET /web/property/json/getElements?classname=org.joget.plugin.base.Plugin`（本机 352 个）。
5. **提醒**（只提醒，不自动改）：子流程（`Implementation.SubFlow`，pbuilder.js:3280）以及本地有没有那个流程；插件属性里名字带 participant、值还是改名前参与者 id 的（例如 EmailTool 的 `toParticipantId`，Joget 自带的 Clone 也不改它）；本地和文件里都没有的 Application；导出时远端有未保存修改。
6. **确认框**列出：新 id / 名称、参与者改名、缺少的表单、没装的插件、要重新填的敏感字段、提醒。
7. **追加**：参与者加进 `Package.Participants`；缺的 Application 加进 `Package.Applications`；流程加进 `Package.WorkflowProcesses`；三张表写成 `新流程id::…`。没有 `processStartWhiteList` 时补 `{type:"role", value:"adminUser"}`（跟 cloneProcess 一样，pbuilder.js:4594-4600）。**不调用 `updateJsonFromXpdl`**，别的流程的数据不动。
8. **刷新**：跟 cloneProcess 最后 4 行一样（pbuilder.js:4620-4624）：`CustomBuilder.update()` → `ProcessBuilder.updateProcessSelector()` → `CustomBuilder.Builder.triggerChange()` → `location.hash = 新id`。新流程出现在下拉菜单并被打开。
9. **不保存**。Save 走 Joget 原来的保存流程（保存提示音照常）。

## 依赖（Joget DX 9.1.2 源码）
| 用到的 | 出处 |
|---|---|
| `ProcessBuilder.cloneProcess`（改 id、复制绑定、刷新顺序） | pbuilder/js/pbuilder.js:4469-4625 |
| `getArray` / `setArray` | pbuilder.js:2801 / 2817 |
| `updateProcessSelector`、`#processes_list` | pbuilder.js:2697 |
| `currentProcessData`（`properties.id`、`xpdlObj`） | pbuilder.js:2960-2990（generateProcessData） |
| 参与者绑定的形状（`type:"plugin"` → `value` 是类名） | pbuilder.js:3848-3890（updateParticipantMapping） |
| `ProcessBuilder.availableForms` | pbuilder.js:7348（getForms） |
| `CustomBuilder.update` | builder/builder.js:1474 |
| `CustomBuilder.Builder.triggerChange` | builder/builder.js:8873 |
| `get_cbuilder_msg("pbuilder.label.copy")` | “(Copy)” |
| 工具栏 `.advanced-tools-toogle` | 同 hotkeys.js（docs/11） |

## 已知行为 / 限制
- `triggerChange` 时 Joget 会把**当前打开的那个流程**的布局重新写一遍（坐标微调、`NO_ROUTING_STRAIGHT` → `NO_ROUTING_ORTHOGONAL`）。Joget 自带的 Clone 按钮一模一样（测试里逐项对比过），不是这个扩展改的。
- 本地缺表单时，Joget 保存会报 “Design is invalid”（实测）。先用表单 JSON 把表单复制过来再导入。
- 参与者改名后，插件属性里写死的参与者 id（如 `toParticipantId`）不会自动改，只在确认框提醒（跟 Clone 一致）。
- 跨流程引用（子流程、别的流程的变量）只提醒，不处理。
- 敏感字段是按属性名猜的，可能多清（例如某个叫 `username` 的普通设置），导入后看确认框里的清单补回去。
- 表单定义、插件本身、环境变量、Package 级别的 DataFields / TypeDeclarations 不在包里。
- `CustomBuilder.data` 的结构没有公开文档；Joget 升级后先跑测试（结构对不上时导入会停下，不硬写）。

## 测试
`node tests/run.mjs "process copy"`（4 个）：
1. 按钮只在 Process Builder、在快捷键按钮后面；导出的包和设计器数据逐项一致（去前缀）；假的 username/password 被清空、`#envVariable.x#` 保留；导出不改设计器数据；Form Builder 上没有按钮。
2. 导入到同一个 app → `process1_2`、“(Copy)”；表单 / 插件绑定 1:1 改 key；原有流程（除布局外）和原有绑定不变；没有自动保存；并在另一个页面跑 Joget 自带的 `cloneProcess`，对比：原流程完全一致、新流程（除布局外）一致、参与者 id 和三张表的 key 一致、表单和参与者绑定一致。有效的 app 不会出现「设计无效」提示。
3. 模拟别的 app 的包（缺表单、缺插件、子流程、敏感字段、参与者改名）→ 确认框都列出来；取消不改数据；错误文件只显示错误、不改数据；皮肤关掉按钮消失。
4. 在内存里先 `addProcess()` 造一个空流程（和新建 app 打开 Process Builder 时自动生成的 stub 一样）→ 导入确认框列出「按 Save 会被拒绝」及空流程 id；导入后弹出同样的说明；点 Save（请求不会发出）会出现「无法保存：Design is invalid」对话框，点名那个空流程。关页面即丢掉，不写服务器。

测试不真正提交 Save。真实保存在 v1.4.0 开发时手动验证过：新建临时 app（复制自 crm）→ 从 crm 导出 process1 → 导入 → Save 成功 → 重新打开后 `process1_2`、参与者和三张表都在 → 删除临时 app。

## 「Design is invalid」

Joget 点 Save 时会跑 `ProcessBuilder.beforeSaveValidation` → `ProcessBuilder.validate()`（`pbuilder.js` 6439–6610）。它检查 **这个 app 里的全部流程**，不只是当前打开的那个。任意一个不合格，toast 就只显示「Design is invalid」，保存请求不会发出。画布上的红色 `invalidNodeMessage` 也只画在当前流程的节点上；空流程没有节点，所以看起来像「导入的流程有问题，但不知道错在哪」。

检查项（和 Joget 一致）：
- 流程至少有一个活动节点；必须恰好有一个开始节点（`JaWE_GRAPH_START_OF_WORKFLOW`）
- 每个活动要么有进入连线、要么是开始节点；要么有出去连线、要么是结束节点
- 开始节点后面的节点不能再有其他进入连线；Deadline 必须有对应的 EXCEPTION 连线

最常见情况：在 **空白 app**（或点了「新建流程」）打开 Process Builder 时，Joget 会自动建一个没有活动的 `process1`「Process 1」。再导入一份本来完全合法的流程（例如 `expenseclaim` 的 `process1`，会变成 `process1_2`），当前画布是合法的导入结果，但包里那个空的 `process1` 仍在，Save 就会失败。

处理：在流程下拉菜单里选中那个空流程，点删除，再保存。缺表单不会触发这句英文，但会让 Joget 在保存时用别的错误拒绝，仍需先把表单复制过来。

扩展会：
- 在导入确认框里预先列出这些问题（标题「按 Save 会被拒绝：设计无效」）
- 导入完成后如果包仍不合格，再弹一次说明
- 拦截 `ProcessBuilder.beforeSaveValidation`，失败时弹出「无法保存：Design is invalid」，列出每个流程 / 节点和原因

## 排查
- 按钮没出现：`<html>` 有没有 `joget-skin`；路径是不是 `.../process/builder`；工具栏里有没有 `.advanced-tools-toogle`。
- 点了没反应 / “页面脚本没有回应”：`about:debugging` 看 `pcopy-page.js` 是否被拦（`web_accessible_resources`），Console 里有没有 `ProcessBuilder` 报错。
- 导入停在“数据结构对不上”：Joget 版本变了，对照上面的依赖表到新 war 里查。

v1.4.3 起，导出/导入按钮在 [18. 工具栏「Joget Skin」菜单](18-tool-menu.md) 里，id 仍是 `#jskin-pcopy-export` / `#jskin-pcopy-import`。
