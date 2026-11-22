# 17. 隐藏 / 显示 Canvas Controls — `canvasctl.js`（v1.4.3）

Process Builder 右下角有一块 Joget 自带的「Canvas Controls」提示（Shift+拖动平移、Shift+滚轮横向滚动、Ctrl+滚轮缩放）。Joget 自己的收起按钮只是加上 class `hidden`，仍会留下一条小条，还是占位置。这个模块在皮肤开启时默认把整块提示完全藏起来，工具栏用一个按钮再打开。

## 做什么
- 只在 Process Builder（路径 `.../process/builder`）显示工具栏按钮（`#jskin-cc-btn`，图标 `la-info-circle`，title「显示 / 隐藏 Canvas Controls」）。位置在导出/导入流程按钮后面。
- 默认隐藏整块 `#pbuilder-controls-indicator`（CSS：`html.joget-skin:not(.jskin-cc-on)`）。
- 点按钮切换显示；打开时记 `localStorage.jogetSkinCanvasControls = "1"`，关掉或未设置都视为隐藏。显示时会把提示移到 `#builder_canvas` 右下角并提高 z-index（Joget 默认 `right: 50px; z-index: 9` 会被右侧属性面板挡住）；关掉后清掉我们写的定位，皮肤关闭时恢复 Joget 原位置。
- 面板右上有一个我们加的「×」（`#jskin-cc-x`），效果和点工具栏关掉一样。
- Joget 自己的向下箭头仍然只收起说明文字，不会把整块去掉。
- 皮肤关掉（`<html>` 没有 `joget-skin`）时按钮和 × 都移除，Joget 原来的提示恢复显示。
- Joget 可以不刷新就切 Builder，所以脚本跟 hotkeys.js 一样注入在 `builder*`，离开 Process Builder 就摘掉按钮。

## 文件
| 文件 | 作用 |
|---|---|
| `canvasctl.js` | 内容脚本（只顶层）。按钮、localStorage、给面板加 ×、给 `<html>` 加/去掉 `jskin-cc-on` |
| `builder.css` | `html.joget-skin:not(.jskin-cc-on) #pbuilder-controls-indicator { display: none !important }`，以及 × 的样式 |

`manifest.json` 把 `canvasctl.js` 和 hotkeys / pcopy / ucopy 放在同一条 `content_scripts`（`/jw/web/console/app/*/builder*`）。

## 存储
| 键 | 位置 | 含义 |
|---|---|---|
| `jogetSkinCanvasControls` | 页面的 `localStorage`（跟 Joget 同域，例如 `localhost:8080`） | `"1"` 显示；`"0"` 或没有这个键 = 隐藏 |

这不是 `browser.storage`，换一台电脑或清站点数据会回到默认（隐藏）。

## 依赖的 Joget DOM / JS（DX 9.1.2）
| 我们用的 | 来自 |
|---|---|
| `#pbuilder-controls-indicator` 及其子节点 `#pbuilder-controls-header` / `#pbuilder-controls-body` / `#pbuilder-controls-close` / `#pbuilder-controls-open` | `pbuilder/js/pbuilder.js`「Simple controls indicator」IIFE（约 2158–2188 行），标题文案 `pbuilder.canvas.tooltip.header`（英文是 “Canvas Controls”） |
| class `hidden` 只收起正文和关闭钮、仍显示一条带向上箭头的小条 | 同上；样式在 `pbuilder/css/pbuilder.css` 约 22–82 行 |
| `#builderToolbar .advanced-tools-toogle` 作为工具栏锚点 | 与 composer.js / hotkeys.js / pcopy 相同 |

面板是 `document.body.appendChild` 上去的，在 Process Builder 初始化偏后才出现。脚本用 `MutationObserver` 等它出现后再挂 ×。离开 `/process/` 时 Joget 会把这个节点删掉（`pbuilder.js` 约 2185–2187 行）。

## 测试
`node tests/run.mjs "canvas controls"`：默认隐藏、工具栏按钮可开关且写入 localStorage、× 可关掉、皮肤关掉后面板按 Joget 原样出现、Form Builder 上没有按钮。

## 排查
- 按钮没出现：`<html>` 有没有 `joget-skin`；路径是不是 `.../process/builder`；工具栏里有没有 `.advanced-tools-toogle`。
- 面板一直在：看 `<html>` 有没有误加 `jskin-cc-on`，或 CSS 没注入。
- 打开后看不见：Joget 可能还没建出 `#pbuilder-controls-indicator`（刚进 Process Builder 时等一两秒）；或之前被 Joget 的 `hidden` 收起，我们在显示时会去掉这个 class。若提示仍在属性面板后面，检查面板有没有被移到 `#builder_canvas` 里（`data-jskin-placed="1"`）。

v1.4.3 起，开关按钮在 [18. 工具栏「Joget Skin」菜单](18-tool-menu.md) 里，id 仍是 `#jskin-cc-btn`。菜单项会显示当前是「已隐藏」还是「✓ 已显示」。
