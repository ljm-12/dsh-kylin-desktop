# 银河麒麟 ARM64 桌面端离线打包说明

本项目采用独立载体架构（Overlay Carrier），专门为纯内网银河麒麟 Linux (ARM64) 环境进行桌面端与离线运行时封装。

- **仓库地址**：[ljm-12/dsh-kylin-desktop](https://github.com/ljm-12/dsh-kylin-desktop.git)
- **主要分支**：`master`

---

## 核心定制组件（仓库根目录即打包工程）

本仓库是独立打包仓库（Overlay Carrier），仓库根目录即打包工程，所有内网定制内容直接位于根目录之下，构建时叠加于官方上游 Runtime 之上：

1. **Electron 桌面外壳（`src/`）**：
   - TypeScript 主进程源码，负责 Runtime 进程生命周期、就绪检测、日志脱敏与窗口安全策略；编译产物位于 `lib/`（不入库）。
2. **内网策略配置补丁（`config/intranet.cordis.patch.yml`）**：
   - 禁用公网 DeepSeek 路由与遥测插件，启用 `intranet-openai` 兼容路由与本地模型接入策略。
3. **Debian 软件包生命周期钩子（`build/`）**：
   - `deb-preinstall.sh`、`deb-postinstall.sh`、`deb-postrm.sh`，用于平替兼容旧版 `dsh-intranet-agent` 并完成清理与配置升级；`icon.png` 为桌面应用图标。
4. **离线 CPython 3.10 Office 套件（`office/`）**：
   - `downloads/` 内置 ARM64 CPython 3.10 运行时压缩包及 `pypdf`、`python-docx`、`openpyxl`、`python-pptx` 等离线 wheels 依赖。
   - 提供 `dsh-office`、`dsh-python` 命令入口与 `office_tool.py` 自动化处理脚本。
5. **CDP 浏览器自动化工具（`office/dsh-browser`）**：
   - 内置轻量 CDP 浏览器控制脚本 `browser_tool.py`，支持离线或内网 Chromium 自动化操作。
6. **随包技能（`skills/`）**：
   - `browser-automation`（浏览器自动化）与 `offline-office-documents`（离线文档处理）两个技能包，由 Electron 启动时注入 Runtime。

---

## CI/CD 自动化构建流水线

构建会通过 `scripts/patch-upstream-proxy.mjs` 为官方 Runtime 的共享 HTTP 代理策略补充 IPv4 CIDR 匹配。载体原有的 `192.168.0.0/16`、`10.0.0.0/8`、`172.16.0.0/12` 直连配置由此生效，覆盖模型发现和对话请求；域名和公网仍遵循现有代理配置。代理列表的大小写环境变量合并后同步传入 Runtime。补丁遇到不兼容的上游结构会停止构建，避免产出未包含修复的安装包。

若其他工具能调用模型，而本应用提示 `fetch failed`，应核对目标机代理环境。该修复解决已复现的 CIDR 不生效问题；连接是否恢复仍需在麒麟实机验证，不能仅凭本地测试判定。

- **工作流文件**：`.github/workflows/build-kylin-arm64-desktop.yml`
- **运行环境**：原生 `ubuntu-24.04-arm` runner。
- **构建机制**：
  - 接收参数 `dsh_ref`（如 `dsh-v0.1.5-rc.2`），拉取官方 `deepseek-ai/deepseek-harness` 对应的 Release Tag；
  - 在官方仓库中执行 `corepack pnpm install --frozen-lockfile` 安装官方依赖；
  - 定位 `packages/subprocess/subprocess-local/node_modules/node-pty`；
  - 启动预置的 `manylinux_2_28_aarch64` 容器在 ARM64 环境下编译 `pty.node` 原生 C++ 扩展（校验 GLIBC ≤ 2.28）；
  - 执行 `build-exe-for-python-sdk.ts` 构建独立的 ARM64 可执行运行时 (`deepseek-harness-sdk-runtime-linux-arm64`) 与 `ripgrep`；
  - 将 ARM64 运行时与内置的离线 Office/浏览器工具链 (`office/downloads` 中的 CPython 3.10 与预下载 wheels) 组装至 `staging/`；
  - 运行 `smoke-runtime` 进行本地回环与 combo bundle HTTP 验证；
  - 使用 `electron-builder` 打包生成标准 `.deb` 安装包，并调用 `verify-linux-artifacts.sh` 进行静态架构、GLIBC 门禁与目录结构校验；
  - 生成 `SHA256SUMS` 和 `BUILD-INFO.json`，并将全部制品上传到 GitHub Actions Artifacts。

---

## 3. 运维与交付约束

1. **敏感环境变量清洗与放行**：
   - Electron 桌面主进程在拉起底层 Runtime 时，会过滤未授权的敏感环境变量（如 `*_SECRET` 或无关 `*_API_KEY`），但显式放行 `INTRANET_OPENAI_API_KEY` 与 `INTRANET_AGENT_API_KEY`。
   - 内网模型凭据推荐在应用界面 **Settings > Models** 中录入（保存在本地 Harness 凭据库 `~/.credentials.yaml`），也可直接通过环境变量 `INTRANET_OPENAI_API_KEY` / `INTRANET_AGENT_API_KEY` 提供。
2. **产物归档与保留期**：
   - GitHub Actions 的构建 artifact 默认仅保留 14 天，且未配置自动 Release 发布。
   - 打包完成后应及时下载转存 `.deb` 以及配套的 `SHA256SUMS` 和 `BUILD-INFO.json`。

---

## 4. 打包步骤记录

1. **版本排查**：
   检查官方仓库 `deepseek-ai/deepseek-harness` 最新发布的 `dsh-v*` 标签版本（例如 `dsh-v0.1.5-rc.2`）。
2. **触发构建**：
   通过 GitHub API 或 Actions 控制台触发 `Build Kylin ARM64 desktop` 工作流，传入选定的 `dsh_ref`。
3. **验收校验与归档**：
   从 Actions 产物中下载离线包，核对 SHA256 校验和并在麒麟 ARM64 测试机上进行安装测试，及时将产物归档至内网制品库。
