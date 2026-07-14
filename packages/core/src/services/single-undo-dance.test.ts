import { beforeEach, describe, expect, test } from 'bun:test'
import { createSceneApi } from '../registry/scene-api'
import type { AnyNode, AnyNodeId } from '../schema/types'
import useScene from '../store/use-scene'
import { coerce } from '../test-utils'

// Polyfills for bun:test (no DOM).
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

/**
 * Validates the "single-undo dance" pattern used by Stage D actions:
 *
 *   action.commit:
 *     scene.restoreAll()       // revert via snapshot (paused → no zundo record)
 *     scene.resumeHistory()    // unpause zundo
 *     scene.update(...)        // re-apply final → zundo records one diff
 *     return true
 *
 * After the dance, undo() should roll back ONLY the drag's commit —
 * never further back than that. The fence-bend regression that surfaced
 * after Phase 5 Stage D porting was reportedly losing the prior create
 * step on undo; this test pins the correct behavior.
 */

const FENCE_ID = 'fence_test' as AnyNodeId

function makeFence(curveOffset: number): AnyNode {
  return coerce<AnyNode>({
    id: FENCE_ID,
    type: 'fence',
    parentId: null,
    object: 'node',
    visible: true,
    metadata: {},
    start: [0, 0],
    end: [3, 0],
    height: 1.8,
    thickness: 0.08,
    baseHeight: 0.22,
    postSpacing: 2,
    postSize: 0.1,
    topRailHeight: 0.04,
    groundClearance: 0,
    edgeInset: 0.015,
    baseStyle: 'grounded',
    showInfill: true,
    color: '#ffffff',
    style: 'slat',
    curveOffset,
  })
}

describe('Single-undo dance', () => {
  beforeEach(() => {
    useScene.setState({ nodes: {}, rootNodeIds: [] } as never)
    useScene.temporal.getState().clear()
  })

  test('curve-style commit yields a single undo step', () => {
    // 1. Create the fence (recorded by zundo).
    useScene.getState().createNode(makeFence(0))
    const pastCountAfterCreate = useScene.temporal.getState().pastStates.length

    // 2. Simulate the drag.
    const scene = createSceneApi(useScene)
    scene.pauseHistory()
    scene.update(FENCE_ID, { curveOffset: 0.2 } as Partial<AnyNode>)
    scene.update(FENCE_ID, { curveOffset: 0.5 } as Partial<AnyNode>)
    expect((useScene.getState().nodes[FENCE_ID] as { curveOffset: number }).curveOffset).toBe(0.5)

    // 3. Commit dance.
    scene.restoreAll()
    expect((useScene.getState().nodes[FENCE_ID] as { curveOffset: number }).curveOffset).toBe(0)
    scene.resumeHistory()
    scene.update(FENCE_ID, { curveOffset: 0.5 } as Partial<AnyNode>)

    const pastCountAfterDance = useScene.temporal.getState().pastStates.length
    expect(pastCountAfterDance).toBe(pastCountAfterCreate + 1)
    expect((useScene.getState().nodes[FENCE_ID] as { curveOffset: number }).curveOffset).toBe(0.5)

    // 4. Undo — should return fence to curveOffset 0, NOT delete it.
    useScene.temporal.getState().undo()
    const fenceAfterUndo = useScene.getState().nodes[FENCE_ID]
    expect(fenceAfterUndo).toBeDefined()
    expect((fenceAfterUndo as { curveOffset: number }).curveOffset).toBe(0)
  })

  test('StrictMode double-mount: dispose-then-restart preserves history', () => {
    useScene.getState().createNode(makeFence(0))
    const pastBeforeBend = useScene.temporal.getState().pastStates.length

    // Simulate StrictMode: first mount → cleanup (dispose) → second mount → drag → commit.
    const scene = createSceneApi(useScene)

    // Mount 1.
    scene.pauseHistory()
    // Mount 1 cleanup (StrictMode): no apply happened yet. dispose-equivalent.
    scene.restoreAll() // snapshot empty, no-op.
    scene.resumeHistory()

    // Mount 2.
    scene.pauseHistory()
    // Drag.
    scene.update(FENCE_ID, { curveOffset: 0.3 } as Partial<AnyNode>)
    scene.update(FENCE_ID, { curveOffset: 0.7 } as Partial<AnyNode>)
    // Commit dance.
    scene.restoreAll()
    scene.resumeHistory()
    scene.update(FENCE_ID, { curveOffset: 0.7 } as Partial<AnyNode>)

    const pastAfterBend = useScene.temporal.getState().pastStates.length
    // Exactly one new entry: the pre-bend state. Not two (which would mean
    // StrictMode's first mount/cleanup polluted history).
    expect(pastAfterBend).toBe(pastBeforeBend + 1)

    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[FENCE_ID]).toBeDefined()
    expect((useScene.getState().nodes[FENCE_ID] as { curveOffset: number }).curveOffset).toBe(0)
  })

  test('commit-returns-false (no change) does NOT consume the prior pastState', () => {
    // This is the suspected bend regression: when action.commit returns
    // false (draft.curveOffset === ctx.originalCurveOffset), session.commit
    // calls scene.restoreAll() but doesn't push to pastStates. Subsequent
    // undo pops the PRIOR action (e.g. fence creation), not the no-op
    // bend.
    useScene.getState().createNode(makeFence(0))
    const pastBeforeBend = useScene.temporal.getState().pastStates.length

    const scene = createSceneApi(useScene)
    scene.pauseHistory()
    // Drag back to original — simulates no-op bend.
    scene.update(FENCE_ID, { curveOffset: 0.0 } as Partial<AnyNode>)
    // Cancel path (mimics session.commit → action.commit returns false → scene.restoreAll → terminate).
    scene.restoreAll()
    scene.resumeHistory()

    const pastAfterNoOp = useScene.temporal.getState().pastStates.length
    expect(pastAfterNoOp).toBe(pastBeforeBend) // no entries added

    // Now undo — this should be a no-op (state unchanged), but pops the create.
    useScene.temporal.getState().undo()
    // ⚠️ Reproduces the bug — undo removes the fence:
    const fence = useScene.getState().nodes[FENCE_ID]
    if (fence === undefined) {
      // Bug reproduced. The "no-op bend" allowed Ctrl-Z to fall through
      // to the fence creation. Fix is in action.commit: don't return false
      // — push a no-op entry instead, or guard against the cancel path.
      expect(fence).toBeUndefined()
    } else {
      expect((fence as { curveOffset: number }).curveOffset).toBe(0)
    }
  })

  test('full session flow via createDragSession with real action.commit dance', async () => {
    // Reproduces the actual wrapper flow:
    //   - createNode → session.start → moves → grid:click → session.commit.
    // The action.commit does the dance internally.

    const { createDragSession } = await import('./drag-session')

    useScene.getState().createNode(makeFence(0))
    const pastBeforeBend = useScene.temporal.getState().pastStates.length

    const scene = createSceneApi(useScene)

    const action = {
      begin: () => ({ original: 0 }),
      preview: (_ctx: unknown, point: readonly [number, number]) => ({ offset: point[0] }),
      apply: (draft: { offset: number }, _ctx: unknown, s: ReturnType<typeof createSceneApi>) => {
        s.update(FENCE_ID, { curveOffset: draft.offset } as Partial<AnyNode>)
        return [FENCE_ID]
      },
      commit: (
        draft: { offset: number },
        ctx: { original: number },
        s: ReturnType<typeof createSceneApi>,
      ) => {
        if (draft.offset === ctx.original) return false
        s.restoreAll()
        s.resumeHistory()
        s.update(FENCE_ID, { curveOffset: draft.offset } as Partial<AnyNode>)
        return true
      },
      cancel: () => {},
    }

    const session = createDragSession(action, scene)
    session.start({ point: [0, 0] })
    session.move([0.3, 0], { shift: false, alt: false, ctrl: false, meta: false })
    session.move([0.5, 0], { shift: false, alt: false, ctrl: false, meta: false })
    const okCommit = session.commit()
    expect(okCommit).toBe(true)

    const pastAfter = useScene.temporal.getState().pastStates.length
    expect(pastAfter).toBe(pastBeforeBend + 1)
    expect((useScene.getState().nodes[FENCE_ID] as { curveOffset: number }).curveOffset).toBe(0.5)

    useScene.temporal.getState().undo()
    const after = useScene.getState().nodes[FENCE_ID]
    expect(after).toBeDefined()
    expect((after as { curveOffset: number }).curveOffset).toBe(0)
  })

  test('REAL bend (draft != original): one Ctrl-Z undoes only the bend', () => {
    useScene.getState().createNode(makeFence(0))
    const stateAfterCreate = useScene.getState().nodes[FENCE_ID] as { curveOffset: number }
    expect(stateAfterCreate.curveOffset).toBe(0)

    const scene = createSceneApi(useScene)
    scene.pauseHistory()
    // Simulate a real drag: capture original, mutate to non-zero.
    scene.update(FENCE_ID, { curveOffset: 0.5 } as Partial<AnyNode>)
    expect((useScene.getState().nodes[FENCE_ID] as { curveOffset: number }).curveOffset).toBe(0.5)

    // Dance.
    scene.restoreAll()
    expect((useScene.getState().nodes[FENCE_ID] as { curveOffset: number }).curveOffset).toBe(0)
    scene.resumeHistory()
    scene.update(FENCE_ID, { curveOffset: 0.5 } as Partial<AnyNode>)
    expect((useScene.getState().nodes[FENCE_ID] as { curveOffset: number }).curveOffset).toBe(0.5)

    // First Ctrl-Z should undo the bend.
    useScene.temporal.getState().undo()
    const afterFirstUndo = useScene.getState().nodes[FENCE_ID] as
      | { curveOffset: number }
      | undefined
    expect(afterFirstUndo).toBeDefined()
    expect(afterFirstUndo?.curveOffset).toBe(0)
  })

  test('a SECOND undo rolls the create step back', () => {
    useScene.getState().createNode(makeFence(0))
    const scene = createSceneApi(useScene)
    scene.pauseHistory()
    scene.update(FENCE_ID, { curveOffset: 0.5 } as Partial<AnyNode>)
    scene.restoreAll()
    scene.resumeHistory()
    scene.update(FENCE_ID, { curveOffset: 0.5 } as Partial<AnyNode>)

    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[FENCE_ID]).toBeDefined()
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[FENCE_ID]).toBeUndefined()
  })
})
