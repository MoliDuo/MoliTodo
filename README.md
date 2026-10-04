# Moli Todo 待办

<img src="web/public/icon.svg" width="64" alt="Moli Todo" />

一个能在网页和桌面浮窗（Windows、macOS）上用、并且多端同步的待办清单。

[![ci](https://github.com/MoliDuo/MoliTodo/actions/workflows/ci.yml/badge.svg)](https://github.com/MoliDuo/MoliTodo/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/MoliDuo/MoliTodo)](https://github.com/MoliDuo/MoliTodo/releases)
![license](https://img.shields.io/badge/license-All%20rights%20reserved-lightgrey)

> 重写进行中：目前完成了服务端、统一登录、任务同步和网页版；桌面端、安装包按 [docs/architecture.md](docs/architecture.md) 里的步骤陆续加入。旧的 Electron 版（哞哞清单）在 [v1.0.7](https://github.com/MoliDuo/MoliTodo/releases/tag/v1.0.7) 之前的发布里，不再维护。

## 功能

- 网页版：打开 <https://todo.xiangyu.pro> 使用：添加、勾选、修改、删除、拖动排序，已完成视图按天分组并可记耗时。
- 导入：设置里可以导入旧版哞哞清单的历史任务（只添加，重复导入会跳过）。
- 桌面版（规划中）：Windows 和 macOS 的桌面浮窗，离线可用，联网后同步。
- 同步：多台设备、网页和桌面之间保持一致，冲突时以服务器为准，被覆盖的内容可以找回。

## 安装或访问

网页：<https://todo.xiangyu.pro>。桌面安装包发布后在 [Releases](https://github.com/MoliDuo/MoliTodo/releases)。

## 登录方式

统一登录（Authelia）。网页走浏览器登录，桌面端用设备码登录；应用里没有自己的账号和密码。

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

目录：`server/`（Fastify 接口和登录）、`web/`（Vite + React 网页，也是桌面端的界面）、`shared/`（两边共用的结构和逻辑）、`docs/`（文档；`docs/design/original` 是旧版的设计稿，仅供视觉参考）。

## 许可

保留所有权利，见 [LICENSE](LICENSE)。
