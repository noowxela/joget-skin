# Joget Skin 功能测试

用 Playwright（Chromium）打开真实的 Joget 页面，把扩展的 CSS/JS 按 `manifest.json` 的规则注入进去（`browser.storage` 用一个存在 sessionStorage 里的假实现代替；`browser.runtime.getURL` 指向 `/__jskin_ext/<文件>`，由 `ctx.route` 从扩展目录返回 `web_accessible_resources` 里的文件），然后逐个功能检查。每个功能一个测试，输出 `PASS` / `FAIL`，有失败时退出码为 1。

**默认只读**：只打开页面、点选元素、开关面板。process copy 测试会在设计器内存里导入流程、改假的密码字段；其中一项会点 Save，但只为确认客户端校验拦住请求并弹出详细原因，关页面就丢掉。保存提示音的测试用模拟的成功/失败提示，不真正保存。

**例外（userview copy）**：导入测试会在当前 app 里创建一个新 Userview，断言结束后立刻删除它。Save 测试会先把当前 app 复制成临时 app `jskinucopytmp`，在那里导入并刷新确认已落库，最后删除这个临时 app，并核对本地 app 列表没有变化。如果测试中途失败，也会在 `finally` 里尝试删除。

## 运行
```bash
cd joget-skin
node tests/run.mjs                    # 全部（约 2.5 分钟）
node tests/run.mjs canvas             # 只跑名字里含 canvas 的
node tests/run.mjs hotkeys 全部        # 多个关键词
SHOTS=../joget-skin-shots node tests/run.mjs   # 顺便截图（失败时也会截 FAIL-*.png）
```

环境变量
| 变量 | 默认 | 说明 |
|---|---|---|
| `JOGET_URL` | `http://localhost:8080/jw` | Joget 地址 |
| `JOGET_USER` / `JOGET_PASS` | `admin` / `admin` | 本机演示实例的账号；别的实例请用环境变量传入 |
| `JOGET_APP` / `JOGET_APP_VERSION` | `crm` / `1` | 用哪个演示 app |
| `SHOTS` | （不截图） | 截图目录 |
| `PLAYWRIGHT` | 先试 `import("playwright")`，再试 ai-agent-command-center 里的 | playwright 的 `index.mjs` 路径 |

需要：Node 18+、Playwright 带 Chromium、Joget 在跑并有 crm 演示 app（有 `crm_account` 表单）。

不需要 Joget 的单元测试：`node tests/updates-json.test.mjs`（自动更新清单生成器，见 docs/15）、`node tests/pages.test.mjs`（GitHub Pages / 更新日志页面生成器）。

## 测试和功能对照
| 测试 | 功能文档 |
|---|---|
| content: skin on/off + theme class follow storage | docs/01 |
| builder.css: declutter | docs/02 |
| indigo theme | docs/03 |
| userview.css | docs/04 |
| composer: …（4 个） | docs/05 |
| save chime | docs/06 |
| popup | docs/07 |
| left-panel handle、left-panel hotkey | docs/08、docs/11 |
| quick nav | docs/09 |
| canvas centred（form / datalist / userview / process）、element select box | docs/10 |
| hotkeys: …（3 个） | docs/11 |
| property editor: 全部收起/全部展开（form / datalist） | docs/12 |
| property editor: label left / input right、list builder rows | docs/13 |
| process copy: …（4 个：导出、同 app 导入并对比 Clone、警告框 / 取消 / 错误文件、空流程导致 Design is invalid 的详细原因） | docs/14 |
| userview copy: …（4 个：导出按钮只在 UI Builder、同 app 导入为新 Userview、警告框 / 取消 / 错误文件、临时 app 里 Save 后删除） | docs/16 |
| canvas controls: 默认隐藏、工具栏开关 + localStorage、面板 ×、皮肤关掉后恢复 | docs/17 |
| `node tests/updates-json.test.mjs`（无需 Joget） | docs/15 |
| `node tests/pages.test.mjs`（无需 Joget） | CHANGELOG.md、docs/15 |
| skin off: everything from v1.3.7 goes away | 全部 |

## 不在测试范围
- Firefox 专有的部分：`window.wrappedJSObject` 挂 jQuery `ajaxSuccess`（保存提示音的检测 1）、真实的 `browser.storage` 和 popup 与内容脚本之间的实时同步。这些要在 Firefox 里手动确认。
- 真实的拖放（从左栏拖组件）。会改表单，所以不自动测。
- 真实保存（除 userview copy 的 Save 测试：它在临时复制的 app 里进行，结束后删除该 app）。

## Joget 升级后
1. 跑全部测试。
2. FAIL 的那条会写出原因（例如 `not centred: open L10/R-30`）。打开对应 docs 文档的「依赖」表，到新版 war 里 grep 那些 id / class / 函数名，看哪里变了。
