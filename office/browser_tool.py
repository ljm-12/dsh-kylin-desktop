#!/usr/bin/env python3
"""
Lightweight Chrome DevTools Protocol (CDP) Browser Automation Tool for DeepSeek Harness.
Communicates directly with Chromium-based browsers (Chromium, Chrome, QaxBrowser, 360Chrome)
running on Kylin Linux via standard WebSocket over port 9222. Zero external dependencies.
"""

import argparse
import base64
import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import time
import urllib.request
from typing import Any, Dict, List, Optional, Tuple


DEFAULT_PORT = int(os.environ.get("DSH_BROWSER_PORT", "9222"))
DEFAULT_USER_DATA_DIR = os.environ.get(
    "DSH_BROWSER_USER_DATA_DIR",
    os.path.expanduser("~/.dsh-browser-profile"),
)

BROWSER_CANDIDATES = [
    os.environ.get("CHROMIUM_PATH"),
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/qaxbrowser",        # 奇安信可信浏览器 (Kylin Linux default)
    "/usr/bin/360chrome",         # 360安全浏览器
    "/usr/bin/uos-browser",
    "/usr/bin/browser",
]


class WebSocketClient:
    """Minimal RFC 6455 WebSocket client using standard library sockets."""

    def __init__(self, ws_url: str, timeout: float = 15.0):
        # ws://127.0.0.1:9222/devtools/page/XYZ
        url = ws_url.replace("ws://", "").replace("wss://", "")
        parts = url.split("/", 1)
        host_port = parts[0].split(":")
        self.host = host_port[0]
        self.port = int(host_port[1]) if len(host_port) > 1 else 80
        self.path = "/" + parts[1] if len(parts) > 1 else "/"
        self.timeout = timeout
        self.sock = socket.create_connection((self.host, self.port), timeout=self.timeout)
        self._handshake()

    def _handshake(self) -> None:
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        req = (
            f"GET {self.path} HTTP/1.1\r\n"
            f"Host: {self.host}:{self.port}\r\n"
            f"Upgrade: websocket\r\n"
            f"Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode("ascii"))
        res = self.sock.recv(4096).decode("latin1")
        if "101 Switching Protocols" not in res:
            raise RuntimeError(f"WebSocket handshake failed: {res[:120]}")

    def send_json(self, data: Dict[str, Any]) -> None:
        payload = json.dumps(data).encode("utf-8")
        length = len(payload)
        mask = os.urandom(4)
        if length <= 125:
            header = struct.pack("!BB", 0x81, 0x80 | length) + mask
        elif length <= 65535:
            header = struct.pack("!BBH", 0x81, 0x80 | 126, length) + mask
        else:
            header = struct.pack("!BBQ", 0x81, 0x80 | 127, length) + mask
        masked_payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(header + masked_payload)

    def recv_json(self) -> Dict[str, Any]:
        while True:
            # Read first 2 bytes
            head = self._recv_exact(2)
            opcode = head[0] & 0x0F
            is_masked = bool(head[1] & 0x80)
            length = head[1] & 0x7F

            if length == 126:
                length = struct.unpack("!H", self._recv_exact(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", self._recv_exact(8))[0]

            mask = self._recv_exact(4) if is_masked else b""
            raw_data = self._recv_exact(length)

            if is_masked:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(raw_data))
            else:
                payload = raw_data

            if opcode == 0x1:  # Text frame
                return json.loads(payload.decode("utf-8", errors="replace"))
            elif opcode == 0x8:  # Close frame
                raise ConnectionResetError("WebSocket closed by server")
            elif opcode == 0x9:  # Ping
                pong = struct.pack("!BB", 0x8A, 0x80) + os.urandom(4)
                self.sock.sendall(pong)

    def _recv_exact(self, num_bytes: int) -> bytes:
        buf = bytearray()
        while len(buf) < num_bytes:
            chunk = self.sock.recv(num_bytes - len(buf))
            if not chunk:
                raise ConnectionResetError("Socket closed prematurely")
            buf.extend(chunk)
        return bytes(buf)

    def close(self) -> None:
        try:
            self.sock.close()
        except Exception:
            pass


class BrowserController:
    """Manages Chromium browser process and sends CDP commands."""

    def __init__(
        self,
        port: int = DEFAULT_PORT,
        headless: bool = True,
        user_data_dir: Optional[str] = None,
    ):
        self.port = port
        self.headless = headless
        self.user_data_dir = os.path.abspath(user_data_dir) if user_data_dir else DEFAULT_USER_DATA_DIR
        self._msg_id = 0

    def find_browser_executable(self) -> Optional[str]:
        for path in BROWSER_CANDIDATES:
            if path and os.path.isfile(path) and os.access(path, os.X_OK):
                return path
        for name in ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "qaxbrowser"]:
            found = shutil.which(name)
            if found:
                return found
        return None

    def is_browser_running(self) -> bool:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json/version", timeout=1.5) as resp:
                return resp.status == 200
        except Exception:
            return False

    def ensure_browser(self) -> None:
        if self.is_browser_running():
            return

        browser_bin = self.find_browser_executable()
        if not browser_bin:
            raise FileNotFoundError(
                "No Chromium-based browser executable found on system. "
                "Checked paths: " + ", ".join(c for c in BROWSER_CANDIDATES if c)
            )

        os.makedirs(self.user_data_dir, exist_ok=True)
        cmd = [
            browser_bin,
            f"--remote-debugging-port={self.port}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            f"--user-data-dir={self.user_data_dir}",
            "--disable-background-networking",
            "--disable-sync",
        ]
        if self.headless:
            cmd.append("--headless=new")

        subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )

        for _ in range(30):
            time.sleep(0.2)
            if self.is_browser_running():
                return
        raise TimeoutError(f"Browser did not start remote debugging on port {self.port} in 6 seconds.")

    def get_pages(self) -> List[Dict[str, Any]]:
        self.ensure_browser()
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}/json/list")
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return [p for p in data if p.get("type") == "page"]

    def get_or_create_page(self) -> Dict[str, Any]:
        pages = self.get_pages()
        if pages:
            return pages[0]
        # Create a new tab
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}/json/new?about:blank", method="PUT")
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def execute_cdp(self, method: str, params: Optional[Dict[str, Any]] = None) -> Any:
        page = self.get_or_create_page()
        ws_url = page.get("webSocketDebuggerUrl")
        if not ws_url:
            raise RuntimeError(f"No webSocketDebuggerUrl for page {page.get('id')}")

        ws = WebSocketClient(ws_url)
        try:
            self._msg_id += 1
            call_id = self._msg_id
            msg = {"id": call_id, "method": method, "params": params or {}}
            ws.send_json(msg)

            start = time.time()
            while time.time() - start < 20.0:
                res = ws.recv_json()
                if res.get("id") == call_id:
                    if "error" in res:
                        raise RuntimeError(f"CDP Error ({method}): {res['error'].get('message')}")
                    return res.get("result", {})
            raise TimeoutError(f"CDP command {method} timed out after 20s")
        finally:
            ws.close()

    def open_url(self, url: str) -> Dict[str, Any]:
        if not url.startswith("http://") and not url.startswith("https://") and not url.startswith("file://") and not url.startswith("about:"):
            url = "http://" + url
        self.execute_cdp("Page.navigate", {"url": url})
        time.sleep(1.0)
        title_res = self.evaluate("document.title")
        return {
            "status": "ok",
            "url": url,
            "title": title_res.get("value", "")
        }

    def evaluate(self, expression: str) -> Any:
        res = self.execute_cdp("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True
        })
        return res.get("result", {})

    def click(self, selector_or_text: str) -> Dict[str, Any]:
        js = f"""
        (() => {{
            let target = document.querySelector({json.dumps(selector_or_text)});
            if (!target) {{
                const nodes = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"], span, div'));
                target = nodes.find(el => el.innerText && el.innerText.trim() === {json.dumps(selector_or_text)});
            }}
            if (!target) {{
                return {{ found: false }};
            }}
            target.scrollIntoView({{ behavior: 'instant', block: 'center' }});
            target.click();
            return {{
                found: true,
                tagName: target.tagName,
                id: target.id,
                className: target.className
            }};
        }})()
        """
        res = self.evaluate(js)
        val = res.get("value", {})
        if not val.get("found"):
            return {"status": "error", "message": f"Element matching '{selector_or_text}' not found on page"}
        time.sleep(0.5)
        new_title = self.evaluate("document.title").get("value", "")
        new_url = self.evaluate("document.location.href").get("value", "")
        return {
            "status": "ok",
            "clicked": selector_or_text,
            "element": val,
            "current_title": new_title,
            "current_url": new_url
        }

    def type_text(self, selector: str, text: str) -> Dict[str, Any]:
        js = f"""
        (() => {{
            const target = document.querySelector({json.dumps(selector)});
            if (!target) return {{ found: false }};
            target.focus();
            target.value = {json.dumps(text)};
            target.dispatchEvent(new Event('input', {{ bubbles: true }}));
            target.dispatchEvent(new Event('change', {{ bubbles: true }}));
            return {{ found: true, selector: {json.dumps(selector)} }};
        }})()
        """
        res = self.evaluate(js)
        val = res.get("value", {})
        if not val.get("found"):
            return {"status": "error", "message": f"Input matching '{selector}' not found on page"}
        return {"status": "ok", "typed": text, "selector": selector}

    def screenshot(self, output_path: Optional[str] = None) -> Dict[str, Any]:
        if not output_path:
            output_path = f"screenshot_{int(time.time())}.png"
        res = self.execute_cdp("Page.captureScreenshot", {"format": "png"})
        b64 = res.get("data", "")
        with open(output_path, "wb") as f:
            f.write(base64.b64decode(b64))
        return {"status": "ok", "screenshot_path": os.path.abspath(output_path)}

    def dump_markdown(self) -> str:
        """Extract main content and interactive elements into structured Markdown."""
        js = r"""
        (() => {
            const title = document.title || 'Untitled';
            const url = document.location.href;

            const interactives = [];
            const clickable = Array.from(document.querySelectorAll('button, a, input, select, textarea, [role="button"]'));
            for (let i = 0; i < Math.min(clickable.length, 50); i++) {
                const el = clickable[i];
                const tag = el.tagName.toLowerCase();
                const type = el.type || '';
                const text = (el.innerText || el.value || el.placeholder || el.ariaLabel || '').trim();
                const selector = el.id ? '#' + el.id : (el.name ? `[name="${el.name}"]` : tag);
                if (text || el.id || el.name) {
                    interactives.push(`- [${tag}${type ? ':' + type : ''}] "${text}" (selector: \\\`${selector}\\\`)`);
                }
            }

            const textContent = document.body ? document.body.innerText.split('\\n').map(l => l.trim()).filter(l => l.length > 0).slice(0, 100).join('\\n') : '';

            return {
                title,
                url,
                interactives,
                textContent
            };
        })()
        """
        res = self.evaluate(js)
        val = res.get("value", {})
        md = [
            f"# Page: {val.get('title', '')}",
            f"**URL**: {val.get('url', '')}\n",
            "## Interactive Elements",
        ]
        if val.get("interactives"):
            md.extend(val["interactives"])
        else:
            md.append("*(No significant interactive elements detected)*")

        md.append("\n## Visible Content")
        md.append(val.get("textContent", ""))
        return "\n".join(md)

    def stop(self) -> Dict[str, Any]:
        pages = self.get_pages()
        for p in pages:
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json/close/{p['id']}", timeout=2.0)
            except Exception:
                pass
        return {"status": "ok", "message": "Browser tabs closed"}


def main():
    parser = argparse.ArgumentParser(description="DeepSeek Harness Lightweight CDP Browser Tool")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="CDP debugging port (default: 9222 or $DSH_BROWSER_PORT)")
    parser.add_argument("--user-data-dir", default=DEFAULT_USER_DATA_DIR, help="Chromium user data directory (default: ~/.dsh-browser-profile or $DSH_BROWSER_USER_DATA_DIR)")
    parser.add_argument("--headed", action="store_true", help="Launch browser with visible GUI window (default: headless)")

    subparsers = parser.add_subparsers(dest="command", required=True)

    # open
    p_open = subparsers.add_parser("open", help="Navigate to URL")
    p_open.add_argument("url", help="Target URL (e.g. http://127.0.0.1:8080 or intranet OA)")

    # dump
    subparsers.add_parser("dump", help="Dump page content and interactive elements as Markdown")

    # click
    p_click = subparsers.add_parser("click", help="Click an element by CSS selector or inner text")
    p_click.add_argument("selector", help="CSS selector (e.g. '#submit-btn') or visible button text")

    # type
    p_type = subparsers.add_parser("type", help="Type text into an input or textarea")
    p_type.add_argument("selector", help="CSS selector (e.g. 'input[name=\"username\"]')")
    p_type.add_argument("text", help="Text to input")

    # screenshot
    p_shot = subparsers.add_parser("screenshot", help="Take screenshot of current page")
    p_shot.add_argument("path", nargs="?", default=None, help="Output image file path (PNG)")

    # eval
    p_eval = subparsers.add_parser("eval", help="Evaluate JavaScript expression on page")
    p_eval.add_argument("code", help="JavaScript code to execute")

    # tabs
    subparsers.add_parser("tabs", help="List active tabs")

    # stop
    subparsers.add_parser("stop", help="Close browser session")

    args = parser.parse_args()
    ctl = BrowserController(
        port=args.port,
        headless=not args.headed,
        user_data_dir=args.user_data_dir,
    )

    try:
        if args.command == "open":
            print(json.dumps(ctl.open_url(args.url), ensure_ascii=False, indent=2))
        elif args.command == "dump":
            print(ctl.dump_markdown())
        elif args.command == "click":
            print(json.dumps(ctl.click(args.selector), ensure_ascii=False, indent=2))
        elif args.command == "type":
            print(json.dumps(ctl.type_text(args.selector, args.text), ensure_ascii=False, indent=2))
        elif args.command == "screenshot":
            print(json.dumps(ctl.screenshot(args.path), ensure_ascii=False, indent=2))
        elif args.command == "eval":
            print(json.dumps(ctl.evaluate(args.code), ensure_ascii=False, indent=2))
        elif args.command == "tabs":
            print(json.dumps(ctl.get_pages(), ensure_ascii=False, indent=2))
        elif args.command == "stop":
            print(json.dumps(ctl.stop(), ensure_ascii=False, indent=2))
    except Exception as exc:
        print(json.dumps({"status": "error", "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
