# browser-bays

One coloured, persistent controlled browser per Claude Code session, for runtime
testing with [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp).

- **Bays.** Four bays (red, blue, green, amber), each a chrome-devtools-mcp server
  with its own persistent Chrome profile under `~/.browser-bays/profiles/<bay>`.
  Log in once per bay; the login stays.
- **One per session.** Every bay server is held back at session start; the session
  connects the first free bay (or the one you take with `/bay <name>`). A bay is
  held while its server process lives, so it frees itself when the session ends.
- **Visible.** A band above the prompt shows the session's bay
  in its colour; **Focus** brings that bay's Chrome window to the front. `/bays`
  opens a pane with every bay and who holds it.
- **Agents describe their bay.** Tools `bay_info` and `bay_describe` let the agent
  record the app, URL, dev-server port and notes it uses the bay for, and see the
  ports other sessions took; `/bays` shows every bay's description.
- **The model sees one browser.** Only the session's bay tools are connected (`mcp__plugin_browser-bays_<bay>__*`).

## Install

```
/plugin marketplace add pelayomendez/browser-bays
/plugin install browser-bays@pelayomendez-browser-bays
```

## Config

`~/.browser-bays/config.json` (written on first use; `BROWSER_BAYS_HOME` moves it):

```json
{
  "package": "chrome-devtools-mcp@latest",
  "autoAssign": true,
  "idleMinutes": 10,
  "holdServers": ["chrome-devtools"],
  "bays": [
    { "id": "bay-1", "name": "red", "color": "#E5484D", "emoji": "🔴", "headless": false }
  ]
}
```

- `holdServers`: other MCP servers to keep out of sessions (e.g. your own
  chrome-devtools entries), so agents use the bay only.
- `idleMinutes`: close a bay's browser after this many minutes without a browser
  call (default 10, `0` keeps it open); it reopens on the next call, login kept.
- `headless`: run that bay without a window (log in with it visible first).
- Bay ids `bay-1`…`bay-4` are fixed by the plugin manifest; names, colours and
  flags are yours.

## Drivers

A bay's `driver` picks the MCP server that runs its browser. `chrome-devtools`
(default) and `firefox-devtools` ship built in; add others under `drivers` in
`config.json`:

```json
"drivers": {
  "my-browser": {
    "label": "My browser MCP",
    "command": "npx",
    "args": ["-y", "my-browser-mcp@latest", "--profile", "{profile}"],
    "headlessArgs": ["--headless"],
    "process": "{profile}"
  }
}
```

`{profile}`, `{name}`, `{emoji}` and `{color}` are filled in per bay; `process`
identifies the browser's main process for Focus. `/bay driver <name>` switches
the session's bay (applies the next time the bay starts).

## Commands

- `/bay` or `/bay focus`: bring this session's browser to the front.
- `/bay <name>`: take a bay when the session has none.
- `/bay driver [name]`: show or change the bay's driver.
- `/bay headless on|off`, `/bay app|url|port|notes <text>`, `/bay save`: mode and instructions.
- `/bays`: show all bays.

Requires Node.js (npx) and Chrome. Focus uses `osascript` on macOS, falling back
to the browser's own bring-to-front.
