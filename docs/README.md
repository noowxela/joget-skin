# Joget Skin v1.4.1 文档索引

Firefox MV3 扩展（gecko id `joget-skin@alexwoon`），给 Joget DX 9 的 Builder 和 userview 做整理、布局和可选主题。
每个功能一份文档，写清楚：做什么、文件和行号、存储键、依赖 Joget 的哪些东西（附 Joget 源码出处）、容易坏的地方、坏了怎么查。

## 兼容性
- 只在 **Joget DX Enterprise 9.1.2**（本机 Docker，`http://localhost:8080/jw`，构建 9.1.2.2 / ee559cd）上测过。
- 下文的 “Joget 源码” 都指 `apache-tomcat-11.0.26/webapps/jw.war`（9.1.2）里的文件，路径相对 war 根目录。
- Joget 升级后：先跑 `node tests/run.mjs`（见 `tests/README.md`），哪个测试 FAIL 就打开对应文档的「依赖」和「排查」两节。

## 文件和 manifest 注入关系
| 文件 | 注入到 | 时机 |
|---|---|---|
| `content.js` | `/jw/web/console/*`、`/jw/web/userview/*`、`/jw/web/embed/userview/*`（所有 frame） | document_start |
| `builder.css` + `themes/indigo/builder.css` | `/jw/web/console/*`（所有 frame） | document_start |
| `userview.css` + `themes/indigo/userview.css` | userview 页面 | document_start |
| `composer.js` | `/jw/web/console/app/*/builders*`（只顶层） | document_idle |
| `chime-sound.js` + `savechime.js` | `/jw/web/console/app/*/builder/*`（只顶层） | document_idle |
| `hotkeys.js` + `propcollapse.js` + `edgetoggles.js` + `pcopy-content.js` | `/jw/web/console/app/*/builder*`（含 `/builders` 和 `/process/builder`） | document_idle |
| `pcopy-page.js` | 由 `pcopy-content.js` 用 `<script src>` 注入 Process Builder 页面（`web_accessible_resources`） | 第一次显示按钮时 |
| `popup.html` / `popup.js` | 工具栏弹窗 | — |

所有 CSS 都写在 `html.joget-skin` 之下；`content.js` 拿掉这个 class 就等于整个皮肤关掉。

## 功能文档
1. [content.js：皮肤开关和主题 class](01-content-js.md)
2. [builder.css：去杂项（declutter）](02-builder-css-declutter.md)
3. [Indigo 主题](03-indigo-theme.md)
4. [userview.css](04-userview-css.md)
5. [composer.js：App Composer 整理](05-composer.md)
6. [保存提示音：savechime.js + chime-sound.js](06-save-chime.md)
7. [弹窗 popup](07-popup.md)
8. [左栏开关（面板外侧把手 + 快捷键）](08-left-panel-toggle.md)
9. [Quick nav 收到右边 + 把手](09-quick-nav.md)
10. [画布居中](10-canvas-centering.md)
11. [快捷键按钮](11-hotkeys.md)
12. [属性面板 全部收起/全部展开](12-property-collapse.md)
13. [属性面板 标签左、输入框右](13-property-rows.md)
14. [单流程复制（导出 / 导入）](14-process-copy.md)
15. [Firefox 自托管自动更新](15-auto-update.md)

更新日志（用户可见变更，按版本排列）在仓库根目录的 [CHANGELOG.md](../CHANGELOG.md)，发布后显示在 [GitHub Pages](https://noowxela.github.io/joget-skin/)。

## 通用排查步骤
1. DevTools → Elements：`<html>` 上有没有 `joget-skin`。没有 → 看 [01](01-content-js.md)。
2. Console 过滤 `joget-skin` / `Joget Skin`：保存提示音会打 `console.debug("[joget-skin] chime: …")`，App Composer 让位时打 `console.warn("[Joget Skin] another copy …")`。
3. `about:debugging` → 本扩展 → 检查：看内容脚本是否报错。
4. 跑测试：`node tests/run.mjs <关键词>` 只跑相关测试。
