import { describe, expect, test } from 'bun:test'
import { LevelNode, RoofNode, RoofSegmentNode } from '@pascal-app/core'
import * as THREE from 'three'
import { Brush, Evaluator } from 'three-bvh-csg'
import { prepareBrushForCSG, subtractCsgBrush } from '../../lib/csg-utils'
import { generateRoofSegmentGeometry } from './roof-system'

function box(size: [number, number, number], position: [number, number, number]): Brush {
  const brush = new Brush(new THREE.BoxGeometry(...size))
  brush.position.set(...position)
  prepareBrushForCSG(brush)
  return brush
}

describe('roof system intersections', () => {
  test('keeps a declared host solid and clips the mounted conical wall at its surface', () => {
    const level = LevelNode.parse({
      id: 'level_conical-cut',
      type: 'level',
      children: ['roof_host', 'roof_conical'],
    })
    const hostRoof = RoofNode.parse({
      id: 'roof_host',
      type: 'roof',
      parentId: level.id,
      children: ['rseg_host'],
    })
    const conicalRoof = RoofNode.parse({
      id: 'roof_conical',
      type: 'roof',
      parentId: level.id,
      position: [0, 3.0657691454, 0],
      children: ['rseg_conical'],
      support: {
        kind: 'roof',
        roofSegmentId: 'rseg_host',
        localPosition: [0, 0],
        curbHeight: 0.5,
      },
    })
    const host = RoofSegmentNode.parse({
      id: 'rseg_host',
      type: 'roof-segment',
      parentId: hostRoof.id,
      roofType: 'gable',
      width: 10,
      depth: 8,
      wallHeight: 2,
      pitch: 25,
    })
    const conical = RoofSegmentNode.parse({
      id: 'rseg_conical',
      type: 'roof-segment',
      parentId: conicalRoof.id,
      roofType: 'conical',
      width: 3,
      depth: 3,
      wallHeight: 1.2994614872,
      pitch: 50,
    })
    const nodes = {
      [level.id]: level,
      [hostRoof.id]: hostRoof,
      [conicalRoof.id]: conicalRoof,
      [host.id]: host,
      [conical.id]: conical,
    }
    const unclipped = generateRoofSegmentGeometry(host)
    const clipped = generateRoofSegmentGeometry(host, nodes)
    const meshBefore = new THREE.Mesh(unclipped)
    const meshAfter = new THREE.Mesh(clipped)
    const hitsAt = (mesh: THREE.Mesh, x: number, z: number) =>
      new THREE.Raycaster(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0)).intersectObject(
        mesh,
      )

    expect(hitsAt(meshBefore, 1.4, 0).length).toBeGreaterThan(0)
    expect(hitsAt(meshAfter, 1.4, 0).length).toBeGreaterThan(0)
    expect(Array.from(clipped.getAttribute('position').array).every(Number.isFinite)).toBe(true)

    const unclippedConical = generateRoofSegmentGeometry(conical)
    const clippedConical = generateRoofSegmentGeometry(conical, nodes)
    const sideHitsAt = (geometry: THREE.BufferGeometry, y: number) =>
      new THREE.Raycaster(new THREE.Vector3(3, y, 0), new THREE.Vector3(-1, 0, 0)).intersectObject(
        new THREE.Mesh(geometry),
      )

    expect(sideHitsAt(unclippedConical, 0.7).length).toBeGreaterThan(0)
    expect(sideHitsAt(clippedConical, 0.7)).toHaveLength(0)
    expect(sideHitsAt(clippedConical, 0.9).length).toBeGreaterThan(0)

    unclipped.dispose()
    clipped.dispose()
    unclippedConical.dispose()
    clippedConical.dispose()
  })

  test('removes a roof layer that continues through a sibling attic', () => {
    const layer = box([4, 0.2, 4], [0, 1, 0])
    const siblingInterior = box([2, 3, 2], [0, 1, 0])
    const evaluator = new Evaluator()
    evaluator.attributes = ['position', 'normal', 'uv']

    const result = subtractCsgBrush(layer, siblingInterior, evaluator)
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

  test('clips an entering gable created as a separate roof on the same level', () => {
    const level = LevelNode.parse({
      id: 'level_main',
      type: 'level',
      children: ['roof_mansard', 'roof_gable'],
    })
    const mansardRoof = RoofNode.parse({
      id: 'roof_mansard',
      type: 'roof',
      parentId: level.id,
      children: ['rseg_mansard'],
    })
    const gableRoof = RoofNode.parse({
      id: 'roof_gable',
      type: 'roof',
      parentId: level.id,
      position: [3, 0, 0],
      children: ['rseg_gable'],
    })
    const mansard = RoofSegmentNode.parse({
      id: 'rseg_mansard',
      type: 'roof-segment',
      parentId: mansardRoof.id,
      roofType: 'mansard',
      width: 10,
      depth: 8,
      wallHeight: 3,
      pitch: 30,
    })
    const gable = RoofSegmentNode.parse({
      id: 'rseg_gable',
      type: 'roof-segment',
      parentId: gableRoof.id,
      roofType: 'gable',
      width: 8,
      depth: 5,
      wallHeight: 3,
      pitch: 35,
      rotation: Math.PI / 2,
    })
    const nodes = {
      [level.id]: level,
      [mansardRoof.id]: mansardRoof,
      [gableRoof.id]: gableRoof,
      [mansard.id]: mansard,
      [gable.id]: gable,
    }

    const unclipped = generateRoofSegmentGeometry(gable)
    const clipped = generateRoofSegmentGeometry(gable, nodes)
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 10, -2), new THREE.Vector3(0, -1, 0))

    expect(ray.intersectObject(new THREE.Mesh(unclipped)).length).toBeGreaterThan(0)
    expect(ray.intersectObject(new THREE.Mesh(clipped))).toHaveLength(0)

    unclipped.dispose()
    clipped.dispose()
  })

  test('keeps equal-area roof ownership stable when level children are reordered', () => {
    const level = LevelNode.parse({
      id: 'level_main',
      type: 'level',
      children: ['roof_z_gable', 'roof_a_mansard'],
    })
    const mansardRoof = RoofNode.parse({
      id: 'roof_a_mansard',
      type: 'roof',
      parentId: level.id,
      children: ['rseg_mansard'],
    })
    const gableRoof = RoofNode.parse({
      id: 'roof_z_gable',
      type: 'roof',
      parentId: level.id,
      position: [3, 0, 0],
      children: ['rseg_gable'],
    })
    const mansard = RoofSegmentNode.parse({
      id: 'rseg_mansard',
      type: 'roof-segment',
      parentId: mansardRoof.id,
      roofType: 'mansard',
      width: 10,
      depth: 4,
      wallHeight: 3,
      pitch: 30,
    })
    const gable = RoofSegmentNode.parse({
      id: 'rseg_gable',
      type: 'roof-segment',
      parentId: gableRoof.id,
      roofType: 'gable',
      width: 8,
      depth: 5,
      wallHeight: 3,
      pitch: 35,
      rotation: Math.PI / 2,
    })
    const nodes = {
      [level.id]: level,
      [mansardRoof.id]: mansardRoof,
      [gableRoof.id]: gableRoof,
      [mansard.id]: mansard,
      [gable.id]: gable,
    }
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 10, -2), new THREE.Vector3(0, -1, 0))

    const unclipped = generateRoofSegmentGeometry(gable)
    const clippedBeforeReorder = generateRoofSegmentGeometry(gable, nodes)
    const unclippedHitCount = ray.intersectObject(new THREE.Mesh(unclipped)).length
    const clippedBeforeHitCount = ray.intersectObject(new THREE.Mesh(clippedBeforeReorder)).length
    expect(clippedBeforeHitCount).toBeLessThan(unclippedHitCount)

    const reorderedLevel = LevelNode.parse({
      ...level,
      children: ['roof_a_mansard', 'roof_z_gable'],
    })
    const clippedAfterReorder = generateRoofSegmentGeometry(gable, {
      ...nodes,
      [level.id]: reorderedLevel,
    })
    expect(ray.intersectObject(new THREE.Mesh(clippedAfterReorder))).toHaveLength(
      clippedBeforeHitCount,
    )

    unclipped.dispose()
    clippedBeforeReorder.dispose()
    clippedAfterReorder.dispose()
  })

  test('clips two entering roofs against one larger host roof', () => {
    const level = LevelNode.parse({
      id: 'level_main',
      type: 'level',
      children: ['roof_host', 'roof_east', 'roof_west'],
    })
    const hostRoof = RoofNode.parse({
      id: 'roof_host',
      type: 'roof',
      parentId: level.id,
      children: ['rseg_host'],
    })
    const eastRoof = RoofNode.parse({
      id: 'roof_east',
      type: 'roof',
      parentId: level.id,
      position: [3, 0, 0],
      children: ['rseg_east'],
    })
    const westRoof = RoofNode.parse({
      id: 'roof_west',
      type: 'roof',
      parentId: level.id,
      position: [-3, 0, 0],
      children: ['rseg_west'],
    })
    const host = RoofSegmentNode.parse({
      id: 'rseg_host',
      type: 'roof-segment',
      parentId: hostRoof.id,
      roofType: 'mansard',
      width: 12,
      depth: 10,
      wallHeight: 3,
      pitch: 30,
    })
    const east = RoofSegmentNode.parse({
      id: 'rseg_east',
      type: 'roof-segment',
      parentId: eastRoof.id,
      roofType: 'gable',
      width: 8,
      depth: 5,
      wallHeight: 3,
      pitch: 35,
      rotation: Math.PI / 2,
    })
    const west = RoofSegmentNode.parse({
      ...east,
      id: 'rseg_west',
      parentId: westRoof.id,
    })
    const nodes = {
      [level.id]: level,
      [hostRoof.id]: hostRoof,
      [eastRoof.id]: eastRoof,
      [westRoof.id]: westRoof,
      [host.id]: host,
      [east.id]: east,
      [west.id]: west,
    }

    const eastGeometry = generateRoofSegmentGeometry(east, nodes)
    const westGeometry = generateRoofSegmentGeometry(west, nodes)
    const eastRay = new THREE.Raycaster(new THREE.Vector3(0, 10, -2), new THREE.Vector3(0, -1, 0))
    const westRay = new THREE.Raycaster(new THREE.Vector3(0, 10, 2), new THREE.Vector3(0, -1, 0))

    expect(eastRay.intersectObject(new THREE.Mesh(eastGeometry))).toHaveLength(0)
    expect(westRay.intersectObject(new THREE.Mesh(westGeometry))).toHaveLength(0)

    eastGeometry.dispose()
    westGeometry.dispose()
  })

  test('clips a custom-footprint lean-to deck against a separate host roof', () => {
    const level = LevelNode.parse({
      id: 'level_main',
      type: 'level',
      children: ['roof_host', 'roof_lean_to'],
    })
    const hostRoof = RoofNode.parse({
      id: 'roof_host',
      type: 'roof',
      parentId: level.id,
      children: ['rseg_host'],
    })
    const leanToRoof = RoofNode.parse({
      id: 'roof_lean_to',
      type: 'roof',
      parentId: level.id,
      position: [3, 0, 0],
      children: ['rseg_lean_to'],
    })
    const host = RoofSegmentNode.parse({
      id: 'rseg_host',
      type: 'roof-segment',
      parentId: hostRoof.id,
      roofType: 'mansard',
      width: 10,
      depth: 8,
      wallHeight: 3,
      pitch: 30,
    })
    const leanTo = RoofSegmentNode.parse({
      id: 'rseg_lean_to',
      type: 'roof-segment',
      parentId: leanToRoof.id,
      roofType: 'shed',
      width: 8,
      depth: 4,
      wallHeight: 3,
      pitch: 15,
      overhang: 0,
      shedFootprintPieces: [
        [
          [-4, -2],
          [4, -2],
          [4, 2],
          [-4, 2],
        ],
      ],
    })
    const nodes = {
      [level.id]: level,
      [hostRoof.id]: hostRoof,
      [leanToRoof.id]: leanToRoof,
      [host.id]: host,
      [leanTo.id]: leanTo,
    }
    const unclipped = generateRoofSegmentGeometry(leanTo)
    const clipped = generateRoofSegmentGeometry(leanTo, nodes)

    expect(clipped.getAttribute('position').count).not.toBe(
      unclipped.getAttribute('position').count,
    )

    unclipped.dispose()
    clipped.dispose()
  })

  test('uses every segment in a multi-segment host roof as an occluder', () => {
    const level = LevelNode.parse({
      id: 'level_main',
      type: 'level',
      children: ['roof_host', 'roof_entering'],
    })
    const hostRoof = RoofNode.parse({
      id: 'roof_host',
      type: 'roof',
      parentId: level.id,
      children: ['rseg_far', 'rseg_host'],
    })
    const enteringRoof = RoofNode.parse({
      id: 'roof_entering',
      type: 'roof',
      parentId: level.id,
      position: [3, 0, 0],
      children: ['rseg_entering'],
    })
    const farSegment = RoofSegmentNode.parse({
      id: 'rseg_far',
      type: 'roof-segment',
      parentId: hostRoof.id,
      roofType: 'gable',
      width: 2,
      depth: 2,
      wallHeight: 3,
      pitch: 30,
      position: [20, 0, 0],
    })
    const hostSegment = RoofSegmentNode.parse({
      id: 'rseg_host',
      type: 'roof-segment',
      parentId: hostRoof.id,
      roofType: 'mansard',
      width: 10,
      depth: 8,
      wallHeight: 3,
      pitch: 30,
    })
    const enteringSegment = RoofSegmentNode.parse({
      id: 'rseg_entering',
      type: 'roof-segment',
      parentId: enteringRoof.id,
      roofType: 'gable',
      width: 8,
      depth: 5,
      wallHeight: 3,
      pitch: 35,
      rotation: Math.PI / 2,
    })
    const nodes = {
      [level.id]: level,
      [hostRoof.id]: hostRoof,
      [enteringRoof.id]: enteringRoof,
      [farSegment.id]: farSegment,
      [hostSegment.id]: hostSegment,
      [enteringSegment.id]: enteringSegment,
    }
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 10, -2), new THREE.Vector3(0, -1, 0))

    const clipped = generateRoofSegmentGeometry(enteringSegment, nodes)
    expect(ray.intersectObject(new THREE.Mesh(clipped))).toHaveLength(0)

    clipped.dispose()
  })
})
