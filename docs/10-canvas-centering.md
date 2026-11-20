# 10. 画布居中

**做什么**：`#builder_canvas` 在「左栏右边」到「右边被占用的区域」之间水平居中，左右留白一样（各 10px 起），不再贴左。保留 Joget 自己的视口宽度（desktop 1000 / tablet 768 / mobile 375）；放不下时用 `max-width` 缩小（和 Joget 自己的 `max-width` 思路一样）。没有视口 class 的画布（Process Builder 等）直接填满中间空间。预览模式（`#cbuilder.preview`）不动。

**原理**：Joget 的画布是 `position: fixed`，用 `margin-left = 左栏宽 + 5px` 定位。这里改成同时设 `left` 和 `right`，`margin-left/right: auto`，浏览器会自动居中。
- `--jskin-canvas-gap: 10px` 两边留白；v1.3.8 有边缘把手时（`html.jskin-edge-handles`）变 30px，给左栏外侧把手和右边 quick nav 把手留位置。quick nav 固定展开时（`html.jskin-qn-pinned`）右边占用 40px
- `--jskin-canvas-right`：右边被占的宽度
  - quick nav 收起（默认）：6px；没有 quick nav 或在左边：0；Joget 原状 30px
  - 属性面板浮动打开（`max-property-editor`，Joget 的面板 `right: 40px`）：`40px + --builder-right-panel-width`
  - 属性面板停靠：`--builder-right-panel-width`

**文件**：`builder.css` 250-286 行（说明在 204-219 行的 c 段）。

**实测（1440×900，crm 演示 app）**
| 情况 | Joget 原样 | 加皮肤 |
|---|---|---|
| Form / List / UI Builder，属性面板打开 | 左 20px，右 -174px（画布有 174px 压在属性面板下面），宽 1000 | 左 10 / 右 10，宽 826 |
| 属性面板关闭 | — | 左 120 / 右 120，宽 1000 |
| 左栏收起 | — | 左 206 / 右 206，宽 1000 |
| Process Builder，面板打开 / 关闭 / 左栏收起 | 左 0，右 -365，宽 1211 | 10/10 宽 826；10/10 宽 1220；10/10 宽 1392 |
选中元素后的蓝色选择框和元素位置差 0px（TextField、TextArea）。

**依赖 Joget 9.1.2**
| 依赖 | 出处 |
|---|---|
| `#builder_canvas` 的 fixed 定位和宽度规则 | `builder/builder.css:399-450` |
| `--builder-left-panel-width`、`--builder-right-panel-width` | `builder/builder.css:16-63` |
| 视口 class `desktop/tablet/mobile`（加在 body 和 `#builder_canvas`） | `builder/builder.js:3697-3703` |
| `body.max-property-editor`、`property-editor-right-panel`、`no-right-panel`、`right-panel-closed` | `builder/builder.js:574, 3716, 3811-3813`；浮动面板 `right: 40px` 在 `builder/builder.css:1653-1666` |
| `#element-select-box`（选择框，跟着画布里的 iframe 走） | `builder/builder.js:5157` |

**脆弱点**
- 属性面板被用户手动拖宽（`#right-panel-resize`）时，Joget 改的是内联宽度而不是变量，这时右边留白会不准（画布可能和面板重叠一点）。
- 属性面板打开时，desktop 画布会从 1000 缩到可用宽度（1440 宽屏幕上约 826），表单会按这个宽度排版；关闭面板就恢复 1000。
- Joget 若在 `#builder_canvas` 上写内联 `left/margin`，本规则（带 `!important`）会盖过它。

**排查**：选中 `#builder_canvas` 看计算后的 `left`、`right`、`margin-left`、`max-width`；在 Console 执行 `getComputedStyle(document.body).getPropertyValue("--jskin-canvas-right")`。
测试：`canvas centred: form/datalist/userview/process builder` 和 `canvas: element select box still lines up`。
