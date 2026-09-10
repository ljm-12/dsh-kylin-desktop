/// <reference lib="dom" />
import { contextBridge, ipcRenderer } from 'electron'

export interface NativeFilePayload {
  name: string
  size: number
  type: string
  buffer: ArrayBuffer
}

// 1. Expose the native file bridge to renderer
try {
  contextBridge.exposeInMainWorld('__electronNativeBridge', {
    pickFiles: (multiple?: boolean, accept?: string): Promise<NativeFilePayload[]> =>
      ipcRenderer.invoke('dsh:pick-files', { multiple, accept }),
    readPaths: (paths: string[]): Promise<NativeFilePayload[]> =>
      ipcRenderer.invoke('dsh:read-paths', { paths }),
  })
} catch {
  // In case contextIsolation is disabled
  ;(window as unknown as Record<string, unknown>).__electronNativeBridge = {
    pickFiles: (multiple?: boolean, accept?: string): Promise<NativeFilePayload[]> =>
      ipcRenderer.invoke('dsh:pick-files', { multiple, accept }),
    readPaths: (paths: string[]): Promise<NativeFilePayload[]> =>
      ipcRenderer.invoke('dsh:read-paths', { paths }),
  }
}

function createFilesFromPayload(items: NativeFilePayload[]): File[] {
  return items.map((item) => {
    const blob = new Blob([item.buffer], { type: item.type })
    return new File([blob], item.name, { type: item.type, lastModified: Date.now() })
  })
}

async function triggerNativeFilePicker(input: HTMLInputElement): Promise<void> {
  try {
    const items: NativeFilePayload[] = await ipcRenderer.invoke('dsh:pick-files', {
      multiple: input.multiple,
      accept: input.accept,
    })
    if (!items || items.length === 0) return

    const dt = new DataTransfer()
    for (const f of createFilesFromPayload(items)) {
      dt.items.add(f)
    }
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  } catch (error) {
    console.error('[preload] Native file picker failed:', error)
  }
}

// 2. Inject main-world hook into page to intercept programmatic click() calls on file inputs
function injectMainWorldHook(): void {
  try {
    const script = document.createElement('script')
    script.textContent = `
      (() => {
        if (window.__dsh_native_click_hooked) return;
        window.__dsh_native_click_hooked = true;
        const originalClick = HTMLInputElement.prototype.click;
        HTMLInputElement.prototype.click = function() {
          if (this.type === 'file') {
            window.dispatchEvent(new CustomEvent('__dsh_native_file_click__', { detail: { input: this } }));
            return;
          }
          return originalClick.apply(this, arguments);
        };
      })();
    `
    const target = document.head || document.documentElement
    if (target) {
      target.appendChild(script)
      script.remove()
    }
  } catch {
    // Ignore injection error
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectMainWorldHook, { once: true })
} else {
  injectMainWorldHook()
}

window.addEventListener('__dsh_native_file_click__', (event: Event) => {
  const customEvent = event as CustomEvent<{ input?: HTMLInputElement }>
  const input = customEvent.detail?.input || document.querySelector('input[type="file"]') as HTMLInputElement | null
  if (input) {
    void triggerNativeFilePicker(input)
  }
})

// 3. Capturing click listener on document for attachment buttons or file inputs
window.addEventListener(
  'click',
  (event) => {
    const target = event.target as HTMLElement | null
    if (!target) return

    // Direct click on input[type="file"]
    if (target instanceof HTMLInputElement && target.type === 'file') {
      event.preventDefault()
      event.stopPropagation()
      void triggerNativeFilePicker(target)
      return
    }

    // Click on paperclip / attachment button
    const button = target.closest('button')
    if (button) {
      const label = button.getAttribute('aria-label') || ''
      const isAttach = label.includes('附件') || label.toLowerCase().includes('attach') || button.className.includes('add')
      if (isAttach) {
        const container = button.closest('div') || document
        const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement | null
          || document.querySelector('input[type="file"]') as HTMLInputElement | null
        if (fileInput) {
          event.preventDefault()
          event.stopPropagation()
          void triggerNativeFilePicker(fileInput)
        }
      }
    }
  },
  true,
)

// 4. Global drag & drop support for Linux desktop file managers (Peony / Nautilus text/uri-list)
window.addEventListener(
  'dragover',
  (event) => {
    const dt = event.dataTransfer
    if (dt && (dt.types.includes('Files') || dt.types.includes('text/uri-list'))) {
      event.preventDefault()
      dt.dropEffect = 'copy'
    }
  },
  true,
)

window.addEventListener(
  'drop',
  async (event) => {
    const dt = event.dataTransfer
    if (!dt) return

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null
    if (!fileInput) return

    if (dt.files && dt.files.length > 0) {
      event.preventDefault()
      event.stopPropagation()
      fileInput.files = dt.files
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      return
    }

    const uriList = dt.getData('text/uri-list')
    if (uriList) {
      event.preventDefault()
      event.stopPropagation()
      const rawUris = uriList.split(/\r?\n/).filter((line) => line.startsWith('file://'))
      const paths = rawUris.map((uri) => {
        try {
          return decodeURIComponent(new URL(uri).pathname)
        } catch {
          return uri.replace(/^file:\/\//, '')
        }
      })
      if (paths.length > 0) {
        const items: NativeFilePayload[] = await ipcRenderer.invoke('dsh:read-paths', { paths })
        if (items && items.length > 0) {
          const outDt = new DataTransfer()
          for (const f of createFilesFromPayload(items)) {
            outDt.items.add(f)
          }
          fileInput.files = outDt.files
          fileInput.dispatchEvent(new Event('change', { bubbles: true }))
        }
      }
    }
  },
  true,
)
