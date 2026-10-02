# 官方 DeepSeek Harness 桌面版的麒麟 ARM64 打包适配

[English](README.md) | 中文

本仓库直接构建 `deepseek-ai/deepseek-harness` 的 `apps/desktop`，不再维护自制 Electron 窗口、Web Runtime 载体、模型凭据逻辑或 UI 补丁。官方已有的界面、文件选择、插件、模型设置、Office/PDF、浏览器能力和任务功能均使用官方实现；需要启用的可选功能仍通过官方插件管理配置。

截至 2026-09-30，本次固定官方标签为 `dsh-v0.2.0-rc.2`（候选版本），提交为 `639ed015397290b3745d163aafe02ffee4aa3f84`。官方桌面发布脚本目前只声明 macOS/Windows 目标，因此本仓库补充官方尚未提供的 Linux ARM64 平台选择、Debian 安装入口和麒麟兼容参数。

## 只维护官方缺少的部分

- 扩展官方准备脚本的 Linux ARM64 路径，沿用官方编译、npm 包闭包、Host、Office/解释器资源准备、完整性清单和启动冒烟测试。
- 兼容 Electron ASAR 对缺失文件返回 null 的行为，使官方 Linux WASM Office 后端正常回退；转换功能仍使用官方实现。
- 按麒麟 glibc 2.28 上限重编译实际随包 `node-pty`，检查安装包中所有外置 ELF 文件的架构和 glibc 依赖；不跳过不兼容的产物。
- 桌面启动器默认在有 `DISPLAY` 时选择 X11/XWayland，默认关闭 GPU 加速；`DSH_ENABLE_GPU=1` 可恢复。沿用官方沙箱，只有实机确认需要时才使用 `DSH_KYLIN_NO_SANDBOX=1`。
- 加载代理根 CA，并为官方尚不支持的 IPv4 CIDR `NO_PROXY` 匹配提供小补丁。回环及 RFC1918 私网地址默认直连，其他流量遵循用户的代理配置。
- 保留 `config/intranet.cordis.patch.yml` 作为可选内网策略，避免把内网部署规则混入官方产品源码。

## 代理证书

所有证书文件及 `DMZ_cert/` 均由 Git 忽略，不得提交。仅将公共 `DMZ_cert/root-ca.crt` 的 PEM 内容保存为仓库 Actions Secret `DMZ_PROXY_CA_CERT`；打包时注入被忽略的 `config/proxy-root-ca.crt`，验证 CA 有效性及安装包中的相同证书，结束后从 runner 清理注入文件。安装包仍包含公共 CA，启动器在 Electron/Host 启动前设置 `NODE_EXTRA_CA_CERTS`。不要把 `privkey.pem` 放入仓库、安装包或 GitHub Secret。普通适配 CI 生成一次性测试 CA，不接收真实代理证书。

桌面菜单启动即可加载随包 CA。需要替换证书时可以显式指定，包含完整证书链的 PEM 文件也可使用：

```bash
NODE_EXTRA_CA_CERTS=/data/DMZ_cert/fullchain.pem deepseek-harness-kylin
```

`/usr/bin/dsh` 使用官方 CLI 入口，并加载相同默认 CA。模型的反向代理 Base URL、模型 ID 和 API Key 在官方 Settings > Models 中配置；证书不会替代这些设置，也不会关闭 TLS 验证。反代 URL 的主机名/IP 必须与服务端证书 SAN 匹配。这里的信任配置面向 Node Host/CLI 网络请求，不替代 Chromium 或系统的证书信任库。

## GitHub 构建

构建前在仓库 Settings > Secrets and variables > Actions 中配置 `DMZ_PROXY_CA_CERT`。缺少 Secret 时，在依赖安装前停止构建。

运行 [Build Kylin ARM64 official desktop](https://github.com/ljm-12/dsh-kylin-desktop/actions/workflows/build-kylin-arm64-desktop.yml)，输入 `dsh-v0.2.0-rc.2`。原生 runner 为 `ubuntu-24.04-arm`。

构建成功后，Actions artifact 包含：

```text
DeepSeek-Harness-Kylin-ARM64-0.2.0-rc.2.deb
SHA256SUMS
BUILD-INFO.json
UPSTREAM-PATCH.diff
RUNTIME-PATCH.diff
```

`BUILD-INFO.json` 记录官方提交、打包仓库提交和证书/补丁哈希；两个 diff 分别展示平台/代理源码适配和随包 Office 兼容修改。工作流不上传 Release、不自动下载到本地，artifact 保留 30 天。

本地只运行无依赖的适配层检查：

```bash
DSH_PROXY_CA_CERT_FILE=DMZ_cert/root-ca.crt node scripts/prepare-proxy-ca.mjs
DSH_TEST_SOURCE=/path/to/pinned/official/checkout node --test tests/*.test.mjs
bash -n scripts/*.sh build/*.sh
```

本地完整打包必须使用原生 Linux ARM64，具备 Node 24、Corepack、Docker、编译工具、musl-tools、Electron 运行库、OpenSSL、readelf 与 dpkg：

```bash
DSH_PROXY_CA_CERT_FILE=DMZ_cert/root-ca.crt bash scripts/build-on-arm64.sh /path/to/official/checkout dsh-v0.2.0-rc.2
```

## 安装与旧版数据

```bash
sudo apt install ./DeepSeek-Harness-Kylin-ARM64-0.2.0-rc.2.deb
```

应用名仍为 DeepSeek Harness Kylin，桌面命令为 `deepseek-harness-kylin`，保留 `dsh-intranet` 别名。官方桌面使用官方 Harness home（通常为 `~/.dsh`）；旧载体的 `~/.config/dsh-kylin-desktop-packaging/runtime-home` 不自动迁移、不删除。先保留旧数据备份，再通过官方入口配置模型及工作区，避免不同版本的会话格式被直接覆盖。

可选内网策略需由部署者合并至官方桌面 profile 的 `cordis.patch.yml`（通常为 `~/.dsh/profiles/desktop/cordis.patch.yml`），保留已有插件行。该文件中的示例 LAN 地址、模型名和插件 ID需按实际环境与版本核对；不自动覆盖用户配置。

## 验证边界

适配层测试包含真实 TLS 握手：没有 CA 时拒绝测试服务器，加载 CA 后成功。ARM64 构建还用实际 Electron Node 模式重复此检查，并使用官方 Host/Office 冒烟测试、官方完整性清单及 Debian/ELF 校验。

这些检查不能替代麒麟实机安装、桌面图标启动、输入法、实际反代请求、一次对话和工具调用、重启与升级验收。若 KySec 拒绝执行，应根据目标机拒绝日志处理对应路径，不自动关闭系统安全策略。
