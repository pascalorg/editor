import { beforeEach, describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '../../schema/types'
import useScene from '../use-scene'

type RafFn = (cb: (t: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= ((
  cb: (t: number) => void,
) => {
  cb(0)
  return 0
}) as RafFn
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

const SHELF_ID = 'shelf_sanitize' as AnyNodeId
const SOLAR_PANEL_ID = 'sp_x' as AnyNodeId

function makeShelf(overrides: Partial<AnyNode> = {}): AnyNode {
  return {
    id: SHELF_ID,
    type: 'shelf',
    parentId: null,
    object: 'node',
    visible: true,
    name: 'Shelf',
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    width: 1.2,
    depth: 0.3,
    thickness: 0.04,
    height: 0.9,
    style: 'wall-shelf',
    rows: 1,
    columns: 1,
    withBack: false,
    withSides: true,
    withBottom: false,
    bracketStyle: 'minimal',
    ...overrides,
  } as unknown as AnyNode
}

function makeSolarPanel(): AnyNode {
  return {
    id: SOLAR_PANEL_ID,
    type: 'solar-panel',
    parentId: null,
    object: 'node',
    visible: true,
    name: 'Panel',
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    rows: 2,
    columns: 3,
    panelWidth: 1,
    panelHeight: 1.65,
    gapX: 0.02,
    gapY: 0.02,
    mountingType: 'flush',
    tiltAngle: 15,
    standoffHeight: 0.05,
    frameThickness: 0.04,
    frameDepth: 0.04,
  } as unknown as AnyNode
}

function shelf() {
  return useScene.getState().nodes[SHELF_ID] as Extract<AnyNode, { type: 'shelf' }>
}

describe('node mutation numeric sanitization', () => {
  beforeEach(() => {
    useScene.setState({
      nodes: {
        [SHELF_ID]: makeShelf(),
        [SOLAR_PANEL_ID]: makeSolarPanel(),
      },
      rootNodeIds: [SHELF_ID, SOLAR_PANEL_ID],
      dirtyNodes: new Set(),
      collections: {},
      readOnly: false,
    } as never)
    useScene.temporal.getState().clear()
  })

  test('drops NaN numeric updates while preserving other fields in the patch', () => {
    useScene.getState().updateNode(SHELF_ID, {
      thickness: Number.NaN,
      name: 'Renamed after NaN',
    } as Partial<AnyNode>)

    expect(shelf().thickness).toBe(0.04)
    expect(Number.isFinite(shelf().thickness)).toBe(true)
    expect(shelf().name).toBe('Renamed after NaN')
  })

  test('drops Infinity numeric updates while preserving later normal updates', () => {
    useScene.getState().updateNode(SHELF_ID, {
      width: Infinity,
      name: 'Renamed after Infinity',
    } as Partial<AnyNode>)

    expect(shelf().width).toBe(1.2)
    expect(Number.isFinite(shelf().width)).toBe(true)
    expect(shelf().name).toBe('Renamed after Infinity')

    useScene.getState().updateNode(SHELF_ID, {
      name: 'Clean rename',
    } as Partial<AnyNode>)

    expect(shelf().name).toBe('Clean rename')
  })

  test('clamps out-of-range numeric updates to the node schema bounds', () => {
    useScene.getState().updateNode(SHELF_ID, {
      width: 99,
      thickness: -1,
    } as Partial<AnyNode>)

    expect(shelf().width).toBe(3)
    expect(shelf().thickness).toBe(0.01)
  })

  test('preserves extra fields while sanitizing numeric updates', () => {
    useScene.setState({
      nodes: {
        [SHELF_ID]: {
          ...makeShelf(),
          legacyField: 'current',
        } as unknown as AnyNode,
      },
      rootNodeIds: [SHELF_ID],
    } as never)

    useScene.getState().updateNode(SHELF_ID, {
      width: Infinity,
      legacyPatch: 'patch',
    } as Partial<AnyNode>)

    const node = useScene.getState().nodes[SHELF_ID] as Record<string, unknown>
    expect(node.width).toBe(1.2)
    expect(node.legacyField).toBe('current')
    expect(node.legacyPatch).toBe('patch')
  })

  test('allows non-canonical ids to receive updates', () => {
    useScene.getState().updateNode(SOLAR_PANEL_ID, {
      name: 'Updated panel',
    } as Partial<AnyNode>)

    const panel = useScene.getState().nodes[SOLAR_PANEL_ID] as { name?: string }
    expect(panel.name).toBe('Updated panel')
  })

  test('sanitizes non-finite numeric values during create', () => {
    const createdId = 'shelf_created' as AnyNodeId

    useScene.getState().createNode(
      makeShelf({
        id: createdId,
        width: Infinity,
        thickness: Number.NaN,
      } as Partial<AnyNode>),
    )

    const created = useScene.getState().nodes[createdId] as Extract<AnyNode, { type: 'shelf' }>
    expect(created.width).toBe(1.2)
    expect(created.thickness).toBe(0.04)
    expect(Number.isFinite(created.width)).toBe(true)
    expect(Number.isFinite(created.thickness)).toBe(true)
  })
})
