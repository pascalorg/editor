import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  ColumnNode,
  columnPlanLeanOffset,
  ItemNode,
  nodeRegistry,
  registerNode,
} from '@pascal-app/core'
import { create } from '@react-three/test-renderer'
import { type Matrix4, type Mesh, type Object3D, Vector3 } from 'three'
import { hostedChildUpdates } from '../shared/hosted-resize'
import { columnDefinition } from './definition'
import { buildColumnFloorplan, getColumnFloorplanFootprint } from './floorplan'
import { columnHostedPolicy } from './hosted-resize'
import { ColumnPreview, ColumnRenderer, columnLeanMatrix } from './renderer'
import { columnTopSurfaces } from './surface'

const deg = (degrees: number) => (degrees * Math.PI) / 180
const tilted = ColumnNode.parse({
  id: 'column_tilted',
  position: [2, 0, 1],
  rotation: deg(30),
  tiltX: deg(20),
  tiltZ: deg(-10),
  height: 3,
  crossSection: 'square',
  width: 0.4,
  depth: 0.4,
})

async function meshMatrices(element: React.ReactElement) {
  const renderer = await create(element)
  renderer.scene.instance.updateMatrixWorld(true)
  const matrices: Matrix4[] = []
  let leanGroup: Object3D | undefined
  renderer.scene.instance.traverse((object) => {
    if ((object as Mesh).isMesh) matrices.push(object.matrixWorld.clone())
    if (!object.matrixAutoUpdate) leanGroup ??= object
  })
  return { renderer, matrices, leanGroup }
}

describe('tilted column', () => {
  test('the placement ghost leans exactly like the rendered column', async () => {
    const ghost = await meshMatrices(<ColumnPreview node={tilted} />)
    const column = await meshMatrices(<ColumnRenderer node={tilted} />)
    expect(ghost.matrices.length).toBeGreaterThan(0)
    expect(column.matrices).toHaveLength(ghost.matrices.length)
    for (const [i, matrix] of ghost.matrices.entries()) {
      // The renderer sits at the node position; the ghost at the cursor origin.
      const placed = matrix
        .clone()
        .setPosition(
          new Vector3().setFromMatrixPosition(matrix).add(new Vector3(...tilted.position)),
        )
      for (const [k, value] of column.matrices[i]!.elements.entries())
        expect(value).toBeCloseTo(placed.elements[k]!, 9)
    }
    await ghost.renderer.unmount()
    await column.renderer.unmount()
  })

  test('the lean shears with height in the yawed frame and keeps the base planted', async () => {
    const { renderer, leanGroup } = await meshMatrices(<ColumnPreview node={tilted} />)
    expect(leanGroup).toBeDefined()
    const base = new Vector3(0, 0, 0).applyMatrix4(leanGroup!.matrixWorld)
    expect(base.length()).toBeCloseTo(0, 9)
    const top = new Vector3(0, 3, 0).applyMatrix4(leanGroup!.matrixWorld)
    const [dx, dz] = columnPlanLeanOffset(tilted, 3)
    expect(top.x).toBeCloseTo(dx, 9)
    expect(top.y).toBeCloseTo(3, 9)
    expect(top.z).toBeCloseTo(dz, 9)
    expect(columnLeanMatrix(ColumnNode.parse({}))).toBeNull()
    await renderer.unmount()
  })

  test('the plan covers the lean and outlines the leaned top', () => {
    const [dx, dz] = columnPlanLeanOffset(tilted, tilted.height)
    const footprint = getColumnFloorplanFootprint(tilted)
    const upright = getColumnFloorplanFootprint({ ...tilted, tiltX: undefined, tiltZ: undefined })
    const extent = (points: readonly (readonly [number, number])[], axis: 0 | 1) =>
      Math.max(...points.map((p) => p[axis])) - Math.min(...points.map((p) => p[axis]))
    expect(extent(footprint, 0)).toBeCloseTo(extent(upright, 0) + Math.abs(dx), 3)
    expect(extent(footprint, 1)).toBeCloseTo(extent(upright, 1) + Math.abs(dz), 3)

    const geometry = buildColumnFloorplan(tilted, {
      resolve: () => undefined,
      children: [],
      siblings: [],
      parent: null,
    })
    expect(geometry?.kind).toBe('group')
    if (geometry?.kind !== 'group') return
    const top = geometry.children.find(
      (child) => child.kind === 'polygon' && child.strokeDasharray !== undefined,
    )
    expect(top?.kind === 'polygon' && top.points).toEqual(
      upright.map(([x, z]) => [expect.closeTo(x + dx, 9), expect.closeTo(z + dz, 9)]),
    )
  })

  test('the top support stays level and slides over with the lean', () => {
    const [top] = columnTopSurfaces(tilted)
    const [upright] = columnTopSurfaces({ ...tilted, tiltX: undefined, tiltZ: undefined })
    const y = upright!.position[1]
    expect(top!.normal).toEqual([0, 1, 0])
    expect(top!.position[0]).toBeCloseTo(-Math.tan(deg(-10)) * y, 9)
    expect(top!.position[1]).toBe(y)
    expect(top!.position[2]).toBeCloseTo(Math.tan(deg(20)) * y, 9)
    expect(top!.region).toEqual(upright!.region)
  })
})

describe('tilting a column with an object on top', () => {
  let restore: () => void
  beforeEach(() => {
    restore = nodeRegistry._snapshot()
    registerNode(columnDefinition)
  })
  afterEach(() => restore())

  test('carries the object with the leaned top', () => {
    const column = ColumnNode.parse({ id: 'column_host', crossSection: 'square', height: 2.5 })
    const [top] = columnTopSurfaces(column)
    const vase = ItemNode.parse({
      id: 'item_vase',
      parentId: column.id,
      position: [0, top!.position[1], 0],
      asset: {
        id: 'vase',
        name: 'Vase',
        category: 'decor',
        thumbnail: '',
        src: '/vase.glb',
        dimensions: [0.1, 0.2, 0.1],
      },
    })
    const before = {
      [column.id]: { ...column, children: [vase.id] },
      [vase.id]: vase,
    } as Record<AnyNodeId, AnyNode>
    const leaning = { ...before[column.id], tiltX: deg(5) } as ColumnNode
    const updates = hostedChildUpdates(
      before,
      { ...before, [column.id]: leaning },
      columnHostedPolicy,
    )
    const [leanedTop] = columnTopSurfaces(leaning)
    expect(updates).toEqual([[vase.id, { position: leanedTop!.position }]])
  })
})
