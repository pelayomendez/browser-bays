import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'browser-bays',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 3,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 3 },
    view: {},
  },
} as const

test('a session without a bay says so above the prompt, on every surface', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /no browser bay/ }))?.text).toContain('no browser bay')
    await ui.unmount()
  }
})

test('a session with a bay shows it, its mode and what it is for', async ($, on) => {
  on('state.get', (_, e) => {
    return (
    e.key === 'assigned'
      ? {
          value: {
            value: {
              shape: 'assigned-1',
              value: {
              id: 'bay-2', name: 'blue', color: '#0090FF', emoji: '🔵', headless: false,
              driver: 'chrome-devtools', url: 'http://localhost:3002', server: 'plugin:browser-bays:bay-2',
              },
            },
            version: 1,
          },
        }
      : { value: { version: 0 } }
    ) as never
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /bay blue/ }))?.text).toContain('bay blue')
  expect((await ui.find({ type: 'Text', text: /visible/ }))?.text).toContain('localhost:3002')
  expect(await ui.find({ type: 'Button', key: 'focus' })).toBeDefined()
  await ui.unmount()
})

test('the bays pane offers Allow only on bays auto mode would still review', async ($, on) => {
  const row = { color: '#0090FF', emoji: '🔵', headless: false, driver: 'chrome-devtools', isChromeRunning: false }
  on('state.get', (_, e) => {
    return (
      e.key === 'rows'
        ? {
            value: {
              value: [
                { ...row, id: 'bay-1', name: 'red', state: 'free', ruleState: 'allowed' },
                { ...row, id: 'bay-2', name: 'blue', state: 'free', ruleState: 'none' },
              ],
              version: 1,
            },
          }
        : { value: { version: 0 } }
    ) as never
  })

  const ui = await $.ui.mount({
    plugin: 'browser-bays',
    component: 'Pane',
    requestId: 'browser-bays',
    surface: 'terminal',
    props: { bodyColumns: 120, view: {} },
  } as never)
  expect(await ui.find({ type: 'Button', key: 'allow-bay-2' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'allow-bay-1' })).toBeUndefined()
  await ui.unmount()
})

test('a pane row whose bay a deny or ask rule covers says so and offers no Allow', async ($, on) => {
  on('state.get', (_, e) => {
    return (
      e.key === 'rows'
        ? {
            value: {
              value: [{ id: 'bay-2', name: 'blue', color: '#0090FF', emoji: '🔵', headless: false, state: 'free', isChromeRunning: false, ruleState: 'held' }],
              version: 1,
            },
          }
        : { value: { version: 0 } }
    ) as never
  })
  const ui = await $.ui.mount({ plugin: 'browser-bays', component: 'Pane', requestId: 'browser-bays', surface: 'terminal', props: { bodyColumns: 120, view: {} } } as never)
  expect(await ui.find({ type: 'Button', key: 'allow-bay-2' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /deny or ask rule/ }))?.text).toContain('deny or ask rule')
  await ui.unmount()
})

for (const [label, body, probe] of [['invalid JSON', '{ "hooks": ', 'yes'], ['null', 'null', 'yes'], ['an array', '[]', 'yes'], ['string permissions', '{"permissions":"x"}', 'yes'], ['an existence check that answered nothing', '{}', '']] as const) {
  test(`Allow leaves a settings file holding ${label} untouched`, async ($, on) => {
    const writes: string[] = []
    let stub = true
    on('state.get', (_, e, next) => {
      if (!stub) return next(e)
      return (
        e.key === 'rows'
          ? { value: { value: [{ id: 'bay-2', name: 'blue', color: '#0090FF', emoji: '🔵', headless: false, state: 'free', isChromeRunning: false, ruleState: 'none' }], version: 1 } }
          : { value: { version: 0 } }
      ) as never
    })
    on('ui.toast', () => ({ value: undefined }) as never)
        on('process.run', (_, e) => {
      const argv = (e as { argv?: string[]; command?: string[] }).argv ?? (e as { command?: string[] }).command ?? []
      const out = argv[0] === 'printenv' ? (argv[1] === 'HOME' ? '/home/t\n' : '') : argv[0] === 'sh' ? `${probe}\n` : ''
      return { value: { stdout: out, stderr: '', code: 0 } } as never
    })
    on('fs.read', () => ({ value: body }) as never)
    on('fs.write', (_, e) => {
      writes.push(String((e as { path?: string }).path))
      return { value: undefined } as never
    })
    const ui = await $.ui.mount({ plugin: 'browser-bays', component: 'Pane', requestId: 'browser-bays', surface: 'terminal', props: { bodyColumns: 120, view: {} } } as never)
    const allow = await ui.find({ type: 'Button', key: 'allow-bay-2' })
    expect(allow).toBeDefined()
    stub = false
  await (ui as unknown as { press: (q: unknown) => Promise<void> }).press({ type: "Button", key: "allow-bay-2" })
    expect(writes.filter(p => p.endsWith('settings.json'))).toEqual([])
    await ui.unmount()
  })
}

test('Allow adds the bay rule and keeps the rest of the settings file', async ($, on) => {
  const writes: { path: string; text: string }[] = []
  let stub = true
  on('state.get', (_, e, next) => {
      if (!stub) return next(e)
    return (
      e.key === 'rows'
        ? { value: { value: [{ id: 'bay-2', name: 'blue', color: '#0090FF', emoji: '🔵', headless: false, state: 'free', isChromeRunning: false, ruleState: 'none' }], version: 1 } }
        : { value: { version: 0 } }
    ) as never
  })
  on('process.run', (_, e) => {
    const argv = (e as { argv?: string[]; command?: string[] }).argv ?? (e as { command?: string[] }).command ?? []
    const out = argv[0] === 'printenv' ? (argv[1] === 'HOME' ? '/home/t\n' : '') : argv[0] === 'sh' ? 'yes\n' : ''
    return { value: { stdout: out, stderr: '', code: 0 } } as never
  })
  on('fs.read', () => ({ value: '{"env":{"A":"1"},"permissions":{"allow":["Bash(ls)"]}}' }) as never)
  on('fs.write', (_, e) => {
    const w = e as { path?: string; content?: string; data?: string; text?: string }
    writes.push({ path: String(w.path), text: String(w.content ?? w.data ?? w.text) })
    return { value: undefined } as never
  })
  const ui = await $.ui.mount({ plugin: 'browser-bays', component: 'Pane', requestId: 'browser-bays', surface: 'terminal', props: { bodyColumns: 120, view: {} } } as never)
  stub = false
  await (ui as unknown as { press: (q: unknown) => Promise<void> }).press({ type: 'Button', key: 'allow-bay-2' })
  const settings = writes.find(w => w.path.endsWith('settings.json'))
  expect(settings?.path).toBe('/home/t/.claude/settings.json')
  expect(JSON.parse(settings?.text ?? '{}')).toEqual({
    env: { A: '1' },
    permissions: { allow: ['Bash(ls)', 'mcp__plugin_browser-bays_bay-2__*'] },
  })
  await ui.unmount()
})
