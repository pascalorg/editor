import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  nodeRegistry,
  registerNode,
  type SlabNode,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import type { Group, Material, Mesh } from 'three'
import { doorwayStepsFixture } from '../../../../core/src/systems/slab/__fixtures__/doorway-steps'
import { paintCommitRoute } from '../../../../editor/src/lib/paint-commit-route'
import {
  commitPaintScopeFanout,
  type PaintScope,
  paintScopeRole,
  resolvePaintScopeTargets,
} from '../../../../editor/src/lib/paint-scope'
import {
  mergePaintSurfaces,
  paintSurfaceMeshes,
  plateAffectedSurfaces,
  platePreviewSurfaces,
} from '../../../../editor/src/lib/plate-paint-affected'
import { installImmediateAnimationFrames } from '../../../../editor/src/test-utils/immediate-animation-frames'
import { slabDefinition } from '../definition'
import { buildSlabGeometry } from '../geometry'
import { erasedSlabLook, slabPaint } from '../paint'

// One paint click on a generated floor plate, run the way the editor runs it:
// the hover outline, the preview and what the plate draws after the commit
// must be the same meshes in the same finish, and the click one undo step.
// A | B | C in a row, B raised, a door in each dividing wall: B owns a step at
// each door, and its outside faces are its own edge.

const OAK = 'library:preset-tomato'
const PINE = 'library:preset-blush'
const PAINT = 'library:preset-charcoal'
const RUG: [number, number][] = [
  [5, 1],
  [7, 1],
  [7, 3],
  [5, 3],
]

let restoreFrames = () => {}
beforeEach(() => {
  restoreFrames = installImmediateAnimationFrames()
  nodeRegistry._reset()
  registerNode(slabDefinition as never)
})
afterEach(() => {
  useScene.setState({ nodes: {}, materials: {}, dirtyNodes: new Set(), readOnly: false })
  useScene.temporal.getState().clear()
  nodeRegistry._reset()
  restoreFrames()
})

function load(patch: (nodes: Record<string, AnyNode>) => void = () => {}) {
  const nodes = doorwayStepsFixture() as Record<string, AnyNode>
  for (const id of ['zone_a', 'zone_b', 'zone_c']) {
    const zone = nodes[id] as ZoneNode
    nodes[id] = { ...zone, floor: { ...zone.floor, finish: id === 'zone_b' ? OAK : PINE } }
  }
  patch(nodes)
  useScene.setState({
    nodes: nodes as Record<AnyNodeId, AnyNode>,
    materials: {},
    dirtyNodes: new Set(),
    readOnly: false,
  })
  useScene.temporal.getState().clear()
}

const plates = () =>
  Object.values(useScene.getState().nodes).filter(
    (node): node is SlabNode => node.type === 'slab' && node.boundary === 'auto',
  )
const plateOf = (role: 'base' | 'platform') => plates().find((slab) => slab.plateRole === role)!

function buildAll(): Map<string, Group> {
  const nodes = useScene.getState().nodes as Record<string, AnyNode>
  return new Map(
    plates().map((plate) => {
      const group = buildSlabGeometry(
        plate,
        {
          parent: nodes[plate.parentId!]!,
          resolve: (id) => nodes[id] as never,
          children: [],
          siblings: Object.values(nodes).filter((node) => node.parentId === plate.parentId),
          materials: useScene.getState().materials,
        },
        'rendered',
        true,
      )
      for (const mesh of group.children) mesh.userData.__fromGeometry = true
      return [plate.id, group]
    }),
  )
}

/** Every plate mesh by a stable key: plate, paint role, and its rank among that role. */
function meshesOf(groups: Map<string, Group>): Map<string, Mesh> {
  const meshes = new Map<string, Mesh>()
  for (const [id, group] of groups) {
    const seen = new Map<string, number>()
    for (const mesh of group.children as Mesh[]) {
      const role = String(mesh.userData.paintRole)
      const rank = seen.get(role) ?? 0
      seen.set(role, rank + 1)
      meshes.set(`${id}|${role}|${rank}`, mesh)
    }
  }
  return meshes
}

const look = (material: Material | Material[]) => {
  const m = material as Material & {
    color?: { getHexString: () => string }
    map?: { source?: { uuid: string }; uuid: string } | null
  }
  return `${m.type}|${m.color?.getHexString() ?? ''}|${m.map?.source?.uuid ?? m.map?.uuid ?? ''}`
}

function click(args: {
  plate: 'base' | 'platform'
  role: string
  scope: PaintScope
  preset?: string
}) {
  const node = plateOf(args.plate)
  const nodes = useScene.getState().nodes as Record<string, AnyNode>
  const erasing = args.preset === undefined
  const targets = resolvePaintScopeTargets({
    node,
    role: args.role,
    scope: args.scope,
    nodes,
    spaces: {},
    slotRolesOf: () => [],
  })
  const scopeRole = paintScopeRole(node, args.role, args.scope)
  const affected = plateAffectedSurfaces(nodes, node, scopeRole, { erasing }) ?? []
  const previewTargets = mergePaintSurfaces(targets, platePreviewSurfaces(nodes, node, scopeRole))

  const groups = buildAll()
  const meshes = meshesOf(groups)
  const keyOf = new Map([...meshes].map(([key, mesh]) => [mesh, key]))
  const before = new Map([...meshes].map(([key, mesh]) => [key, mesh.material]))
  const outline = paintSurfaceMeshes(affected, (id) => groups.get(id) as never)
    .map((mesh) => keyOf.get(mesh as unknown as Mesh)!)
    .sort()

  const restores = previewTargets.map((target) =>
    slabPaint.applyPreview({
      node: nodes[target.nodeId]!,
      role: target.role,
      material: undefined,
      materialPreset: args.preset,
      root: groups.get(target.nodeId)!,
    }),
  )
  const previewed = new Map(
    [...meshes]
      .filter(([key, mesh]) => mesh.material !== before.get(key))
      .map(([key, mesh]) => [key, look(mesh.material)]),
  )
  for (const restore of restores.reverse()) restore?.()

  const history = useScene.temporal.getState().pastStates.length
  const spec = { node, role: args.role, material: undefined, materialPreset: args.preset }
  if (paintCommitRoute(targets, node.id, args.role) === 'fanout')
    commitPaintScopeFanout(targets, undefined, args.preset)
  else slabPaint.commit(spec)
  const undoSteps = useScene.temporal.getState().pastStates.length - history

  // A painted part the click removes is drawn by its room's floor afterwards.
  const after = meshesOf(buildAll())
  const drawnAt = (key: string) =>
    after.get(key) ?? after.get(key.replace(/^([^|]+\|room:[^/|]+)\/[^|]+\|/, '$1|'))
  const drawn = new Map(
    [...before.keys()].flatMap((key) => {
      const mesh = drawnAt(key)
      return mesh && look(mesh.material) !== look(before.get(key)!)
        ? [[key, look(mesh.material)] as const]
        : []
    }),
  )
  return { outline, previewed, drawn, undoSteps }
}

function expectParity(result: ReturnType<typeof click>) {
  expect(result.outline.length).toBeGreaterThan(0)
  expect([...result.previewed.keys()].sort()).toEqual(result.outline)
  expect([...result.drawn.keys()].sort()).toEqual(result.outline)
  for (const [key, shown] of result.previewed) expect(result.drawn.get(key)).toBe(shown)
  expect(result.undoSteps).toBe(1)
}

describe('a floor plate paints what it outlines and previews, in one undo step', () => {
  test('this surface: the raised room floor and the steps that follow it', () => {
    load()
    const result = click({ plate: 'platform', role: 'room:zone_b', scope: 'single', preset: PAINT })
    expectParity(result)
    expect(result.outline.some((key) => key.includes('|step:zone_b/'))).toBe(true)
  })

  test('this surface erased: the floor shows the plate top, its steps the unpainted step', () => {
    load()
    expectParity(click({ plate: 'platform', role: 'room:zone_b', scope: 'single' }))
  })

  test('a ground floor room on the footprint', () => {
    load()
    expectParity(click({ plate: 'base', role: 'room:zone_a', scope: 'single', preset: PAINT }))
  })

  test('the whole room, painted and erased (edge, step finish; doorway paint stays)', () => {
    load()
    expectParity(click({ plate: 'platform', role: 'room:zone_b', scope: 'room', preset: PAINT }))
    load((nodes) => {
      const b = nodes.zone_b as ZoneNode
      nodes.zone_b = {
        ...b,
        floorStepFinish: PINE,
        floorEdgeFinish: PAINT,
        floorStepOverrides: [{ key: 'door_bc', finish: PAINT }],
      } as ZoneNode
    })
    const erased = click({ plate: 'platform', role: 'room:zone_b', scope: 'room' })
    expectParity(erased)
    expect(erased.outline.some((key) => key.includes('|step:zone_b/door_bc|'))).toBe(false)
  })

  test('a painted part: this surface is just the part; erased, the room floor shows', () => {
    const withRug = () =>
      load((nodes) => {
        const b = nodes.zone_b as ZoneNode
        nodes.zone_b = {
          ...b,
          floor: { ...b.floor, regions: [{ id: 'rug', polygon: RUG, finish: PINE }] },
        } as ZoneNode
      })
    withRug()
    const part = click({
      plate: 'platform',
      role: 'room:zone_b/rug',
      scope: 'single',
      preset: PAINT,
    })
    expectParity(part)
    expect(part.outline.every((key) => key.includes('|room:zone_b/rug|'))).toBe(true)
    withRug()
    expectParity(click({ plate: 'platform', role: 'room:zone_b/rug', scope: 'single' }))
    withRug()
    const whole = click({
      plate: 'platform',
      role: 'room:zone_b/rug',
      scope: 'room',
      preset: PAINT,
    })
    expectParity(whole)
    expect(whole.outline.some((key) => key.includes('|room:zone_b/rug|'))).toBe(true)
    expect(whole.outline.some((key) => key.includes('|room:zone_b|'))).toBe(true)
    expect((useScene.getState().nodes.zone_b as ZoneNode).floor?.regions).toBeUndefined()
  })

  test('this step, and every step of the room', () => {
    load()
    expectParity(
      click({ plate: 'platform', role: 'step:zone_b/door_ab', scope: 'single', preset: PAINT }),
    )
    load()
    expectParity(
      click({ plate: 'platform', role: 'step:zone_b/door_ab', scope: 'room', preset: PAINT }),
    )
  })

  test("the footprint's edge band carries its rooms' edges, painted and erased", () => {
    load()
    expectParity(click({ plate: 'base', role: 'edge', scope: 'single', preset: PAINT }))
    load((nodes) => {
      const base = Object.values(nodes).find(
        (node): node is SlabNode => node.type === 'slab' && node.plateRole === 'base',
      )!
      nodes[base.id] = { ...base, slots: { ...base.slots, edge: PAINT } } as SlabNode
    })
    expectParity(click({ plate: 'base', role: 'edge', scope: 'single' }))
  })

  test('a raised room edge erased falls back to its footprint band', () => {
    load((nodes) => {
      const b = nodes.zone_b as ZoneNode
      nodes.zone_b = { ...b, floorEdgeFinish: PAINT } as ZoneNode
      const base = Object.values(nodes).find(
        (node): node is SlabNode => node.type === 'slab' && node.plateRole === 'base',
      )!
      nodes[base.id] = { ...base, slots: { ...base.slots, edge: PINE } } as SlabNode
    })
    // Walls cover B's outside here, so no edge of its own is drawn to click.
    expect(erasedSlabLook({ node: plateOf('platform'), role: 'edge:zone_b' } as never)).toEqual({
      materialPreset: PINE,
    })
    expect(erasedSlabLook({ node: plateOf('platform'), role: 'step:zone_b' } as never)).toEqual({
      materialPreset: OAK,
    })
  })

  test('a carried-over "whole slab" scope paints only the hovered surface', () => {
    load()
    const result = click({ plate: 'platform', role: 'room:zone_b', scope: 'object', preset: PAINT })
    expectParity(result)
    const platform = plateOf('platform')
    expect(platform.slots?.side).toBeUndefined()
    expect(platform.foundation?.material).toBeUndefined()
  })
})
