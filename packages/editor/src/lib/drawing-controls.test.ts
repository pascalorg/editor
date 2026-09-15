import { describe, expect, test } from 'bun:test'
import { registerDrawingControls, runDrawingControl } from './drawing-controls'

describe('drawing controls', () => {
  test.each([
    '2d',
    '3d',
    'split',
  ] as const)('polygon finish creates once and clears the sibling in %s', (view) => {
    const calls: string[] = []
    const cleanup = (['2d', '3d'] as const).map((surface) =>
      registerDrawingControls('slab', surface, {
        finish: () => {
          calls.push(`commit ${surface}`)
          return true
        },
        back: () => calls.push(`back ${surface}`),
        afterFinish: () => calls.push(`clear ${surface}`),
      }),
    )
    try {
      expect(runDrawingControl('slab', 'finish', view)).toBe(true)
      expect(calls).toEqual(view === '2d' ? ['commit 2d', 'clear 3d'] : ['commit 3d', 'clear 2d'])
      calls.length = 0
      runDrawingControl('slab', 'back', view)
      expect(calls).toEqual(['back 2d', 'back 3d'])
    } finally {
      for (const off of cleanup) off()
    }
  })

  test.each([
    'fence',
    'roof',
    'zone',
  ] as const)('%s respects its creation owner in every view', (tool) => {
    const calls: string[] = []
    const cleanup = (['2d', '3d'] as const).map((view) =>
      registerDrawingControls(tool, view, {
        finish: () => {
          calls.push(view)
          return true
        },
        back: () => {},
      }),
    )
    try {
      for (const view of ['2d', '3d', 'split'] as const) runDrawingControl(tool, 'finish', view)
      expect(calls).toEqual(Array(3).fill(tool === 'zone' ? '2d' : '3d'))
    } finally {
      for (const off of cleanup) off()
    }
  })

  test('invalid drafts stay intact and an absent owner never falls back to duplicate creation', () => {
    const calls: string[] = []
    const off2d = registerDrawingControls('ceiling', '2d', {
      finish: () => {
        calls.push('commit')
        return true
      },
      back: () => {},
      afterFinish: () => calls.push('clear'),
    })
    const off3d = registerDrawingControls('ceiling', '3d', { finish: () => false, back: () => {} })
    try {
      expect(runDrawingControl('ceiling', 'finish', 'split')).toBe(false)
      off3d()
      expect(runDrawingControl('ceiling', 'finish', '3d')).toBe(false)
      expect(calls).toEqual([])
    } finally {
      off2d()
      off3d()
    }
  })

  test('cleanup cannot remove a newer registration', () => {
    const calls: string[] = []
    const old = registerDrawingControls('wall', '3d', { back: () => calls.push('old') })
    const current = registerDrawingControls('wall', '3d', { back: () => calls.push('current') })
    old()
    runDrawingControl('wall', 'back', '3d')
    expect(calls).toEqual(['current'])
    current()
    expect(runDrawingControl('wall', 'back', '3d')).toBe(false)
  })
})
