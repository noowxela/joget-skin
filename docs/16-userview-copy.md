# 16. UI / Userview 复制（导出 / 导入）— `ucopy-content.js` + `ucopy-page.js`（v1.4.2）

## 做什么
在 Userview Builder（UI 构建器）的工具栏（快捷键按钮右边）加两个按钮：
- **⬇ 导出此 UI**：把当前打开的 Userview JSON，连同依赖清单，下载成 `<appId>_<版本>_<userviewId>.userview.json`。
- **⬆ 导入 UI**：选一个这样的 JSON 文件，先检查、弹出确认框，按「导入」后在**当前 app 里创建一个新的 Userview**，并把导入的定义写进去，然后打开这个新 UI。

**不会改写当前打开的那个 UI。** 导入会立刻把新 Userview 写到服务器：Joget 的 `builderSave` 只能更新已有 id（未知 id 返回 404），官方「新建 UI」本身也会立即落库，设计器里不存在「未保存的新 Userview」。若不想保留，请到 App Composer 删除这个新 Userview。

适合把远端 Joget 上的某一个 UI 搬到本机 app，而不用导出 / 导入整个 app。

## 为什么不采用「只改设计器、等你按 Save」
流程导入可以那样做，因为一个 app 的所有流程都在同一份 `CustomBuilder.data` 里，Save 会整包写回。Userview Builder 里 `CustomBuilder.data` 只是**当前这一个** UI，`saveUrl` 是 `/userview/builderSave/{userviewId}`：
- 把打开的 UI 换成导入内容，会直接覆盖正在看的定义，太危险。
- 只改内存里的 `CustomBuilder.id` / `data.properties.id`，再按 Save，要么写到旧 id 上（覆盖），要么对新 id 得到 404。
- 官方创建接口 `POST /userview/submit/create` 本身就会 `dao.add`，没有「先打开空的新 UI、等你保存」这条路。

因此导入语义定为：**新建 + 写入定义 + 打开新 builder**；确认框会明确写出这一点。若第二步（`builderSave`）失败，会尝试删除刚创建的 Userview，避免留下空壳。

## 文件
| 文件 | 作用 |
|---|---|
| `ucopy-content.js` | 内容脚本（只顶层）。按钮、文件选择、确认框、下载。注入 `ucopy-page.js`，用 `window.postMessage` 跟它说话 |
| `ucopy-page.js` | 用 `<script src>` 注入到页面里（`manifest.json` → `web_accessible_resources`），读取 `CustomBuilder.getJson()` / `CustomBuilder.data`，调用官方创建和 `builderSave`。不用 `wrappedJSObject` |
| `builder.css` 末尾 | 确认框、提示条的样式与流程复制共用选择器（都在 `html.joget-skin` 之下） |

`ucopy-content.js` 跟 `pcopy-content.js`、hotkeys.js 一样注入在 `/jw/web/console/app/*/builder*`（Joget 可以不刷新就切 Builder），但只在路径是 `.../userview/builder` 时显示按钮。皮肤关掉（`<html>` 没有 `joget-skin`）时按钮移除。`#jskin-pcopy-*` 的 id 没有改，流程复制测试不受影响。

敏感字段的正则、`#envVariable.x#` 这类 hash variable 保留不清空、遍历 JSON 的 `walk()`，都与 `pcopy-page.js` 保持一致（有意平行，没有重构 pcopy，避免回归）。

### 消息通道
- 内容脚本 → 页面：`{ source: "jskin-ucopy-content", id, cmd: "ping" | "export" | "check" | "apply", text? }`
- 页面 → 内容脚本：`{ source: "jskin-ucopy-page", id, ok, error?, ... }`
- 都是 JSON 字符串；两边只收 `e.source === window` 且 `e.origin === location.origin` 的消息。
- 内容脚本先发 `ping`（幂等）直到页面脚本回应，再发真正的命令，保证 `apply` 只发一次。
- `apply` 先把结果 `postMessage` 回去，再调用 `CustomBuilder.ajaxRenderBuilder` 打开新 UI，避免导航把回复冲掉。

## 文件格式（v1）
```json
{
  "kind": "joget-userview-bundle", "v": 1,
  "source": { "origin", "appId", "appVersion", "userviewId", "userviewName", "exportedAt", "unsavedChanges" },
  "userview": "CustomBuilder.getJson() 解出来的整份 Userview JSON（properties / setting / categories / menus …）",
  "requires": {
    "forms": ["..."],
    "datalists": ["..."],
    "processes": ["..."],
    "activities": [{ "processId", "activityId" }],
    "userviews": ["引用到的其他 Userview id"],
    "plugins": ["className"],
    "envVariables": ["从 #envVariable.key# 扫到的 key"]
  },
  "sensitive": ["userview.setting.properties.….password", "..."]
}
```
- `requires` 只是清单（表单、列表、流程定义都不会打进包里）。
- 表单 = 属性里的 `formDefId` / `formId`；列表 = `listId` / `datalistId` / `datalistDefId`；流程 = `processId` / `processDefId`（去掉 `app#ver#` 前缀）；其他 Userview = `userviewId` / `userviewDefId`（排除自己）；插件 = 所有 `className`；环境变量 = 字符串里的 `#envVariable.x#`。
- **敏感字段**：属性名像 password / passwd / secret / token / apiKey / privateKey / credential / authorization / username / smtpUser 的非空字符串，导出时清空，路径记在 `sensitive`。只是 `#envVariable.x#` 这类 hash variable 引用的值保留（不是密码本身）。规则与流程导出相同。

## 导入步骤（`ucopy-page.js` 的 `plan()` + `apply()`）
1. **检查结构**（`shapeError()`）：当前是 Userview Builder（`CustomBuilder.builderType === "userview"`），有 `data.properties`、`getJson`、`appId` / `appVersion`。对不上就停下，什么都不写。
2. **检查文件**：`kind` 必须是 `joget-userview-bundle`，`v` 必须是 1，且有 `userview.properties`。
3. **新 id（照抄 App Composer 复制表单 / 列表的 `incrementSuffix`）**
   - 原 id 在当前 app 里不存在就沿用。
   - 已存在时加 `_2`；如果已经有 `_2`、`_5`，下一个是 `_6`（取已有数字后缀的最大值再加 1）。
   - 需要改 id 时，名称加「 (Copy)」；「 (Copy)」也撞名则用「 (Copy 2)」。
   - Joget 的 App Composer 没有「复制 Userview」按钮（只有表单和列表）。官方「新建 UI」对话框可以通过 `copyUserviewId` 复制一份，但 id / 名称由用户自己填。这里的自动后缀跟复制表单 / 列表对齐。
   - 写入前改写 `properties.id` / `name`，以及 `setting.properties.userviewId` / `userviewName`；指向自己的 `userviewId` 也会改成新 id。JSON 里的 id 必须和 URL 里的 id 一致，否则 `UserviewUtil.validateDefinitionIdWithJson` 会失败。
4. **依赖检查（只读）**：对照当前 app 的
   - `/web/json/console/app/<app>/<ver>/forms/options`
   - `/datalist/options`
   - `/userview/options`
   - `/envVariable/options`（没有则用 `/envVariable/list`）
   - `/processActivity/options`，以及 `/web/json/workflow/process/list?all=true`
   - 插件：`GET /web/property/json/getElements?classname=org.joget.plugin.base.Plugin`，再加上 Userview 主题 / 菜单 / 权限的 getElements，以及当前 Builder 的 `CustomBuilder.paletteElements`。Userview JSON 里的结构类型（`Userview`、`UserviewCategory`、`UserviewPage` 等）和 `menu-component` 不列入“缺少的插件”。
   某张清单读不到时，确认框会说明「无法完成的检查」，而不是把所有引用都标成缺失。
5. **确认框**列出：来源、当前打开的 UI（标明不会改写）、新 id / 名称、缺少的依赖、要重新填的敏感字段，以及「会写入服务器」的说明。
6. **创建**：`POST /web/console/app/<app>/<ver>/userview/submit/create`（`id` / `name` / `description` / `builderMode=true`），CSRF 头用 `ConnectionManager.tokenName` / `tokenValue`。不传 `copyUserviewId`，避免先复制当前 UI 再覆盖。
7. **写入定义**：`POST /web/console/app/<app>/<ver>/userview/builderSave/<新id>`，body 是官方同款的 `jsonFile`（`FormData` + `JSON.stringify(...).replace(/\//g, '\\/')`）。失败则 `POST .../userview/delete`（`ids=<新id>`）回滚。
8. **打开新 UI**：`CustomBuilder.ajaxRenderBuilder(.../userview/builder/<新id>)`（跟官方 `userviewSaved.jsp` 一样）。

## 依赖（Joget DX 9.1.2 源码）
| 用到的 | 出处 |
|---|---|
| `CustomBuilder.getJson` / `CustomBuilder.data` / `CustomBuilder.id` | builder/builder.js（getJson 约 1515 行） |
| `CustomBuilder.saveUrl` → `builderSave/{userviewId}`；未知 id 返回 404；JSON id 必须匹配 | `UserviewBuilderWebController.save` |
| `AppUtil.getSubmittedJsonDefinition`（`json` 参数或 multipart `jsonFile`） | `AppUtil.java` |
| 官方新建：`POST /userview/submit/create`，可选 `copyAppId` + `copyUserviewId`，始终 `dao.add` | `ConsoleWebController.consoleUserviewSubmit` |
| 复制已有 UI 时改写 `properties.id/name/description` 和 `setting.properties.userviewName` | `GeneratorUtil.createNewUserviewJson` |
| 删除：`POST /userview/delete`，参数 `ids` | `ConsoleWebController.consoleUserviewDelete` |
| 表单 / 列表复制时的 `incrementSuffix`（`_2`、`_3`…） | `abuilder.core.js`（App Composer 复制表单 / 列表；Userview 没有对应按钮） |
| 创建成功后 `parent.CustomBuilder.ajaxRenderBuilder(.../userview/builder/{id})` | `userviewSaved.jsp` |
| CSRF | Joget 的 CSRFGuard 脚本只钩 `XMLHttpRequest`（也就是 `jQuery.ajax`），不钩 `fetch`。顶层窗口的 `ConnectionManager.token*` 常常是空的，真正的值在画布 iframe（`blank.jsp`）里。导入的 POST 走 `jQuery.ajax`，并尽量从 iframe / `/csrf` 补上 token |
| 工具栏 `.advanced-tools-toogle` | 同 hotkeys.js（docs/11） |

## 已知行为 / 限制
- 导入会在服务器上留下一个新 Userview。这是有意为之，不是自动「另存」当前打开的 UI。
- 表单、列表、流程、插件、环境变量的**定义本身**不在包里，只扫描引用。本地缺了这些，新 UI 能创建，但对应菜单 / 页面会坏，需要先把依赖复制过来。
- 敏感字段是按属性名猜的，可能多清（例如某个叫 `username` 的普通设置），导入后看确认框里的清单补回去。
- `#envVariable.x#` 引用会保留，但环境变量的值不会跟着导出。
- 跨 app 导入时，id 若在目标 app 里还没用过，会沿用原来的 id。
- `CustomBuilder.data` 的结构没有公开文档；Joget 升级后先跑测试（结构对不上时导入会停下，不硬写）。

v1.4.3 起，导出/导入按钮在 [18. 工具栏「Joget Skin」菜单](18-tool-menu.md) 里，id 仍是 `#jskin-ucopy-export` / `#jskin-ucopy-import`。
