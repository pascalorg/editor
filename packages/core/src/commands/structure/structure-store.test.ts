import { afterEach, describe, expect, test } from 'bun:test'
import { initSpaceDetectionSync } from '../../lib/space-detection'
import { BuildingNode, ItemNode, LevelNode, WallNode, type ZoneNode } from '../../schema'
import { type SceneCommit, subscribeSceneCommits } from '../../store/history-control'
import useScene, { clearSceneHistory } from '../../store/use-scene'
import {
  createMezzanine,
  createZone,
  deleteZone,
  divideZone,
  mergeZones,
  type StructurePlan,
  setWallGeometry,
  setZoneEdges,
  setZoneIntent,
  structureChangeBatch,
} from './index'
import { roomFace } from './shared'

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}
let stop = () => {}
afterEach(() => {
  stop()
  useScene.temporal.getState().resume()
})

function setup() {
  const level = LevelNode.parse({ id: 'level_store', parentId: 'building_store' })
  const building = BuildingNode.parse({ id: 'building_store', children: [level.id] })
  useScene.setState({
    nodes: { [level.id]: level, [building.id]: building },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    collections: {},
    materials: {},
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  clearSceneHistory()
  stop = initSpaceDetectionSync(useScene, { getState: () => ({ spaces: {}, setSpaces: () => {} }) })
  let i = 0
  const mintId = (kind: string) => `${kind}_store${++i}`
  const created = createZone(useScene.getState().nodes, {
    levelId: level.id,
    polygon: [
      [0, 0],
      [8, 0],
      [8, 4],
      [0, 4],
    ],
    enclose: true,
    mintId,
  })
  return { created, mintId }
}
function assertCommit(
  plan: StructurePlan,
  counts: { zone: number; slab: number; ceiling: number },
) {
  expect(plan.conflicts).toBeUndefined()
  clearSceneHistory()
  const before = useScene.getState().nodes
  const commits: SceneCommit[] = []
  const unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
  try {
    useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
    expect(commits).toHaveLength(1)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    for (const [type, count] of Object.entries(counts))
      expect(
        Object.values(commits[0]!.current.nodes).filter((node) => node.type === type),
      ).toHaveLength(count)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(before)
  } finally {
    unsubscribe()
  }
}

describe('structure primitive store commits', () => {
  test('createZone: complete construction in one commit and undo', () => {
    const { created } = setup()
    assertCommit(created, { zone: 1, slab: 1, ceiling: 1 })
  })
  test('delete with kept contents detaches ceiling fixtures before the derived deletion and undoes', () => {
    const { created } = setup()
    useScene.getState().applyNodeChanges(structureChangeBatch(created.changes))
    const ceiling = Object.values(useScene.getState().nodes).find((n) => n.type === 'ceiling')!
    const light = ItemNode.parse({
      id: 'item_retained_light',
      parentId: ceiling.id,
      position: [2, 0, 2],
      asset: {
        id: 'light',
        category: 'lights',
        name: 'Light',
        thumbnail: '',
        src: 'https://example.com/light.glb',
      },
    })
    useScene.getState().createNode(light, ceiling.id)
    const before = useScene.getState().nodes
    clearSceneHistory()
    const plan = deleteZone(before, { zoneId: created.zoneId, contents: 'keep' })
    useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
    expect(useScene.getState().nodes[light.id]).toMatchObject({ parentId: 'level_store' })
    expect(useScene.getState().nodes[ceiling.id]).toBeUndefined()
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(before)
  })
  test('Divide restores identical zone, separator, plate and ceiling IDs on undo then redo', () => {
    const { created, mintId } = setup()
    useScene.getState().applyNodeChanges(structureChangeBatch(created.changes))
    const before = useScene.getState().nodes
    clearSceneHistory()
    const plan = divideZone(before, {
      zoneId: created.zoneId,
      cut: [
        [2, 0],
        [2, 4],
      ],
      mintId,
    })
    useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
    const after = useScene.getState().nodes
    expect(Object.values(after).filter((n) => n.type === 'zone')).toHaveLength(2)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(before)
    useScene.temporal.getState().redo()
    expect(useScene.getState().nodes).toEqual(after)
  })
  test('deleting ceiling contents produces no derived update and one reversible commit', () => {
    const { created } = setup()
    useScene.getState().applyNodeChanges(structureChangeBatch(created.changes))
    const ceiling = Object.values(useScene.getState().nodes).find((n) => n.type === 'ceiling')!
    const light = ItemNode.parse({
      id: 'item_removed_light',
      parentId: ceiling.id,
      position: [2, 0, 2],
      asset: {
        id: 'light',
        category: 'lights',
        name: 'Light',
        thumbnail: '',
        src: 'https://example.com/light.glb',
      },
    })
    useScene.getState().createNode(light, ceiling.id)
    const plan = deleteZone(useScene.getState().nodes, {
      zoneId: created.zoneId,
      contents: 'delete',
    })
    expect(plan.changes.some((c) => c.op === 'update' && c.id === ceiling.id)).toBe(false)
    assertCommit(plan, { zone: 0, slab: 0, ceiling: 0 })
  })
  test('a room inside shared walls is refused: no reset, nothing written', () => {
    const { created, mintId } = setup()
    useScene.getState().applyNodeChanges(structureChangeBatch(created.changes))
    const points: [number, number][] = [
      [-2, -2],
      [10, -2],
      [10, 6],
      [-2, 6],
    ]
    useScene.getState().applyNodeChanges({
      create: points.map((start, i) => ({
        node: WallNode.parse({
          id: mintId('wall'),
          parentId: 'level_store',
          start,
          end: points[(i + 1) % 4],
        }),
        parentId: 'level_store',
      })),
    })
    useScene.getState().applyNodeChanges(
      structureChangeBatch(
        setZoneIntent(useScene.getState().nodes, {
          zoneId: created.zoneId,
          patch: {
            name: 'Office',
            floor: { elevation: 0.4, finish: 'wood' },
            wallMaterial: 'paint',
            hasFloor: false,
            hasCeiling: false,
          },
        }).changes,
      ),
    )
    const refused = deleteZone(useScene.getState().nodes, {
      zoneId: created.zoneId,
      contents: 'keep',
    })
    expect(refused.payload.mode).toBe('blocked')
    expect(refused.changes).toEqual([])
    expect(refused.conflicts?.map((c) => c.code)).toEqual(['shared-walls'])
    expect(useScene.getState().nodes[created.zoneId as ZoneNode['id']]).toMatchObject({
      name: 'Office',
    })
  })
  for (const command of ['intent', 'edges', 'divide', 'merge', 'delete', 'geometry'] as const)
    test(`${command}: complete construction in one commit and undo`, () => {
      const { created, mintId } = setup()
      useScene.getState().applyNodeChanges(structureChangeBatch(created.changes))
      let nodes = useScene.getState().nodes
      let plan: StructurePlan
      const zone = nodes[created.zoneId as ZoneNode['id']] as ZoneNode
      let counts = { zone: 1, slab: 1, ceiling: 1 }
      if (command === 'intent') {
        plan = setZoneIntent(nodes, {
          zoneId: zone.id,
          patch: { hasCeiling: false, floor: { elevation: 0.2 } },
        })
        counts.ceiling = 0
        counts.slab = 2
      } else if (command === 'edges')
        plan = setZoneEdges(nodes, {
          zoneId: zone.id,
          edges: [
            {
              spanRef: { ...roomFace(nodes, zone)!.spans[0]!, t0: 0.25, t1: 0.75 },
              kind: 'separator',
            },
          ],
          mintId,
        })
      else if (command === 'divide') {
        plan = divideZone(nodes, {
          zoneId: zone.id,
          cut: [
            [2, 0],
            [2, 4],
          ],
          mintId,
        })
        counts = { zone: 2, slab: 1, ceiling: 2 }
      } else if (command === 'merge') {
        useScene.getState().applyNodeChanges(
          structureChangeBatch(
            divideZone(nodes, {
              zoneId: zone.id,
              cut: [
                [2, 0],
                [2, 4],
              ],
              mintId,
            }).changes,
          ),
        )
        nodes = useScene.getState().nodes
        const ids = Object.values(nodes)
          .filter((n) => n.type === 'zone')
          .map((n) => n.id)
        plan = mergeZones(nodes, { zoneIds: [ids[0]!, ids[1]!] })
      } else if (command === 'delete') {
        plan = deleteZone(nodes, { zoneId: zone.id, contents: 'delete' })
        counts = { zone: 0, slab: 0, ceiling: 0 }
      } else {
        const wall = Object.values(nodes).find((n) => n.type === 'wall')!
        plan = setWallGeometry(nodes, { wallId: wall.id, thickness: 0.25, mintId })
      }
      assertCommit(plan, counts)
    })
})

for (const command of ['create', 'intent', 'delete'] as const)
  test(`mezzanine ${command}: one complete commit and undo restores railing and ceiling hole`, () => {
    const { created, mintId } = setup()
    useScene.getState().applyNodeChanges(structureChangeBatch(created.changes))
    useScene.getState().updateNode('level_store', { height: 5 })
    const mezzanine = createMezzanine(useScene.getState().nodes, {
      hostZoneId: created.zoneId,
      polygon: [
        [1, 1],
        [3, 1],
        [3, 3],
        [1, 3],
      ],
      mintId,
    })
    if (command === 'create') {
      assertCommit(mezzanine, { zone: 2, slab: 2, ceiling: 2 })
      return
    }
    useScene.getState().applyNodeChanges(structureChangeBatch(mezzanine.changes))
    const nodes = useScene.getState().nodes
    const plan =
      command === 'intent'
        ? setZoneIntent(nodes, {
            zoneId: mezzanine.zoneId,
            patch: { floor: { elevation: 1.6, finish: 'wood' } },
          })
        : deleteZone(nodes, { zoneId: mezzanine.zoneId, contents: 'keep' })
    assertCommit(plan, {
      zone: command === 'delete' ? 1 : 2,
      slab: command === 'delete' ? 1 : 2,
      ceiling: command === 'delete' ? 1 : 2,
    })
  })
