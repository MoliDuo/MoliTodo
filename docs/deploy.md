# 部署

Moli Todo 部署在 Moli 服务器上的 Docker 里，地址 <https://todo.xiangyu.pro>。推送到 `main` 后 `ci` 通过，`deploy` 工作流自动构建镜像并部署。

## 1. 名字与用途

只写名字，不写值。

**GitHub（组织级密钥，本仓库只读取）**

| 名字                             | 用途                                                 |
| -------------------------------- | ---------------------------------------------------- |
| `DEPLOY_SSH_KEY`                 | 部署用的 SSH 私钥，服务器上只允许它执行 `deploy-app` |
| `DEPLOY_TAILSCALE_CLIENT_ID`     | 构建机临时加入内网用的 Tailscale OAuth 客户端        |
| `DEPLOY_TAILSCALE_CLIENT_SECRET` | 同上的密钥                                           |
| `DEPLOY_SERVER`                  | 服务器在内网里的地址                                 |
| `DEPLOY_SERVER_USER`             | 部署登录用的服务器账号                               |

**GitHub（发版用，只在 `release` 工作流里读取，见 [release.md](./release.md)）**

| 名字                                 | 用途                                                       |
| ------------------------------------ | ---------------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | 桌面版更新签名私钥，本仓库密钥                             |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 上面私钥的密码，本仓库密钥                                 |
| `CODESIGN_P12_BASE64`                | macOS 代码签名证书（组织共用，.p12 的 base64），组织级密钥 |
| `CODESIGN_P12_PASSWORD`              | 同上证书的密码，组织级密钥                                 |

**服务器上 `/data/apps/todo/.env`（权限 600，不进仓库）**，模板是 [deploy/env.example](../deploy/env.example)：

| 名字                    | 用途                                                        |
| ----------------------- | ----------------------------------------------------------- |
| `APP_URL`               | 网站的地址，用来生成登录回调地址                            |
| `OIDC_ISSUER`           | 统一登录的地址                                              |
| `OIDC_CLIENT_ID`        | 网页的登录客户端，`moli-todo`                               |
| `OIDC_CLIENT_SECRET`    | 网页客户端的密钥，登记客户端时只显示一次                    |
| `OIDC_NATIVE_CLIENT_ID` | 桌面客户端的 id，`moli-todo-app`；桌面令牌的 `aud` 必须是它 |

## 2. 首次部署

以下步骤由管理员在服务器上做；应用仓库不能替自己登记。

1. 建应用目录，放入 [deploy/](../deploy) 里的文件：

   ```bash
   mkdir -p /data/apps/todo/data && cd /data/apps/todo
   # 复制 docker-compose.yml、migrate.cmd，把 env.example 复制成 .env 并填值
   chmod 600 .env
   echo APP_TAG=init > .tag
   chown 1000:1000 data   # 容器里以 node 用户（1000）运行，要能写数据卷
   ```

2. 在 `/data/apps/deploy/apps` 里加一行 `todo`，登记这个应用。
3. 登记两个登录客户端（SOP：MoliSpec 的 `docs/sop/authelia-登记客户端.md`），都显式指定授权策略：
   - `moli-todo`：机密客户端，回调地址 `https://todo.xiangyu.pro/auth/callback`，策略 `one_factor`；把密钥写进 `.env` 的 `OIDC_CLIENT_SECRET`。
   - `moli-todo-app`：公开客户端，设备码，要刷新令牌，策略 `one_factor`。
4. 把 `deploy.yml` 加进仓库（见 MoliSpec 的 `standards/参考/deploy.yml`，应用标识 `todo`），合并到 `main` 触发第一次部署。

## 3. 日常部署

- **触发**：合并或推送到 `main`。`ci` 全部通过（`ci-gate`）后，`deploy` 自动运行；`ci` 失败就不会部署。
- **确认成功**：GitHub Actions 里 `deploy` 变绿。服务器的部署脚本最后会请求 `/healthz`，核对 `version` 等于刚部署的提交，不一致就回滚并让 `deploy` 失败。
- **看版本**：`curl -s https://todo.xiangyu.pro/healthz`，期望 `{"ok":true,"version":"<40 位提交哈希>"}`。

迁移只加不删：新增表和列，要删的东西先停用，下一个版本再迁移删除，这样回滚到上一个版本时旧代码仍能使用新结构。

## 4. 回滚

部署失败时脚本自动回到上一个版本。要手动回到更早的提交，用部署脚本的回滚入口：它直接启动服务器上已有的旧镜像（保留最近 5 个），不重新构建、不做迁移。先看有哪些版本：

```bash
docker images --format '{{.Tag}}' moli-todo
```

再执行（`<提交哈希>` 是上面列出的 40 位标签）：

```bash
printf '%s %s rollback\n' todo <提交哈希> | /data/apps/deploy/deploy-app
```

没有那个镜像时，对该提交重新运行 `ci`，或者用 `git revert` 撤销有问题的提交，走正常的 PR 和部署。数据库不做反向迁移；部署脚本迁移前会备份数据目录，只有迁移本身损坏了数据才用它恢复。

## 5. 上线后的验证

1. `https://todo.xiangyu.pro/healthz` 返回 200，`version` 是刚部署的提交。
2. 打开 <https://todo.xiangyu.pro>，自动跳到统一登录，登录后回到页面，显示"已登录：你的名字"。
3. 不登录直接请求 `https://todo.xiangyu.pro/api/v1/me`，返回 401 和 JSON。

## 6. 常见故障

| 现象                                         | 原因和处置                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `deploy` 报"没有登记"                        | 应用还没登记到允许列表（第 2 节第 2 步）                                                          |
| 容器反复重启，日志有 `Invalid configuration` | `.env` 缺变量或值不合法；日志里写了是哪个变量，不会打印值                                         |
| 登录最后一步失败                             | 回调地址与登记的不一致，或 `OIDC_CLIENT_SECRET` 与登记的不一致（换令牌要用 `client_secret_post`） |
| 登录后又回到登录                             | 会话 cookie 要求 HTTPS：检查网关是否正常终结 HTTPS                                                |
| 启动报 `SQLITE_CANTOPEN`                     | 数据目录权限不对，见第 2 节第 1 步的 `chown`                                                      |
