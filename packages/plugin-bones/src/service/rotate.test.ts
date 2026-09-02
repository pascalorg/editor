import { describe, expect, test } from 'bun:test'
import { useScene } from '@pascal-app/core'
import { computeLevel } from '../framing/compute'
import { FramingNode } from '../framing/schema'
import { serviceDefinition } from './definition'
import { resolveServicePlacement } from './placement'
import { resolveHeatPumpAssemblyYaw, resolveHeatPumpProxy } from './proxy'
import { ServiceNode } from './schema'

/**
 * ROTATE PARITY gates (HP polish item 4 — Julien: "it looks like I can't
 * rotate it like a normal object or with R"). The host reaches a selected
 * node's rotation through two definition seams (see definition.ts for the
 * read-only host investigation): `keyboardActions.r/t` (the R/T keys) and
 * a `handles` arc-resize 'rotate' descriptor (⌘-drag + the 2D floorplan
 * rotate + the on-canvas gizmo). Both must write the heat-pump node's
 * additive `yawOverride` — the raw rotation[1] write the host falls back
 * to is invisible to the engine-composed assembly (the shipped bug).
 */

// `updateNode` batches dirty-marking through requestAnimationFrame — the
// same headless polyfill the wall-mount history-session gates use.
type RafFn = (cb: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (cb) => {
  cb(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

const QUANTUM = Math.PI / 4

type LooseNodes = Record<string, Record<string, unknown>>

function scene(): LooseNodes {
  const wall = (id: string, start: [number, number], end: [number, number]) => ({
    id,
    type: 'wall',
    parentId: 'level_1',
    start,
    end,
    thickness: 0.114,
    height: 2.5,
    frontSide: 'exterior',
    children: [],
  })
  const zone = (id: string, name: string, polygon: [number, number][]) => ({
    id,
    type: 'zone',
    parentId: 'level_1',
    name,
    polygon,
    boundaryWallIds: [],
  })
  return {
    level_1: { id: 'level_1', type: 'level', level: 0, height: 2.5 },
    w_s: wall('w_s', [0, 0], [10, 0]),
    w_e: wall('w_e', [10, 0], [10, 8]),
    w_n: wall('w_n', [10, 8], [0, 8]),
    w_w: wall('w_w', [0, 8], [0, 0]),
    z_laundry: zone('z_laundry', 'Laundry', [[0, 0], [5, 0], [5, 8], [0, 8]]),
    z_bath: zone('z_bath', 'Bathroom', [[5, 0], [10, 0], [10, 4], [5, 4]]),
    bonesframing_1: FramingNode.parse({
      id: 'bonesframing_1',
      parentId: 'level_1',
      viewMode: 'xray',
    }) as unknown as Record<string, unknown>,
  }
}

/** Scene + a heat-pump node, loaded into the REAL core scene store (the
 * keyboard actions write through useScene.updateNode, like the host). */
function loadScene(hpExtra: Record<string, unknown> = {}): ServiceNode {
  const nodes = scene()
  const hp = ServiceNode.parse({
    serviceType: 'heat-pump',
    position: [5, 0, -1.5],
    ...hpExtra,
  })
  nodes[hp.id] = { ...hp, parentId: 'level_1' } as unknown as Record<string, unknown>
  useScene.setState({
    nodes,
    rootNodeIds: ['level_1'],
    dirtyNodes: new Set(),
    collections: {},
    materials: {},
    readOnly: false,
  } as never)
  return hp
}

const storedYaw = (id: string): unknown =>
  (useScene.getState().nodes as unknown as LooseNodes)[id]?.yawOverride

type KeyboardAction = {
  appliesTo: (node: unknown) => boolean
  run: (node: unknown) => void
}
const keyboardActions = (
  serviceDefinition as unknown as Record<string, Record<string, KeyboardAction>>
).keyboardActions as { r: KeyboardAction; t: KeyboardAction }

type RotateHandle = {
  kind: string
  shape?: string
  axis?: string
  apply: (node: unknown, delta: number, sceneApi: unknown) => Record<string, unknown>
  placement: { position: (node: unknown, sceneApi?: unknown) => readonly number[] }
}
const handlesOf = (node: unknown): RotateHandle[] =>
  (serviceDefinition as unknown as { handles: (n: unknown) => RotateHandle[] }).handles(node)

describe('keyboardActions — R/T write yawOverride (heat-pump only)', () => {
  test('appliesTo gates on heat-pump; every other service type falls through to the host default', () => {
    for (const key of ['r', 't'] as const) {
      expect(keyboardActions[key].appliesTo({ serviceType: 'heat-pump' })).toBe(true)
      for (const other of ['panel', 'water-heater', 'sewer-exit', 'thermostat']) {
        expect(keyboardActions[key].appliesTo({ serviceType: other })).toBe(false)
      }
    }
  })

  test('first R steps from the ENGINE wall-square yaw (not from 0 — no jump), then quantizes like the host', () => {
    const hp = loadScene()
    const node = (useScene.getState().nodes as unknown as LooseNodes)[hp.id]
    // engine truth for this scene: unit #1 verbatim at the node, squared
    // to the south wall → π (proves the base is the DERIVED yaw)
    const base = resolveHeatPumpAssemblyYaw(
      useScene.getState().nodes as unknown as LooseNodes,
      node as never,
    )
    expect(base).toBeCloseTo(Math.PI, 12)
    keyboardActions.r.run(node)
    // host steppedRotation semantics: round to the nearest 45°, step +1
    expect(storedYaw(hp.id)).toBe((Math.round(base / QUANTUM) + 1) * QUANTUM)
    // second press steps from the STORED override
    keyboardActions.r.run((useScene.getState().nodes as unknown as LooseNodes)[hp.id])
    expect(storedYaw(hp.id)).toBe((Math.round(base / QUANTUM) + 2) * QUANTUM)
  })

  test('T steps the other way; an off-grid stored yaw rounds to the nearest 45° first (host parity)', () => {
    const hp = loadScene({ yawOverride: Math.PI + 0.1 }) // ≈ 3.24, nearest 45° multiple = π
    keyboardActions.t.run((useScene.getState().nodes as unknown as LooseNodes)[hp.id])
    expect(storedYaw(hp.id)).toBe((Math.round((Math.PI + 0.1) / QUANTUM) - 1) * QUANTUM)
  })
})

describe('handles — the arc-rotate descriptor (⌘-drag / floorplan / gizmo)', () => {
  test('heat-pump nodes expose ONE arc-resize rotate handle; other types none', () => {
    const hp = { serviceType: 'heat-pump' }
    const list = handlesOf(hp)
    expect(list.length).toBe(1)
    expect(list[0]?.kind).toBe('arc-resize')
    expect(list[0]?.shape).toBe('rotate')
    expect(list[0]?.axis).toBe('angular')
    expect(handlesOf({ serviceType: 'panel' })).toEqual([])
    // the gizmo mounts above the cabinet, not at the origin (a handle at
    // y=0 would sink into the pad)
    const pos = list[0]?.placement.position(hp)
    expect((pos?.[1] ?? 0)).toBeGreaterThan(0.85)
  })

  test('apply writes yawOverride = current yaw − delta (host sign convention), from the derived base when unset', () => {
    const hp = loadScene()
    const nodes = useScene.getState().nodes as unknown as LooseNodes
    const node = nodes[hp.id]
    const sceneApi = { nodes: () => nodes }
    const handle = handlesOf(node)[0] as RotateHandle
    // unset: base = the engine's wall-square π
    expect(handle.apply(node, Math.PI / 4, sceneApi)).toEqual({
      yawOverride: Math.PI - Math.PI / 4,
    })
    // set: base = the stored override (drag continues from what you see)
    const spun = { ...node, yawOverride: 0.5 }
    expect(handle.apply(spun, -0.25, sceneApi)).toEqual({ yawOverride: 0.75 })
  })
})

describe('the override reaches the assembly + pick proxy (absent == wall-square)', () => {
  test('yawOverride on the node turns the engine fixture AND the proxy; clearing restores wall-square', () => {
    const hp = loadScene({ yawOverride: 1.2 })
    const nodes = useScene.getState().nodes as unknown as LooseNodes
    const ref = { serviceType: 'heat-pump' as const, parentId: 'level_1' }
    const unit1 = computeLevel(nodes, nodes.bonesframing_1 as never).fixtures.find(
      (f) => f.meta?.equipment === 'condenser' && f.meta?.unit === 1,
    )
    expect(unit1?.rotationY).toBe(1.2)
    // the pick proxy hugs the rotated assembly (proxy yaw == assembly yaw)
    expect(resolveHeatPumpProxy(nodes, ref)?.rotationY).toBe(1.2)
    expect(resolveHeatPumpAssemblyYaw(nodes, nodes[hp.id] as never)).toBe(1.2)
    // clear the override (null) → back to the derived wall-square π
    const cleared = { ...nodes, [hp.id]: { ...nodes[hp.id], yawOverride: null } }
    const clearedUnit = computeLevel(cleared, cleared.bonesframing_1 as never).fixtures.find(
      (f) => f.meta?.equipment === 'condenser' && f.meta?.unit === 1,
    )
    expect(clearedUnit?.rotationY).toBeCloseTo(Math.PI, 12)
    expect(resolveHeatPumpProxy(cleared, ref)?.rotationY).toBeCloseTo(Math.PI, 12)
  })

  test('the basement/off placeholder body turns with the override too (one orientation in every mode)', () => {
    const hp = loadScene({ yawOverride: 1.2 })
    const nodes = useScene.getState().nodes as unknown as LooseNodes
    const placement = resolveServicePlacement(nodes, nodes[hp.id] as never)
    expect(placement?.rotationY).toBe(1.2)
    // null/absent keeps the legacy rotation[1] fallback (0 here)
    const cleared = resolveServicePlacement(
      nodes,
      { ...(nodes[hp.id] as object), yawOverride: null } as never,
    )
    expect(cleared?.rotationY).toBe(0)
  })
})
