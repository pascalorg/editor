import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanGeometry,
  type GeometryContext,
  RoofNode,
  RoofSegmentNode,
} from '@pascal-app/core'
import { buildRoofFloorplan } from './floorplan'

function buildContext(
  node: ReturnType<typeof RoofNode.parse>,
  children: AnyNode[],
  siblings: AnyNode[],
  nodes: Record<string, AnyNode>,
): GeometryContext {
  return {
    resolve: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
    children,
    siblings,
    parent: null,
  }
}

function outlinePoints(geometry: FloorplanGeometry | null): [number, number][] {
  if (geometry?.kind !== 'group') return []
  return geometry.children.flatMap((child) =>
    child.kind === 'polygon' && child.fill === 'none' ? (child.points as [number, number][]) : [],
  )
}

describe('buildRoofFloorplan roof intersections', () => {
  test('clips the smaller roof footprint and keeps the larger host outline', () => {
    const hostRoof = RoofNode.parse({
      id: 'roof_host',
      type: 'roof',
      children: ['rseg_host'],
    })
    const enteringRoof = RoofNode.parse({
      id: 'roof_entering',
      type: 'roof',
      position: [3, 0, 0],
      children: ['rseg_entering'],
    })
    const hostSegment = RoofSegmentNode.parse({
      id: 'rseg_host',
      type: 'roof-segment',
      parentId: hostRoof.id,
      roofType: 'mansard',
      width: 10,
      depth: 8,
    })
    const enteringSegment = RoofSegmentNode.parse({
      id: 'rseg_entering',
      type: 'roof-segment',
      parentId: enteringRoof.id,
      roofType: 'gable',
      width: 8,
      depth: 4,
    })
    const nodes = {
      [hostRoof.id]: hostRoof,
      [enteringRoof.id]: enteringRoof,
      [hostSegment.id]: hostSegment,
      [enteringSegment.id]: enteringSegment,
    }

    const enteringGeometry = buildRoofFloorplan(
      enteringRoof,
      buildContext(enteringRoof, [enteringSegment], [hostRoof], nodes),
    )
    const enteringOutline = outlinePoints(enteringGeometry)
    expect(Math.min(...enteringOutline.map(([x]) => x))).toBeCloseTo(5, 6)
    expect(Math.max(...enteringOutline.map(([x]) => x))).toBeCloseTo(7, 6)

    const hostGeometry = buildRoofFloorplan(
      hostRoof,
      buildContext(hostRoof, [hostSegment], [enteringRoof], nodes),
    )
    const hostOutline = outlinePoints(hostGeometry)
    expect(Math.min(...hostOutline.map(([x]) => x))).toBeCloseTo(-5, 6)
    expect(Math.max(...hostOutline.map(([x]) => x))).toBeCloseTo(5, 6)
  })

  test('keeps a mounted conical roof visible above its host in plan view', () => {
    const hostRoof = RoofNode.parse({
      id: 'roof_host',
      type: 'roof',
      children: ['rseg_host'],
    })
    const conicalRoof = RoofNode.parse({
      id: 'roof_conical',
      type: 'roof',
      children: ['rseg_conical'],
      support: {
        kind: 'roof',
        roofSegmentId: 'rseg_host',
        localPosition: [0, 0],
        curbHeight: 0.5,
      },
    })
    const hostSegment = RoofSegmentNode.parse({
      id: 'rseg_host',
      type: 'roof-segment',
      parentId: hostRoof.id,
      roofType: 'gable',
      width: 10,
      depth: 8,
    })
    const conicalSegment = RoofSegmentNode.parse({
      id: 'rseg_conical',
      type: 'roof-segment',
      parentId: conicalRoof.id,
      roofType: 'conical',
      width: 3,
      depth: 3,
    })
    const nodes = {
      [hostRoof.id]: hostRoof,
      [conicalRoof.id]: conicalRoof,
      [hostSegment.id]: hostSegment,
      [conicalSegment.id]: conicalSegment,
    }

    const geometry = buildRoofFloorplan(
      conicalRoof,
      buildContext(conicalRoof, [conicalSegment], [hostRoof], nodes),
    )
    const outline = outlinePoints(geometry)

    expect(geometry).not.toBeNull()
    expect(Math.min(...outline.map(([x]) => x))).toBeCloseTo(-1.5, 6)
    expect(Math.max(...outline.map(([x]) => x))).toBeCloseTo(1.5, 6)
  })
})
