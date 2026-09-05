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

- **工作流文件**：`.github/workflows/build-kylin-arm64-desktop.yml`
- **运行环境**：原生 `ubuntu-24.04-arm` runner。
- **构建机制**：
  - 接收参数 `dsh_ref`（如 `dsh-v0.1.3-alpha.1`），拉取官方 `deepseek-ai/deepseek-harness` 对应的 Release Tag；
  - 校验上游版本一致性，并在容器内编译 manylinux 2.28 兼容的 `node-pty` 原生二进制；
  - 打包生成 ARM64 可执行程序与完整 Electron 桌面端安装包（`.deb` 与 `.AppImage`），并生成 `SHA256SUMS` 与 `BUILD-INFO.json`。

---

## 运维与交付约束

1. **敏感环境变量清洗**：
   - Electron 桌面主进程在拉起底层 Runtime 时，会主动过滤清洗父进程的环境变量（包含 `*_API_KEY` 与 `*_SECRET`）。
   - 在终端 export `INTRANET_AGENT_API_KEY` 无效；内网模型凭据必须在应用界面 **Settings > Models** 中录入，凭据将保存在本地 Harness 凭据库中。
2. **产物归档与保留期**：
   - GitHub Actions 的构建 artifact 默认仅保留 14 天，且未配置自动 Release 发布。
   - 打包完成后应及时下载转存 `.deb`、AppImage 以及配套的 `SHA256SUMS` 和 `BUILD-INFO.json`。

---

## 打包步骤记录

1. **版本排查**：
   检查官方仓库 `deepseek-ai/deepseek-harness` 最新发布的 `dsh-v*` 标签版本（例如 `dsh-v0.1.3-alpha.1`）。
2. **触发构建**：
   通过 GitHub API 或 Actions 控制台触发 `Build Kylin ARM64 desktop` 工作流，传入选定的 `dsh_ref`。
3. **验收校验与归档**：
   从 Actions 产物中下载离线包，核对 SHA256 校验和并在麒麟 ARM64 测试机上进行安装测试，及时将产物归档至内网制品库。
