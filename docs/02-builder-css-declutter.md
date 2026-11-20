# 2. builder.css：去杂项（declutter）

**做什么**（`builder.css`）
- 1a 隐藏首次使用提示气泡 `.guider`、`#guider_overlay`（19-23 行）
- 1b 隐藏右下角 AI composer 圆钮 `#composerIcon`、`#cc-dock-preview`（25-29 行）
- 1c 左边组件面板的项目变矮（31-41 行）：`#left-panel .components-list ol > li` 和 `.builder-palette-element`
- 2 布局说明（43-55 行），2a App Composer 样式（56-202 行，见 [05](05-composer.md)）

**存储键**：无（只看 `html.joget-skin`）。

**依赖 Joget**（9.1.2）
- `.guider` / `#guider_overlay`：Joget 的 guiders.js（`js/guiders/`）生成
- `#composerIcon`：DX 9.1 的 AI composer 按钮（运行时生成，未在 war 静态文件里找到固定行号）
- `#left-panel .components-list`、`.builder-palette-element`：`builder/builder.js` 生成左栏组件列表

**脆弱点**
- 1c 改了拖拽源的高度。如果从左栏拖组件到画布出问题，先把 1c 注释掉。
- Joget 改 class 名后规则会静默失效（不会报错）。

**排查**：DevTools 选中元素，看 Styles 里 `html.joget-skin …` 规则是否命中；没命中就是 Joget 改了选择器。
测试：`builder.css: declutter (hint bubbles / AI pill hidden)`（用测试元素验证规则本身）。
