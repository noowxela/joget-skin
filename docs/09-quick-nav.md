# 9. Quick nav 隐藏 + 开关按钮

**做什么**
- 右边的 quick nav 竖条平时**完全隐藏**（宽 0、无边框、`visibility:hidden`），鼠标悬停不会展开；Joget 给它留的 30-40px 还给画布（见 [10](10-canvas-centering.md)）。
- v1.3.9：右边缘的开关按钮 `#jskin-qn-handle` 和左边的 `#jskin-left-handle` 同款（20×64px，垂直居中，左侧圆角）。只有**点按钮**才展开 / 收起。
- 展开时 quick nav 40px、按钮跟着移到它左边、画布右边让出 40px；状态记在 `html.jskin-qn-pinned` 和页面 `localStorage` 的 `jogetSkinQuickNavPinned`。箭头：收起时 ‹，展开时 ›。
- 放在左边的 quick nav（`quick-nav-position-left`）、展开的菜单（`#quick-nav-bar.active`）不动；菜单打开时把手隐藏。

**文件**：`edgetoggles.js`（`ensureQuickNav()`）；样式 `builder.css` 的 v1.3.7 b) 段和「v1.3.8 Edge handles」段。

**依赖 Joget 9.1.2**
| 依赖 | 出处 |
|---|---|
| `#quick-nav-bar` | `WEB-INF/jsp/cbuilder/base.jsp:336`；样式 `builder/builder.css:1970-2010` |
| `body.quick-nav-shown` | `builder/builder.js:4775` |
| `body.quick-nav-position-left`、`#quick-nav-bar.active`（Esc 关闭） | `builder/builder.js:4550-4565` |

**脆弱点**：Joget 的 `transition: 0.35s all` 被改成只过渡 width/visibility；Joget 若改成 transform 动画，展开可能失效。

**排查**：点按钮后看 `<html>` 是否有 `jskin-qn-pinned`、`#quick-nav-bar` 宽度是否 40px；按钮不见 → `body` 上有没有 `quick-nav-shown`。
测试：`quick nav: hidden, no hover reveal, toggle button opens / closes`。
