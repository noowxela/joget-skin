# 9. Quick nav 收到右边 + 把手

**做什么**
- 右边的 quick nav 竖条平时只露 6px（半透明）；Joget 给它留的 30-40px 还给画布（见 [10](10-canvas-centering.md)）。
- v1.3.8：右边缘加一个看得见的把手 `#jskin-qn-handle`（16×64px，垂直居中）。鼠标移到把手上，quick nav 展开到 40px，把手跟着移到它左边；鼠标移进 quick nav 本身也保持展开。
- 点把手 = 固定展开 / 取消固定（`html.jskin-qn-pinned`，记在页面的 `localStorage` 的 `jogetSkinQuickNavPinned`）。固定时画布右边让出 40px。
- 放在左边的 quick nav（`quick-nav-position-left`）、展开的菜单（`#quick-nav-bar.active`）不动；菜单打开时把手隐藏。

**文件**：`edgetoggles.js`（`ensureQuickNav()`）；样式 `builder.css` 的 v1.3.7 b) 段和「v1.3.8 Edge handles」段（悬停用 `body:has(#jskin-qn-handle:hover)`，Firefox 121+ 支持，manifest 要求 142+）。

**依赖 Joget 9.1.2**
| 依赖 | 出处 |
|---|---|
| `#quick-nav-bar` | `WEB-INF/jsp/cbuilder/base.jsp:336`；样式 `builder/builder.css:1970-2010` |
| `body.quick-nav-shown` | `builder/builder.js:4775` |
| `body.quick-nav-position-left`、`#quick-nav-bar.active`（Esc 关闭） | `builder/builder.js:4550-4565` |

**脆弱点**：Joget 的 `transition: 0.35s all` 被改成只过渡 width/opacity；Joget 若改成 transform 动画，展开可能失效。

**排查**：悬停把手时看 `#quick-nav-bar` 宽度是否变 40px；把手不见 → `body` 上有没有 `quick-nav-shown`。
测试：`quick nav: 6px idle, handle hover -> 40px, click pins / unpins`。
