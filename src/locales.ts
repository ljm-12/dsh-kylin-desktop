/** User-visible copy owned by the Kylin desktop carrier. */
export interface DesktopCopy {
  appTitle: string
  startupFailureTitle: string
  runtimeExitTitle: string
  runtimeMissing: (path: string) => string
  runtimeSidecarMissing: (path: string) => string
  startupFailure: (reason: string) => string
  runtimeExit: (reason: string) => string
}

const zhCN: DesktopCopy = {
  appTitle: 'DeepSeek Harness 内网版',
  startupFailureTitle: 'DeepSeek Harness 启动失败',
  runtimeExitTitle: 'DeepSeek Harness Runtime 已退出',
  runtimeMissing: path => `未找到 ARM64 Runtime：${path}`,
  runtimeSidecarMissing: path => `未找到 Runtime 必需的 ripgrep 伴随程序：${path}`,
  startupFailure: reason => `本地 Runtime 未能启动。\n\n${reason}`,
  runtimeExit: reason => `本地 Runtime 意外退出。\n\n${reason}`,
}

const enUS: DesktopCopy = {
  appTitle: 'DeepSeek Harness Intranet',
  startupFailureTitle: 'DeepSeek Harness failed to start',
  runtimeExitTitle: 'DeepSeek Harness Runtime exited',
  runtimeMissing: path => `The ARM64 Runtime is missing: ${path}`,
  runtimeSidecarMissing: path => `The Runtime ripgrep sidecar is missing: ${path}`,
  startupFailure: reason => `The local Runtime did not start.\n\n${reason}`,
  runtimeExit: reason => `The local Runtime exited unexpectedly.\n\n${reason}`,
}

/** Resolve desktop-shell copy from Electron's locale identifier. */
export function desktopCopy(locale: string): DesktopCopy {
  return locale.toLowerCase().startsWith('zh') ? zhCN : enUS
}
