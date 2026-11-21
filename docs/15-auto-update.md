# 15. Firefox 自托管自动更新

**做什么**：扩展不发布到 AMO 的公开目录，而是以 unlisted 方式让 Mozilla 签名，再自己托管更新清单。装过带 `update_url` 的版本之后，Firefox 大约每 24 小时会查一次清单，发现更高版本就自动下载签好名的 xpi 并替换。也可以在 `about:addons` 的齿轮菜单里点「检查更新」（Check for Updates）马上触发。

这是个人用的 Joget 扩展，源码和签好名的 xpi 会公开放在 GitHub（`noowxela/joget-skin`）。任何人都能下载并解包看到源码，里面没有密钥：AMO 签名用的凭证只放在本机 gitignored 的 `.env` 里。

## 地址怎么安排

| 用途 | URL |
|---|---|
| Firefox 去查的更新清单（`update_url`） | `https://noowxela.github.io/joget-skin/updates.json` |
| 某个版本的签名 xpi（`update_link`） | `https://github.com/noowxela/joget-skin/releases/download/v<ver>/joget-skin-<ver>.xpi` |

`updates.json` 放在 `gh-pages` 分支的根目录，只放这一份清单和一页很短的 `index.html`，不会把 `docs/` 或源码发布到 Pages。选 Pages 而不是 `raw.githubusercontent.com` 或 Release 资产来托管清单，是因为这个 URL 稳定、只含更新文件、GitHub Pages 会用 HTTPS 并给出合适的 `Content-Type`。

xpi 放在 GitHub Release 资产里，而不是 Pages 上，免得二进制包和更新清单混在一起。GitHub 的 `/releases/download/...` 会 302 到 `release-assets.githubusercontent.com`（或同类的 `*.githubusercontent.com`）上的 HTTPS 地址。Extension Workshop 的[更新文档](https://extensionworkshop.com/documentation/manage/updating-your-extension/)要求清单本身必须是 HTTPS，并且 `update_link` 必须是 HTTPS（否则就要带 `update_hash`）。文档没有单独写「跟不跟跳转」，但 Firefox 的更新下载会跟随 HTTPS→HTTPS 的跳转；Mozilla 工作人员也说过可以用 GitHub Releases 当 `update_link`。每一条更新都会带 `update_hash`（`sha256:`），文件在跳转之后仍会按哈希校验。

`manifest.json` 里的 `browser_specific_settings.gecko.update_url` 指向上面的 Pages 地址。Firefox 之后一直用**已经装上的那个版本**里的 `update_url` 去检查更新，所以第一个带这个字段的版本必须手动装一次；更早的版本（例如 1.3.10、1.4.0）自己发现不了这份清单。

## 用法

第一次（仓库还没有 GitHub remote、Pages 也还没开的时候），按文末「需要你点头的一次性步骤」做完，再在干净的工作区运行：

```bash
./release.sh 1.4.1
```

以后发新版：

```bash
./release.sh            # 若 v当前版本 已有 tag，就升 patch，例如 1.4.1 → 1.4.2
./release.sh 1.5.0      # 也可以指定版本
./release.sh --dry-run  # 只做本地步骤，不访问 AMO / GitHub / git push
```

脚本会：确认工作区干净（忽略未跟踪的 `.amo-upload-uuid` 和 `AGENTS.md`）→ 必要时改 `manifest.json` / `package.json` 的版本并提交 → 打 `v<ver>` 标签 → 跑 `sign.sh` 向 AMO 申请 unlisted 签名 → 把签好的 xpi 复制为 `joget-skin-<ver>.xpi` → `gh release create` → 用 `scripts/gen-updates-json.mjs` 把这一版（含 sha256）合并进已有的 `updates.json`（保留历史版本）→ 推到 `gh-pages` → push 提交和标签。

装扩展：

1. 从 [GitHub Releases](https://github.com/noowxela/joget-skin/releases) 下载签好名的 `joget-skin-<ver>.xpi`。
2. Firefox → `about:addons` → 齿轮 → 「从文件安装附加组件」（Install Add-on From File）→ 选这个 xpi。
3. 以后更新：等 Firefox 自己检查，或在同一页点「检查更新」。

临时用 `about:debugging` 从文件夹加载的扩展**不会**走这套自动更新。改完代码要看效果，仍然在 `about:debugging#/runtime/this-firefox` 里点 Reload；要长期安装并自动更新，必须装签名 xpi。

排查自动更新：在 `about:config` 确认 `extensions.update.enabled` 为 `true`。需要的话可以把 `extensions.update.interval` 从 86400 改到 120（秒）以便测试，测完改回去。然后打开「浏览器控制台」（Browser Console），过滤扩展名或 `updates.json`，看有没有报错。

## 文件

| 文件 | 作用 |
|---|---|
| `manifest.json` → `browser_specific_settings.gecko.update_url` | 已安装副本去查的清单地址 |
| `scripts/gen-updates-json.mjs` | 无依赖，按 xpi 算 sha256，合并进 `updates.json` |
| `tests/updates-json.test.mjs` | 生成器的单元测试（不需要 Joget） |
| `release.sh` | 一键发版；`--dry-run` 跳过所有网络步骤 |
| `sign.sh` | 用本机 `.env` 里的 AMO 凭证做 unlisted 签名；产物在 `web-ext-artifacts/`。脚本本身不会打印凭证 |

## 依赖

- Firefox 142+（与 `strict_min_version` 一致）。发行版 Firefox 只接受 Mozilla 签过名的 xpi，所以发版一定要跑 `sign.sh`（`web-ext sign --channel=unlisted`）。
- `sign.sh` 需要仓库根目录有 `.env`，里面是 [AMO API key](https://addons.mozilla.org/developers/addon/api/key/) 的 `AMO_JWT_ISSUER` / `AMO_JWT_SECRET`。先复制 `.env.example` 再填写。不要提交 `.env`。`release.sh` 只检查文件在不在，自己不读它。
- 本机已登录 `gh`，对 `noowxela/joget-skin` 有写权限；git remote `origin` 指向这个仓库。
- 生成器测：`node tests/updates-json.test.mjs`。
- `npm run -s lint` 必须带 `--self-hosted`。没有这个标志时，linter 会把 `update_url` 当成 AMO 上架扩展不允许的字段而报错。unlisted / 自托管扩展需要这个字段。

## 容易坏的地方

- 只把源码文件夹临时加载进 Firefox，不会自动更新。必须永久安装签名 xpi。
- 1.4.1 之前的已安装版本没有 `update_url`，不会自己升上来，要手动装一次 1.4.1 或更新的签名 xpi。
- 如果 `https://noowxela.github.io/joget-skin/updates.json` 搬走或失效，已装的副本找不到新地址。换 URL 的话，新版本改 `update_url` 之后，旧副本仍会去查旧地址，所以旧地址至少要继续提供一份指向新清单的更新，或者用企业策略覆盖 `update_url`。
- `gh release upload` 在 macOS 上有时会把 `.xpi` 的 `Content-Type` 设成 `application/octet-stream`。自动更新靠签名和 `update_hash`，一般仍可用；若希望在浏览器里点链接就能安装，需要资产类型是 `application/x-xpinstall`。
- 工作区不干净时 `release.sh` 会拒绝运行，以免把别人的改动一并发出去。不要把 `.env`、`.amo-upload-uuid`、`AGENTS.md` 加进提交。

## 排查

1. 打开 `https://noowxela.github.io/joget-skin/updates.json`，确认 HTTPS、JSON 合法，且 addon id 是 `joget-skin@alexwoon`。
2. 清单里最新那条的 `version`、`update_link`、`update_hash` 是否和 Release 上的 xpi 一致：`shasum -a 256 joget-skin-<ver>.xpi`，前面加上 `sha256:`。
3. 已装版本 ≥ 1.4.1，并且是从签名 xpi 永久安装的（`about:support` 的扩展表里能看到）。
4. Browser Console 里有没有哈希不符、下载失败或清单解析错误。刚换过 xpi 时，Firefox 可能用到缓存的旧文件，文档建议这时看看下载是否在 0ms 内结束。

## 需要你点头的一次性步骤

这些会创建公开仓库、上传签名包并让 Firefox 能访问更新地址，脚本不会擅自执行：

1. 创建公开仓库并加上 remote（在 `joget-skin` 目录）：
   `gh repo create noowxela/joget-skin --public --source=. --remote=origin`
2. 把已有提交推上去（包含 1.4.1 这条）：`git push -u origin main`
3. 开 GitHub Pages：仓库 Settings → Pages → Deploy from branch → `gh-pages`、目录 `/`（root）。若 `gh-pages` 还不存在，第一次成功跑完 `./release.sh 1.4.1` 时会建这个分支；脚本也会尝试用 API 打开 Pages，失败的话就按这里手动开。
4. 确认本机 `.env` 已填好 AMO 凭证，工作区干净，然后跑 `./release.sh 1.4.1`。它会把这一版提交到 AMO 做 unlisted 签名、创建 `v1.4.1` Release、发布 `updates.json`。
5. 在 Firefox 里用「从文件安装附加组件」装上 `joget-skin-1.4.1.xpi`（不要只用 about:debugging 临时加载）。之后的版本就可以自动更新。
