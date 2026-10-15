import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

// Give Electron and the window manager time to receive each native input event.
export async function dragCaption(windowId, rect, x11) {
  const geometry = () => Object.fromEntries(x11(['getwindowgeometry', '--shell', windowId]).trim().split('\n')
    .map(line => line.split('=')).map(([key, value]) => [key, Number(value)]))
  x11(['windowactivate', '--sync', windowId])
  const before = geometry()
  const x = Math.floor(rect.x + rect.width / 2)
  x11(['mousemove', '--sync', '--window', windowId, String(x), '20'])
  await delay(150)
  x11(['mousedown', '1'])
  try {
    await delay(150)
    for (let step = 1; step <= 6; step++) {
      x11(['mousemove', '--sync', String(before.X + x + step * 8), String(before.Y + 20 + step * 5)])
      await delay(50)
    }
  } finally { x11(['mouseup', '1']) }
  await delay(300)
  const after = geometry()
  assert.ok(after.X !== before.X || after.Y !== before.Y,
    `Integrated caption cannot drag the window: ${JSON.stringify({ before, after, rect })}`)
  return x
}
