const mode = process.argv[2]

switch (mode) {
  case 'ready':
    process.stdout.write('dsh web: http://127.0.0.1:43123/?tok')
    setImmediate(() => process.stdout.write('en=fixture-secret\n'))
    setInterval(() => {}, 60_000)
    break
  case 'early-exit':
    process.stderr.write('fixture startup failure\n')
    process.exitCode = 7
    break
  case 'ready-exit':
    process.stdout.write('dsh web: http://127.0.0.1:43124/?token=fixture-secret\n')
    setImmediate(() => { process.exitCode = 9 })
    break
  case 'ignore-term':
    process.on('SIGTERM', () => {})
    process.stdout.write('dsh web: http://127.0.0.1:43125/?token=fixture-secret\n')
    setInterval(() => {}, 60_000)
    break
  default:
    process.stderr.write(`unknown fixture mode: ${String(mode)}\n`)
    process.exitCode = 2
}
