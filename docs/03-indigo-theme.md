# 3. Indigo 主题

**做什么**：可选配色。`themes/indigo/builder.css`（454 行）给 Builder，`themes/indigo/userview.css`（327 行）给运行中的 app。只在 `html.joget-skin.joget-skin-theme-indigo` 下生效（弹窗「主题」选 Indigo）。

**文件结构**（`themes/indigo/builder.css`）：1 主题变量 29-67，2 基础 68-80，3 按钮 81-118，4 输入框 119-148，5 顶栏 149-185，6 左栏 186-232，7 画布边框 233-246，8 右侧属性面板 247-296，9 quick nav + 底栏 297-321，10 App Composer 322-349，11 Process Builder 外框 350-362，12 admin bar / 提示气泡 363-388，13 旧 web console 389 起。
`themes/indigo/userview.css`：先覆盖 DX9 主题变量（`--theme-*`、`--primaryColor1..5`、`--jgt-*`），再微调 header、菜单、面包屑、datalist 表格、表单、按钮。

**存储键**：`jogetSkinTheme`。

**依赖 Joget**
- Builder：`#top-panel`、`#builderIcon`、`#top-panel-main`、`#left-panel .drag-elements`、`#builder_canvas`、`#right-panel .element-properties`、`#quick-nav-bar`（`WEB-INF/jsp/cbuilder/base.jsp`）；`body.default-builder.form/.datalist/.userview/.process`（`builder/builder.js`）。
- Userview：DX9 Universal 主题的 CSS 变量（主题插件在 `WEB-INF/lib/jw-enterprise-plugins-9.1.2.jar`）。

**脆弱点**
- 只做颜色/边框/字体，不动画布、select box、`#lf-container` 的位置大小（拖拽安全）。
- 只适配浅色 Builder；Joget 暗色主题（`body[builder-theme="dark"]`）下请关闭主题。
- 会覆盖每个 app 自己的品牌色。

**排查**：`<html>` 要同时有 `joget-skin` 和 `joget-skin-theme-indigo`。颜色不对时在 DevTools 里看 `--js-*` 变量。
测试：`indigo theme: loads together with v1.3.7 layout, canvas still centred`。
