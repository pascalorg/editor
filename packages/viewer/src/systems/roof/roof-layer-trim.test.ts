import { describe, expect, test } from 'bun:test'
import { RoofNode, RoofSegmentNode } from '@pascal-app/core'
import * as THREE from 'three'
import { Brush, Evaluator } from 'three-bvh-csg'
import { prepareBrushForCSG } from '../../lib/csg-utils'
import { subtractRoofInterior } from './roof-layer-trim'
import { generateRoofSegmentGeometry } from './roof-system'

function box(size: [number, number, number], position: [number, number, number]): Brush {
  const brush = new Brush(new THREE.BoxGeometry(...size))
  brush.position.set(...position)
  prepareBrushForCSG(brush)
  return brush
}

describe('subtractRoofInterior', () => {
  test('removes a roof layer that continues through a sibling attic', () => {
    const layer = box([4, 0.2, 4], [0, 1, 0])
    const siblingInterior = box([2, 3, 2], [0, 1, 0])
    const evaluator = new Evaluator()
    evaluator.attributes = ['position', 'normal', 'uv']

    const result = subtractRoofInterior(layer, siblingInterior, evaluator)
    const mesh = new THREE.Mesh(result.geometry)
    const centerHits = new THREE.Raycaster(
      new THREE.Vector3(0, 3, 0),
      new THREE.Vector3(0, -1, 0),
    ).intersectObject(mesh)
    const edgeHits = new THREE.Raycaster(
      new THREE.Vector3(1.5, 3, 0),
      new THREE.Vector3(0, -1, 0),
    ).intersectObject(mesh)

    expect(centerHits).toHaveLength(0)
    expect(edgeHits.length).toBeGreaterThan(0)

    layer.geometry.dispose()
    siblingInterior.geometry.dispose()
    result.geometry.dispose()
  })

  test('clips a painted gable segment against its mansard sibling', () => {
    const roof = RoofNode.parse({
      id: 'roof_join',
      type: 'roof',
      children: ['rseg_mansard', 'rseg_gable'],
    })
    const mansard = RoofSegmentNode.parse({
      id: 'rseg_mansard',
      type: 'roof-segment',
      parentId: roof.id,
      roofType: 'mansard',
      width: 10,
      depth: 8,
      wallHeight: 3,
      pitch: 30,
    })
    const gable = RoofSegmentNode.parse({
      id: 'rseg_gable',
      type: 'roof-segment',
      parentId: roof.id,
      roofType: 'gable',
      width: 8,
      depth: 5,
      wallHeight: 3,
      pitch: 35,
      position: [3, 0, 0],
      rotation: Math.PI / 2,
      materialPreset: 'library:roof-shingle',
    })
    const nodes = { [roof.id]: roof, [mansard.id]: mansard, [gable.id]: gable }

    const unclipped = generateRoofSegmentGeometry(gable)
    const clipped = generateRoofSegmentGeometry(gable, nodes)
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 10, -2), new THREE.Vector3(0, -1, 0))

    const unclippedHits = ray.intersectObject(new THREE.Mesh(unclipped))
    const clippedHits = ray.intersectObject(new THREE.Mesh(clipped))
    expect(unclippedHits.length).toBeGreaterThan(0)
    expect(clippedHits).toHaveLength(0)

    unclipped.dispose()
    clipped.dispose()
  })

  test('keeps the host mansard shell beneath an entering gable', () => {
    const roof = RoofNode.parse({
      id: 'roof_join',
      type: 'roof',
      children: ['rseg_mansard', 'rseg_gable'],
    })
    const mansard = RoofSegmentNode.parse({
      id: 'rseg_mansard',
      type: 'roof-segment',
      parentId: roof.id,
      roofType: 'mansard',
      width: 10,
      depth: 8,
      wallHeight: 3,
      pitch: 30,
    })
    const gable = RoofSegmentNode.parse({
      id: 'rseg_gable',
      type: 'roof-segment',
      parentId: roof.id,
      roofType: 'gable',
      width: 8,
      depth: 5,
      wallHeight: 3,
      pitch: 35,
      position: [3, 0, 0],
      rotation: Math.PI / 2,
    })
    const nodes = { [roof.id]: roof, [mansard.id]: mansard, [gable.id]: gable }

    const mansardWithSibling = generateRoofSegmentGeometry(mansard, nodes)
    const ray = new THREE.Raycaster(new THREE.Vector3(3, 10, 0), new THREE.Vector3(0, -1, 0))

    expect(ray.intersectObject(new THREE.Mesh(mansardWithSibling)).length).toBeGreaterThan(0)

    mansardWithSibling.dispose()
  })
})
