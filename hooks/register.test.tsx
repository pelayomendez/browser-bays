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
                { ...row, id: 'bay-1', name: 'red', state: 'free', isAllowed: true },
                { ...row, id: 'bay-2', name: 'blue', state: 'free', isAllowed: false },
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
