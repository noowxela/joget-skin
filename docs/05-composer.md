# 5. composer.js：App Composer 整理

页面：`/jw/web/console/app/{appId}/{version}/builders`。脚本 `composer.js`（629 行），样式 `builder.css` 56-202 行。

## 功能
1. **「显示其他 Builder」按钮**（`ensureButton()` 110-157）：放在工具栏 Advanced Tools 右边。默认只显示 Form / List / UI / Process 四种 Builder（`<html>` 加 `jskin-composer-hide-others`，CSS 62-66 行），点一下显示全部。
2. **Form 按表名分组**（`group()` 214-259）：把 Form Builder 列表的 `<li.item>` 按 `.item-sublabel`（表名）分组，插入 `li.jskin-group-header`。只移动原节点，不复制，Joget 的点击和悬停事件保持有效。没有表名的放在最后（「（无表名）」）。
3. **收起/展开分组**（`makeHeader()` 169-208，`applyCollapse()` 296-320，`ensureTitleButtons()` 341-371）：点组标题收起一组；Form Builder 标题上的两个按钮全部收起/展开。搜索、标签筛选、usages 模式下全部展开（`filtering()` 287-294），但不改已保存的状态。
4. **只允许一份副本管理页面**（`otherCopyRunning()` 401-416，`standDown()` 418-448，`showConflictNotice()` 450-473）：如果装了两份扩展（例如旧版本），后来的那份让位并在左下角显示黄色提示，避免两份互相改 class 造成闪烁。另有防死循环：3 秒内 class 变化超过 30 次就让位（run() 内）。
5. **单页跳转清理**（`leaveComposer()` 528-539，popstate + URL 轮询 599-607）：Joget 用 pushState 从 App Composer 进入 Builder 时页面不重载，所以每 500ms 检查一次 `location.pathname`，离开 `/builders` 就移除按钮、标题按钮和 `<html>` 上的 class，回来再加。

## 存储键
- `jogetSkinComposerShowOthers`：是否显示其他 Builder（默认 false）
- `jogetSkinComposerCollapsed:<appId>`：`{ tables: [...] }` 收起的表名（只在用户点击时写入，启动时读一次）
- 旧格式 `jogetSkinComposerCollapsed`（v1.3.3：`{ appId: [table] }`）仍可读取

## 依赖 Joget 9.1.2
| 依赖 | 出处 |
|---|---|
| URL `/web/console/app/<id>/<ver>/builders` | `WEB-INF/jsp/console/apps/builders.jsp` |
| `#builderToolbar`、`.advanced-tools-toogle`（Joget 原拼写） | `WEB-INF/jsp/cbuilder/base.jsp:115, 128` |
| `#builders > .builder-type.builder-form/.builder-datalist/.builder-userview/.builder-process`，`.ul-wrapper > ul > li.item > a.item-link > .item-sublabel` | `js/abuilder.core.js`（列表生成，`.item-sublabel` 在 501 行） |
| `AppBuilder.resizeBuilders`（窗口 resize 时重算行高，`relayout()` 75-81 触发 resize） | `js/abuilder.core.js:462, 472, 713, 716` |
| 搜索框 `#builder_canvas .search-container > input`、`.sub-search`、`body.show-usages-mode` | `js/abuilder.core.js:161-245` |

## 脆弱点
- Joget 改列表结构（`.ul-wrapper`、`.item-sublabel`）→ 分组消失但不报错。
- `MutationObserver` 盯整个 body；如果 Joget 不停重绘，会触发防死循环让位（Console 有 warn）。
- 让位提示出现但你只装了一份 → 看 `<html data-jskin-composer-owner>`，可能是页面没刷新、旧脚本还在。

## 排查
- 按钮不见：`document.querySelector("#builderToolbar .advanced-tools-toogle")` 是否存在；`<html>` 是否有 `jskin-composer`。
- 分组不见：`document.querySelector("#builders > .builder-type.builder-form .ul-wrapper > ul")`。
- 测试：`composer: …` 四个测试（按钮/隐藏、单页跳转、分组+重载后保持收起、让位）。
