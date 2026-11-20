# 13. 属性面板 标签左、输入框右

**做什么**：简单的单行属性改成一行两栏：左边标签（约 38%，最少 110px），右边输入框；描述文字（Joget 默认隐藏 `.property-description`）如果显示，会放在输入框下面。复杂的属性仍然上下排列。

**并排的类型**（`.property-editor-property` 上的 `property-type-*`）：`textfield`、`icon-textfield`、`autocomplete`、`selectbox`、`number`、`password`、`color`、`readonly`、`checkbox-truefalse`（单个勾选框）。

**保持上下排列的类型**：`header`、`grid`、`gridcombine`、`gridfixedrow`、`elementselect`（插件选择，下面带子属性）、`elementmultiselect`、`codeeditor`、`textarea`、`htmleditor`、`repeater`、多选 `checkbox`、`radio`、`imageradio`、`multiselect`、`sortableselect`、`iconbuttons`、`cssstyle`、`colorscheme`、`file`、`image`、`label`、`custom`、`hidden`。
（类型列表来自 `js/jquery/jquery.propertyeditor.js` 的 `PropertyEditor.Type.*`，class 名 = `property-type-` + 类型小写，见 3032 行；`checkbox-truefalse` 见 7543 行。）

**做法**：只用 CSS（`builder.css` 414-515 行），范围 `html.joget-skin #right-panel`：行变成 `display:grid`，`.property-label-container` 设 `display:contents`，让标签和描述直接成为网格单元；`.property-input` 去掉 Joget 的 float 和 80% 宽度。Joget 隐藏的行（class `hidden` 或内联 `display:none`）不受影响。错误提示 `.property-input-error` 是 Joget 加在输入框容器里的，跟着输入框在右栏。

**依赖 Joget 9.1.2**
| 依赖 | 出处 |
|---|---|
| 行结构 `.property-editor-property > .property-label-container(.property-label + .property-description) + .property-input` | `js/jquery/jquery.propertyeditor.js:3032` 起 |
| Joget 原布局：`.property-label-container{width:20%;float:left}`、`.property-input{width:80%;float:right}`，窄面板 `.narrow` 时上下排 | `js/jquery/jquery.propertyeditor.css:255-292, 1598-1606` |
| 窄面板 class `narrow`（宽度 ≤680px） | `jquery.propertyeditor.js:140-151, 1911` |

**脆弱点**
- Joget 用 jQuery `.show()` 显示行时会写内联 `display:block`，所以这里用了 `display:grid !important`（并排除内联 `display:none`）。
- 新的属性类型不会自动并排（白名单）。

**排查**：选中一行看 `display` 是否为 `grid`、class 里的 `property-type-*` 是什么。
测试：`property editor: label left / input right …`（文本字段：11 行并排、5 行复杂类型保持上下）、`property editor rows: list builder column properties`。
