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

export type BayRow = Bay & {
  state: 'mine' | 'taken' | 'free'
  holderPid?: string
  isChromeRunning: boolean
  /** The user's settings allow this bay's tools, so auto mode does not review them. */
  isAllowed: boolean
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
