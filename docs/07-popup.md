# 7. 弹窗 popup

**做什么**：工具栏按钮弹窗（`popup.html` 105 行，`popup.js` 73 行）：
- 「启用」开关 `#toggle` → `jogetSkinEnabled`
- 「主题」下拉 `#theme`（默认 / Indigo）→ `jogetSkinTheme`
- 「保存提示音」勾选 `#chime` → `jogetSkinSaveChime`
- 「提示音」下拉 `#sound` + 「试听」按钮 `#preview` → `jogetSkinChimeSound`。选项来自 `JogetSkinChime.SOUNDS`（popup.html 引入 `chime-sound.js`），所以弹窗和内容脚本的音效列表不会不一致。
- 版本号 `#version` 读 `browser.runtime.getManifest().version`。
- 皮肤关闭时其他控件变灰（`syncDisabled()`）。

**依赖 Joget**：无。

**排查**：右键弹窗 → 检查。试听结果写在 `<body data-preview="running soft">`。
测试：`popup: version, 3 sounds, toggles write storage`。
