# 发布桌面版

桌面安装包由 `release` 工作流发布（规范 006、007）。网页服务端不走这条路：合并到 `main` 就部署（见 [deploy.md](deploy.md)）。

## 一次性准备（管理员）

1. 在自己的机器上运行 `scripts/setup-updater-keys.sh`：生成更新签名密钥（会问两次密码），把公钥和更新地址写进 `desktop/src-tauri/tauri.conf.json`，并把私钥和密码写进本仓库的 Actions 密钥 `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
2. 立刻把私钥文件和密码存进密码库。GitHub 读不回密钥；丢了就再也发不出已安装的应用能接受的更新，只能让用户重新下载安装。
3. 提交改好的 `tauri.conf.json`（PR 走正常流程）。
4. macOS 代码签名用的是组织级密钥 `CODESIGN_P12_BASE64` 和 `CODESIGN_P12_PASSWORD`（规范 007 的 7.5.1），不用另外设置。

## 发版

1. 在 `main` 上把 `package.json` 的 `version` 改成新版本，提交 `chore(release): vX.Y.Z`，走 PR 合并，等 `ci` 通过。
2. 在 `main` 的最新提交上打标签并推送：

   ```bash
   git checkout main && git pull
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```

3. `release` 工作流会：检查标签和 `package.json` 一致、版本比已有标签新、标签就是 `main` 的最新提交且 `ci-gate` 已通过、签名密钥齐全；建草稿 Release（标题 `Moli Todo X.Y.Z`，说明从提交生成）；在 Windows 和 macOS 上构建并签名；检查每个文件的签名；生成 `latest.json` 和 `SHA256SUMS`；确认 `main` 没有新提交；公开发布；最后像已安装的应用那样读一遍线上的更新源，核对版本、地址和签名。线上核对不通过，会自动把 Release 改回草稿。
4. 发布前可以在草稿里润色说明，但不要删「校验」一节。

资产名：`MoliTodo_X.Y.Z_windows_x64.exe`、`MoliTodo_X.Y.Z_macos_arm64.dmg`、`MoliTodo_X.Y.Z_macos_arm64.app.tar.gz`（自动更新用）、`SHA256SUMS`、`latest.json`。

## 演练

在 Actions 里手动运行 `release`（Run workflow）是演练：用一次性的密钥做同样的构建、签名和检查，**不发布任何东西**，产物在这次运行的 `release-preview` 里保留一周。改了发布流程后先演练。

## 出问题怎么办

- **草稿没有发出去**（流水线中途失败）：看日志修好，删掉草稿，不要改标签；需要的话发下一个补丁版本。标签不删不移（规范 006 的 6.3.2）。
- **已发布的版本有严重问题**：先把 Release 改回草稿（更新源随之失效，已安装的应用不会再拿到它，正停在更新页等它的应用下次检查时解锁），修好后发新的补丁版本，并在有问题的版本的说明里加一行警告指向修复版本（规范 006 的 6.8）。回到上一个好版本的客户端仍能正常同步，服务器的数据不受影响。更新是强制的，在线的应用一小时内都会装上新版本，所以发布前一定先演练。
- **服务端要拒绝旧客户端**：在服务器 `.env` 里设 `MIN_CLIENT_VERSION`；低于它的桌面端收到 426 后锁住、只能更新，网页自动刷新（见 [architecture.md](architecture.md)）。
- **接口有不兼容的改动**：合并到 `main` 就部署服务器，但桌面端要等打标签发版。这段时间里旧桌面端连的是新服务器，所以尽快发版；发版后在线的桌面端最多一小时就被要求更新。网页的版本号也读 `package.json`，设 `MIN_CLIENT_VERSION` 前先确认网页已经部署到这个版本，否则网页也会被拒。

## 已知限制

- Windows 安装包没有代码签名，首次运行有系统提示（规范 007 的 7.5.4）。
- macOS 用组织共用的自签名证书，没有公证，首次打开需要手动放行。
- 更新签名里记录了版本，应用开着 `requireSignedVersion`：旧版本的签名不能冒充新版本。这个开关由 `scripts/setup-updater-keys.sh` 写进配置；改过密钥脚本之前生成的配置要手动补上。
- 只有一个稳定通道，没有 beta（规范 007 的 7.3.4）。
