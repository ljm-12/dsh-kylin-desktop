# Agent Note: 麒麟桌面 Runtime 载体

Status: implemented

[English](2026-09-04-kylin-desktop-runtime-carrier.md) | 中文

## 问题

麒麟 ARM64 安装包需要跟随 Harness 官方版本，而不等待或重新标记社区桌面二进制。如果在 Electron 内构建 Harness 依赖树，原生扩展、客户端传输和应用生命周期会与 Electron 的 Node ABI 耦合，同时形成第二套应用组合。

## 决策

[`packaging/kylin-desktop`](../../../../packaging/kylin-desktop) 是 npm 发布家族之外的私有分发项目。其工作流从 `deepseek-ai/deepseek-harness` 检出明确的 `dsh-v*` 标签，并在 `ubuntu-24.04-arm` 上通过仓库自有 Runtime 流程构建官方 Linux ARM64 单文件 Runtime。

本载体扩展[单文件 Runtime 分发](2026-07-10-single-file-executable-sdk-runtime-distribution.zh.md)、[唯一 dsh 启动器](2026-08-22-single-dsh-application-launcher.zh.md)和[就绪 Web UI](../feature/2026-08-12-open-ready-web-ui.zh.md)决策。上述记录继续负责 Runtime 构建、应用入口和认证就绪通知。

官方 Runtime 始终作为子进程运行。Electron 使用内网 patch、禁用浏览器交接并指定端口 `0` 来启动其内置 `web` profile；`dsh web:` 就绪行提供由 `BrowserWindow` 加载的认证回环地址。载体不会把 Harness package 图导入 Electron，也不会定义另一个 Harness 应用启动器。

Runtime 可执行文件及其 `-rg` 伴随程序在 Electron resources 下保持相邻。构建元数据记录官方标签、提交、仓库版本和哈希。Debian 与 AppImage 的版本来自官方源码 manifest，而不是载体的私有 package 版本。

内网 patch 禁用 DeepSeek 公网路由、模型可见 Web 访问、反馈入口和遥测，同时保留 Settings > Models 以及本地 OpenAI 兼容初始路由。Electron 进程还设置遥测退出开关，移除名称表示凭据的继承环境变量，只接受带认证信息的 IPv4 回环就绪地址，并从日志移除进程 Token。

子进程从启动到关闭只有一个所有者。就绪状态使用 Runtime 通知而不是延时；Electron 关闭时发送 `SIGTERM`、等待退出，并且只在有界时间结束后升级到 `SIGKILL`。就绪前退出会拒绝启动，就绪后退出会报告为应用故障。

## 验证

载体测试使用逐测试临时目录和真实子进程。测试覆盖分块就绪输出、启动前退出诊断、就绪后意外退出、Token 脱敏、环境变量过滤、ARM64 ELF 校验和打包配置。原生工作流另外执行源码标签校验、官方 manylinux 2.28 `node-pty` 重建、真实认证 Web Runtime 冒烟、安装包检查、可执行文件架构与权限检查以及校验和生成。

目标镜像验证仍是独立证据。发布必须完成真实麒麟 ARM64 安装和图形冒烟，因为 Ubuntu ARM64 构建不能证明麒麟 GTK、NSS、ALSA、显示服务、Electron 沙箱或 AppImage Runtime 行为。

## 备选方案

**重新封装社区桌面 Release。** 不采用，因为其标签可能落后于官方 Runtime，使当前安装包依赖另一个仓库的发布时间和已编译应用图。

**继续移植社区版进程内 Electron Host。** 不采用，因为它会重复官方 `dsh` Runtime 与 Web profile 已经负责的应用组合、IPC 传输、依赖闭包和原生扩展兼容工作。

**通过 QEMU 在 Windows x64 或 Linux x64 上交叉构建 Runtime。** 不采用，因为官方构建要求 Linux 目标架构处理原生 `node-pty`；模拟产生的派生进程不能提供与仓库原生 ARM64 工作流相同的产物证据。

**只提供浏览器启动器。** 不采用，因为它依赖目标系统浏览器集成，且不能提供所需的自包含桌面窗口。Electron 通过加载官方本地 Web 应用保持精简，不再拥有另一套 UI。

## 后果

官方标签无需等待对应社区桌面 Release 即可生成麒麟候选包，Harness UI 与应用组合仍由官方 Runtime 负责。需要维护的桌面代码仅限进程生命周期、回环导航、构建元数据、内网默认值和 Linux 打包。

每个候选版本仍需要原生 ARM64 构建与麒麟验收。官方 Runtime 文件名、伴随程序、Web 启动参数、就绪行、profile patch ID 或认证交换发生变化时，工作流会失败，并要求明确更新载体而不是猜测兼容行为。
