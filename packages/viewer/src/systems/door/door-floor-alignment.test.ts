// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { DoorNode } from '@pascal-app/core'
import * as THREE from 'three'
import { buildDoorPreviewMesh } from '../../index'

const DOOR_TYPES = [
  'hinged',
  'double',
  'french',
  'folding',
  'pocket',
  'barn',
  'sliding',
  'garage-sectional',
  'garage-rollup',
  'garage-tiltup',
] as const

function visibleBounds(mesh: THREE.Mesh): THREE.Box3 {
  mesh.updateMatrixWorld(true)
  const bounds = new THREE.Box3()
  for (const child of mesh.children) {
    if (child.name === 'cutout') continue
    bounds.expandByObject(child, true)
  }
  return bounds
}

describe('door floor alignment', () => {
  for (const doorType of DOOR_TYPES) {
    test(`${doorType} does not extend below the opening floor`, () => {
      const node = DoorNode.parse({
        id: `door_floor-alignment-${doorType}`,
        doorType,
        operationState: 0,
        threshold: true,
      })
      const mesh = buildDoorPreviewMesh(node)
      const bounds = visibleBounds(mesh)

      expect(bounds.min.y).toBeGreaterThanOrEqual(-node.height / 2 - 1e-6)
    })
  }

  test('keeps the wall cutout bottom locked to the opening floor', () => {
    const node = DoorNode.parse({ id: 'door_floor-alignment-cutout' })
    const mesh = buildDoorPreviewMesh(node)
    const cutout = mesh.getObjectByName('cutout') as THREE.Mesh
    cutout.geometry.computeBoundingBox()

    expect(cutout.geometry.boundingBox?.min.y).toBeCloseTo(-node.height / 2, 6)
  })
})

test('a floor-anchored door mesh stands on the higher room while stored coordinates stay unchanged', async () => {
  const { useScene } = await import('@pascal-app/core')
  const { reconcileStructureOnLoad } = await import('@pascal-app/core/scene-migrations')
  const { floorStepFixture } = await import(
    '../../../../core/src/systems/slab/__fixtures__/floor-step'
  )
  const fixture = floorStepFixture()
  fixture.level.height = 3
  for (const [i, zone] of fixture.zones.entries())
    fixture.nodes[zone.id] = { ...zone, floor: { elevation: i ? 0.05 : 0.55 } }
  fixture.nodes[fixture.door.id] = fixture.door
  fixture.nodes[fixture.divider.id] = { ...fixture.divider, children: [fixture.door.id] }
  const nodes = reconcileStructureOnLoad(fixture.nodes).nodes
  const previous = useScene.getState()
  useScene.setState({ nodes })
  try {
    const mesh = buildDoorPreviewMesh(fixture.door)
    expect(mesh.position.y - fixture.door.height / 2 + 0.05).toBeCloseTo(0.55)
    expect(fixture.door.position).toEqual([2, 1, 0])
    mesh.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose()
    })
  } finally {
    useScene.setState(previous, true)
  }
})
