import { beforeEach, describe, expect, test } from 'bun:test'
import {
  activateXray,
  imposeLowWalls,
  releaseLowWalls,
  removeXray,
  type SceneLike,
  setXrayViewMode,
  type ViewerLike,
} from './activation'
import { effectiveViewMode, FramingNode } from './framing/schema'
import { buildServicePointNodes, planServiceSeeding } from './service/place'
import { SERVICE_TYPES } from './service/schema'
import { useBonesStore } from './store'

/**
 * The click-scoped activation contract (user round 2026-08-20) — the store-
 * level gates for Changes A/B/D:
 *  - "X-Ray this level" creates the framing node + EVERY service point in
 *    ONE applyNodeChanges (one undo entry) and imposes wall mode 'down'
 *    exactly once;
 *  - a manual wall-mode change afterwards survives recomputes/re-renders
 *    (nothing re-imposes — the imposition has no non-click path);
 *  - the view-mode control drives wall mode on the off-boundary only;
 *  - Remove deletes the X-ray plus its auto-managed nodes in one entry and
 *    restores the pre-X-ray wall mode.
 */

// Same synthetic scene shape as service/place.test.ts: four exterior walls,
// garage + bathroom zones — every one of the eight service types places.
function scene(): Record<string, Record<string, unknown>> {
  const wall = (id: string, start: [number, number], end: [number, number], extra = {}) => ({
    id,
    type: 'wall',
    parentId: 'level_1',
    start,
    end,
    thickness: 0.114,
    height: 2.5,
    frontSide: 'exterior',
    children: [],
    ...extra,
  })
  const zone = (
    id: string,
    name: string,
    polygon: [number, number][],
    boundaryWallIds: string[],
  ) => ({ id, type: 'zone', parentId: 'level_1', name, polygon, boundaryWallIds })
  return {
    level_1: { id: 'level_1', type: 'level', level: 0, height: 2.5 },
    w_s: wall('w_s', [0, 0], [10, 0]),
    w_e: wall('w_e', [10, 0], [10, 8]),
    w_n: wall('w_n', [10, 8], [0, 8]),
    w_w: wall('w_w', [0, 8], [0, 0]),
    w_mid: wall('w_mid', [5, 0], [5, 8], { frontSide: 'interior', backSide: 'interior' }),
    z_garage: zone('z_garage', 'Garage', [[0, 0], [5, 0], [5, 8], [0, 8]], ['w_w', 'w_mid']),
    z_bath: zone('z_bath', 'Bathroom', [[5, 0], [10, 0], [10, 4], [5, 4]], []),
  }
}

type Changes = {
  create?: { node: unknown; parentId?: unknown }[]
  update?: { id: unknown; data: Record<string, unknown> }[]
  delete?: unknown[]
}

/** Minimal scene-store fake: applies changes like the host (one call = one
 * history entry) and records every call for the undo-grouping assertions. */
function fakeScene(initial: Record<string, Record<string, unknown>>) {
  const applyCalls: Changes[] = []
  const updateCalls: { id: unknown; data: unknown }[] = []
  const state = {
    nodes: { ...initial },
    applyNodeChanges(changes: Changes) {
      applyCalls.push(changes)
      for (const { node, parentId } of changes.create ?? []) {
        const n = node as Record<string, unknown>
        state.nodes[String(n.id)] = { ...n, parentId }
      }
      for (const { id, data } of changes.update ?? []) {
        const key = String(id)
        state.nodes[key] = { ...state.nodes[key], ...data }
      }
      for (const id of changes.delete ?? []) delete state.nodes[String(id)]
    },
    updateNode(id: never, data: never) {
      updateCalls.push({ id, data })
      const key = String(id)
      state.nodes[key] = { ...state.nodes[key], ...(data as Record<string, unknown>) }
    },
  }
  return { store: { getState: () => state } as SceneLike, state, applyCalls, updateCalls }
}

function fakeViewer(initialMode: string | undefined) {
  const writes: string[] = []
  const state = {
    wallMode: initialMode,
    setWallMode(mode: string) {
      state.wallMode = mode
      writes.push(mode)
    },
  }
  return { store: { getState: () => state } as ViewerLike, state, writes }
}

beforeEach(() => {
  useBonesStore.getState().setWallModeBeforeXray(null)
})

describe('activateXray — one click, one undo entry, walls Low once', () => {
  test('creates the framing node + all eight service points in ONE applyNodeChanges', () => {
    const { store, applyCalls } = fakeScene(scene())
    const viewer = fakeViewer('cutaway')
    const framing = activateXray(store, 'level_1', viewer.store)

    expect(applyCalls).toHaveLength(1) // ONE history entry
    const creates = applyCalls[0]?.create ?? []
    expect(creates).toHaveLength(1 + SERVICE_TYPES.length)
    const created = creates.map((c) => c.node as Record<string, unknown>)
    expect(created[0]?.type).toBe('bones:framing')
    const types = created
      .slice(1)
      .map((n) => String(n.serviceType))
      .sort()
    expect(types).toEqual([...SERVICE_TYPES].sort())
    for (const c of creates) expect(c.parentId).toBe('level_1')

    // Position parity: the click seeds the exact nodes the pure planner
    // builds — engine auto anchors, byte for byte (A4: creation alone never
    // moves anything; place.test.ts pins the planner against the engines).
    const expected = buildServicePointNodes(scene(), 'level_1')
    const strip = (n: Record<string, unknown>) => {
      const { id: _id, ...rest } = n
      return rest
    }
    const byType = (a: Record<string, unknown>, b: Record<string, unknown>) =>
      String(a.serviceType).localeCompare(String(b.serviceType))
    expect(created.slice(1).map(strip).sort(byType)).toEqual(
      expected.map((n) => strip(n as unknown as Record<string, unknown>)).sort(byType),
    )

    // activation defaults: X-ray vision ON, seeding latched, MEP on
    expect(framing.viewMode).toBe('xray')
    expect(framing.servicesSeeded).toBe(true)
    expect(framing.showElectrical).toBe(true)
    expect(framing.showPlumbing).toBe(true)
    expect(framing.showHvac).toBe(true)
  })

  test('imposes wall mode down exactly once and remembers the previous mode', () => {
    const { store } = fakeScene(scene())
    const viewer = fakeViewer('cutaway')
    activateXray(store, 'level_1', viewer.store)
    expect(viewer.state.wallMode).toBe('down')
    expect(viewer.writes).toEqual(['down'])
    expect(useBonesStore.getState().wallModeBeforeXray).toBe('cutaway')
  })

  test('walls already down: no write, and the remembered mode is untouched', () => {
    const { store } = fakeScene(scene())
    const viewer = fakeViewer('down')
    activateXray(store, 'level_1', viewer.store)
    expect(viewer.writes).toEqual([])
    expect(useBonesStore.getState().wallModeBeforeXray).toBeNull()
  })

  test('a manual wall-mode change afterwards SURVIVES — nothing re-imposes', () => {
    const { store, state } = fakeScene(scene())
    const viewer = fakeViewer('up')
    const framing = activateXray(store, 'level_1', viewer.store)
    // the user flips walls back to full height while the X-ray is on
    viewer.state.setWallMode('up')
    // recompute/re-render equivalents: the renderer's seeding planner is a
    // no-op (latched) and a same-mode write never touches the viewer
    const seeding = planServiceSeeding(
      state.nodes,
      'level_1',
      state.nodes[framing.id] as { id: string },
    )
    expect(seeding.create).toHaveLength(0)
    expect(seeding.update).toHaveLength(0)
    setXrayViewMode(store, state.nodes[framing.id] as { id: string }, 'xray', viewer.store)
    expect(viewer.state.wallMode).toBe('up')
    expect(viewer.writes).toEqual(['down', 'up']) // activation + the user, nothing else
  })

  test('wall-less level: framing node alone, seeding NOT latched (heals when walls appear)', () => {
    const bare: Record<string, Record<string, unknown>> = {
      level_1: { id: 'level_1', type: 'level', level: 0, height: 2.5 },
    }
    const { store, state, applyCalls } = fakeScene(bare)
    const framing = activateXray(store, 'level_1', fakeViewer('up').store)
    expect(applyCalls[0]?.create).toHaveLength(1)
    expect(framing.servicesSeeded).toBe(false)
    // …the level grows geometry later → the renderer's planner seeds + latches
    for (const [id, node] of Object.entries(scene())) state.nodes[id] ??= node
    const heal = planServiceSeeding(
      state.nodes,
      'level_1',
      state.nodes[framing.id] as { id: string },
    )
    expect(heal.create).toHaveLength(SERVICE_TYPES.length)
    expect(heal.update).toEqual([{ id: framing.id, data: { servicesSeeded: true } }])
  })
})

describe('setXrayViewMode — the control IS the switch (off-boundary only)', () => {
  test('xray → off restores the remembered mode; off → xray imposes down again', () => {
    const { store, state } = fakeScene(scene())
    const viewer = fakeViewer('cutaway')
    const framing = activateXray(store, 'level_1', viewer.store)
    const node = () => state.nodes[framing.id] as { id: string; viewMode?: unknown }

    setXrayViewMode(store, node(), 'off', viewer.store)
    expect(effectiveViewMode(node())).toBe('off')
    expect(viewer.state.wallMode).toBe('cutaway') // pre-X-ray mode restored

    setXrayViewMode(store, node(), 'xray', viewer.store)
    expect(effectiveViewMode(node())).toBe('xray')
    expect(viewer.state.wallMode).toBe('down')
  })

  test('xray ↔ basement never touches wall mode', () => {
    const { store, state } = fakeScene(scene())
    const viewer = fakeViewer('up')
    const framing = activateXray(store, 'level_1', viewer.store)
    const node = () => state.nodes[framing.id] as { id: string; viewMode?: unknown }

    setXrayViewMode(store, node(), 'basement', viewer.store)
    expect(effectiveViewMode(node())).toBe('basement')
    setXrayViewMode(store, node(), 'xray', viewer.store)
    expect(viewer.writes).toEqual(['down']) // only the activation write

    // …and basement → off releases like xray → off
    setXrayViewMode(store, node(), 'basement', viewer.store)
    setXrayViewMode(store, node(), 'off', viewer.store)
    expect(viewer.state.wallMode).toBe('up')
  })

  test('off with walls manually changed since: restore is skipped (user choice respected)', () => {
    const { store, state } = fakeScene(scene())
    const viewer = fakeViewer('cutaway')
    const framing = activateXray(store, 'level_1', viewer.store)
    viewer.state.setWallMode('up') // manual change while X-ray on
    setXrayViewMode(store, state.nodes[framing.id] as { id: string }, 'off', viewer.store)
    expect(viewer.state.wallMode).toBe('up') // NOT snapped back to cutaway
  })

  test('unknown pre-X-ray mode restores to full height (up)', () => {
    const viewer = fakeViewer('down')
    releaseLowWalls(viewer.store)
    expect(viewer.state.wallMode).toBe('up')
  })

  test('viewer without setWallMode: impose/release are safe no-ops', () => {
    const bare = { getState: () => ({}) } as ViewerLike
    expect(() => imposeLowWalls(bare)).not.toThrow()
    expect(() => releaseLowWalls(bare)).not.toThrow()
  })
})

describe('removeXray — deactivation mirror', () => {
  test('deletes framing + the level’s service AND device nodes in ONE entry; walls restore', () => {
    const { store, state, applyCalls } = fakeScene(scene())
    const viewer = fakeViewer('cutaway')
    const framing = activateXray(store, 'level_1', viewer.store)
    // a reconciler-seeded device node rides along
    state.nodes.bonesdevice_1 = {
      id: 'bonesdevice_1',
      type: 'bones:device',
      parentId: 'level_1',
      deviceId: 'w_s|recep|1',
    }
    // …but foreign-level bones nodes are untouched
    state.nodes.bonesdevice_2 = {
      id: 'bonesdevice_2',
      type: 'bones:device',
      parentId: 'level_2',
      deviceId: 'x',
    }
    applyCalls.length = 0

    removeXray(store, framing.id, 'level_1', viewer.store)
    expect(applyCalls).toHaveLength(1)
    const deleted = (applyCalls[0]?.delete ?? []).map(String)
    expect(deleted).toContain(framing.id)
    expect(deleted).toContain('bonesdevice_1')
    expect(deleted).not.toContain('bonesdevice_2')
    // framing + 8 services + 1 device
    expect(deleted).toHaveLength(1 + SERVICE_TYPES.length + 1)
    expect(state.nodes[framing.id]).toBeUndefined()
    expect(viewer.state.wallMode).toBe('cutaway')
  })
})

/**
 * CHECKLIST A5 / INVARIANT W1 (skeptic blocker, 2026-08-21): wall mode is
 * ONE global host pref, X-rays are per-level — the restore rides only the
 * action that deactivates the LAST live X-ray. Repro'd verbatim: with A and
 * B both live, removing A used to restore the pre-X-ray mode under B.
 */
describe('INVARIANT W1 — restore never fires while any other X-ray is live', () => {
  const twoLevels = () => ({
    ...scene(),
    level_2: { id: 'level_2', type: 'level', level: 1, height: 2.5 },
  })

  test('remove A → walls stay down for B; remove B → restore fires once', () => {
    const { store, state } = fakeScene(twoLevels())
    const viewer = fakeViewer('up')
    const a = activateXray(store, 'level_1', viewer.store) // up → down, remembered
    const b = activateXray(store, 'level_2', viewer.store) // already down: no-op
    expect(viewer.writes).toEqual(['down'])

    removeXray(store, a.id, 'level_1', viewer.store)
    expect(viewer.state.wallMode).toBe('down') // B is still live
    expect(state.nodes[b.id]).toBeDefined()

    removeXray(store, b.id, 'level_2', viewer.store)
    expect(viewer.state.wallMode).toBe('up') // LAST one out restores
    expect(viewer.writes).toEqual(['down', 'up']) // exactly once
  })

  test('viewMode-off variant: A → Normal keeps walls down for B; B → Normal restores', () => {
    const { store, state } = fakeScene(twoLevels())
    const viewer = fakeViewer('cutaway')
    const a = activateXray(store, 'level_1', viewer.store)
    const b = activateXray(store, 'level_2', viewer.store)

    setXrayViewMode(store, state.nodes[a.id] as { id: string }, 'off', viewer.store)
    expect(viewer.state.wallMode).toBe('down') // B still live

    setXrayViewMode(store, state.nodes[b.id] as { id: string }, 'off', viewer.store)
    expect(viewer.state.wallMode).toBe('cutaway') // last live X-ray went off
  })

  test('an X-ray parked in Normal holds nothing — removing the live one restores', () => {
    const { store, state } = fakeScene(twoLevels())
    const viewer = fakeViewer('up')
    const a = activateXray(store, 'level_1', viewer.store)
    const b = activateXray(store, 'level_2', viewer.store)
    setXrayViewMode(store, state.nodes[b.id] as { id: string }, 'off', viewer.store)
    expect(viewer.state.wallMode).toBe('down') // A still live

    removeXray(store, a.id, 'level_1', viewer.store)
    expect(viewer.state.wallMode).toBe('up') // B is parked off — no hold
  })

  test('legacy holder: a pre-viewMode node (absent keys ⇒ xray) counts as live', () => {
    const nodes = twoLevels() as Record<string, Record<string, unknown>>
    nodes.bonesframing_legacy = {
      id: 'bonesframing_legacy',
      type: 'bones:framing',
      parentId: 'level_2',
    }
    const { store } = fakeScene(nodes)
    const viewer = fakeViewer('up')
    const a = activateXray(store, 'level_1', viewer.store)
    removeXray(store, a.id, 'level_1', viewer.store)
    expect(viewer.state.wallMode).toBe('down') // the legacy X-ray still needs it
  })
})

describe('creation defaults (schema pins)', () => {
  test('new framing node: viewMode xray, MEP systems on, seeding unlatched', () => {
    const node = FramingNode.parse({})
    expect(node.viewMode).toBe('xray')
    expect(node.showElectrical).toBe(true)
    expect(node.showPlumbing).toBe(true)
    expect(node.showHvac).toBe(true)
    expect(node.servicesSeeded).toBe(false)
    expect(node.showWalls).toBe(true)
    expect(node.showFloor).toBe(true)
    expect(node.showRoof).toBe(true)
    expect(node.showFoundation).toBe(true)
  })

  test('effectiveViewMode: explicit wins; legacy seeThrough maps false→off, else xray', () => {
    expect(effectiveViewMode({ viewMode: 'basement', seeThrough: false })).toBe('basement')
    expect(effectiveViewMode({ viewMode: 'off' })).toBe('off')
    expect(effectiveViewMode({ seeThrough: false })).toBe('off')
    expect(effectiveViewMode({ seeThrough: true })).toBe('xray')
    expect(effectiveViewMode({})).toBe('xray') // legacy node, absent keys
    expect(effectiveViewMode({ viewMode: 'garbage' })).toBe('xray')
  })
})
