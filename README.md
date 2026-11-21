# Joget Skin

给 [Joget](https://www.joget.org/) DX 9 用的 Firefox 扩展（个人项目）：整理 Builder / userview 界面、可选 Indigo 主题、保存提示音，以及 Process Builder 的单流程导出/导入。

- Firefox 142+，gecko id `joget-skin@alexwoon`
- 不在 AMO 公开目录上架。签名包以 unlisted 方式分发，用 Firefox 自托管更新（见 [docs/15-auto-update.md](docs/15-auto-update.md)）

## 安装

1. 打开 [Releases](https://github.com/noowxela/joget-skin/releases)，下载签好名的 `joget-skin-<ver>.xpi`。
2. 在 Firefox 打开 `about:addons` → 齿轮菜单 → 「从文件安装附加组件」，选这个文件。
3. 以后 Firefox 会自己检查更新（大约每 24 小时）。也可以在同一页再点一次齿轮 → 「检查更新」。

第一个带自动更新的版本是 **1.4.1**。更早的安装不会自己升上来，需要按上面的步骤再装一次。

临时从源码文件夹加载（`about:debugging` → 「临时载入附加组件」）适合开发，**不会**自动更新，Firefox 重启后也要重新加载。

## 开发

```bash
npm run -s lint
node tests/updates-json.test.mjs          # 更新清单生成器，不需要 Joget
node tests/run.mjs <关键词>               # 针对本机 Joget 的功能测试，见 tests/README.md
./release.sh --dry-run                    # 演练发版，不访问 AMO / GitHub
```

功能说明在 [`docs/README.md`](docs/README.md)。发版流程在 [`docs/15-auto-update.md`](docs/15-auto-update.md)。签名用 `sign.sh`（需要本机 `.env` 里的 AMO API 凭证；不要提交这个文件）。
