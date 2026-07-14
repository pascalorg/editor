import { beforeEach, describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '../../schema/types'
import { coerce } from '../../test-utils'
import useScene from '../use-scene'

// bun:test has no DOM — node-actions schedules markDirty via requestAnimationFrame,
// so polyfill it as synchronous.
type RafFn = (cb: (t: number) => void) => number
type RafGlobals = {
  requestAnimationFrame?: RafFn
  cancelAnimationFrame?: (id: number) => void
}
const rafGlobals = coerce<RafGlobals>(globalThis)
rafGlobals.requestAnimationFrame ??= (cb: (t: number) => void) => {
  cb(0)
  return 0
}
rafGlobals.cancelAnimationFrame ??= () => {}

const ROOF_ID = 'roof_test' as AnyNodeId
const SEG_A_ID = 'rseg_a' as AnyNodeId
const SEG_B_ID = 'rseg_b' as AnyNodeId
const VENT_ID = 'bvent_v1' as AnyNodeId

function makeRoof(): AnyNode {
  return coerce<AnyNode>({
    id: ROOF_ID,
    type: 'roof',
    parentId: null,
    object: 'node',
    visible: true,
    name: '',
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    children: [SEG_A_ID, SEG_B_ID],
  })
}

function makeSegment(id: AnyNodeId, children: AnyNodeId[] = []): AnyNode {
  return coerce<AnyNode>({
    id,
    type: 'roof-segment',
    parentId: ROOF_ID,
    object: 'node',
    visible: true,
    name: '',
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    roofType: 'gable',
    width: 8,
    depth: 6,
    wallHeight: 0.5,
    pitch: 40,
    wallThickness: 0.1,
    deckThickness: 0.1,
    overhang: 0.3,
    shingleThickness: 0.05,
    children,
  })
}

function makeVent(parentId: AnyNodeId): AnyNode {
  return coerce<AnyNode>({
    id: VENT_ID,
    type: 'box-vent',
    parentId,
    roofSegmentId: parentId as string,
    object: 'node',
    visible: true,
    name: '',
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    width: 0.4,
    depth: 0.4,
    height: 0.15,
    hoodOverhang: 0.04,
    topTaper: 0.4,
    capHeight: 0.07,
    capGap: 0,
    domeCurvature: 0.65,
    baseInset: 0.06,
    baseHeight: 0.04,
    cornerBevel: 0.012,
    style: 'cap',
    materialPreset: 'preset-white',
  })
}

function childrenOf(id: AnyNodeId): AnyNodeId[] {
  const seg = useScene.getState().nodes[id] as { children?: AnyNodeId[] } | undefined
  return (seg?.children ?? []) as AnyNodeId[]
}

function vent(): AnyNode {
  return useScene.getState().nodes[VENT_ID] as AnyNode
}

describe('node-actions reparent — repeated segment-hopping', () => {
  beforeEach(() => {
    useScene.setState({
      nodes: {
        [ROOF_ID]: makeRoof(),
        [SEG_A_ID]: makeSegment(SEG_A_ID, [VENT_ID]),
        [SEG_B_ID]: makeSegment(SEG_B_ID, []),
        [VENT_ID]: makeVent(SEG_A_ID),
      },
      rootNodeIds: [ROOF_ID],
    } as never)
    useScene.temporal.getState().clear()
  })

  test('initial state: vent listed once in A.children, absent from B.children', () => {
    expect(childrenOf(SEG_A_ID)).toEqual([VENT_ID])
    expect(childrenOf(SEG_B_ID)).toEqual([])
    expect((vent() as { parentId: AnyNodeId }).parentId).toBe(SEG_A_ID)
  })

  test('A→B: auto-reparent moves vent without leaving duplicates', () => {
    useScene
      .getState()
      .updateNode(VENT_ID, { parentId: SEG_B_ID, roofSegmentId: SEG_B_ID } as Partial<AnyNode>)

    expect(childrenOf(SEG_A_ID)).toEqual([])
    expect(childrenOf(SEG_B_ID)).toEqual([VENT_ID])
    expect((vent() as { parentId: AnyNodeId }).parentId).toBe(SEG_B_ID)
  })

  test('A→B→A→B: three hops leave children lists clean (regression: vent crash)', () => {
    // Move 1: A → B
    useScene
      .getState()
      .updateNode(VENT_ID, { parentId: SEG_B_ID, roofSegmentId: SEG_B_ID } as Partial<AnyNode>)
    expect(childrenOf(SEG_A_ID)).toEqual([])
    expect(childrenOf(SEG_B_ID)).toEqual([VENT_ID])

    // Move 2: B → A
    useScene
      .getState()
      .updateNode(VENT_ID, { parentId: SEG_A_ID, roofSegmentId: SEG_A_ID } as Partial<AnyNode>)
    expect(childrenOf(SEG_A_ID)).toEqual([VENT_ID])
    expect(childrenOf(SEG_B_ID)).toEqual([])

    // Move 3: A → B (the move the user reports crashes)
    useScene
      .getState()
      .updateNode(VENT_ID, { parentId: SEG_B_ID, roofSegmentId: SEG_B_ID } as Partial<AnyNode>)
    expect(childrenOf(SEG_A_ID)).toEqual([])
    expect(childrenOf(SEG_B_ID)).toEqual([VENT_ID])
    expect((vent() as { parentId: AnyNodeId }).parentId).toBe(SEG_B_ID)

    // Crucially: the vent must appear in EXACTLY ONE segment's children.
    // Duplicate listing is what makes the roof renderer mount two
    // <NodeRenderer key={ventId}> instances and crash the scene-registry
    // on unmount.
    const totalListings =
      childrenOf(SEG_A_ID).filter((id) => id === VENT_ID).length +
      childrenOf(SEG_B_ID).filter((id) => id === VENT_ID).length
    expect(totalListings).toBe(1)
  })

  test.each([
    ['chimney', 'chmn_x'],
    ['skylight', 'sky_x'],
    ['dormer', 'dorm_x'],
    ['solar-panel', 'sp_x'],
    ['ridge-vent', 'rvent_x'],
  ])('A→B→A→B for %s: chimney-style auto-reparent leaves children clean', (type, idStr) => {
    const id = idStr as AnyNodeId
    useScene.setState({
      nodes: {
        [ROOF_ID]: makeRoof(),
        [SEG_A_ID]: makeSegment(SEG_A_ID, [id]),
        [SEG_B_ID]: makeSegment(SEG_B_ID, []),
        [id]: coerce<AnyNode>({
          id,
          type,
          parentId: SEG_A_ID,
          roofSegmentId: SEG_A_ID,
          object: 'node',
          visible: true,
          name: '',
          metadata: {},
          position: [0, 0, 0],
          rotation: 0,
        }),
      },
      rootNodeIds: [ROOF_ID],
    } as never)

    const hop = (to: AnyNodeId) =>
      useScene.getState().updateNode(id, { parentId: to, roofSegmentId: to } as Partial<AnyNode>)

    hop(SEG_B_ID)
    hop(SEG_A_ID)
    hop(SEG_B_ID)

    expect(childrenOf(SEG_A_ID)).toEqual([])
    expect(childrenOf(SEG_B_ID)).toEqual([id])
    const node = useScene.getState().nodes[id] as { parentId: AnyNodeId }
    expect(node.parentId).toBe(SEG_B_ID)
  })

  test('A→B→A→B with redundant manual children edits (vent move-tool pattern, pre-fix)', () => {
    // Reproduces the box-vent / ridge-vent move-tool order: manual
    // children edits FIRST, then updateNode({parentId}) which triggers
    // auto-reparent. The dual handling must not leave the vent listed
    // in both segments after three hops.
    const hop = (from: AnyNodeId, to: AnyNodeId) => {
      const st = useScene.getState()
      // 1. Manual: filter old children, push to new children — using
      //    the snapshot (st.nodes) captured before any updates.
      const oldSeg = st.nodes[from] as { children?: AnyNodeId[] } | undefined
      if (oldSeg) {
        st.updateNode(from, {
          children: (oldSeg.children ?? []).filter((id) => id !== VENT_ID),
        } as Partial<AnyNode>)
      }
      const newSeg = st.nodes[to] as { children?: AnyNodeId[] } | undefined
      if (newSeg && !(newSeg.children ?? []).includes(VENT_ID)) {
        st.updateNode(to, {
          children: [...(newSeg.children ?? []), VENT_ID],
        } as Partial<AnyNode>)
      }
      // 2. Then the auto-reparent path via parentId.
      st.updateNode(VENT_ID, {
        parentId: to,
        roofSegmentId: to,
      } as Partial<AnyNode>)
    }

    hop(SEG_A_ID, SEG_B_ID)
    hop(SEG_B_ID, SEG_A_ID)
    hop(SEG_A_ID, SEG_B_ID)

    expect(childrenOf(SEG_A_ID)).toEqual([])
    expect(childrenOf(SEG_B_ID)).toEqual([VENT_ID])
    expect((vent() as { parentId: AnyNodeId }).parentId).toBe(SEG_B_ID)

    const totalListings =
      childrenOf(SEG_A_ID).filter((id) => id === VENT_ID).length +
      childrenOf(SEG_B_ID).filter((id) => id === VENT_ID).length
    expect(totalListings).toBe(1)
  })
})
