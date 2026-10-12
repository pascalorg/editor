import { describe, expect, test } from 'bun:test'
import { ColumnNode } from '@pascal-app/core'
import { create } from '@react-three/test-renderer'
import { Box3, type Mesh } from 'three'
import { getColumnFloorplanFootprint } from './floorplan'
import { ColumnPreview } from './renderer'
import { columnCapitalBlocks, columnShaftLayout } from './shape'
import { columnTopSurfaces } from './surface'

const bare = {
  crossSection: 'i-beam',
  width: 0.3,
  depth: 0.4,
  height: 3,
  baseStyle: 'none',
  capitalStyle: 'none',
} as const

describe('i-beam column', () => {
  test('renders two flanges and a web spanning the section', async () => {
    const renderer = await create(<ColumnPreview node={ColumnNode.parse(bare)} />)
    const meshes: Mesh[] = []
    renderer.scene.instance.updateMatrixWorld(true)
    renderer.scene.instance.traverse((object) => {
      if ((object as Mesh).isMesh) meshes.push(object as Mesh)
    })
    expect(meshes).toHaveLength(3)
    const bounds = new Box3()
    for (const mesh of meshes) bounds.expandByObject(mesh)
    expect(bounds.min.x).toBeCloseTo(-0.15)
    expect(bounds.max.x).toBeCloseTo(0.15)
    expect(bounds.min.z).toBeCloseTo(-0.2)
    expect(bounds.max.z).toBeCloseTo(0.2)
    expect(bounds.max.y).toBeCloseTo(3)
    const web = meshes.find((mesh) => {
      const box = new Box3().setFromObject(mesh)
      return box.max.x - box.min.x < 0.1
    })
    expect(web).toBeDefined()
    await renderer.unmount()
  })

  test('a bare i-beam draws its true section in plan', () => {
    const column = ColumnNode.parse({ ...bare, position: [2, 0, 1] })
    const footprint = getColumnFloorplanFootprint(column)
    expect(footprint).toHaveLength(12)
    expect(Math.min(...footprint.map(([x]) => x))).toBeCloseTo(1.85)
    expect(Math.max(...footprint.map(([, z]) => z))).toBeCloseTo(1.2)
  })

  test('an i-beam with plates draws the plate rectangle in plan', () => {
    const column = ColumnNode.parse({ ...bare, baseStyle: 'simple-square' })
    expect(getColumnFloorplanFootprint(column)).toHaveLength(4)
  })

  test('caps with box plates and supports objects on the section', () => {
    const capped = ColumnNode.parse({ ...bare, capitalStyle: 'simple-slab' })
    const layout = columnShaftLayout(capped)
    expect(
      columnCapitalBlocks(capped, layout.shaftY + layout.shaftHeight, layout.capitalHeight),
    ).toEqual([expect.objectContaining({ kind: 'box' })])

    const [top] = columnTopSurfaces(ColumnNode.parse(bare))
    expect(top?.position).toEqual([0, 3, 0])
    expect(top?.region).toMatchObject({ kind: 'polygon' })
    expect(top?.region.kind === 'polygon' && top.region.points).toHaveLength(12)
  })
})
