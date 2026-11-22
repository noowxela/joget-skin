# 7. 弹窗 popup

**做什么**：工具栏按钮弹窗（`popup.html`、`popup.js`）：
- 「启用」开关 `#toggle` → `jogetSkinEnabled`
- 「主题」下拉 `#theme`（默认 / Indigo）→ `jogetSkinTheme`
- 「保存提示音」勾选 `#chime` → `jogetSkinSaveChime`
- 「提示音」下拉 `#sound` + 「试听」按钮 `#preview` → `jogetSkinChimeSound`。选项来自 `JogetSkinChime.SOUNDS`（popup.html 引入 `chime-sound.js`），所以弹窗和内容脚本的音效列表不会不一致。
- 版本号 `#version` 读 `browser.runtime.getManifest().version`。
- 「检查更新」按钮 `#update-check`：用 `cache: "no-store"` 拉取 `https://noowxela.github.io/joget-skin/updates.json`，在 `addons["joget-skin@alexwoon"].updates` 里取最高版本，和当前 manifest 版本做 semver 比较。状态写在 `#update-status`（检查中… / 已是最新版 / 有新版本 vX.Y.Z / 检查失败：原因）。有新版本时给出「更新日志」链接（`changelog.html`，`target=_blank`）和「立即更新」按钮。
- 每天第一次打开弹窗会自动检查一次（时间戳 `jogetSkinUpdateCheckedAt` 存在 `storage.local`）；自动检查是安静的，只有发现新版本才改状态。手动点按钮总会显示结果。
- 「立即更新」若运行环境提供 `browser.runtime.requestUpdateCheck`（Chrome 有，**Firefox 到目前仍未实现**，见 Bug 1740508），就调用它：`update_available` 时提示将安装并在 `onUpdateAvailable` 后 `runtime.reload()`；`throttled` / `no_update` 会说明。Firefox 上改为提示到 `about:addons` 点「检查更新」，并可打开附加组件管理页（`tabs.create`，不需要额外权限）。
- 不新增 `host_permissions`：GitHub Pages 对 `updates.json` 返回 `Access-Control-Allow-Origin: *`，弹窗里的 `fetch` 可以直接用。也不新增 `management` 权限；若碰巧能调用 `management.getSelf()` 且 `installType` 是 `development`，或 `requestUpdateCheck` 在清单已有新版本时返回 `no_update`，会提示临时从 about:debugging 加载的扩展不能自动更新。
- 皮肤关闭时其他控件变灰（`syncDisabled()`）；检查更新不受皮肤开关影响。

**依赖 Joget**：无。

**排查**：右键弹窗 → 检查。试听结果写在 `<body data-preview="running soft">`。网络面板应看到对 `updates.json` 的请求（`cache: no-store`）。若一直「检查失败：网络错误」，看是否被离线或扩展页的网络策略拦住（不是缺 host 权限）。
测试：`popup: version, 3 sounds, toggles write storage`，以及 `popup: update check …`（用模拟的 `updates.json` 覆盖新版本 / 已是最新 / 请求失败）。
