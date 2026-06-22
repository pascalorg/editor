import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  DuctFittingNode,
  DuctSegmentNode,
  type PortConnection,
} from '@pascal-app/core'
import { getDuctFittingPorts } from '../duct-fitting/ports'
import { type DuctProfile, planElbowAtPort, profileDiameterIn } from './auto-fitting'
import type { ScenePort } from './ports'
import { planVerticalOffsets } from './vertical-offset'

type Point = [number, number, number]

const RECT_PROFILE: DuctProfile = { shape: 'rect', diameter: 6, width: 14, height: 8 }

function distSq(a: readonly number[], b: readonly number[]): number {
  const dx = a[0]! - b[0]!
  const dy = a[1]! - b[1]!
  const dz = a[2]! - b[2]!
  return dx * dx + dy * dy + dz * dz
}

function rectRun(path: Point[]): DuctSegmentNode {
  return DuctSegmentNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Trunk',
    path,
    shape: 'rect',
    diameter: 6,
    width: 14,
    height: 8,
    roll: 0,
    ductMaterial: 'sheet-metal',
    insulationR: 0,
    system: 'supply',
  })
}

function runConnection(run: DuctSegmentNode): PortConnection {
  return {
    kind: 'run',
    nodeId: run.id,
    startPath: run.path,
  }
}

function runPort(run: DuctSegmentNode, point: Point, direction: Point): ScenePort {
  return {
    id: 'end',
    nodeId: run.id,
    position: point,
    direction,
    diameter: 12,
    system: 'supply',
  }
}

function portLike(position: Point, direction: Point): ScenePort {
  return {
    id: 'x',
    nodeId: 'x' as AnyNode['id'],
    position,
    direction,
    diameter: 12,
    system: 'supply',
  }
}

function fittingConnection(fitting: DuctFittingNode): PortConnection {
  return {
    kind: 'rigid-node',
    nodeId: fitting.id,
    startPosition: fitting.position,
  }
}

describe('planVerticalOffsets', () => {
  test.each([
    { label: 'upward', y: 0, dy: 1.2 },
    { label: 'downward', y: 2, dy: -1.2 },
  ])('rolls the minted plumb riser through a rectangular $label offset', ({ y, dy }) => {
    const moved = rectRun([
      [0, y, 0],
      [4, y, 0],
    ])
    const partner = rectRun([
      [-4, y, 0],
      [0, y, 0],
    ])

    const result = planVerticalOffsets({
      duct: moved,
      dy,
      profile: RECT_PROFILE,
      connections: [runConnection(partner)],
      scenePorts: [runPort(partner, [0, y, 0], [1, 0, 0])],
      nodesById: {
        [moved.id]: moved as AnyNode,
        [partner.id]: partner as AnyNode,
      },
    })

    expect(result?.status).toBe('valid')
    if (result?.status !== 'valid') return
    expect(result.plan.risers).toHaveLength(1)
    expect(result.plan.risers[0]!.roll).toBeCloseTo(Math.PI / 2, 6)
  })

  test('re-aims and resizes an existing flat elbow before routing the vertical L', () => {
    const elbow = DuctFittingNode.parse({
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      name: 'Old elbow',
      fittingType: 'elbow',
      shape: 'rect',
      width: 8,
      height: 4,
      diameter: profileDiameterIn({ ...RECT_PROFILE, width: 8, height: 4 }),
      diameter2: profileDiameterIn({ ...RECT_PROFILE, width: 8, height: 4 }),
      ductMaterial: 'sheet-metal',
      system: 'supply',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      angle: 90,
    })
    const inlet = getDuctFittingPorts(elbow).find((p) => p.id === 'inlet')!
    const moved = rectRun([
      [...inlet.position],
      [inlet.position[0] - 4, inlet.position[1], inlet.position[2]],
    ])

    const result = planVerticalOffsets({
      duct: moved,
      dy: 1.2,
      profile: RECT_PROFILE,
      connections: [fittingConnection(elbow)],
      scenePorts: [{ ...inlet, nodeId: elbow.id }],
      nodesById: {
        [moved.id]: moved as AnyNode,
        [elbow.id]: elbow as AnyNode,
      },
    })

    expect(result?.status).toBe('valid')
    if (result?.status !== 'valid') return
    expect(result.plan.risers).toHaveLength(1)
    expect(result.plan.risers[0]!.roll).toBeCloseTo(Math.PI / 2, 6)

    const elbowUpdate = result.plan.updates.find((u) => u.id === elbow.id)
    expect(elbowUpdate?.data).toMatchObject({
      shape: 'rect',
      width: RECT_PROFILE.width,
      height: RECT_PROFILE.height,
      diameter: profileDiameterIn(RECT_PROFILE),
    })
    expect(elbowUpdate?.data.rotation).toBeDefined()
    expect(elbowUpdate?.data.angle).toBeDefined()
  })

  test('fitting-connected offsets keep every minted collar touching the lifted run', () => {
    const elbow = DuctFittingNode.parse({
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      name: 'Angled elbow',
      fittingType: 'elbow',
      shape: 'rect',
      width: 8,
      height: 4,
      diameter: profileDiameterIn({ ...RECT_PROFILE, width: 8, height: 4 }),
      diameter2: profileDiameterIn({ ...RECT_PROFILE, width: 8, height: 4 }),
      ductMaterial: 'sheet-metal',
      system: 'supply',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      angle: 45,
    })
    const outlet = getDuctFittingPorts(elbow).find((p) => p.id === 'outlet')!
    const angle = Math.PI / 4
    const moved = rectRun([
      [...outlet.position],
      [
        outlet.position[0] + Math.cos(angle) * 4,
        outlet.position[1],
        outlet.position[2] + Math.sin(angle) * 4,
      ],
    ])

    const result = planVerticalOffsets({
      duct: moved,
      dy: 1.2,
      profile: RECT_PROFILE,
      connections: [fittingConnection(elbow)],
      scenePorts: [{ ...outlet, nodeId: elbow.id }],
      nodesById: {
        [moved.id]: moved as AnyNode,
        [elbow.id]: elbow as AnyNode,
      },
    })

    expect(result?.status).toBe('valid')
    if (result?.status !== 'valid') return
    expect(result.plan.fittings).toHaveLength(1)
    expect(result.plan.risers).toHaveLength(1)

    const topPorts = getDuctFittingPorts(result.plan.fittings[0]!)
    const riser = result.plan.risers[0]!
    expect(topPorts.some((p) => distSq(p.position, result.plan.ductPath[0]!) < 1e-9)).toBe(true)
    expect(topPorts.some((p) => distSq(p.position, riser.path[1]!) < 1e-9)).toBe(true)

    const elbowUpdate = result.plan.updates.find((u) => u.id === elbow.id)
    const reaimedElbow = DuctFittingNode.parse({ ...elbow, ...elbowUpdate?.data })
    const reaimedPorts = getDuctFittingPorts(reaimedElbow)
    expect(reaimedPorts.some((p) => distSq(p.position, riser.path[0]!) < 1e-9)).toBe(true)
  })

  test.each([
    { label: 'tee branch', fittingType: 'tee' as const, portId: 'branch' },
    { label: 'cross branch', fittingType: 'cross' as const, portId: 'branch' },
  ])('routes a vertical offset from a stationary $label fitting', ({ fittingType, portId }) => {
    const fitting = DuctFittingNode.parse({
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      name: fittingType,
      fittingType,
      shape: 'rect',
      width: RECT_PROFILE.width,
      height: RECT_PROFILE.height,
      diameter: profileDiameterIn(RECT_PROFILE),
      shape2: 'rect',
      width2: RECT_PROFILE.width,
      height2: RECT_PROFILE.height,
      diameter2: profileDiameterIn(RECT_PROFILE),
      ductMaterial: 'sheet-metal',
      system: 'supply',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      angle: 90,
      branchAngle: 90,
    })
    const fittingPorts = getDuctFittingPorts(fitting)
    const branch = fittingPorts.find((p) => p.id === portId)!
    const moved = rectRun([
      [...branch.position],
      [
        branch.position[0] + branch.direction[0] * 4,
        branch.position[1] + branch.direction[1] * 4,
        branch.position[2] + branch.direction[2] * 4,
      ],
    ])

    const result = planVerticalOffsets({
      duct: moved,
      dy: 1.2,
      profile: RECT_PROFILE,
      connections: [fittingConnection(fitting)],
      scenePorts: fittingPorts.map((p) => ({ ...p, nodeId: fitting.id })),
      nodesById: {
        [moved.id]: moved as AnyNode,
        [fitting.id]: fitting as AnyNode,
      },
    })

    expect(result?.status).toBe('valid')
    if (result?.status !== 'valid') return
    expect(result.plan.fittings).toHaveLength(2)
    expect(result.plan.risers).toHaveLength(1)
    expect(result.plan.updates.some((u) => u.id === fitting.id)).toBe(false)
    expect(result.plan.followPath[0]).toEqual(moved.path[0])
    expect(result.plan.ductPath[0]?.[1]).toBeCloseTo(branch.position[1] + 1.2, 6)
    const bottomPorts = getDuctFittingPorts(result.plan.fittings[0]!)
    const topPorts = getDuctFittingPorts(result.plan.fittings[1]!)
    const riser = result.plan.risers[0]!
    expect(bottomPorts.some((p) => distSq(p.position, branch.position) < 1e-9)).toBe(true)
    expect(bottomPorts.some((p) => distSq(p.position, riser.path[0]!) < 1e-9)).toBe(true)
    expect(topPorts.some((p) => distSq(p.position, riser.path[1]!) < 1e-9)).toBe(true)
    expect(topPorts.some((p) => distSq(p.position, result.plan.ductPath[0]!) < 1e-9)).toBe(true)
  })

  test.each([
    { label: 'up', dy: 1 },
    { label: 'down', dy: -0.5 },
  ])('$label moves an elbow-connected top run by stretching the existing vertical riser', ({
    dy,
  }) => {
    const elbow = DuctFittingNode.parse({
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      name: 'Top corner elbow',
      fittingType: 'elbow',
      shape: 'rect',
      width: RECT_PROFILE.width,
      height: RECT_PROFILE.height,
      diameter: profileDiameterIn(RECT_PROFILE),
      diameter2: profileDiameterIn(RECT_PROFILE),
      ductMaterial: 'sheet-metal',
      system: 'supply',
      position: [0, 2, 0],
      rotation: [0, 0, 0],
      angle: 90,
    })
    const inlet = getDuctFittingPorts(elbow).find((p) => p.id === 'inlet')!
    const outlet = getDuctFittingPorts(elbow).find((p) => p.id === 'outlet')!
    const moved = rectRun([
      [...inlet.position],
      [inlet.position[0] - 4, inlet.position[1], inlet.position[2]],
    ])
    const riser = rectRun([[outlet.position[0], 0, outlet.position[2]], [...outlet.position]])

    const result = planVerticalOffsets({
      duct: moved,
      dy,
      profile: RECT_PROFILE,
      connections: [fittingConnection(elbow), runConnection(riser)],
      scenePorts: [
        { ...inlet, nodeId: elbow.id },
        { ...outlet, nodeId: elbow.id },
        runPort(riser, [...outlet.position], [0, 1, 0]),
      ],
      nodesById: {
        [moved.id]: moved as AnyNode,
        [elbow.id]: elbow as AnyNode,
        [riser.id]: riser as AnyNode,
      },
    })

    expect(result?.status).toBe('valid')
    if (result?.status !== 'valid') return
    expect(result.plan.fittings).toHaveLength(0)
    expect(result.plan.risers).toHaveLength(0)
    expect(result.plan.followPath[0]?.[1]).toBeCloseTo(inlet.position[1] + dy, 6)
  })

  test('collapses an elbow-riser-elbow side into one elbow when the top run aligns downward', () => {
    const moved = rectRun([
      [0, 0, 0],
      [4, 0, 0],
    ])
    const partner = rectRun([
      [-4, 0, 0],
      [0, 0, 0],
    ])
    const upward = planVerticalOffsets({
      duct: moved,
      dy: 1.2,
      profile: RECT_PROFILE,
      connections: [runConnection(partner)],
      scenePorts: [runPort(partner, [0, 0, 0], [1, 0, 0])],
      nodesById: {
        [moved.id]: moved as AnyNode,
        [partner.id]: partner as AnyNode,
      },
    })
    expect(upward?.status).toBe('valid')
    if (upward?.status !== 'valid') return
    const [bottom, top] = upward.plan.fittings
    const [riser] = upward.plan.risers
    expect(bottom).toBeDefined()
    expect(top).toBeDefined()
    expect(riser).toBeDefined()
    const topRun = DuctSegmentNode.parse({ ...moved, path: upward.plan.ductPath })
    const topPorts = getDuctFittingPorts(top!)
    const bottomPorts = getDuctFittingPorts(bottom!)

    const collapseDy = -topRun.path[0]![1]
    const result = planVerticalOffsets({
      duct: topRun,
      dy: collapseDy,
      profile: RECT_PROFILE,
      connections: [fittingConnection(top!), runConnection(riser!), fittingConnection(bottom!)],
      scenePorts: [
        ...topPorts.map((p) => ({ ...p, nodeId: top!.id })),
        ...bottomPorts.map((p) => ({ ...p, nodeId: bottom!.id })),
        runPort(riser!, riser!.path[0]!, [0, -1, 0]),
        runPort(riser!, riser!.path[1]!, [0, 1, 0]),
      ],
      nodesById: {
        [topRun.id]: topRun as AnyNode,
        [top!.id]: top! as AnyNode,
        [bottom!.id]: bottom! as AnyNode,
        [riser!.id]: riser! as AnyNode,
      },
    })

    expect(result?.status).toBe('valid')
    if (result?.status !== 'valid') return
    expect(result.plan.fittings).toHaveLength(0)
    expect(result.plan.risers).toHaveLength(0)
    expect(result.plan.delete).toEqual(expect.arrayContaining([top!.id, riser!.id]))
    expect(result.plan.updates.some((u) => u.id === bottom!.id)).toBe(true)
    expect(result.plan.ductPath[0]?.[1]).toBeCloseTo(result.plan.ductPath[1]?.[1] ?? 999, 6)
  })

  test('collapses only the aligned side while shortening the still-offset side', () => {
    const leftBottom = planElbowAtPort(portLike([0, 0, 0], [1, 0, 0]), [0, 1, 0], RECT_PROFILE)
    const leftTop = planElbowAtPort(portLike([0, 1.2, 0], [-1, 0, 0]), [0, -1, 0], RECT_PROFILE)
    const rightBottom = planElbowAtPort(portLike([4, -1, 0], [-1, 0, 0]), [0, 1, 0], RECT_PROFILE)
    const rightTop = planElbowAtPort(portLike([4, 1.2, 0], [1, 0, 0]), [0, -1, 0], RECT_PROFILE)
    expect(leftBottom && leftTop && rightBottom && rightTop).toBeTruthy()
    if (!leftBottom || !leftTop || !rightBottom || !rightTop) return

    const leftRiser = rectRun([leftBottom.collarPoint, leftTop.collarPoint])
    const rightRiser = rectRun([rightBottom.collarPoint, rightTop.collarPoint])
    const topRun = rectRun([leftTop.trimmedPortPoint, rightTop.trimmedPortPoint])
    const leftBottomPorts = getDuctFittingPorts(leftBottom.fitting)
    const leftTopPorts = getDuctFittingPorts(leftTop.fitting)
    const rightBottomPorts = getDuctFittingPorts(rightBottom.fitting)
    const rightTopPorts = getDuctFittingPorts(rightTop.fitting)

    const result = planVerticalOffsets({
      duct: topRun,
      dy: -1.2,
      profile: RECT_PROFILE,
      connections: [
        fittingConnection(leftTop.fitting),
        fittingConnection(rightTop.fitting),
        runConnection(leftRiser),
        runConnection(rightRiser),
        fittingConnection(leftBottom.fitting),
        fittingConnection(rightBottom.fitting),
      ],
      scenePorts: [
        ...leftTopPorts.map((p) => ({ ...p, nodeId: leftTop.fitting.id })),
        ...rightTopPorts.map((p) => ({ ...p, nodeId: rightTop.fitting.id })),
        ...leftBottomPorts.map((p) => ({ ...p, nodeId: leftBottom.fitting.id })),
        ...rightBottomPorts.map((p) => ({ ...p, nodeId: rightBottom.fitting.id })),
        runPort(leftRiser, leftRiser.path[0]!, [0, -1, 0]),
        runPort(leftRiser, leftRiser.path[1]!, [0, 1, 0]),
        runPort(rightRiser, rightRiser.path[0]!, [0, -1, 0]),
        runPort(rightRiser, rightRiser.path[1]!, [0, 1, 0]),
      ],
      nodesById: {
        [topRun.id]: topRun as AnyNode,
        [leftTop.fitting.id]: leftTop.fitting as AnyNode,
        [rightTop.fitting.id]: rightTop.fitting as AnyNode,
        [leftBottom.fitting.id]: leftBottom.fitting as AnyNode,
        [rightBottom.fitting.id]: rightBottom.fitting as AnyNode,
        [leftRiser.id]: leftRiser as AnyNode,
        [rightRiser.id]: rightRiser as AnyNode,
      },
    })

    expect(result?.status).toBe('valid')
    if (result?.status !== 'valid') return
    expect(result.plan.fittings).toHaveLength(0)
    expect(result.plan.risers).toHaveLength(0)
    expect(result.plan.delete).toEqual(expect.arrayContaining([leftTop.fitting.id, leftRiser.id]))
    expect(result.plan.delete ?? []).not.toContain(rightTop.fitting.id)
    expect(result.plan.delete ?? []).not.toContain(rightRiser.id)
    expect(result.plan.updates.some((u) => u.id === leftBottom.fitting.id)).toBe(true)
    expect(result.plan.ductPath[0]?.[1]).toBeCloseTo(result.plan.ductPath[1]?.[1] ?? 999, 6)
    expect(result.plan.followPath[0]?.[1]).toBeCloseTo(topRun.path[0]![1], 6)
    expect(result.plan.followPath[1]?.[1]).toBeCloseTo(0, 6)
  })

  test('collapses a manually height-edited side when that side aligns', () => {
    const leftBottom = planElbowAtPort(portLike([0, 0.5, 0], [1, 0, 0]), [0, 1, 0], RECT_PROFILE)
    const leftTop = planElbowAtPort(portLike([0, 1.2, 0], [-1, 0, 0]), [0, -1, 0], RECT_PROFILE)
    const rightBottom = planElbowAtPort(portLike([4, -1, 0], [-1, 0, 0]), [0, 1, 0], RECT_PROFILE)
    const rightTop = planElbowAtPort(portLike([4, 1.2, 0], [1, 0, 0]), [0, -1, 0], RECT_PROFILE)
    expect(leftBottom && leftTop && rightBottom && rightTop).toBeTruthy()
    if (!leftBottom || !leftTop || !rightBottom || !rightTop) return

    const leftRiser = rectRun([leftBottom.collarPoint, leftTop.collarPoint])
    const rightRiser = rectRun([rightBottom.collarPoint, rightTop.collarPoint])
    const topRun = rectRun([leftTop.trimmedPortPoint, rightTop.trimmedPortPoint])
    const result = planVerticalOffsets({
      duct: topRun,
      dy: -0.7,
      profile: RECT_PROFILE,
      connections: [
        fittingConnection(leftTop.fitting),
        fittingConnection(rightTop.fitting),
        runConnection(leftRiser),
        runConnection(rightRiser),
        fittingConnection(leftBottom.fitting),
        fittingConnection(rightBottom.fitting),
      ],
      scenePorts: [
        ...getDuctFittingPorts(leftTop.fitting).map((p) => ({
          ...p,
          nodeId: leftTop.fitting.id,
        })),
        ...getDuctFittingPorts(rightTop.fitting).map((p) => ({
          ...p,
          nodeId: rightTop.fitting.id,
        })),
        ...getDuctFittingPorts(leftBottom.fitting).map((p) => ({
          ...p,
          nodeId: leftBottom.fitting.id,
        })),
        ...getDuctFittingPorts(rightBottom.fitting).map((p) => ({
          ...p,
          nodeId: rightBottom.fitting.id,
        })),
        runPort(leftRiser, leftRiser.path[0]!, [0, -1, 0]),
        runPort(leftRiser, leftRiser.path[1]!, [0, 1, 0]),
        runPort(rightRiser, rightRiser.path[0]!, [0, -1, 0]),
        runPort(rightRiser, rightRiser.path[1]!, [0, 1, 0]),
      ],
      nodesById: {
        [topRun.id]: topRun as AnyNode,
        [leftTop.fitting.id]: leftTop.fitting as AnyNode,
        [rightTop.fitting.id]: rightTop.fitting as AnyNode,
        [leftBottom.fitting.id]: leftBottom.fitting as AnyNode,
        [rightBottom.fitting.id]: rightBottom.fitting as AnyNode,
        [leftRiser.id]: leftRiser as AnyNode,
        [rightRiser.id]: rightRiser as AnyNode,
      },
    })

    expect(result?.status).toBe('valid')
    if (result?.status !== 'valid') return
    expect(result.plan.delete).toEqual(expect.arrayContaining([leftTop.fitting.id, leftRiser.id]))
    expect(result.plan.delete ?? []).not.toContain(rightTop.fitting.id)
    expect(result.plan.delete ?? []).not.toContain(rightRiser.id)
    expect(result.plan.updates.some((u) => u.id === leftBottom.fitting.id)).toBe(true)
    expect(result.plan.ductPath[0]?.[1]).toBeCloseTo(0.5, 6)
    expect(result.plan.ductPath[1]?.[1]).toBeCloseTo(0.5, 6)
  })

  test('continues past one unequal side without snapping to the lower side early', () => {
    const leftBottom = planElbowAtPort(portLike([0, 0.5, 0], [1, 0, 0]), [0, 1, 0], RECT_PROFILE)
    const leftTop = planElbowAtPort(portLike([0, 1.2, 0], [-1, 0, 0]), [0, -1, 0], RECT_PROFILE)
    const rightBottom = planElbowAtPort(portLike([4, -1, 0], [-1, 0, 0]), [0, 1, 0], RECT_PROFILE)
    const rightTop = planElbowAtPort(portLike([4, 1.2, 0], [1, 0, 0]), [0, -1, 0], RECT_PROFILE)
    expect(leftBottom && leftTop && rightBottom && rightTop).toBeTruthy()
    if (!leftBottom || !leftTop || !rightBottom || !rightTop) return

    const leftRiser = rectRun([leftBottom.collarPoint, leftTop.collarPoint])
    const rightRiser = rectRun([rightBottom.collarPoint, rightTop.collarPoint])
    const topRun = rectRun([leftTop.trimmedPortPoint, rightTop.trimmedPortPoint])
    const result = planVerticalOffsets({
      duct: topRun,
      dy: -1.8,
      profile: RECT_PROFILE,
      connections: [
        fittingConnection(leftTop.fitting),
        fittingConnection(rightTop.fitting),
        runConnection(leftRiser),
        runConnection(rightRiser),
        fittingConnection(leftBottom.fitting),
        fittingConnection(rightBottom.fitting),
      ],
      scenePorts: [
        ...getDuctFittingPorts(leftTop.fitting).map((p) => ({
          ...p,
          nodeId: leftTop.fitting.id,
        })),
        ...getDuctFittingPorts(rightTop.fitting).map((p) => ({
          ...p,
          nodeId: rightTop.fitting.id,
        })),
        ...getDuctFittingPorts(leftBottom.fitting).map((p) => ({
          ...p,
          nodeId: leftBottom.fitting.id,
        })),
        ...getDuctFittingPorts(rightBottom.fitting).map((p) => ({
          ...p,
          nodeId: rightBottom.fitting.id,
        })),
        runPort(leftRiser, leftRiser.path[0]!, [0, -1, 0]),
        runPort(leftRiser, leftRiser.path[1]!, [0, 1, 0]),
        runPort(rightRiser, rightRiser.path[0]!, [0, -1, 0]),
        runPort(rightRiser, rightRiser.path[1]!, [0, 1, 0]),
      ],
      nodesById: {
        [topRun.id]: topRun as AnyNode,
        [leftTop.fitting.id]: leftTop.fitting as AnyNode,
        [rightTop.fitting.id]: rightTop.fitting as AnyNode,
        [leftBottom.fitting.id]: leftBottom.fitting as AnyNode,
        [rightBottom.fitting.id]: rightBottom.fitting as AnyNode,
        [leftRiser.id]: leftRiser as AnyNode,
        [rightRiser.id]: rightRiser as AnyNode,
      },
    })

    expect(result?.status).toBe('valid')
    if (result?.status !== 'valid') return
    expect(result.plan.dy).toBeCloseTo(-1.8, 6)
    expect(result.plan.ductPath[0]?.[1]).toBeCloseTo(-0.6, 6)
    expect(result.plan.ductPath[1]?.[1]).toBeCloseTo(-0.6, 6)
    expect(result.plan.fittings).toHaveLength(1)
    expect(result.plan.risers).toHaveLength(1)
    expect(result.plan.delete).toEqual(expect.arrayContaining([leftTop.fitting.id, leftRiser.id]))
    expect(result.plan.delete ?? []).not.toContain(rightTop.fitting.id)
    expect(result.plan.delete ?? []).not.toContain(rightRiser.id)
  })

  test('consumes multiple side alignments during one continuous drag', () => {
    const leftBottom = planElbowAtPort(portLike([0, 0.5, 0], [1, 0, 0]), [0, 1, 0], RECT_PROFILE)
    const leftTop = planElbowAtPort(portLike([0, 1.2, 0], [-1, 0, 0]), [0, -1, 0], RECT_PROFILE)
    const rightBottom = planElbowAtPort(portLike([4, -1, 0], [-1, 0, 0]), [0, 1, 0], RECT_PROFILE)
    const rightTop = planElbowAtPort(portLike([4, 1.2, 0], [1, 0, 0]), [0, -1, 0], RECT_PROFILE)
    expect(leftBottom && leftTop && rightBottom && rightTop).toBeTruthy()
    if (!leftBottom || !leftTop || !rightBottom || !rightTop) return

    const leftRiser = rectRun([leftBottom.collarPoint, leftTop.collarPoint])
    const rightRiser = rectRun([rightBottom.collarPoint, rightTop.collarPoint])
    const topRun = rectRun([leftTop.trimmedPortPoint, rightTop.trimmedPortPoint])
    const dy = -3.1
    const result = planVerticalOffsets({
      duct: topRun,
      dy,
      profile: RECT_PROFILE,
      connections: [
        fittingConnection(leftTop.fitting),
        fittingConnection(rightTop.fitting),
        runConnection(leftRiser),
        runConnection(rightRiser),
        fittingConnection(leftBottom.fitting),
        fittingConnection(rightBottom.fitting),
      ],
      scenePorts: [
        ...getDuctFittingPorts(leftTop.fitting).map((p) => ({
          ...p,
          nodeId: leftTop.fitting.id,
        })),
        ...getDuctFittingPorts(rightTop.fitting).map((p) => ({
          ...p,
          nodeId: rightTop.fitting.id,
        })),
        ...getDuctFittingPorts(leftBottom.fitting).map((p) => ({
          ...p,
          nodeId: leftBottom.fitting.id,
        })),
        ...getDuctFittingPorts(rightBottom.fitting).map((p) => ({
          ...p,
          nodeId: rightBottom.fitting.id,
        })),
        runPort(leftRiser, leftRiser.path[0]!, [0, -1, 0]),
        runPort(leftRiser, leftRiser.path[1]!, [0, 1, 0]),
        runPort(rightRiser, rightRiser.path[0]!, [0, -1, 0]),
        runPort(rightRiser, rightRiser.path[1]!, [0, 1, 0]),
      ],
      nodesById: {
        [topRun.id]: topRun as AnyNode,
        [leftTop.fitting.id]: leftTop.fitting as AnyNode,
        [rightTop.fitting.id]: rightTop.fitting as AnyNode,
        [leftBottom.fitting.id]: leftBottom.fitting as AnyNode,
        [rightBottom.fitting.id]: rightBottom.fitting as AnyNode,
        [leftRiser.id]: leftRiser as AnyNode,
        [rightRiser.id]: rightRiser as AnyNode,
      },
    })

    expect(result?.status).toBe('valid')
    if (result?.status !== 'valid') return
    expect(result.plan.dy).toBeCloseTo(dy, 6)
    expect(result.plan.ductPath[0]?.[1]).toBeCloseTo(topRun.path[0]![1] + dy, 6)
    expect(result.plan.ductPath[1]?.[1]).toBeCloseTo(topRun.path[1]![1] + dy, 6)
    expect(result.plan.delete).toEqual(
      expect.arrayContaining([
        leftTop.fitting.id,
        leftRiser.id,
        rightTop.fitting.id,
        rightRiser.id,
      ]),
    )
    expect(result.plan.updates.some((u) => u.id === leftBottom.fitting.id)).toBe(true)
    expect(result.plan.updates.some((u) => u.id === rightBottom.fitting.id)).toBe(true)
  })

  test('snaps downward through the short-riser dead band into the collapse route', () => {
    const leftBottom = planElbowAtPort(portLike([0, 0, 0], [1, 0, 0]), [0, 1, 0], RECT_PROFILE)
    const leftTop = planElbowAtPort(portLike([0, 1.2, 0], [-1, 0, 0]), [0, -1, 0], RECT_PROFILE)
    const rightBottom = planElbowAtPort(portLike([4, -1, 0], [-1, 0, 0]), [0, 1, 0], RECT_PROFILE)
    const rightTop = planElbowAtPort(portLike([4, 1.2, 0], [1, 0, 0]), [0, -1, 0], RECT_PROFILE)
    expect(leftBottom && leftTop && rightBottom && rightTop).toBeTruthy()
    if (!leftBottom || !leftTop || !rightBottom || !rightTop) return

    const leftRiser = rectRun([leftBottom.collarPoint, leftTop.collarPoint])
    const rightRiser = rectRun([rightBottom.collarPoint, rightTop.collarPoint])
    const topRun = rectRun([leftTop.trimmedPortPoint, rightTop.trimmedPortPoint])
    const leftBottomPorts = getDuctFittingPorts(leftBottom.fitting)
    const leftTopPorts = getDuctFittingPorts(leftTop.fitting)
    const rightBottomPorts = getDuctFittingPorts(rightBottom.fitting)
    const rightTopPorts = getDuctFittingPorts(rightTop.fitting)
    const connections = [
      fittingConnection(leftTop.fitting),
      fittingConnection(rightTop.fitting),
      runConnection(leftRiser),
      runConnection(rightRiser),
      fittingConnection(leftBottom.fitting),
      fittingConnection(rightBottom.fitting),
    ]
    const scenePorts = [
      ...leftTopPorts.map((p) => ({ ...p, nodeId: leftTop.fitting.id })),
      ...rightTopPorts.map((p) => ({ ...p, nodeId: rightTop.fitting.id })),
      ...leftBottomPorts.map((p) => ({ ...p, nodeId: leftBottom.fitting.id })),
      ...rightBottomPorts.map((p) => ({ ...p, nodeId: rightBottom.fitting.id })),
      runPort(leftRiser, leftRiser.path[0]!, [0, -1, 0]),
      runPort(leftRiser, leftRiser.path[1]!, [0, 1, 0]),
      runPort(rightRiser, rightRiser.path[0]!, [0, -1, 0]),
      runPort(rightRiser, rightRiser.path[1]!, [0, 1, 0]),
    ]
    const nodesById = {
      [topRun.id]: topRun as AnyNode,
      [leftTop.fitting.id]: leftTop.fitting as AnyNode,
      [rightTop.fitting.id]: rightTop.fitting as AnyNode,
      [leftBottom.fitting.id]: leftBottom.fitting as AnyNode,
      [rightBottom.fitting.id]: rightBottom.fitting as AnyNode,
      [leftRiser.id]: leftRiser as AnyNode,
      [rightRiser.id]: rightRiser as AnyNode,
    }

    for (const dy of [-0.4, -0.6, -0.8, -1.0, -1.1]) {
      const result = planVerticalOffsets({
        duct: topRun,
        dy,
        profile: RECT_PROFILE,
        connections,
        scenePorts,
        nodesById,
      })

      expect(result?.status).toBe('valid')
      if (result?.status !== 'valid') continue
      expect(result.plan.dy).toBeCloseTo(-1.2, 6)
      expect(result.plan.delete).toEqual(expect.arrayContaining([leftTop.fitting.id, leftRiser.id]))
      expect(result.plan.delete ?? []).not.toContain(rightTop.fitting.id)
      expect(result.plan.delete ?? []).not.toContain(rightRiser.id)
      expect(result.plan.ductPath[0]?.[1]).toBeCloseTo(result.plan.ductPath[1]?.[1] ?? 999, 6)
    }
  })

  test('collapses a direct vertical riser when the moved run passes the lower elbow', () => {
    const bottom = planElbowAtPort(portLike([0, 0, 0], [1, 0, 0]), [0, 1, 0], RECT_PROFILE)
    expect(bottom).toBeTruthy()
    if (!bottom) return

    const bottomPorts = getDuctFittingPorts(bottom.fitting)
    const verticalPort = bottomPorts.find((p) => distSq(p.position, bottom.collarPoint) < 1e-9)!
    const riserTop: Point = [bottom.collarPoint[0], 1.2, bottom.collarPoint[2]]
    const riser = rectRun([bottom.collarPoint, riserTop])
    const topRun = rectRun([riserTop, [4, riserTop[1], riserTop[2]]])

    const result = planVerticalOffsets({
      duct: topRun,
      dy: -0.8,
      profile: RECT_PROFILE,
      connections: [runConnection(riser), fittingConnection(bottom.fitting)],
      scenePorts: [
        ...bottomPorts.map((p) => ({ ...p, nodeId: bottom.fitting.id })),
        runPort(riser, bottom.collarPoint, [0, -1, 0]),
        runPort(riser, riserTop, [0, 1, 0]),
      ],
      nodesById: {
        [topRun.id]: topRun as AnyNode,
        [riser.id]: riser as AnyNode,
        [bottom.fitting.id]: bottom.fitting as AnyNode,
      },
    })

    expect(result?.status).toBe('valid')
    if (result?.status !== 'valid') return
    expect(result.plan.dy).toBeCloseTo(-1.2, 6)
    expect(result.plan.fittings).toHaveLength(0)
    expect(result.plan.risers).toHaveLength(0)
    expect(result.plan.delete).toEqual(expect.arrayContaining([riser.id]))
    expect(result.plan.updates.some((u) => u.id === bottom.fitting.id)).toBe(true)
    const bottomUpdate = result.plan.updates.find((u) => u.id === bottom.fitting.id)
    const reaimedBottom = DuctFittingNode.parse({ ...bottom.fitting, ...bottomUpdate?.data })
    const reaimedPorts = getDuctFittingPorts(reaimedBottom)
    expect(reaimedPorts.some((p) => distSq(p.position, result.plan.ductPath[0]!) < 1e-9)).toBe(true)
    expect(verticalPort).toBeDefined()
  })

  test('continues routing after a collapse without needing a new drag', () => {
    const bottom = planElbowAtPort(portLike([0, 0, 0], [1, 0, 0]), [0, 1, 0], RECT_PROFILE)
    expect(bottom).toBeTruthy()
    if (!bottom) return

    const bottomPorts = getDuctFittingPorts(bottom.fitting)
    const riserTop: Point = [bottom.collarPoint[0], 1.2, bottom.collarPoint[2]]
    const riser = rectRun([bottom.collarPoint, riserTop])
    const topRun = rectRun([riserTop, [4, riserTop[1], riserTop[2]]])

    const result = planVerticalOffsets({
      duct: topRun,
      dy: -2.4,
      profile: RECT_PROFILE,
      connections: [runConnection(riser), fittingConnection(bottom.fitting)],
      scenePorts: [
        ...bottomPorts.map((p) => ({ ...p, nodeId: bottom.fitting.id })),
        runPort(riser, bottom.collarPoint, [0, -1, 0]),
        runPort(riser, riserTop, [0, 1, 0]),
      ],
      nodesById: {
        [topRun.id]: topRun as AnyNode,
        [riser.id]: riser as AnyNode,
        [bottom.fitting.id]: bottom.fitting as AnyNode,
      },
    })

    expect(result?.status).toBe('valid')
    if (result?.status !== 'valid') return
    expect(result.plan.dy).toBeCloseTo(-2.4, 6)
    expect(result.plan.delete).toEqual(expect.arrayContaining([riser.id]))
    expect(result.plan.fittings.length).toBeGreaterThan(0)
    expect(result.plan.risers.length).toBeGreaterThan(0)
    expect(result.plan.ductPath[0]?.[1]).toBeLessThan(0)
  })

  test.each([
    { label: 'collapse', dy: 1 },
    { label: 'cross', dy: 1.2 },
  ])('does not $label an existing vertical riser while stretching it', ({ dy }) => {
    const moved = rectRun([
      [0, 0, 0],
      [4, 0, 0],
    ])
    const riser = rectRun([
      [0, 0, 0],
      [0, 1, 0],
    ])

    const result = planVerticalOffsets({
      duct: moved,
      dy,
      profile: RECT_PROFILE,
      connections: [runConnection(riser)],
      scenePorts: [runPort(riser, [0, 0, 0], [0, -1, 0])],
      nodesById: {
        [moved.id]: moved as AnyNode,
        [riser.id]: riser as AnyNode,
      },
    })

    expect(result?.status).toBe('invalid')
  })
})
