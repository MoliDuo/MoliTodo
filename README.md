# Moli Todo 待办

<img src="web/public/icon.svg" width="64" alt="Moli Todo" />

一个在网页上用的待办清单，多台设备之间自动同步。

[![ci](https://github.com/MoliDuo/MoliTodo/actions/workflows/ci.yml/badge.svg)](https://github.com/MoliDuo/MoliTodo/actions/workflows/ci.yml)
![license](https://img.shields.io/badge/license-All%20rights%20reserved-lightgrey)

> 现在只有网页版，没有桌面客户端。旧的 Electron 版（哞哞清单）和一度做过的 Tauri 桌面版都已停止维护，安装包已下架。

## 功能

- 今天：每天一页清单，`#标签`、缩进、整行高亮、手填用时，页底是当天总用时；昨天没做完的可以挑着挪到今天。
- 索引：搜索，标签统计，标签详情按天看用时，标签改名、改颜色。
- 本子：每年一本，写过的每天一页，名画封面（也可以上传），拖页角翻页；手机单页，电脑两页对开。
- 计时：正计时，统计累计、日均、分布饼图、月度和年度曲线。
- 主题色：选或输入色号；浅色、深色、跟随系统。
- 同步：多台设备之间保持一致，冲突时以服务器为准。

## 访问

<https://todo.xiangyu.pro>，用统一登录进入，不需要安装。

## 登录方式

统一登录（Authelia），浏览器登录；应用里没有自己的账号和密码。

## 部署

部署在 Moli 服务器的 Docker 里，见 [docs/deploy.md](docs/deploy.md)。

## 开发

```bash
npm ci
cp .env.example .env.local   # 填上登录客户端的信息；.env.local 不提交
npm run dev:server           # 服务端，端口 3000
npm run dev:web              # 网页，端口 5173，接口转发到服务端
npm run check                # 和 CI 一样的检查：格式、lint、类型、测试（含覆盖率下限）、构建
```

目录：`server/`（Fastify 接口和登录）、`web/`（Vite + React 网页）、`shared/`（服务端和网页共用的接口结构；同步等只有网页用的逻辑在 `web/src/lib/`）、`docs/`（文档；`docs/design/original` 是旧版的设计稿，仅供视觉参考）。

## 许可

保留所有权利，见 [LICENSE](LICENSE)。
