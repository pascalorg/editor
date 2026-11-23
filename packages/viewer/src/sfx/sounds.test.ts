import { expect, test } from 'bun:test'
import { INTERACTION_SOUNDS, SOUNDS } from '@pascal-app/viewer/sfx'

test('every core interaction maps to a viewer cue with its intended gain', () => {
  expect(INTERACTION_SOUNDS).toEqual({
    'door-open': ['doorOpen', 1],
    'door-swing': ['doorSwing', 1],
    'door-close': ['doorClose', 1],
    'window-open': ['doorOpen', 0.6],
    'window-swing': ['doorSwing', 0.6],
    'window-close': ['doorClose', 0.6],
    garage: ['garageDoor', 1],
    'shutters-open': ['shuttersOpen', 1],
    'shutters-close': ['shuttersClose', 1],
    'panel-open': ['shuttersOpen', 0.75],
    'panel-swing': ['doorSwing', 0.45],
    'panel-close': ['shuttersClose', 0.75],
    'switch-on': ['switchOn', 1],
    'switch-off': ['switchOff', 1],
  })
  for (const [name] of Object.values(INTERACTION_SOUNDS)) expect(SOUNDS[name].src).toEndWith('.mp3')
})

test('a fresh import starts no audio, storage access or browser listeners', () => {
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      '--eval',
      `
      const { emitter } = await import('@pascal-app/core')
      const { Howler } = await import('howler')
      const before = emitter.all.get('interaction:sound')?.length ?? 0
      let browserWork = 0
      for (const name of ['localStorage', 'sessionStorage']) {
        Object.defineProperty(globalThis, name, {
          configurable: true,
          get() { browserWork++; throw new Error('storage touched during import') },
        })
      }
      globalThis.addEventListener = () => { browserWork++ }
      await import('@pascal-app/viewer/sfx')
      if (browserWork || Howler._howls.length || (emitter.all.get('interaction:sound')?.length ?? 0) !== before)
        throw new Error('SFX import performed browser or audio work')
    `,
    ],
    cwd: import.meta.dir,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect(result.stderr.toString()).toBe('')
  expect(result.exitCode).toBe(0)
})
