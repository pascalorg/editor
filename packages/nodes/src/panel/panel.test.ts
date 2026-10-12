import { describe, expect, test } from 'bun:test'
import { PanelNode, panelDepthOffset, WallNode } from '@pascal-app/core'
import type { Mesh } from 'three'
import { panelDefinition } from './definition'
import { buildPanelFloorplan } from './floorplan'
import { buildPanelGeometry } from './geometry'
import { PANEL_SLOT_ID } from './slots'

const wall = WallNode.parse({ start: [0, 0], end: [8, 0], thickness: 0.2 })
const panel = (extra: Partial<PanelNode> = {}) =>
  PanelNode.parse({
    parentId: wall.id,
    wallId: wall.id,
    position: [2, 1.5, 0],
    width: 1.2,
    height: 2,
    ...extra,
  })
/** Geometry buffers are float32, so reads out of them compare to 6 places. */
const body = (node: PanelNode) =>
  buildPanelGeometry(node, { parent: wall, materials: {} }).children[0] as Mesh

describe('panel', () => {
  test('sits on the chosen face, its back against the wall', () => {
    // Half the 0.2 m wall plus half the default 0.03 m panel.
    expect(panelDepthOffset(panel(), wall)).toBeCloseTo(0.115, 9)
    expect(panelDepthOffset(panel({ side: 'back' }), wall)).toBeCloseTo(-0.115, 9)
  })

  test('a stand-off lifts it off the face', () => {
    expect(panelDepthOffset(panel({ offset: 0.05 }), wall)).toBeCloseTo(0.165, 9)
  })

  test('follows the wall thickness it is built against', () => {
    const thick = { ...wall, thickness: 0.4 }
    expect(panelDepthOffset(panel(), thick)).toBeCloseTo(0.215, 9)
  })

  test('builds one box sized to the panel, tagged with its paintable slot', () => {
    const mesh = body(panel())
    mesh.geometry.computeBoundingBox()
    const size = mesh.geometry.boundingBox!.max.clone().sub(mesh.geometry.boundingBox!.min)
    expect(size.x).toBeCloseTo(1.2, 6)
    expect(size.y).toBeCloseTo(2, 6)
    expect(size.z).toBeCloseTo(0.03, 6)
    expect(mesh.position.z).toBeCloseTo(0.115, 9)
    expect(mesh.userData.slotId).toBe(PANEL_SLOT_ID)
  })

  test('its face UVs are in metres, so a finish tiles at real size', () => {
    const uv = body(panel()).geometry.getAttribute('uv')
    // The +Z face is the fifth of six, four vertices each.
    const us = [0, 1, 2, 3].map((v) => uv.getX(16 + v))
    const vs = [0, 1, 2, 3].map((v) => uv.getY(16 + v))
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(1.2, 6)
    expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(2, 6)
  })

  test('draws in plan as a strip off the wall face, across its width', () => {
    const plan = buildPanelFloorplan(panel(), { parent: wall } as never)
    expect(plan?.kind).toBe('polygon')
    const points = (plan as { points: [number, number][] }).points
    expect(Math.min(...points.map((p) => p[0]))).toBeCloseTo(1.4, 9)
    expect(Math.max(...points.map((p) => p[0]))).toBeCloseTo(2.6, 9)
    // Front of a wall drawn along +x is +z: the strip spans 0.1 → 0.13.
    expect(Math.min(...points.map((p) => p[1]))).toBeCloseTo(0.1, 9)
    expect(Math.max(...points.map((p) => p[1]))).toBeCloseTo(0.13, 9)
  })

  test('is hosted by walls and re-derives its wall when placed from a preset', () => {
    expect(panelDefinition.capabilities.hostRefFields).toEqual(['wallId'])
    expect(panelDefinition.capabilities.slots?.(panel()).map((s) => s.slotId)).toEqual([
      PANEL_SLOT_ID,
    ])
  })
})
