# 官方 DeepSeek Harness 桌面版的麒麟 ARM64 打包

[English](README.md) | 中文

固定构建官方 `dsh-v0.2.1-rc.2`，提交 `687f282e8625c6b8d11ff58211a90524be2e4317`。使用官方 `apps/desktop`、产品界面、Host、账号、连接、插件和请求转发实现，并加入下述 Linux 窗口适配。登录及断线恢复遵循该官方版本本身的行为。

本仓库只提供打包适配，不额外添加或替换官方插件；运行功能和插件集合以此标签为准。兼容目标为麒麟 V10 SP1 ARM64（UKUI、GLIBC 2.28），实际安装及内网模型对话仍需目标机器验收。

## 必要打包适配

官方标签只声明 macOS/Windows 桌面目标，因此保留 Linux ARM64 构建路径、Debian 安装入口、实际随包 node-pty 的 manylinux 2.28 重编译和完整性验证。Office 保留一处 ASAR 兼容处理：缺失文件的 `null` 和 `undefined` 均视为不存在，使官方 Linux WASM 后端能正确回退。ws 发送器增加一处空帧兼容处理：只写入完整帧头，省去零长度载荷的 iovec，传输字节保持一致。两处差异及哈希会写入 `BUILD-INFO.json` 和 `RUNTIME-PATCH.diff`。

源码检查允许九个官方构建脚本/CLI 文件变化、主进程及两个 preload 中逐字核验的 Linux 托盘和标题栏适配，以及逐字节核验的 Linux 进程清理模块；其余官方运行源码、产品页面和共享样式保持不变。最终安装包的 Connection/Gateway 客户端必须逐字节匹配官方编译结果。Linux 工作区复用官方 40 像素融合顶栏，将应用/编辑菜单和 Electron 的最小化、最大化、关闭按钮放在同一行，替代系统标题栏及独立原生菜单栏；拖动、主题颜色和全屏状态沿用官方实现，其他窗口保留系统外框。Linux 使用官方锁文件中的 Electron 44.7.0，已包含 UKUI 托盘注册的上游修复；移除旧版强制使用 44.5.1 的补丁及旧的运行时平台推导补丁。运行时准备和 electron-builder 均读取官方安装依赖的版本，官方锁文件保持不变。随包 pnpm 路径遵循新版 primary-runtime 布局。

## 代理公钥证书

将公共根 CA 和中间 CA 的 PEM 证书包保存为 Actions Secret `DMZ_PROXY_CA_CERT`。构建注入被 Git 忽略的 `config/proxy-root-ca.crt`（沿用原文件名，内容为完整 CA 包），逐张验证 CA、有效期，拒绝重复证书，并验证最终包内证书字节，完成后清理 runner 上的注入文件。证书和 `DMZ_cert/` 不提交 Git；不接收私钥。

桌面和官方 CLI 启动器默认设置 `NODE_EXTRA_CA_CERTS`，保留用户显式指定的值；不覆盖代理环境变量。麒麟启动兼容参数保留：有 `DISPLAY` 时选择 X11/XWayland，默认关闭 GPU 加速；`DSH_ENABLE_GPU=1` 恢复加速。默认保留沙箱，`DSH_KYLIN_NO_SANDBOX=1` 保留为实机确有需要时的显式开关。该配置用于 Node Host/CLI 的 TLS 信任，不替代 Chromium/系统信任库。模型 Base URL、模型 ID 和 API Key 继续在官方设置中配置。

```bash
NODE_EXTRA_CA_CERTS=/data/proxy-root-ca.crt deepseek-harness-kylin
```

## 构建和验证

在 [Build Kylin ARM64 official desktop](https://github.com/ljm-12/dsh-kylin-desktop/actions/workflows/build-kylin-arm64-desktop.yml) 选择 `master` 主分支，输入 `dsh-v0.2.1-rc.2`。原生 Linux ARM64 runner 构建，不发布 Release，不自动下载到本地。

成功 artifact 包含 `.deb`、`SHA256SUMS`、`BUILD-INFO.json`、`UPSTREAM-PATCH.diff` 和 `RUNTIME-PATCH.diff`，保留 30 天。元数据记录官方提交、打包提交、Debian 构建修订号及证书/补丁哈希。

构建检查包括真实 Electron Node TLS，以及内网证书链仅加载根 CA 失败、加载根 CA 和中间 CA 成功的回归验证、官方 Host/Office 完整性与冒烟、所有外置 ELF 的 ARM64 和 GLIBC ≤ 2.28、压缩 RPC/事件流，以及物料化目录和最终 ASAR 各 60 秒的官方页面/Host 原生 WebSocket、SSE 连续性。最终包还通过实际桌面启动器运行官方主进程，操作欢迎页的官方“跳过”进入工作区，再连续 60 秒检查工作区 WebSocket/SSE、页面不重载及最小化/恢复；Openbox 和 xdotool 检查工作区不含系统标题栏，执行顶栏拖动、融合窗口按钮最大化/还原/最小化/关闭及托盘恢复操作；独立 D-Bus StatusNotifier 测试宿主验证托盘注册、图标、点击恢复、“显示”和“退出”菜单以及正常退出。独立原生 Electron 夹具会在完整打包前验证适配窗口和官方顶栏样式；拖动测试在按下、移动和释放之间等待 Electron 与 X11 窗口管理器处理事件，并使用 1600×1000 虚拟屏幕为移动预留空间。这项检查使用独立 profile 和临时调试端口，生产启动不启用调试端口。临时测试使用隔离数据，不读取用户配置。云端测试环境为 Ubuntu ARM64；麒麟实机连接恢复情况见下方修复记录。

本地适配层检查：

```bash
DSH_PROXY_CA_CERT_FILE=/path/to/proxy-ca-bundle.crt node scripts/prepare-proxy-ca.mjs
DSH_TEST_SOURCE=/path/to/official/checkout node --test tests/*.test.mjs
bash -n scripts/*.sh build/*.sh
```

完整打包必须在原生 Linux ARM64 上执行，具备 Node 24、Corepack、Docker、编译器、musl-tools、Electron 运行库、OpenSSL、readelf、dpkg、Xvfb、Openbox、xdotool、xprop、D-Bus、python3-dbus 和 python3-gi。

```bash
DSH_PROXY_CA_CERT_FILE=/path/to/proxy-ca-bundle.crt bash scripts/build-on-arm64.sh /path/to/official/checkout dsh-v0.2.1-rc.2
```

## WebSocket 兼容修复

麒麟 V10 SP1 的首次空 Ping 触发 `EFAULT / write`，连接以 1006 关闭。ws 发送器补丁省去零长度载荷的 iovec，改为直接写入相同的完整帧头。官方心跳频率、传输字节、掩码、压缩和回调保持不变。旧版 0.2.0-rc.2 的实机日志曾记录约 250 秒稳定连接；该历史结果不代表新版已经完成实机验收。

回归测试注入 EFAULT 复现旧版故障，逐字节比较 40 种帧编码，并验证 30 轮空 Ping/Pong、数据和压缩传输及正常关闭。测试覆盖打包前运行库和最终 ASAR，测试夹具不进入应用安装包。

正式包使用官方 `lib/main.js` 入口，并加入精确的 Linux 托盘适配：任务栏及托盘使用 PNG 图标，关闭窗口收起到托盘，点击图标或菜单恢复，菜单“退出”先沿用官方 Host 和存储关闭流程，再结束仍然存活的应用子进程，包括已被跟踪到的脱离进程组的工作进程；核对进程启动时间以防止误杀复用的 PID。若托盘创建失败，关闭窗口改为请求退出，避免留下无法访问的隐藏进程。测试按 UKUI 规则拒绝错误的服务名/路径组合，通过唯一 D-Bus 名访问托盘，并检查退出后没有脱离进程组的后台进程。已移除临时连接诊断和诊断用预加载钩子，不再写入 `DeepSeek-Harness-connection-diagnostics.jsonl`。已有文件来自旧诊断版本。官方会话、附件及模型输出仍按官方逻辑保存。

## 安装后操作

1. 完全退出旧版应用，包括托盘中的后台进程。
2. 下载成功构建的 artifact，解压并运行 `sha256sum -c SHA256SUMS`。
3. 安装：`sudo apt install ./DeepSeek-Harness-Kylin-ARM64-0.2.1-rc.2.deb`。
4. 执行 `dpkg-query -W -f='${Version}\n' deepseek-harness-kylin`，确认修订号与该 artifact 的 `BUILD-INFO.json` 中 `debianRevision` 一致。应用版本号仍为 `0.2.1-rc.2`。
5. 从桌面菜单启动，观察左下角连接状态，再测试内网模型的一次对话及重启。

默认加载随包根 CA 和中间 CA，不需要额外证书文件、启动环境变量或手工改源码。安装不清空 `~/.dsh`、会话、模型或插件配置；旧配置中的手工策略也不会被自动撤销。若遇到其他问题，保留用户配置供排查。

应用名和安装标识仍为 DeepSeek Harness Kylin，命令为 `deepseek-harness-kylin`。保留旧 `dsh-intranet` 命令别名仅用于升级兼容，它执行相同的官方桌面程序。旧载体数据目录不自动迁移或删除。
