# 18. 工具栏「Joget Skin」菜单 — `toolmenu.js`（v1.4.3）

Builder 工具栏里，Joget Skin 以前并排放了快捷键、流程/UI 导出导入、Canvas Controls 几个按钮，占位置。现在收成一个「Joget Skin ▾」按钮（扳手图标，`#jskin-tool-btn`），悬停或点击打开下拉菜单。

## 做什么
- 只在皮肤开启、并且页面上有 `#builderToolbar .advanced-tools-toogle` 时出现。位置在 Advanced Tools 后面；App Composer 上则在「显示其他 Builder」后面。
- 打开方式：鼠标悬停、点击、焦点在按钮上时按 Enter（按钮默认行为）。关掉：再点一次、按 Escape、在菜单外点击。从按钮移到菜单会延迟约 200ms 再关，以免还没移进去就被收起来。
- 菜单项沿用原来的按钮和 id（`#jskin-cc-btn`、`#jskin-hotkeys-btn`、`#jskin-pcopy-export` / `import`、`#jskin-ucopy-export` / `import`），点击行为不变。菜单里补上中文标签；Canvas Controls 会显示当前是「已隐藏」还是「✓ 已显示」。
- 菜单内容跟当前 Builder 走：Process Builder 有 Canvas Controls 和流程导出/导入；Userview Builder 有 UI 导出/导入；各 Builder 都有快捷键。SPA 切换或关掉皮肤时，对应项和菜单本身会摘掉。
- 下拉层挂在 `document.body` 上并用 `position: fixed`，避免被 `#top-panel { overflow: hidden }` 裁掉。

## 文件
| 文件 | 作用 |
|---|---|
| `toolmenu.js` | 内容脚本（只顶层）。建按钮和菜单、托管各模块的按钮组、处理打开/关闭 |
| `builder.css` | 按钮和菜单样式（`html.joget-skin #jskin-tool-…`） |
| `hotkeys.js` / `pcopy-content.js` / `ucopy-content.js` / `canvasctl.js` | `placeGroup()`：有菜单就把自己的按钮组放进去，没有菜单才退回原来的工具栏位置 |

`manifest.json` 把 `toolmenu.js` 放在同一条 `builder*` `content_scripts` 的最前面，好让后面的脚本能找到 `#jskin-tool-menu`。

App Composer 的「显示其他 Builder」按钮不进这个菜单，仍单独放在 Advanced Tools 后面。

## 测试
`node tests/run.mjs "toolbar menu"`：Process Builder 菜单含 Canvas Controls / 快捷键 / 导出导入流程；Esc 和点击可开关；打开 Userview Builder 后换成 UI 导出导入；关掉皮肤后菜单消失。相关的 process copy / userview copy / canvas controls / hotkeys / composer 测试会先打开菜单再点原来的按钮。
