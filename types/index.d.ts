export type Bay = {
  id: string
  name: string
  color: string
  emoji: string
  headless: boolean
  /** Key of a driver in config.json: the MCP server that runs this bay's browser. */
  driver?: string
  /** What this bay is for: the app under test, its URL, free notes. */
  app?: string
  url?: string
  port?: string
  notes?: string
}

export type Driver = {
  label?: string
  command: string
  args?: string[]
  headlessArgs?: string[]
  theme?: string | null
  /** Text identifying the browser's main process; {profile} is filled in. */
  process?: string
}

export type Assigned = Bay & { server: string }

/** Per-session instructions; each field overrides the bay's own. */
export type Brief = { app?: string; url?: string; port?: string; notes?: string }

/** allowed: an allow rule skips auto-mode review; none: no rule; held: a deny or ask rule wins; unreadable: settings file could not be read. */
export type RuleState = 'allowed' | 'none' | 'held' | 'unreadable'

export type BayRow = Bay & {
  state: 'mine' | 'taken' | 'free'
  holderPid?: string
  isChromeRunning: boolean
  /** What the user settings file says about this bay's tools under auto mode. */
  ruleState: RuleState
  /** What the holding session says it uses the bay for. */
  brief?: Brief
}

declare module 'claude-code' {
  interface PluginState {
    'browser-bays': {
      assigned: Shaped<Assigned | null>
      brief: Brief
      briefSent: string | null
      retired: string[]
      rows: BayRow[]
      note: string | null
    }
  }
}
