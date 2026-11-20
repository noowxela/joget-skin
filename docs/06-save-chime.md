# 6. 保存提示音：savechime.js + chime-sound.js

**做什么**：在 Builder 里保存成功后播放一声柔和提示音；保存失败不响。

**文件**
- `chime-sound.js`（132 行）：定义 `globalThis.JogetSkinChime = { SOUNDS, DEFAULT, play, renderWav }`。三种音：`soft`（柔和叮咚，默认）、`marimba`（木琴）、`bubble`（泡泡）（65-94 行）。`play(ac, name)` 97 行，`renderWav(name)` 104 行（离线渲染成 WAV，给 HTMLAudio 备用）。
- `savechime.js`（297 行）：
  - 武装（arm）：在 `#save-btn` / `#save-btn-toolbar` 上 pointerdown，或按 Ctrl/⌘+S（162-187 行），在用户手势里创建/恢复 AudioContext，并起一个静音源保持音频设备热着（`keepWarm()` 68-84）。
  - 检测 1（最快）：jQuery `ajaxSuccess`，URL 等于 `CustomBuilder.saveUrl` 且响应 `{success:true}`（`hookAjax()` 192-246）。Firefox 里通过 `window.wrappedJSObject` + `exportFunction` 挂到页面的 jQuery。`ajaxError` 或 `success:false` 不响。
  - 检测 2（备用）：`#builder-message` 里出现 `.toast.toast-success`，且 60 秒内武装过（254-278 行）；`.toast-danger` 取消武装。保存按钮图标变成 `fa-spinner` 时也会武装。
  - 1.5 秒内去重（两个检测都命中只响一次）。WebAudio 不能运行时改用 WAV（`playFallback()` 114-125）。
  - 调试属性：`<html data-jskin-last-chime="时间 状态 warm/cold …">`。

**存储键**：`jogetSkinSaveChime`（默认 true）、`jogetSkinChimeSound`（默认 `soft`）。

**依赖 Joget 9.1.2**
| 依赖 | 出处 |
|---|---|
| URL `/web/console/app/<id>/<ver>/<type>/builder/<id>`（注意：Process Builder 是 `/process/builder#…`，没有尾部 `/`，**不匹配**，所以流程 Builder 里没有提示音） | `manifest.json` / `savechime.js:27` |
| `#save-btn` | `WEB-INF/jsp/cbuilder/base.jsp:110` |
| `CustomBuilder.saveUrl` | `builder/builder.js:8`（默认 ''），370、417 行赋值 |
| 全局 `jQuery`（`ajaxSuccess` / `ajaxError`） | `wro/jds.min.js`（base.jsp:351） |
| `#builder-message` 和 `CustomBuilder.showMessage()` 生成的 `.toast.toast-<type>` | `base.jsp:338`，`builder/builder.js:1886-1925` |

**脆弱点**
- `wrappedJSObject` 只在 Firefox 内容脚本里有；Chrome 测试环境只能测检测 2。
- Joget 改了保存 URL 的赋值方式或 toast class → 检测失效，不会报错。
- macOS 蓝牙耳机冷启动会有几百毫秒延迟（已用 keepWarm 缓解）。

**排查**：Console 开 Verbose，过滤 `[joget-skin] chime:`，按顺序应看到 `hooked save response` → `armed (…)` → `success via …` → `played (…)`。没有 `hooked` → 页面 jQuery 没找到；有 `armed` 没 `success` → 看 Network 里保存请求的 URL 是否等于 `CustomBuilder.saveUrl`。
测试：`save chime: plays on (mocked) save success toast, silent on failure — nothing saved`（模拟 AudioContext 和 toast，不点保存）。
