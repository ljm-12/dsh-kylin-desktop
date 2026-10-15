// Reuse the official caption layout and Electron window controls on Linux.
export const linuxWindowReplacements = new Map([
  ['apps/desktop/src/main.ts', [
    ["...(process.platform === 'win32' && primary ? {",
      "...((process.platform === 'win32' || process.platform === 'linux') && primary ? {"],
    ["if (process.platform === 'darwin' || process.platform === 'win32') {\n    // Fullscreen hides",
      "if (process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux') {\n    // Fullscreen hides"],
    ["Menu.buildFromTemplate(process.platform === 'win32' ? devToolsItems : [{",
      "Menu.buildFromTemplate(process.platform === 'win32' || process.platform === 'linux' ? devToolsItems : [{"],
    ["if (process.platform === 'win32') {\n    ipcMain.handle(DESKTOP_IPC.windowsMenu",
      "if (process.platform === 'win32' || process.platform === 'linux') {\n    ipcMain.handle(DESKTOP_IPC.windowsMenu"],
  ]],
  ['apps/desktop/src/preload-windows.ts', [
    ["if (process.platform !== 'win32') return",
      "if (process.platform !== 'win32' && process.platform !== 'linux') return"],
  ]],
  ['apps/desktop/src/preload-platform.ts', [
    ["if (process.platform !== 'darwin' && process.platform !== 'win32') return",
      "if (process.platform !== 'darwin' && process.platform !== 'win32' && process.platform !== 'linux') return"],
  ]],
])

export function patchLinuxWindow(file, source) {
  for (const [before, after] of linuxWindowReplacements.get(file) ?? []) {
    if (source.includes(after)) continue
    if (source.split(before).length !== 2) throw new Error(`Unsupported official Linux window source: ${file}`)
    source = source.replace(before, after)
  }
  return source
}
