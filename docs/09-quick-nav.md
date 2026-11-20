# 9. Quick nav 收到右边

**做什么**：右边的 quick nav 竖条平时只露 6px（半透明），鼠标移上去 0.15 秒后展开到 40px；Joget 给它留的 30-40px 还给画布（见 [10](10-canvas-centering.md)）。放在左边的 quick nav（`quick-nav-position-left`）和展开的菜单（`#quick-nav-bar.active`）不动。

**文件**：`builder.css` 239-249 行。

**依赖 Joget 9.1.2**
| 依赖 | 出处 |
|---|---|
| `#quick-nav-bar` | `WEB-INF/jsp/cbuilder/base.jsp:336`；样式 `builder/builder.css:1970-2000` |
| `body.quick-nav-shown` | `builder/builder.js:4775` |
| `body.quick-nav-position-left`、`#quick-nav-bar.active`（Esc 关闭） | `builder/builder.js:4550-4565` |

**脆弱点**：Joget 的 `transition: 0.35s all` 被覆盖成只过渡 width/opacity；Joget 若改成 transform 动画，悬停展开可能失效。

**排查**：悬停时看 `#quick-nav-bar` 宽度是否变 40px；没变就看 `:hover` 规则是否被 Joget 的 `!important` 盖过。
测试：`quick nav: 6px idle, 40px on hover`。
