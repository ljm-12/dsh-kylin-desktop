# 银河麒麟 ARM64 桌面端离线打包说明

本项目采用独立载体架构（Overlay Carrier），专门为纯内网银河麒麟 Linux (ARM64) 环境进行桌面端与离线运行时封装。

- **仓库地址**：[ljm-12/dsh-kylin-desktop](https://github.com/ljm-12/dsh-kylin-desktop.git)
- **主要分支**：`main`

---

## 核心定制组件 (`packaging/kylin-desktop/`)

所有内网定制内容集中在 `packaging/kylin-desktop/` 目录下，解耦并叠加于官方上游版本之上：

1. **离线 CPython 3.10 Office 套件**：
   - 包含独立解压的 ARM64 CPython 3.10 运行时及 `pypdf`, `python-docx`, `openpyxl`, `python-pptx` 等离线 wheels 依赖。
   - 提供 `dsh-office` 与 `dsh-python` 命令入口与 `offline_tool.py` 自动化处理脚本。
2. **CDP 浏览器自动化工具 (`dsh-browser`)**：
   - 内置轻量 CDP 浏览器控制脚本 `browser_tool.py`，支持离线或内网 Chromium 自动化操作。
   - 随附 `browser-automation` 与 `offline-office-documents` skills 说明。
3. **内网策略配置补丁 (`intranet.cordis.patch.yml`)**：
   - 禁用公网 DeepSeek 路由与遥测插件，启用 `intranet-openai` 兼容路由与本地模型接入策略。
4. **Debian 软件包生命周期钩子**：
   - `deb-preinstall.sh`、`deb-postinstall.sh`、`deb-postrm.sh`，用于平替兼容旧版 `dsh-intranet-agent` 并完成清理与配置升级。

---

## CI/CD 自动化构建流水线

- **工作流文件**：`.github/workflows/build-kylin-arm64-desktop.yml`
- **运行环境**：原生 `ubuntu-24.04-arm` runner。
- **构建机制**：
  - 接收参数 `dsh_ref`（如 `dsh-v0.1.3-alpha.1`），拉取官方 `deepseek-ai/deepseek-harness` 对应的 Release Tag；
  - 校验上游版本一致性，并在容器内编译 manylinux 2.28 兼容的 `node-pty` 原生二进制；
  - 打包生成 ARM64 可执行程序与完整 Electron 桌面端安装包（`.deb` 与 `.AppImage`），并生成 `SHA256SUMS` 与 `BUILD-INFO.json`。

---

## 打包步骤记录

1. **版本排查**：
   检查官方仓库 `deepseek-ai/deepseek-harness` 最新发布的 `dsh-v*` 标签版本（例如 `dsh-v0.1.3-alpha.1`）。
2. **触发构建**：
   通过 GitHub API 或 Actions 控制台触发 `Build Kylin ARM64 desktop` 工作流，传入选定的 `dsh_ref`。
3. **验收校验**：
   从 Actions 产物中下载离线包，核对 SHA256 校验和并在麒麟 ARM64 测试机上进行安装测试。