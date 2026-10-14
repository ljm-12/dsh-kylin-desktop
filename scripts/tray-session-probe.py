"""Disposable StatusNotifier host and client for the installed Linux tray test."""
import json
import sys
from pathlib import Path

import dbus
import dbus.service
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

mode, registry = sys.argv[1:3]
registry = Path(registry)
DBusGMainLoop(set_as_default=True)
bus = dbus.SessionBus()
WATCHER = "org.kde.StatusNotifierWatcher"
ITEM = "org.kde.StatusNotifierItem"
PROPERTIES = "org.freedesktop.DBus.Properties"

def parse_registration(service, sender):
    service = str(service)
    if service.startswith("/"):
        if not sender:
            raise ValueError("Object-path registration requires a sender")
        return str(sender), service
    # UKUI treats every non-path argument as a bus name, without splitting it.
    # Electron 44.0.0's combined name/path is invalid and must fail this test.
    if "/" in service or not service:
        raise ValueError("UKUI rejects a combined StatusNotifier bus name/path")
    return service, "/StatusNotifierItem"

def read_item_properties(call, service, path):
    errors = []
    for name in ("org.kde.StatusNotifierItem", "org.freedesktop.StatusNotifierItem"):
        try:
            properties = call(service, path, "org.freedesktop.DBus.Properties", "GetAll", "s", (name,), timeout=5)
        except Exception as error:
            errors.append(str(error))
            continue
        if "Menu" in properties and "Status" in properties:
            return name, properties
    raise ValueError("StatusNotifierItem properties unavailable: " + "; ".join(errors))

if mode == "watch":
    class Watcher(dbus.service.Object):
        def __init__(self):
            self.items = []
            self.owner = dbus.service.BusName(WATCHER, bus=bus)
            super().__init__(self.owner, "/StatusNotifierWatcher")
            self.persist()

        def persist(self):
            temporary = registry.with_suffix(".tmp")
            temporary.write_text(json.dumps({"ready": True, "items": self.items}))
            temporary.replace(registry)

        @dbus.service.method(WATCHER, in_signature="s", out_signature="", sender_keyword="sender")
        def RegisterStatusNotifierItem(self, service, sender=None):
            name, path = parse_registration(service, sender)
            if not bus.name_has_owner(name):
                raise ValueError("StatusNotifier service has no owner")
            self.items.append({"service": name, "path": path})
            self.persist()
            self.StatusNotifierItemRegistered(name + path)

        @dbus.service.method(WATCHER, in_signature="s", out_signature="")
        def RegisterStatusNotifierHost(self, service):
            self.StatusNotifierHostRegistered()

        @dbus.service.signal(WATCHER, signature="s")
        def StatusNotifierItemRegistered(self, service):
            pass

        @dbus.service.signal(WATCHER, signature="")
        def StatusNotifierHostRegistered(self):
            pass

        @dbus.service.method(PROPERTIES, in_signature="s", out_signature="a{sv}")
        def GetAll(self, interface):
            if interface != WATCHER:
                return {}
            return {"ProtocolVersion": dbus.Int32(0),
                    "IsStatusNotifierHostRegistered": dbus.Boolean(True),
                    "RegisteredStatusNotifierItems": dbus.Array(
                        [item["service"] + item["path"] for item in self.items], signature="s")}

        @dbus.service.method(PROPERTIES, in_signature="ss", out_signature="v")
        def Get(self, interface, property_name):
            return self.GetAll(interface)[property_name]

    watcher = Watcher()
    GLib.MainLoop().run()
else:
    registration = json.loads(registry.read_text())["items"][-1]
    service, path = bus.get_name_owner(registration["service"]), registration["path"]
    # Address the unique owner, as desktop panels/proxies do. Old Electron
    # versions answered only their well-known name and fail this check too.
    ITEM, properties = read_item_properties(bus.call_blocking, service, path)
    menu_path = str(properties["Menu"])
    _, layout = bus.call_blocking(service, menu_path, "com.canonical.dbusmenu", "GetLayout", "iias",
                                 (0, -1, ["label", "enabled", "visible", "type"]), timeout=5)
    entries = [{"id": int(child[0]), "label": str(child[1].get("label", "")),
                "enabled": bool(child[1].get("enabled", True)),
                "visible": bool(child[1].get("visible", True))}
               for child in layout[2] if child[1].get("type") != "separator"]
    if mode == "info":
        print(json.dumps({"status": str(properties["Status"]),
                          "icon": bool(properties.get("IconName")) or any(
                              int(pixmap[0]) > 0 and int(pixmap[1]) > 0 and len(pixmap[2]) > 0
                              for pixmap in properties.get("IconPixmap", [])),
                          "entries": entries}))
    elif mode == "activate":
        bus.call_blocking(service, path, ITEM, "Activate", "ii", (0, 0), timeout=5)
    elif mode in ("open", "quit"):
        entry = entries[0] if mode == "open" else entries[-1]
        bus.call_blocking(service, menu_path, "com.canonical.dbusmenu", "Event", "isvu",
                          (entry["id"], "clicked", dbus.String("", variant_level=1), dbus.UInt32(0)), timeout=5)
    else:
        raise SystemExit("Unsupported tray probe action")
