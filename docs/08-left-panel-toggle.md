# 8. 左栏开关（面板外侧把手 + 快捷键）

**做什么**
- v1.3.7：Joget 的 `#left-panel-toogle`（原拼写）只有 10×40px，放大成 20×64px。
- v1.3.8：开关移到**左栏外侧**。`#left-panel` 是 `overflow: hidden`，Joget 的按钮出不去，所以 `edgetoggles.js` 自己加一个固定定位的 `#jskin-left-handle`（20×64px，右侧圆角），贴在左栏右边缘外面、垂直居中，收起时跟着移到 10px 窄条外面。点它等于点 Joget 的按钮，所以 `body.left-panel-closed` 和箭头图标仍由 Joget 自己处理。
- Joget 的按钮在我们的把手存在时（`html.jskin-edge-handles`）设为 `opacity: 0; pointer-events: none`。**不能用 `display: none`**：Joget 的按钮处理函数只在 `$(btn).is(":visible")` 时才执行（`builder/builder.js:1013`）。
- 快捷键：默认 **Ctrl+[**，在快捷键面板里可以改（见 [11](11-hotkeys.md)）。画布 iframe 里也能按；光标在 CodeMirror 里时不拦截（那里 Ctrl+[ 是取消缩进）。
- 画布两侧空隙从 10px 变 30px（`--jskin-canvas-gap`），给把手留位置，同时保持居中（见 [10](10-canvas-centering.md)）。

**文件**：`edgetoggles.js`（`toggleLeft()`、`onKey()`、`ensureLeft()`）；样式 `builder.css` 的「v1.3.8 Edge handles」段。

**存储键**：`jogetSkinHotkeyLeftPanel` = `{ ctrl, meta, alt, shift, code, key }`（`code` 是物理键，例如 `BracketLeft`，和键盘布局、输入法无关）。

**依赖 Joget 9.1.2**
| 依赖 | 出处 |
|---|---|
| `#left-panel-toogle`（`data-cbuilder-action="toogleLeftPanel"`） | `WEB-INF/jsp/cbuilder/base.jsp:250` |
| 按钮处理只在可见时执行（`:visible`） | `builder/builder.js:989-1021` |
| `toogleLeftPanel` 加/去 `body.left-panel-closed`、换图标 | `builder/builder.js:2576-2584` |
| `#left-panel { overflow: hidden }` | `builder/builder.css:140-143` |
| CSS 变量 `--builder-left-panel-width`、`--builder-header-top-height` | `builder/builder.css:5, 16-60` |

**脆弱点**：Joget 改按钮 id、改成别的事件（不是 click），或者不再用 `:visible` 判断时，要回来看。

**排查**：点把手没反应 → Console 跑 `$("#left-panel-toogle").is(":visible")`，必须是 `true`。把手不见 → `<html>` 上有没有 `jskin-edge-handles`。快捷键无效 → 看 `browser.storage.local` 里的 `jogetSkinHotkeyLeftPanel`，以及 `<html>` 上是否卡着 `data-jskin-hk-recording`。
测试：`left-panel handle: …`、`left-panel hotkey: …`。
