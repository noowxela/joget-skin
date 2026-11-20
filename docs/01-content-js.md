# 1. content.js：皮肤开关和主题 class

**做什么**：在 `<html>` 上加/去 `joget-skin`（皮肤开）和 `joget-skin-theme-indigo`（Indigo 主题，只在皮肤开时加）。弹窗改设置后通过 `browser.storage.onChanged` 立即生效，不用刷新。

**文件**：`content.js` 1-48（`apply()` 16-26，读取 28-32，监听 33-47）。

**存储键**：`jogetSkinEnabled`（默认 true）、`jogetSkinTheme`（`"default"` | `"indigo"`，默认 `"default"`）。

**依赖 Joget**：几乎没有。只依赖 URL 前缀 `/jw/web/console/`、`/jw/web/userview/`、`/jw/web/embed/userview/`（`manifest.json`）。Joget 换了 context path（不是 `/jw`）就要改 manifest 的 `matches`。

**脆弱点**
- `run_at: document_start` + `all_frames: true`：画布 iframe `/jw/builder/blank.jsp` 不在 matches 里，所以画布内容不受影响（刻意的）。
- class 是异步加（等 storage 读完），页面最开始几十毫秒可能是原样。

**排查**
- `<html>` 没有 `joget-skin`：看 `about:debugging` 里扩展是否启用、URL 是否匹配；Console 执行 `browser.storage.local.get()`（扩展的检查窗口）看 `jogetSkinEnabled`。
- 测试：`content: skin on/off + theme class follow storage`。
