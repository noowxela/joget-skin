# 12. 属性面板 全部收起 / 全部展开

**做什么**：在右侧属性面板的分节列表（`.property-editor-pages`）正上方加一个按钮：有任何一节是展开的就显示「全部收起」，否则显示「全部展开」。每次选别的元素属性面板会重画，按钮会自动补回来，且只有一个。

**做法**：直接点 Joget 自己的 `#collapse-all-props-btn` / `#expand-all-props-btn`（只有图标的那两个），所以 Joget 记住的状态（builder 的 localStorage 设置 `expandProps`）也一起更新；如果对应的 Joget 按钮看不见（Joget 的处理函数会忽略隐藏按钮），就用 Joget 同样的方法给每节加/去 `collapsed` class。

**文件**：`propcollapse.js`（146 行）：`setAll()` 46-56，`label()` 58-73，`ensure()` 75-103，观察器 125-144。样式 `builder.css` 384-413 和 516-523 行（按钮条占 30px，分节列表往下移 30px）。

**存储键**：本扩展无；Joget 自己的 `localStorage["<builderType>-settings"].expandProps`（`builder/builder.js:1107-1119`）。

**依赖 Joget 9.1.2**
| 依赖 | 出处 |
|---|---|
| `#expand-all-props-btn` / `#collapse-all-props-btn` | `WEB-INF/jsp/cbuilder/base.jsp:274-279` |
| `CustomBuilder.expandAllProperties` / `collapseAllProperties`（选择器 `#right-panel .property-editor-container > .property-editor-pages > .property-editor-page`，class `collapsed`） | `builder/builder.js:3890-3910` |
| 单节点开关（点 `.property-editor-page-title` 切换 `collapsed`） | `js/jquery/jquery.propertyeditor.js:2321-2323` |
| `.single-page .property-editor-pages { position:absolute; top… }` | `js/jquery/jquery.propertyeditor.css:85-92`、`2185-2190`（按钮条因此做成 absolute，分节列表 top 改 30px） |

**脆弱点**：Joget 改属性面板结构（容器 class、分节 class）后按钮不出现或位置压住第一节。

**排查**：`document.querySelectorAll(".jskin-prop-collapse-bar").length` 应为 1；按钮压住分节标题 → 看 `.property-editor-pages` 计算后的 `top`。
测试：`property editor: 全部收起/全部展开 (form builder)`、`(datalist builder)`。
