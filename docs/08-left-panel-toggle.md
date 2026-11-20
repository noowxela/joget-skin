# 8. 左栏开关按钮放大

**做什么**：Joget 的 `#left-panel-toogle`（原拼写）只有 10×40px、图标 10px，很难点。改成 20px 宽、行高 64px、图标 16px，悬停时淡蓝高亮。左栏收起时 `--builder-left-panel-width` 从 10px 改成 22px，让大按钮放得下。

**文件**：`builder.css` 220-237 行。

**依赖 Joget 9.1.2**
| 依赖 | 出处 |
|---|---|
| `#left-panel-toogle`（`data-cbuilder-action="toogleLeftPanel"`） | `WEB-INF/jsp/cbuilder/base.jsp:250` |
| `body.left-panel-closed`（`toogleLeftPanel` 加/去） | `builder/builder.js:2578, 2581, 2865` |
| CSS 变量 `--builder-left-panel-width`（默认按屏幕宽 8–20vw，收起 10px） | `builder/builder.css:16-60` |

**脆弱点**：Joget 改按钮 id（连拼写一起改）就失效。

**排查**：选中按钮看尺寸；收起左栏后看 `body` 上是否有 `left-panel-closed`，以及 `--builder-left-panel-width` 的计算值。
测试：`left-panel toggle is at least 20 x 60 px`。
