import { describe, expect, test } from 'bun:test'
import { computeLevel } from './compute'
import { effectiveNodesFor, throttleTrailing } from './live'
import { baselineConfig, baselineScene } from './baseline-scene'

describe('live-drag reactivity (night-6): framing follows the gesture', () => {
  test('effectiveNodesFor folds overrides in; irrelevant/empty → null', () => {
    const nodes = { a: { id: 'a', type: 'wall', thickness: 0.15 } }
    expect(effectiveNodesFor(nodes, new Map())).toBeNull()
    expect(effectiveNodesFor(nodes, new Map([['ghost', { position: [1, 0, 0] }]]))).toBeNull()
    const out = effectiveNodesFor(nodes, new Map([['a', { thickness: 0.2 }]]))
    expect(out?.a?.thickness).toBe(0.2)
    expect(out?.a?.type).toBe('wall') // spread semantics — untouched fields stay
    expect(nodes.a.thickness).toBe(0.15) // input never mutated
  })

  test('a live window move re-derives the opening frame at the NEW spot', () => {
    // The whole point: kings/trimmers/header must follow the drag, not
    // wait for the drop. Simulate the host's transient override on the
    // baseline window and diff the header position.
    const scene = baselineScene()
    const winId = Object.keys(scene).find(
      (id) => (scene[id] as { type?: string }).type === 'window',
    ) as string
    expect(winId).toBeDefined()
    const cfg = baselineConfig('INTL')
    const committed = computeLevel(scene, cfg)
    const win = scene[winId] as { position?: [number, number, number] }
    const pos = (win.position ?? [0, 0, 0]) as [number, number, number]
    const effective = effectiveNodesFor(
      scene,
      new Map([[winId, { position: [pos[0] + 1, pos[1], pos[2]] }]]),
    )
    expect(effective).not.toBeNull()
    const live = computeLevel(effective as NonNullable<typeof effective>, cfg)
    const headerX = (r: typeof live) =>
      r.members.filter((m) => m.role === 'header').map((m) => m.position[0].toFixed(3))
    expect(headerX(live)).not.toEqual(headerX(committed))
    // and a fresh committed compute still yields the SAME output (the live
    // compute shares the config's memo slot, so this re-derives — equal
    // content is the contract, not reference identity)
    expect(computeLevel(scene, cfg).members).toEqual(committed.members)
  })

  test('throttleTrailing: leading call immediate, burst collapses, trailing always lands', async () => {
    let calls = 0
    const t = throttleTrailing(() => {
      calls++
    }, 30)
    t.run() // leading — immediate
    expect(calls).toBe(1)
    t.run()
    t.run()
    t.run() // burst — one trailing timer
    expect(calls).toBe(1)
    await new Promise((r) => setTimeout(r, 45))
    expect(calls).toBe(2) // the trailing call landed (final drag position)
    t.cancel()
  })
})
