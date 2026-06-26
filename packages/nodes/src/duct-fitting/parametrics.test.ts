import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  DuctFittingNode,
  DuctSegmentNode,
  useScene,
} from '@pascal-app/core'
import { readAutoOffsetTag, withAutoOffsetTag } from '../shared/auto-offset-tag'
import { getDuctFittingPorts } from './ports'

let ductFittingParametrics: typeof import('./parametrics')['ductFittingParametrics']

type Point = [number, number, number]

function equivalentDiameterIn(widthIn: number, heightIn: number): number {
  return 2 * Math.sqrt((widthIn * heightIn) / Math.PI)
}

function rectElbow() {
  return DuctFittingNode.parse({
    id: 'duct-fitting_resize' as AnyNodeId,
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Resize elbow',
    fittingType: 'elbow',
    shape: 'rect',
    width: 14,
    height: 8,
    diameter: equivalentDiameterIn(14, 8),
    diameter2: equivalentDiameterIn(14, 8),
    ductMaterial: 'sheet-metal',
    system: 'supply',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    angle: 90,
  })
}

function verticalRectRunFrom(point: Point, roll: number) {
  return DuctSegmentNode.parse({
    id: 'duct-segment_vertical' as AnyNodeId,
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Drawn vertical run',
    path: [point, [point[0], point[1] + 3, point[2]]],
    shape: 'rect',
    width: 14,
    height: 8,
    diameter: equivalentDiameterIn(14, 8),
    roll,
    ductMaterial: 'sheet-metal',
    insulationR: 0,
    system: 'supply',
  })
}

describe('ductFittingParametrics', () => {
  beforeAll(async () => {
    mock.module('@pascal-app/editor', () => ({
      ActionButton: () => null,
    }))
    ;({ ductFittingParametrics } = await import('./parametrics'))
  })

  beforeEach(() => {
    useScene.setState({
      nodes: {},
      rootNodeIds: [],
      dirtyNodes: new Set(),
      collections: {},
      readOnly: false,
    } as never)
    useScene.temporal.getState().clear()
  })

  test('resizing a fitting retrims connected ducts without changing their roll', () => {
    const fitting = rectElbow()
    const outlet = getDuctFittingPorts(fitting).find((p) => p.id === 'outlet')!
    const originalRoll = 0.37
    const duct = verticalRectRunFrom([...outlet.position] as Point, originalRoll)

    useScene.setState({
      nodes: {
        [fitting.id]: fitting as AnyNode,
        [duct.id]: duct as AnyNode,
      },
      rootNodeIds: [fitting.id, duct.id],
      dirtyNodes: new Set(),
      collections: {},
      readOnly: false,
    } as never)

    const patch = { width: 20 }
    const derived = ductFittingParametrics.derive?.({ ...fitting, ...patch }, patch) ?? {}
    const next = DuctFittingNode.parse({ ...fitting, ...patch, ...derived })
    const updates = ductFittingParametrics.reconcile?.(fitting, next) ?? []
    const ductUpdate = updates.find((u) => u.id === duct.id)

    expect(ductUpdate).toBeDefined()
    expect((ductUpdate?.data as Partial<DuctSegmentNode>).path).toBeDefined()
    expect((ductUpdate?.data as Partial<DuctSegmentNode>).roll).toBeUndefined()
  })

  test('resizing a fitting refreshes a connected duct auto-offset base path', () => {
    const fitting = rectElbow()
    const outlet = getDuctFittingPorts(fitting).find((p) => p.id === 'outlet')!
    const duct = verticalRectRunFrom([...outlet.position] as Point, 0)
    const taggedDuct = DuctSegmentNode.parse({
      ...duct,
      metadata: withAutoOffsetTag(duct.metadata, {
        group: 'aoff_resize',
        dy: 1,
        minted: ['duct-fitting_minted' as AnyNodeId],
        base: [{ id: duct.id, data: { path: duct.path } }],
      }),
    })

    useScene.setState({
      nodes: {
        [fitting.id]: fitting as AnyNode,
        [taggedDuct.id]: taggedDuct as AnyNode,
      },
      rootNodeIds: [fitting.id, taggedDuct.id],
      dirtyNodes: new Set(),
      collections: {},
      readOnly: false,
    } as never)

    const patch = { width: 20 }
    const derived = ductFittingParametrics.derive?.({ ...fitting, ...patch }, patch) ?? {}
    const next = DuctFittingNode.parse({ ...fitting, ...patch, ...derived })
    const updates = ductFittingParametrics.reconcile?.(fitting, next) ?? []
    const ductUpdate = updates.find((u) => u.id === taggedDuct.id)
    const nextOutlet = getDuctFittingPorts(next).find((p) => p.id === 'outlet')!
    const nextTag = readAutoOffsetTag({ metadata: ductUpdate?.data.metadata })
    const basePath = nextTag?.base.find((b) => b.id === taggedDuct.id)?.data.path as
      | Point[]
      | undefined

    expect(basePath?.[0]).toEqual([...nextOutlet.position])
  })

  test('deleting an elbow re-extends mated runs back onto the junction', () => {
    const fitting = rectElbow()
    const ports = getDuctFittingPorts(fitting)
    const outlet = ports.find((p) => p.id === 'outlet')!
    const inlet = ports.find((p) => p.id === 'inlet')!
    // Two runs meeting the elbow's collars — the L-shape the elbow trimmed.
    const outletRun = verticalRectRunFrom([...outlet.position] as Point, 0)
    const inletRun = DuctSegmentNode.parse({
      ...verticalRectRunFrom([...inlet.position] as Point, 0),
      id: 'duct-segment_inlet' as AnyNodeId,
      path: [
        [...inlet.position] as Point,
        [inlet.position[0] - 3, inlet.position[1], inlet.position[2]],
      ],
    })

    const nodes: Record<AnyNodeId, AnyNode> = {
      [fitting.id]: fitting as AnyNode,
      [outletRun.id]: outletRun as AnyNode,
      [inletRun.id]: inletRun as AnyNode,
    }

    const updates = ductFittingParametrics.onDelete?.(fitting, nodes) ?? []
    const outletUpdate = updates.find((u) => u.id === outletRun.id)
    const inletUpdate = updates.find((u) => u.id === inletRun.id)

    // Both mated endpoints snap back to the junction (the original corner).
    expect((outletUpdate?.data as Partial<DuctSegmentNode>).path?.[0]).toEqual([
      ...fitting.position,
    ])
    expect((inletUpdate?.data as Partial<DuctSegmentNode>).path?.[0]).toEqual([...fitting.position])
  })

  test('delete repair matches the 5 cm live connectivity mate tolerance', () => {
    const fitting = rectElbow()
    const outlet = getDuctFittingPorts(fitting).find((p) => p.id === 'outlet')!
    const nearOutlet: Point = [outlet.position[0], outlet.position[1], outlet.position[2] + 0.04]
    const outletRun = DuctSegmentNode.parse({
      ...verticalRectRunFrom(nearOutlet, 0),
      id: 'duct-segment_outlet_gap' as AnyNodeId,
    })
    const nodes: Record<AnyNodeId, AnyNode> = {
      [fitting.id]: fitting as AnyNode,
      [outletRun.id]: outletRun as AnyNode,
    }

    const updates = ductFittingParametrics.onDelete?.(fitting, nodes) ?? []
    const outletUpdate = updates.find((u) => u.id === outletRun.id)

    expect((outletUpdate?.data as Partial<DuctSegmentNode>).path?.[0]).toEqual([
      ...fitting.position,
    ])
  })

  test('deleting a generated elbow clears the owner duct auto-offset tag', () => {
    const fitting = rectElbow()
    const outlet = getDuctFittingPorts(fitting).find((p) => p.id === 'outlet')!
    const duct = verticalRectRunFrom([...outlet.position] as Point, 0)
    const taggedDuct = DuctSegmentNode.parse({
      ...duct,
      metadata: withAutoOffsetTag(duct.metadata, {
        group: 'aoff_deleted_elbow',
        dy: 1,
        minted: [fitting.id],
        base: [{ id: duct.id, data: { path: duct.path } }],
      }),
    })
    const nodes: Record<AnyNodeId, AnyNode> = {
      [fitting.id]: fitting as AnyNode,
      [taggedDuct.id]: taggedDuct as AnyNode,
    }

    const updates = ductFittingParametrics.onDelete?.(fitting, nodes) ?? []
    const finalDuctUpdate = updates.filter((u) => u.id === taggedDuct.id).at(-1)

    expect(readAutoOffsetTag({ metadata: finalDuctUpdate?.data.metadata })).toBeNull()
  })

  test('deleting a tee leaves mated runs untouched', () => {
    const tee = DuctFittingNode.parse({ ...rectElbow(), fittingType: 'tee' })
    const outlet = getDuctFittingPorts(tee).find((p) => p.id === 'outlet')!
    const duct = verticalRectRunFrom([...outlet.position] as Point, 0)
    const nodes: Record<AnyNodeId, AnyNode> = {
      [tee.id]: tee as AnyNode,
      [duct.id]: duct as AnyNode,
    }

    expect(ductFittingParametrics.onDelete?.(tee, nodes) ?? []).toEqual([])
  })

  test('resizing a generated fitting clears the owner duct auto-offset tag', () => {
    const fitting = rectElbow()
    const outlet = getDuctFittingPorts(fitting).find((p) => p.id === 'outlet')!
    const duct = verticalRectRunFrom([...outlet.position] as Point, 0)
    const taggedDuct = DuctSegmentNode.parse({
      ...duct,
      metadata: withAutoOffsetTag(duct.metadata, {
        group: 'aoff_generated_fit',
        dy: 1,
        minted: [fitting.id],
        base: [{ id: duct.id, data: { path: duct.path } }],
      }),
    })

    useScene.setState({
      nodes: {
        [fitting.id]: fitting as AnyNode,
        [taggedDuct.id]: taggedDuct as AnyNode,
      },
      rootNodeIds: [fitting.id, taggedDuct.id],
      dirtyNodes: new Set(),
      collections: {},
      readOnly: false,
    } as never)

    const patch = { width: 20 }
    const derived = ductFittingParametrics.derive?.({ ...fitting, ...patch }, patch) ?? {}
    const next = DuctFittingNode.parse({ ...fitting, ...patch, ...derived })
    const updates = ductFittingParametrics.reconcile?.(fitting, next) ?? []
    const finalDuctUpdate = updates.filter((u) => u.id === taggedDuct.id).at(-1)

    expect(readAutoOffsetTag({ metadata: finalDuctUpdate?.data.metadata })).toBeNull()
  })
})
