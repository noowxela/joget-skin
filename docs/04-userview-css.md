# 4. userview.css

**做什么**：运行中的 app（userview）只做一件事：隐藏页脚 “Powered by Joget” 文字 `footer #footer-message`（`userview.css` 17-20 行）。22-27 行是以后放布局改动的占位说明。

**注入**：`/jw/web/userview/*`、`/jw/web/embed/userview/*`。

**依赖 Joget**：DX9 userview 主题输出的 `footer #footer-message`（主题插件，jar 内模板）。

**脆弱点**：换 userview 主题时 footer 结构可能不同。

**排查**：选中页脚文字看是不是 `#footer-message` 且在 `<footer>` 里。
测试：`userview.css: 'Powered by Joget' footer hidden on a runtime userview`（演示 app 的首页没有这个 footer 时用测试元素验证规则）。
