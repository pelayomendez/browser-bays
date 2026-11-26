# Changelog

Releases are tagged `browser-bays--v<version>` (`claude plugin tag --push`).

## 0.1.0

First release.

- Four bays (red, blue, green, amber), each a controlled browser with its own persistent profile, so a login survives across sessions.
- One bay per session: a new session takes the first free bay; `/bay <name>` moves it and gives the old one back. A bay frees itself when its session ends.
- The band above the prompt: the bay in its colour, driver, visible or headless, and what it is for, with Focus (brings the window to the front, reopening it if closed) and Bays.
- `/bays`: every bay, who holds it and what each session uses it for, with Take for free bays.
- Agent tools `bay_info` and `bay_describe`: record the app, URL, dev-server port and notes, and see the ports other sessions took.
- Drivers: Chrome (chrome-devtools-mcp) by default, Firefox (firefox-devtools-mcp) built in, any MCP server through `drivers` in the config.
- Chrome bays get a toolbar in the bay's colour.
- An idle bay's browser closes after ten minutes and reopens on the next browser call.
- `holdServers` keeps other browser MCP servers out of sessions, so agents use their bay only.
