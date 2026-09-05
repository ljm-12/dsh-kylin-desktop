---
name: browser-automation
description: Control and automate local browsers (Chromium, QaxBrowser, 360Chrome, Google Chrome) on Kylin Linux via CDP protocol for navigation, clicking, form-filling, screenshots, and page content extraction.
---

# Browser Automation on Kylin Linux

Use the built-in `dsh-browser` command to automate browser tasks without needing external internet or extra heavy dependencies.

## Key Capabilities

`dsh-browser` connects directly to the local Kylin Linux browser (Chromium, 奇安信可信浏览器, 360安全浏览器, Chrome) using Chrome DevTools Protocol (CDP):

- **Navigate**: Open web pages and web applications.
- **Inspect / Dump**: Extract readable Markdown text and interactive elements (buttons, inputs, links).
- **Click**: Click buttons, links, and elements by CSS selector or inner text.
- **Type**: Fill in forms and inputs.
- **Screenshot**: Capture the current page as PNG image.
- **Eval**: Execute JavaScript code inside the page.

## Command Reference

### 1. Open Webpage
```bash
dsh-browser open "http://127.0.0.1:8080"
dsh-browser open "http://oa.intranet.local"
```
Returns:
```json
{
  "status": "ok",
  "url": "http://127.0.0.1:8080",
  "title": "Intranet System Login"
}
```

### 2. Dump Page Content & Selectors (Recommended for LLMs)
```bash
dsh-browser dump
```
Outputs clean Markdown representation of the page, listing:
- Page Title and current URL
- Interactive Elements with recommended CSS selectors (e.g. `input[name="username"]`, `#login-btn`)
- Main visible text content

### 3. Click Element
```bash
# By CSS selector
dsh-browser click "#submit-btn"
dsh-browser click "button[type='submit']"

# Or by visible button text
dsh-browser click "登录"
dsh-browser click "查询"
```

### 4. Input Text / Fill Form
```bash
dsh-browser type "input[name='username']" "admin"
dsh-browser type "input[type='password']" "123456"
```

### 5. Take Screenshot
```bash
dsh-browser screenshot /tmp/page_preview.png
```

### 6. Execute Custom JavaScript
```bash
dsh-browser eval "document.title"
dsh-browser eval "Array.from(document.querySelectorAll('tr')).length"
```

### 7. Manage Session
```bash
dsh-browser tabs      # List active browser tabs
dsh-browser stop      # Close browser session
```

## Configuration

- Default CDP port is 9222; override with `--port N` or `DSH_BROWSER_PORT` when running concurrent sessions.
- The browser profile persists at `~/.dsh-browser-profile` (override: `--user-data-dir` / `DSH_BROWSER_USER_DATA_DIR`), so intranet logins survive across sessions.

## Best Practices
1. **Always `dump` after `open`**: Run `dsh-browser dump` to see the available elements and selectors before clicking or typing.
2. **Verify navigation**: After clicking a submit button or link, run `dsh-browser dump` or `dsh-browser screenshot` to verify the page has updated.
