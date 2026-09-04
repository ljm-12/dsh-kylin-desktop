# 麒麟 ARM64 桌面打包

[English](README.md) | 中文

本项目把指定的 DeepSeek Harness 官方标签封装为麒麟 ARM64 桌面应用，不引入社区桌面 fork。轻量 Electron 进程以 `web` profile 启动官方单文件 Runtime，并在受限窗口中加载经过认证的回环地址。

## 构建输入

GitHub 工作流只接受一个明确的 `dsh-v*` 标签。工作流校验该标签与官方仓库版本一致，并把解析后的提交写入 `BUILD-INFO.json`。

构建在 `ubuntu-24.04-arm` 上运行。它遵循官方 Runtime 工作流，包括 manylinux 2.28 `node-pty` 重建，并把生成的 ARM64 可执行程序及其必需的 `-rg` 伴随程序一起封装。

Electron `43.4.0`、electron-builder `26.15.7`、TypeScript 和测试由本目录独立的 `pnpm-lock.yaml` 固定。目标应用不包含 `electron-updater`。

## 运行构建

打开 `Build Kylin ARM64 desktop` 工作流并输入要封装的官方标签。工作流输出一个 artifact，其中包含 `.deb`、AppImage、`SHA256SUMS` 和 `BUILD-INFO.json` 文件。

不使用远端工作流时，把本仓库和官方标签的干净 checkout 复制到 Linux ARM64 构建机，然后执行：

```sh
bash scripts/build-on-arm64.sh /path/to/official/deepseek-harness dsh-v0.1.2-rc.1
```

脚本在运行构建代码前会拒绝非 ARM64 主机、分支或移动引用、标签与版本不匹配以及包管理器版本不匹配。

原生 Runtime 与 Electron 打包操作由构建工作流负责。下面的本地命令验证载体，但不会把非 ARM64 主机的结果表述为 ARM64 安装包。

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run test
```

## Runtime 生命周期

Electron 进程使用以下参数启动内置 Runtime：

```text
--profile web --patch <intranet-policy> --no-open --port 0
```

端口 `0` 由操作系统分配。只有完整且经过认证的 `dsh web:` 就绪行给出 `127.0.0.1` HTTP 地址后，窗口才会打开；其他地址均被拒绝。

窗口禁用 Node 集成，启用上下文隔离和沙箱，禁止新窗口，并阻止跳转到 Runtime 来源之外。Runtime 输出写入用户数据日志前会移除一次性 URL Token。

关闭 Electron 时先发送 `SIGTERM` 并等待 Runtime 退出，只在有界关闭时间结束后使用 `SIGKILL`。Runtime 意外退出时会向用户报告。

## 内网策略

[`config/intranet.cordis.patch.yml`](config/intranet.cordis.patch.yml) 禁用 DeepSeek 公网路由、模型可见 Web 工具、DeepSeek 搜索、反馈界面与命令以及遥测。它提供可编辑的 `intranet-openai` OpenAI 兼容路由，初始地址为 `http://127.0.0.1:8000/v1`。

用户在 Settings > Models 中配置真实内网地址、模型列表和凭据。凭据保存在 Harness 凭据存储中，绝不进入安装包或构建元数据。

## 验证边界

本地测试覆盖跨输出块的就绪行解析、Token 脱敏、环境变量清理、启动前退出、启动后意外退出、子进程完整关闭、ARM64 ELF 识别和打包配置。

ARM64 工作流还检查源码身份、Runtime 构建、认证后的 Web 根页面、Debian 元数据、可执行文件架构与权限、内置策略、AppImage 架构和校验和。

工作流成功不代表图形程序已经在麒麟上验证。正式批准仍需在支持的麒麟 ARM64 镜像上完成安装、启动、模型配置、一次对话、一次工具调用、重启和升级测试。

## 构建产物

验证后的文件采用以下名称：

```text
DeepSeek-Harness-Kylin-ARM64-<version>.deb
DeepSeek-Harness-Kylin-ARM64-<version>.AppImage
SHA256SUMS
BUILD-INFO.json
```

`.deb` 是麒麟主要交付物。AppImage 仅作补充，因为包括部分系统所需 FUSE 在内的运行条件会随目标镜像变化。
