import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test('UKUI tray watcher rejects Electron 44.0.0 combined registration and accepts standard forms', () => {
  const source = fileURLToPath(new URL('../scripts/tray-session-probe.py', import.meta.url))
  // Exercise the parser without importing Linux-only D-Bus/GLib modules.
  execFileSync(process.env.DSH_TEST_PYTHON ?? 'python3', ['-c', `
import ast, pathlib, sys
tree = ast.parse(pathlib.Path(sys.argv[1]).read_text())
functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in ('parse_registration', 'read_item_properties')]
scope = {}
exec(compile(ast.Module(body=functions, type_ignores=[]), sys.argv[1], 'exec'), scope)
parse = scope['parse_registration']
try:
    parse('org.freedesktop.StatusNotifierItem-33698-1/StatusNotifierItem/1', ':1.9')
except ValueError:
    pass
else:
    raise AssertionError('Broken Electron registration was accepted')
assert parse('org.kde.Tray', ':1.9') == ('org.kde.Tray', '/StatusNotifierItem')
assert parse('/StatusNotifierItem/1', ':1.9') == (':1.9', '/StatusNotifierItem/1')
try:
    parse('/StatusNotifierItem', None)
except ValueError:
    pass
else:
    raise AssertionError('Missing sender was accepted')
calls = []
def call(*args, **kwargs):
    calls.append(args)
    assert args[:5] == ('org.freedesktop.StatusNotifierItem-33698-1', '/StatusNotifierItem/1', 'org.freedesktop.DBus.Properties', 'GetAll', 's')
    return {'Menu': '/org/chromium/DbusMenu', 'Status': 'Active'}
interface, properties = scope['read_item_properties'](call, 'org.freedesktop.StatusNotifierItem-33698-1', '/StatusNotifierItem/1')
assert interface == 'org.kde.StatusNotifierItem'
assert properties['Status'] == 'Active'
assert len(calls) == 1
def fallback(*args, **kwargs):
    if args[5][0] == 'org.kde.StatusNotifierItem': raise RuntimeError('unsupported interface')
    return {'Menu': '/menu', 'Status': 'Active'}
assert scope['read_item_properties'](fallback, 'org.test', '/item')[0] == 'org.freedesktop.StatusNotifierItem'
`, source], { stdio: 'pipe' })
})
