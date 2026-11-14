import { beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  type BeamNode,
  BuildingNode,
  clearSceneHistory,
  createBeam,
  LevelNode,
  SlabNode,
  useScene,
} from '@pascal-app/core'
import { beamPliesPatch } from './panel'
import { beamPanelModel, beamSizeOptions, beamSizeValue } from './panel-model'

type RafFn = (cb: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (cb) => {
  cb(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

const IN = 0.0254
const A = createBeam({ start: [0, 0], end: [3, 0], preset: '6x8', levelId: 'level_g' })
const B = createBeam({ start: [0, 2], end: [3, 2], preset: '6x8', levelId: 'level_g' })

beforeEach(() => {
  const building = BuildingNode.parse({ id: 'building_a', children: ['level_g'] })
  const level = LevelNode.parse({
    id: 'level_g',
    parentId: building.id,
    level: 0,
    height: 2.7,
    children: ['slab_g', A.id, B.id],
  })
  const slab = SlabNode.parse({
    id: 'slab_g',
    parentId: level.id,
    polygon: [
      [-1, -1],
      [5, -1],
      [5, 5],
      [-1, 5],
    ],
    elevation: 0.05,
    thickness: 0.2,
  })
  const nodes = Object.fromEntries([building, level, slab, A, B].map((node) => [node.id, node]))
  useScene.getState().setScene(nodes as Record<AnyNodeId, AnyNode>, [building.id as AnyNodeId], {
    installedPlugins: [],
    hasExplicitPluginInstallState: false,
  })
  clearSceneHistory()
})

const read = (id: string) => useScene.getState().nodes[id as AnyNodeId] as BeamNode
const controls = () =>
  beamPanelModel.multiControls!({
    selection: [read(A.id), read(B.id)],
    nodes: useScene.getState().nodes,
  })

test('selected beams take a size, a material and a top together, in one undo step', () => {
  const [size, material, top] = controls()
  expect(size).toMatchObject({ id: 'beam-size', value: '6x8' })
  expect(material).toMatchObject({ id: 'beam-material', value: 'sawn' })
  expect(top).toMatchObject({ id: 'beam-top', value: 'ceiling-dropped' })
  if (size?.kind !== 'select') throw new Error('size is a select')
  size.onChange('(3)2x10')
  for (const id of [A.id, B.id]) {
    expect(read(id)).toMatchObject({ size: '2x10', plies: 3 })
    expect(read(id).width).toBeCloseTo(4.5 * IN)
  }
  const [, , nextTop] = controls()
  if (nextTop?.kind !== 'select') throw new Error('top is a select')
  nextTop.onChange('floor-flush')
  expect(read(A.id)).toMatchObject({ topElevation: 0.05, placement: 'flush' })
  useScene.temporal.getState().undo()
  expect(read(B.id).topElevation).toBeUndefined()
})

test('a mixed selection shows no value; a custom section reads Custom', () => {
  useScene.getState().updateNode(B.id, { material: 'lvl' })
  const [, material] = controls()
  expect(material?.kind === 'select' && material.value).toBeNull()
  const custom = { ...read(A.id), width: 2 * IN, size: undefined }
  expect(beamSizeValue(custom)).toBe('custom')
  expect(beamSizeOptions('custom')[0]).toEqual({ label: 'Custom', value: 'custom' })
  expect(beamSizeOptions('6x8').some((option) => option.value === 'custom')).toBe(false)
})

test('the XR rows step through sizes and materials', () => {
  const rows = beamPanelModel.rows({
    node: read(A.id),
    nodes: useScene.getState().nodes,
    update: (patch) => useScene.getState().updateNode(A.id, patch),
  })
  const size = rows.find((row) => row.id === 'beam-size')
  expect(size?.kind === 'cycle' && size.value).toBe('6x8')
  if (size?.kind === 'cycle') size.next()
  expect(read(A.id).size).toBe('6x10')
})

test('plies add boards of the same width', () => {
  const doubled = createBeam({ start: [0, 0], end: [1, 0], preset: '(2)2x10' })
  expect(beamPliesPatch(doubled, 3).width).toBeCloseTo(4.5 * IN)
  expect(beamPliesPatch(doubled, 1)).toMatchObject({ plies: 1 })
})
