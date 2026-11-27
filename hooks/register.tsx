import { atom, read, update } from 'claude-code'
import type { EngineInterface as Dollar, Register } from 'claude-code'

import type { Assigned, Bay, BayRow, Brief, Driver, RuleState } from '../types'

// One coloured, persistent chrome-devtools-mcp browser ("bay") per session.
// The manifest declares the bay servers; every one is held back at session
// start, and the session connects only the bay it is assigned. A bay is held
// while its server process lives (~/.browser-bays/run/<bay>.pid), so a bay
// frees itself when its session ends.

const PLUGIN = 'browser-bays'
const PANE = 'browser-bays'

const assigned = atom({ plugin: 'browser-bays', key: 'assigned' } as const, null, { shape: 'assigned-1' })
const rows = atom({ plugin: 'browser-bays', key: 'rows' } as const, [])
const note = atom({ plugin: 'browser-bays', key: 'note' } as const, null)
const brief = atom({ plugin: 'browser-bays', key: 'brief' } as const, {})
const briefSent = atom({ plugin: 'browser-bays', key: 'briefSent' } as const, null)
const retired = atom({ plugin: 'browser-bays', key: 'retired' } as const, [])

const DEFAULT_BAYS: Bay[] = [
  { id: 'bay-1', name: 'red', color: '#E5484D', emoji: '🔴', headless: false },
  { id: 'bay-2', name: 'blue', color: '#0090FF', emoji: '🔵', headless: false },
  { id: 'bay-3', name: 'green', color: '#30A46C', emoji: '🟢', headless: false },
  { id: 'bay-4', name: 'amber', color: '#FFB224', emoji: '🟠', headless: false },
]

// Mirrors bin/prepare.mjs, which launches the driver.
const DEFAULT_DRIVERS: Record<string, Driver> = {
  'chrome-devtools': { label: 'Chrome (chrome-devtools-mcp)', command: 'npx', process: '--user-data-dir={profile}' },
  'firefox-devtools': { label: 'Firefox (firefox-devtools-mcp)', command: 'npx', process: '{profile}' },
}

type Config = {
  bays: Bay[]
  holdServers: string[]
  autoAssign: boolean
  drivers: Record<string, Driver>
  /** Minutes without a browser call before the bay's browser is closed; 0 keeps it open. */
  idleMinutes: number
}

let homeDir: string | null = null

// When this session last used its bay's browser (a reload starts it afresh).
let lastUse = 0

// Closes the bay's browser after idleMinutes without a browser call, so an idle
// bay holds no memory. The driver relaunches it, login kept, on the next call.
async function idleCheck($: Dollar) {
  const mine = await read($, assigned)
  if (!mine) return
  const { idleMinutes } = await config($)
  if (!idleMinutes || idleMinutes <= 0) return
  if ((await $.clock.now()) - lastUse < idleMinutes * 60_000) return
  const pid = await chromePid($, mine)
  if (!pid) return
  await $.process.run(['kill', pid])
  $.ui.toast(`Bay ${mine.name}: browser closed after ${idleMinutes} idle minutes; it reopens on the next browser call.`)
}

async function home($: Dollar): Promise<string> {
  if (homeDir) return homeDir
  const { stdout } = await $.process.run(['printenv', 'BROWSER_BAYS_HOME'])
  if (stdout.trim()) return (homeDir = stdout.trim())
  const h = await $.process.run(['printenv', 'HOME'])
  return (homeDir = `${h.stdout.trim()}/.browser-bays`)
}

async function config($: Dollar): Promise<Config> {
  try {
    const raw = await $.fs.read(`${await home($)}/config.json`)
    const parsed = JSON.parse(typeof raw === 'string' ? raw : String((raw as { text?: string }).text ?? '{}'))
    return {
      bays: Array.isArray(parsed.bays) && parsed.bays.length ? parsed.bays : DEFAULT_BAYS,
      holdServers: Array.isArray(parsed.holdServers) ? parsed.holdServers : [],
      autoAssign: parsed.autoAssign !== false,
      drivers: { ...DEFAULT_DRIVERS, ...(parsed.drivers ?? {}) },
      idleMinutes: typeof parsed.idleMinutes === 'number' ? parsed.idleMinutes : 10,
    }
  } catch {
    return { bays: DEFAULT_BAYS, holdServers: [], autoAssign: true, drivers: DEFAULT_DRIVERS, idleMinutes: 10 }
  }
}

async function holderPid($: Dollar, bay: Bay): Promise<string | undefined> {
  try {
    const raw = await $.fs.read(`${await home($)}/run/${bay.id}.pid`)
    const pid = (typeof raw === 'string' ? raw : String((raw as { text?: string }).text ?? '')).trim()
    if (!/^\d+$/.test(pid)) return undefined
    const { exitCode } = await $.process.run(['kill', '-0', pid])
    return exitCode === 0 ? pid : undefined
  } catch {
    return undefined
  }
}

function driverOf(bay: Bay): string {
  return bay.driver ?? 'chrome-devtools'
}

async function profileOf($: Dollar, bay: Bay): Promise<string> {
  const d = driverOf(bay)
  return d === 'chrome-devtools' ? `${await home($)}/profiles/${bay.id}` : `${await home($)}/profiles/${bay.id}-${d}`
}

// The browser's main process for a bay (Chrome helpers carry --type=; the
// driver's own server process is left out).
async function chromePid($: Dollar, bay: Bay): Promise<string | undefined> {
  const { drivers } = await config($)
  const profile = await profileOf($, bay)
  const needle = (drivers[driverOf(bay)]?.process ?? '{profile}').replaceAll('{profile}', profile)
  const { stdout } = await $.process.run(['ps', '-axo', 'pid=,command='])
  const line = stdout
    .split('\n')
    .find(l => l.includes(needle) && !l.includes('--type=') && !l.includes('mcp'))
  return line?.trim().split(/\s+/)[0]
}

async function refreshRows($: Dollar) {
  const { bays } = await config($)
  const mine = await read($, assigned)
  const settings = await loadSettings($, await settingsPath($))
  const list: BayRow[] = []
  for (const bay of bays) {
    const pid = await holderPid($, bay)
    const state = mine?.id === bay.id ? 'mine' : pid ? 'taken' : 'free'
    list.push({
      ...bay,
      state,
      brief: state === 'taken' ? await sharedBrief($, bay) : undefined,
      holderPid: pid,
      isChromeRunning: Boolean(await chromePid($, bay)),
      ruleState: bayRuleState(settings, bay),
    })
  }
  await update($, rows, () => list)
}

// The band above the prompt shows the bay; the status line stays free.
async function showStatus($: Dollar) {
  $.ui.status(undefined)
  $.ui.invalidate('ui.render')
}

async function take($: Dollar, bay: Bay): Promise<string | null> {
  if (await holderPid($, bay)) return `bay ${bay.name} is held by another session`
  // The launcher only claims a bay this mod asked for: a dial nobody asked for
  // (a plugin reload) finds no fresh .want file and exits without claiming.
  const run = `${await home($)}/run`
  await $.process.run(['mkdir', '-p', run])
  await $.fs.write(`${run}/${bay.id}.want`, String(Date.now()))
  const res = await $.mcp.connect(bay.id)
  if (!res.isConnected) return `bay ${bay.name}: ${res.message}`
  const old = await read($, assigned)
  await update($, assigned, () => ({ ...bay, server: res.server }))
  await update($, retired, list => list.filter(id => id !== bay.id))
  await update($, briefSent, () => null)
  if (old && old.id !== bay.id) await release($, old)
  await writeSharedBrief($)
  return null
}

// Gives a bay back: hides its tools from this session and stops its server
// (by the PID its launcher recorded), which closes its Chrome.
async function release($: Dollar, bay: Bay) {
  await update($, retired, list => (list.includes(bay.id) ? list : [...list, bay.id]))
  $.ui.invalidate('tool.list')
  const pid = await holderPid($, bay)
  if (pid) await $.process.run(['kill', pid])
}

async function rawConfig($: Dollar): Promise<Record<string, unknown>> {
  try {
    const raw = await $.fs.read(`${await home($)}/config.json`)
    return JSON.parse(typeof raw === 'string' ? raw : '{}')
  } catch {
    return {}
  }
}

// Writes fields of one bay into config.json (its persistent defaults).
async function saveBay($: Dollar, id: string, patch: Partial<Bay>) {
  const conf = await rawConfig($)
  const bays: Bay[] = Array.isArray(conf.bays) && conf.bays.length ? (conf.bays as Bay[]) : DEFAULT_BAYS
  conf.bays = bays.map(b => (b.id === id ? { ...b, ...patch } : b))
  await $.process.run(['mkdir', '-p', await home($)])
  await $.fs.write(`${await home($)}/config.json`, JSON.stringify(conf, null, 2) + '\n')
  const mine = await read($, assigned)
  if (mine?.id === id) await update($, assigned, a => (a ? { ...a, ...patch } : a))
}

// The session's description of its bay, shared with other sessions through
// run/<bay>.brief.json so /bays everywhere shows what each bay is used for.
async function setBrief($: Dollar, patch: Brief) {
  const next_ = { ...(await read($, brief)) }
  for (const [k, v] of Object.entries(patch) as [keyof Brief, string | undefined][]) {
    if (v === undefined) continue
    if (v === '') delete next_[k]
    else next_[k] = v
  }
  await update($, brief, () => next_)
  await update($, briefSent, () => null)
  await writeSharedBrief($)
}

async function writeSharedBrief($: Dollar) {
  const mine = await effective($)
  if (!mine) return
  const run = `${await home($)}/run`
  await $.process.run(['mkdir', '-p', run])
  const { app, url, port, notes } = mine
  await $.fs.write(`${run}/${mine.id}.brief.json`, JSON.stringify({ app, url, port, notes }))
}

async function sharedBrief($: Dollar, bay: Bay): Promise<Brief | undefined> {
  try {
    const raw = await $.fs.read(`${await home($)}/run/${bay.id}.brief.json`)
    return JSON.parse(typeof raw === 'string' ? raw : '{}')
  } catch {
    return undefined
  }
}

function summary(b: Brief): string {
  return [b.app, b.url, b.port ? `port ${b.port}` : undefined].filter(Boolean).join(' · ')
}

// What this session's browser is for: the session's brief over the bay's own.
async function effective($: Dollar): Promise<(Assigned & Brief) | null> {
  const mine = await read($, assigned)
  if (!mine) return null
  const b = await read($, brief)
  return { ...mine, app: b.app ?? mine.app, url: b.url ?? mine.url, port: b.port ?? mine.port, notes: b.notes ?? mine.notes }
}

function toolPrefix(server: string) {
  return `mcp__${server.replace(/[^A-Za-z0-9_-]/g, '_')}__`
}

// Auto mode: settings allow rules resolve before the classifier, and subagents
// are judged against the main session's rules, so a bay whose edits should run
// unattended needs one rule in the user's settings. The plugin never adds it on
// its own: only the Allow button in /bays (a person's click) writes it.
function allowRule(bay: Bay): string {
  return `${toolPrefix(`plugin:${PLUGIN}:${bay.id}`)}*`
}

async function settingsPath($: Dollar): Promise<string> {
  const { stdout } = await $.process.run(['printenv', 'CLAUDE_CONFIG_DIR'])
  if (stdout.trim()) return `${stdout.trim()}/settings.json`
  const h = await $.process.run(['printenv', 'HOME'])
  return `${h.stdout.trim()}/.claude/settings.json`
}

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

// The user's settings as an object, {} when the file does not exist, or null
// when it exists but cannot be read or is not a settings object. Writers must
// stop on null: writing then would replace the user's file.
async function loadSettings($: Dollar, path: string): Promise<Json | null> {
  const probe = await $.process.run(['sh', '-c', 'test -e "$1" && echo yes', 'sh', path])
  if (probe.stdout.trim() !== 'yes') return {}
  try {
    const raw = await $.fs.read(path)
    if (typeof raw !== 'string') return null
    const parsed: unknown = JSON.parse(raw)
    if (!isObject(parsed)) return null
    if (parsed.permissions !== undefined && !isObject(parsed.permissions)) return null
    return parsed
  } catch {
    return null
  }
}

function rules(settings: Json | null, list: 'allow' | 'ask' | 'deny'): string[] {
  const perms = settings && isObject(settings.permissions) ? settings.permissions : {}
  const v = perms[list]
  return Array.isArray(v) ? v.filter((r): r is string => typeof r === 'string') : []
}

// What the user settings file says about a bay's tools. Project, local and
// managed settings are not read, so this speaks for the user file only.
function bayRuleState(settings: Json | null, bay: Bay): RuleState {
  if (!settings) return 'unreadable'
  const rule = allowRule(bay)
  const server = rule.replace(/__\*$/, '')
  const hits = (r: string) => r === rule || r === server || r === 'mcp__*' || r.startsWith(`${server}__`)
  if (rules(settings, 'deny').some(hits) || rules(settings, 'ask').some(hits)) return 'held'
  return rules(settings, 'allow').some(r => r === rule || r === server) ? 'allowed' : 'none'
}

async function allowBay($: Dollar, bay: Bay): Promise<string> {
  const path = await settingsPath($)
  const rule = allowRule(bay)
  const settings = await loadSettings($, path)
  const state = bayRuleState(settings, bay)
  if (!settings || state === 'unreadable') return `Could not read ${path} as settings, so it was left alone. Add "${rule}" to permissions.allow yourself (/permissions).`
  if (state === 'allowed') return `Bay ${bay.name} is already allowed in ${path}.`
  if (state === 'held') return `A deny or ask rule in ${path} covers bay ${bay.name}; an allow rule would not change that. Edit it yourself if you want the bay allowed.`
  const permissions = isObject(settings.permissions) ? settings.permissions : {}
  const next = { ...settings, permissions: { ...permissions, allow: [...rules(settings, 'allow'), rule] } }
  try {
    await $.fs.write(path, JSON.stringify(next, null, 2) + '\n')
  } catch {
    return `Could not write ${path}. Add "${rule}" to permissions.allow yourself (/permissions).`
  }
  return `Added "${rule}" to ${path}. Sessions and their subagents now drive bay ${bay.name} without auto-mode review.`
}

const RULE_WORDS: Record<RuleState, string> = {
  allowed: 'allowed',
  none: 'no rule',
  held: 'deny/ask rule',
  unreadable: 'unreadable',
}

async function allowText($: Dollar): Promise<string> {
  const { bays } = await config($)
  const path = await settingsPath($)
  const settings = await loadSettings($, path)
  const out = [`Under auto mode, clicks and key presses in a bay need an allow rule. Your user settings (${path}):`]
  for (const bay of bays) out.push(`  ${bay.emoji} ${bay.name.padEnd(6)} ${RULE_WORDS[bayRuleState(settings, bay)].padEnd(13)} ${allowRule(bay)}`)
  out.push('Press Allow on a bay in /bays to add its rule, or add it with /permissions. Bays are shared: a rule covers every session that takes that bay. Rules in project or managed settings are not shown here.')
  return out.join('\n')
}

function describe(bay: Assigned & Brief): string {
  const lines = [
    `Browser bay: this session's controlled browser is bay "${bay.name}" ${bay.emoji}, driver ${driverOf(bay)}, ${bay.headless ? 'headless (no window)' : 'visible'}.`,
    `Use only its tools (${toolPrefix(bay.server)}*); its profile persists, so logins stay.`,
  ]
  if (bay.app) lines.push(`App under test: ${bay.app}.`)
  if (bay.url) lines.push(`Target URL: ${bay.url} (navigate there for UI checks unless told otherwise).`)
  if (bay.port) lines.push(`Dev server port reserved for this bay: ${bay.port}.`)
  if (bay.notes) lines.push(`Notes: ${bay.notes}`)
  lines.push('Record what you use the bay for (app, url, port, notes) with the browser-bays bay_describe tool; bay_info shows every bay and the ports other sessions use.')
  return lines.join('\n')
}

async function assignFirstFree($: Dollar) {
  const { bays } = await config($)
  for (const bay of bays) {
    const why = await take($, bay)
    if (!why) return null
  }
  return 'every bay is held by another session'
}

async function focus($: Dollar): Promise<string> {
  lastUse = await $.clock.now()
  const mine = await read($, assigned)
  if (!mine) return 'This session has no bay.'
  if (mine.headless) return `Bay ${mine.name} is headless: there is no window to show.`
  let pid = await chromePid($, mine)
  // On macOS closing the last window leaves Chrome running with no window.
  const windows = pid
    ? await $.process.run([
        'osascript',
        '-e',
        `tell application "System Events" to count windows of (first process whose unix id is ${pid})`,
      ])
    : null
  const hasWindow = windows ? windows.exitCode !== 0 || Number(windows.stdout.trim()) > 0 : false
  if (!pid || !hasWindow) {
    // Closed or never opened: any browser call makes chrome-devtools-mcp
    // launch it again; open the bay's target URL (or a blank page).
    const bay = await effective($)
    try {
      await $.mcp.call(mine.server, 'new_page', { url: bay?.url ?? 'about:blank' })
    } catch {
      return `Could not reopen bay ${mine.name}.`
    }
    pid = await chromePid($, mine)
    if (!pid) return `Bay ${mine.name} reopened.`
  }
  const script = `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`
  const { exitCode } = await $.process.run(['osascript', '-e', script])
  if (exitCode === 0) return `Bay ${mine.name} brought to the front.`
  // Fallback: ask the browser itself to raise its first page.
  try {
    const pages = await $.mcp.call(mine.server, 'list_pages')
    const text = pages.content.map(c => c.text ?? '').join('\n')
    const id = Number(/^\s*(\d+):/m.exec(text)?.[1] ?? 1)
    await $.mcp.call(mine.server, 'select_page', { pageId: id, bringToFront: true })
    return `Bay ${mine.name} brought to the front.`
  } catch {
    return `Could not bring bay ${mine.name} to the front.`
  }
}


async function infoText($: Dollar): Promise<string> {
  await refreshRows($)
  const bay = await effective($)
  const list = await read($, rows)
  const out = [
    bay
      ? `This session: bay ${bay.name} (${driverOf(bay)}, ${bay.headless ? 'headless' : 'visible'}) · app: ${bay.app ?? '—'} · url: ${bay.url ?? '—'} · port: ${bay.port ?? '—'} · notes: ${bay.notes ?? '—'}`
      : 'This session has no bay.',
    'All bays:',
  ]
  for (const r of list) {
    const b = r.state === 'mine' && bay ? bay : r.state === 'taken' ? r.brief ?? {} : r
    out.push(`- ${r.name}: ${r.state === 'mine' ? 'this session' : r.state === 'taken' ? 'another session' : 'free'}${summary(b) ? ` · ${summary(b)}` : ''}`)
  }
  const ports = list
    .filter(r => r.state === 'taken')
    .map(r => r.brief?.port)
    .filter(Boolean)
  out.push(ports.length ? `Ports used by other sessions' bays: ${ports.join(', ')}.` : 'No ports recorded by other sessions.')
  return out.join('\n')
}

async function openPane($: Dollar) {
  await refreshRows($)
  await $.ui.open({ id: PANE, title: 'Browser bays' })
}

export const register: Register = on => {
  const isOurs = (server: string) => server.startsWith(`plugin:${PLUGIN}:`)

  on('mcp.connect', async ($, e, next) => {
    if (next.origin.plugin === PLUGIN) return next(e)
    const { holdServers } = await config($)
    if (isOurs(e.server) || holdServers.includes(e.server)) {
      return {
        value: {
          isConnected: false as const,
          reason: 'disabled' as const,
          message: `held by ${PLUGIN}: this session uses its assigned bay`,
        },
      }
    }
    return next(e)
  })

  // A bay given back stays connected until the session ends; hide its tools.
  on('tool.list', async ($, e, next) => {
    const result = await next(e)
    const gone = await read($, retired)
    if (!gone.length || !result.value) return result
    const prefixes = gone.map(id => toolPrefix(`plugin:${PLUGIN}:${id}`))
    return { value: result.value.filter(t => !prefixes.some(p => t.name.startsWith(p))) }
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'bays', description: 'Show the browser bays and which session holds each' })
    await $.command.register({
      name: 'bay',
      description: 'This session’s browser bay: /bay, /bay <name>, /bay focus, /bay allow, /bay driver <name>, /bay headless on|off, /bay app|url|port|notes <text>, /bay save',
    })
    await $.tool.register({
      name: 'bay_info',
      description:
        "Show this session's browser bay (driver, visible/headless, app, url, port, notes) and every other bay with what its session uses it for, including the dev-server ports other sessions have taken. Call before starting a dev server or a UI check.",
      inputSchema: { type: 'object', properties: {} },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'bay_describe',
      description:
        "Record what this session uses its browser bay for, so the person and other sessions see it: the app under test, the URL the browser should use, the dev-server port this session took, and free notes. Only the fields given change; an empty string clears one.",
      inputSchema: {
        type: 'object',
        properties: {
          app: { type: 'string', description: 'App under test, e.g. "Projects"' },
          url: { type: 'string', description: 'URL the bay browser targets, e.g. "http://localhost:3001"' },
          port: { type: 'string', description: 'Dev-server port this session uses, e.g. "3001"' },
          notes: { type: 'string', description: 'Anything else: test project, account, branch' },
        },
      },
      isDeferred: false,
    })
    const result = await next(e)
    lastUse = await $.clock.now()
    $.clock.every(60_000, () => {
      void idleCheck($)
    })
    if (!(await read($, assigned))) {
      const { autoAssign } = await config($)
      if (autoAssign && e.isInteractive) {
        const why = await assignFirstFree($)
        await update($, note, () => why)
        if (why) $.ui.toast(`browser-bays: ${why}`)
      }
    }
    await showStatus($)
    return result
  })

  // Tells the model which browser is its own and what it is for, with the
  // first prompt and again whenever that changes.
  on('prompt.submit', async ($, e, next) => {
    const bay = await effective($)
    if (!bay) return next(e)
    const text = describe(bay)
    if (text === (await read($, briefSent))) return next(e)
    await update($, briefSent, () => text)
    return next({ ...e, context: [...(e.context ?? []), text] })
  })

  on('tool.call', { tool: /^mcp__plugin_browser-bays_/ }, async ($, e, next) => {
    lastUse = await $.clock.now()
    const ran = await next(e)
    lastUse = await $.clock.now()
    return ran
  })

  on('tool.run', { tool: 'mcp__browser-bays__bay_info' }, async $ => {
    const text = await infoText($)
    return { result: text, text }
  })

  on('tool.run', { tool: 'mcp__browser-bays__bay_describe' }, async ($, e) => {
    const input = e as unknown as Brief
    if (!(await read($, assigned))) return { deny: 'This session has no bay. Ask the person to take one with /bay <name>.' }
    await setBrief($, { app: input.app, url: input.url, port: input.port, notes: input.notes })
    await showStatus($)
    const text = await infoText($)
    return { result: text, text }
  })

  on('command.run', { command: 'bays' }, async $ => {
    await openPane($)
    return { text: 'Browser bays pane opened.' }
  })

  on('command.run', { command: 'bay' }, async ($, e) => {
    const raw = e.args.trim()
    const [verb = '', ...restWords] = raw.split(/\s+/)
    const rest = raw.slice(verb.length).trim()
    const mine = await read($, assigned)

    if (!verb) {
      const bay = await effective($)
      if (!bay) return { text: 'This session has no bay. Take one with /bay <name> (see /bays).' }
      return {
        text: [
          `${bay.emoji} bay ${bay.name} · ${driverOf(bay)} · ${bay.headless ? 'headless' : 'visible'}`,
          `app: ${bay.app ?? '—'}`,
          `url: ${bay.url ?? '—'}`,
          `port: ${bay.port ?? '—'}`,
          `notes: ${bay.notes ?? '—'}`,
        ].join('\n'),
      }
    }
    if (verb === 'focus') return { text: await focus($) }

    if (verb === 'allow') {
      await openPane($)
      return { text: await allowText($) }
    }

    if (verb === 'headless') {
      if (!mine) return { text: 'This session has no bay.' }
      const on_ = restWords[0] === 'on' ? true : restWords[0] === 'off' ? false : !mine.headless
      await saveBay($, mine.id, { headless: on_ })
      await showStatus($)
      await update($, briefSent, () => null)
      return { text: `Bay ${mine.name} set to ${on_ ? 'headless' : 'visible'}. It applies the next time the bay starts (a new session, or /bay ${mine.name} from another one).` }
    }

    if (verb === 'driver') {
      const { drivers } = await config($)
      const names = Object.keys(drivers)
      if (!mine) return { text: 'This session has no bay.' }
      if (!restWords[0]) {
        return { text: `Bay ${mine.name} runs ${driverOf(mine)}. Drivers: ${names.map(n => `${n}${drivers[n]?.label ? ` (${drivers[n]?.label})` : ''}`).join(', ')}.` }
      }
      if (!drivers[restWords[0]]) return { text: `No driver "${restWords[0]}". Drivers: ${names.join(', ')} (add more under "drivers" in config.json).` }
      await saveBay($, mine.id, { driver: restWords[0] })
      await update($, briefSent, () => null)
      await showStatus($)
      return { text: `Bay ${mine.name} will run ${restWords[0]} the next time it starts (a new session, or taking it again from another session).` }
    }

    if (verb === 'app' || verb === 'url' || verb === 'notes' || verb === 'port') {
      if (!mine) return { text: 'This session has no bay.' }
      await setBrief($, { [verb]: rest })
      return { text: rest ? `This session's ${verb}: ${rest}` : `Cleared this session's ${verb}.` }
    }

    if (verb === 'save') {
      if (!mine) return { text: 'This session has no bay.' }
      const b = await read($, brief)
      await saveBay($, mine.id, b)
      await update($, brief, () => ({}))
      await writeSharedBrief($)
      return { text: `Saved as bay ${mine.name}'s defaults.` }
    }

    const { bays } = await config($)
    const bay = bays.find(b => b.name.toLowerCase() === verb.toLowerCase() || b.id === verb)
    if (!bay) return { text: `No bay "${verb}". Bays: ${bays.map(b => b.name).join(', ')}.` }
    if (mine?.id === bay.id) return { text: `This session already holds bay ${bay.name}.` }
    const why = await take($, bay)
    await showStatus($)
    await refreshRows($)
    return { text: why ?? `Now on bay ${bay.name} ${bay.emoji}${mine ? ` (bay ${mine.name} released)` : ''}.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const bay = await effective($)
    const { Box, Button, Text } = $.ui.resolve(e)
    if (!bay) {
      const why = await read($, note)
      return (
        <Box>
          <Text dimColor>◌ no browser bay{why ? ` (${why})` : ''} </Text>
          <Button key="bays" label="Bays" onPress={() => openPane($)} />
        </Box>
      )
    }
    const what = [bay.app, bay.url, bay.port ? `:${bay.port}` : undefined].filter(Boolean).join(' → ')
    return (
      <Box>
        <Text color={bay.color} bold>● bay {bay.name}</Text>
        <Text dimColor> · {driverOf(bay).replace(/-devtools$/, '')} · {bay.headless ? 'headless' : 'visible'}{what ? ` · ${what}` : ''} </Text>
        {!bay.headless && <Button key="focus" label="Focus" onPress={async () => { $.ui.toast(await focus($)) }} />}
        <Button key="bays" label="Bays" onPress={() => openPane($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, rows)
    const b = await read($, brief)
    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No bays configured.</Text>}
        {list.map(row => {
          const src: Brief = row.state === 'mine' ? { ...row, ...b } : row.state === 'taken' ? row.brief ?? {} : row
          const { app, url, port, notes } = src
          return (
            <Box key={row.id} flexDirection="column">
              <Box>
                <Text color={row.color} bold>● {row.name.padEnd(6)}</Text>
                <Text dimColor={row.state !== 'mine'}>
                  {' '}
                  {row.state === 'mine' ? 'this session' : row.state === 'taken' ? `held (pid ${row.holderPid})` : 'free'}
                  {' · '}
                  {driverOf(row)}
                  {' · '}
                  {row.headless ? 'headless' : 'visible'}
                  {row.isChromeRunning ? ' · browser open' : ''}{' '}
                </Text>
                {row.state === 'mine' && !row.headless && (
                  <Button key={`focus-${row.id}`} label="Focus" onPress={async () => { $.ui.toast(await focus($)) }} />
                )}
                {row.state === 'free' && (
                  <Button
                    key={`take-${row.id}`}
                    label="Take"
                    onPress={async () => {
                      const why = await take($, row)
                      await showStatus($)
                      await refreshRows($)
                      $.ui.toast(why ?? `Now on bay ${row.name}`)
                    }}
                  />
                )}
              </Box>
              {row.ruleState === 'none' && (
                <Box>
                  <Text dimColor>   edits ask under auto mode </Text>
                  <Button
                    key={`allow-${row.id}`}
                    label="Allow"
                    onPress={async () => {
                      $.ui.toast(await allowBay($, row))
                      await refreshRows($)
                    }}
                  />
                </Box>
              )}
              {row.ruleState === 'held' && <Text dimColor>   a deny or ask rule in your user settings keeps edits reviewed</Text>}
              <Text dimColor>   app: {app ?? '—'} · url: {url ?? '—'}{port ? ` · port ${port}` : ''}{notes ? ` · ${notes}` : ''}</Text>
            </Box>
          )
        })}
        <Button key="refresh" label="Refresh" onPress={() => refreshRows($)} />
      </Box>
    )
  })
}
