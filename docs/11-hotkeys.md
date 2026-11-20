# 11. 快捷键按钮

**做什么**：在工具栏 Advanced Tools 右边加一个键盘图标按钮（App Composer 上排在「显示其他 Builder」后面），点开显示 Joget 自带的全部 Builder 快捷键。按 Esc、点外面、点进画布都会关闭。Mac 上显示 ⌘。

**文件**：`hotkeys.js`（288 行）：清单 `GROUPS` 34-77，面板 `buildPanel()` 97-139，开关 `openPanel()/closePanel()` 180-209（画布 iframe 点击 `frameDocs()` 165-178），按钮 `ensureButton()` 211-253，观察器 272-287。样式 `builder.css` 287-383 行。

**快捷键清单和出处（Joget 9.1.2）**
| 快捷键 | 作用 | 出处 |
|---|---|---|
| Ctrl/⌘+S | 保存 | `WEB-INF/jsp/cbuilder/base.jsp:110`（`data-cbuilder-shortcut="ctrl+s"`） |
| Ctrl/⌘+Z | 撤销 | `base.jsp:175` |
| Ctrl+Shift+Z | 重做（Mac 要按 Control；⌘⇧Z 不触发，已实测） | `base.jsp:179` |
| Ctrl/⌘+C | 复制选中的元素 | `base.jsp:185` |
| Ctrl/⌘+V | 粘贴元素 | `base.jsp:189` |
| Esc | 关闭 quick nav 菜单；没开时关闭属性面板 | `builder/builder.js:4557-4565` |
| Shift+拖动 | Process Builder 平移画布 | `pbuilder/js/pbuilder.js:2066-2068` |
| Shift+滚轮 | Process Builder 横向滚动 | `pbuilder/js/pbuilder.js:2116-2119` |
| Ctrl+滚轮 | Process Builder 放大/缩小 | `WEB-INF/classes/pbuilder.properties:216`（画布提示文字） |
| ↑ / ↓、Enter | App Composer 搜索建议上下选、套用 | `js/abuilder.core.js:222-233` |
| Backspace | App Composer 搜索框为空时移除标签筛选 | `js/abuilder.core.js:447, 635` |
| Ctrl/⌘+F、F3/Shift+F3、Esc | 代码编辑器查找替换、下一个/上一个、关闭查找栏 | `js/codemirror6/codemirror6.js:263-265` |
| F1 / F12 | 代码编辑器帮助 / 全屏 | `codemirror6.js:277-283` |
| Ctrl/⌘ + = / − | 代码编辑器字号 | `codemirror6.js:284-296` |
| Tab / Shift+Tab | 代码编辑器缩进 | `codemirror6.js:261` |

说明：
- 快捷键由 `CustomBuilder.initBuilderActions()` 用 jQuery.hotkeys 绑定（`builder/builder.js:981-1041`），同时绑在主页面和画布 iframe 上；`filterInputAcceptingElements/filterTextInputs = false`（986-987 行），所以在输入框里也生效。
- ⌘ 当 Ctrl：`builder/jquery.hotkeys.js:169-170`。它把修饰键拼成 `shift+ctrl+z`，和绑定的 `ctrl+shift+z` 对不上，所以 ⌘⇧Z 不能重做。
- 没列入：`fbuilder/dbuilder/ubuilder.properties` 里的 “Redo (Ctrl+Y)”、“Preview (Ctrl+P)” 是旧版 `js/cbuilder.core.js:144-170` 的，DX9 的 `base.jsp` 不加载它。Process Builder 的 LogicFlow 没有开 keyboard 插件（`pbuilder.js:240-265`）。

**可修改的扩展快捷键（v1.3.8）**：面板最上面一组「Joget Skin 扩展加的（可修改）」，目前只有「收起 / 展开左侧面板」，默认 Ctrl+[。
- 点「修改」→ 显示「请按新组合键…」→ 直接按组合键。Esc 取消。
- 必须带 Ctrl / ⌘ / Alt（或用 F1-F12），不然打字时会误触。
- 和 Joget 的保存、撤销、重做、复制、粘贴冲突时会拒绝并提示。
- 改过之后多一个「恢复默认」按钮。
- 录键时 `<html>` 上有 `data-jskin-hk-recording`，`edgetoggles.js` 这时不响应，Joget 也收不到（拦在 capture 阶段）。
- Joget 自带的快捷键不能改，只能看。

**存储键**：`jogetSkinHotkeyLeftPanel`（`browser.storage.local`，`edgetoggles.js` 读同一个键，改了即时生效）。

**依赖 Joget**：`#builderToolbar .advanced-tools-toogle`（`base.jsp:115, 128`），画布 iframe `#builder_canvas iframe`（同源 `/jw/builder/blank.jsp`），按钮外观用 Joget 的 `btn-group toolbar-group me-3` + `btn btn-light` + Line Awesome 图标 `las la-keyboard`。

**脆弱点**
- 清单是写死的；Joget 升级加了新快捷键要手动更新 `GROUPS`（重新 grep `data-cbuilder-shortcut`、`keydown`）。
- 面板打开时会拦截 Esc（只拦这一次，用来关闭面板，防止 Joget 同时关掉属性面板）；面板关着时不监听任何按键。

**排查**：按钮不见 → `document.querySelector("#builderToolbar .advanced-tools-toogle")`；URL 是否匹配 `PAGE_RE`（28 行）。
测试：`hotkeys: …` 三个测试（位置/开关、App Composer 顺序、⌘ 映射），以及 `left-panel hotkey: …`（修改快捷键）。
