// Exact Linux shell changes against the pinned official desktop source.
export const linuxTrayReplacements = [
  [
    "import { DesktopTray } from './tray.ts'",
    "import { DesktopTray } from './tray.ts'\nimport { KylinProcessTree } from './kylin-process-tree.ts'",
  ],
  [
    'let focusPrimaryWindow = (): void => {}',
    "const kylinProcesses = process.platform === 'linux' ? new KylinProcessTree() : undefined\nlet focusPrimaryWindow = (): void => {}",
  ],
  [
    '    show,\n    ...(process.platform',
    "    show,\n    ...(process.platform === 'linux' ? {\n      icon: app.isPackaged ? join(process.resourcesPath, 'icon.png')\n        : join(app.getAppPath(), 'resources', 'icon-windows.png'),\n      skipTaskbar: false,\n    } : {}),\n    ...(process.platform",
  ],
  [
    "  if (process.platform === 'win32') {\n    // The tray is the way back",
    "  if (process.platform === 'win32' || process.platform === 'linux') {\n    // The tray is the way back",
  ],
  [
    'tray = new DesktopTray({ iconPath: trayIconPath, locale: currentDesktopLocale,',
    "tray = new DesktopTray({ iconPath: process.platform === 'linux' ? applicationIconPath : trayIconPath, locale: currentDesktopLocale,",
  ],
  [
    '      event.preventDefault()\n      if (updateDialog.isOpen)',
    "      event.preventDefault()\n      // A failed Linux tray must never leave an unreachable background process.\n      if (process.platform === 'linux' && tray === undefined) { app.quit(); return }\n      if (updateDialog.isOpen)",
  ],
  [
    '.finally(() => { app.quit() })',
    ".finally(async () => {\n        if (kylinProcesses !== undefined) {\n          try { await kylinProcesses.stop() }\n          catch (error) { console.error('desktop worker cleanup failed', error) }\n        }\n        app.quit()\n      })",
  ],
]

export function patchLinuxTray(source) {
  for (const [before, after] of linuxTrayReplacements) {
    if (source.includes(after)) continue
    if (source.split(before).length !== 2) throw new Error('Unsupported official Linux tray source')
    source = source.replace(before, after)
  }
  return source
}
