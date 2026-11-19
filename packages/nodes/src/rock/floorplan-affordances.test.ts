import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  clearSceneHistory,
  RockNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import {
  rockAddVertexAffordance,
  rockDeleteVertexAffordance,
  rockMoveEdgeAffordance,
  rockMoveVertexAffordance,
} from './floorplan-affordances'

const square: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]
const modifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }

function polygonOf(id: string) {
  const node = useScene.getState().nodes[id as AnyNodeId]
  if (node?.type !== 'rock') throw new Error('The rock is gone')
  return (useLiveNodeOverrides.getState().get(id)?.polygon ?? node.polygon) as RockNode['polygon']
}

describe('editing a rock’s footprint on the plan', () => {
  const rock = RockNode.parse({ id: 'rock_edit', polygon: square, height: 2 })
  let original: ReturnType<typeof useScene.getState>
  let editor: ReturnType<typeof useEditor.getState>
  const originalFrame = globalThis.requestAnimationFrame
  const originalCancel = globalThis.cancelAnimationFrame

  beforeEach(() => {
    // A scene write schedules its dirty marks on the next frame: run it at once.
    globalThis.requestAnimationFrame = (callback) => {
      callback(0)
      return 0
    }
    globalThis.cancelAnimationFrame = () => {}
    original = useScene.getState()
    editor = useEditor.getState()
    useEditor.getState().setSnappingMode('polygon', 'off')
    useScene.setState({
      nodes: { [rock.id]: rock as AnyNode },
      rootNodeIds: [],
      readOnly: false,
    } as never)
    useScene.temporal.getState().resume()
    clearSceneHistory()
  })
  afterEach(() => {
    globalThis.requestAnimationFrame = originalFrame
    globalThis.cancelAnimationFrame = originalCancel
    useLiveNodeOverrides.getState().clear(rock.id)
    useEditor.setState(editor)
    useScene.setState(original)
    clearSceneHistory()
  })

  const nodes = () => useScene.getState().nodes
  const start = (
    affordance: {
      start: (args: never) => {
        apply: (a: never) => void
        canCommit: () => boolean
        commit?: () => void
      }
    },
    payload: object,
    initialPlanPoint: [number, number] = [0, 0],
  ) =>
    affordance.start({ node: nodes()[rock.id], payload, nodes: nodes(), initialPlanPoint } as never)

  // Main previews through overrides; the lab wrote on every tick. Preserve the source
  // shape assertions above that seam, then require one undoable persistent commit.
  const commit = (session: { commit?: () => void }) => {
    const expected = polygonOf(rock.id)
    expect(useScene.getState().nodes[rock.id]).toEqual(rock)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    session.commit?.()
    expect((useScene.getState().nodes[rock.id] as RockNode).polygon).toEqual(expected)
    expect(useLiveNodeOverrides.getState().get(rock.id)).toBeUndefined()
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[rock.id]).toEqual(rock)
  }

  test('dragging a corner moves that corner of the stored footprint', () => {
    const session = start(rockMoveVertexAffordance, { vertexIndex: 1 })

    session.apply({ planPoint: [6, -1], modifiers } as never)

    expect(polygonOf(rock.id)[1]).toEqual([6, -1])
    expect(polygonOf(rock.id)[0]).toEqual([0, 0])
    expect(session.canCommit()).toBe(true)
    commit(session)
  })

  test('adding a vertex at a midpoint makes a fifth corner there', () => {
    const session = start(rockAddVertexAffordance, { edgeIndex: 0 })

    session.apply({ planPoint: [2, -1], modifiers } as never)

    expect(polygonOf(rock.id)).toHaveLength(5)
    expect(polygonOf(rock.id)[1]).toEqual([2, -1])
    commit(session)
  })

  test('sliding an edge moves both of its corners and no others', () => {
    const session = start(rockMoveEdgeAffordance, { edgeIndex: 2 }, [2, 4])

    session.apply({ planPoint: [2, 6], modifiers } as never)

    const moved = polygonOf(rock.id)
    expect(moved[0]).toEqual([0, 0])
    expect(moved[1]).toEqual([4, 0])
    expect(Math.abs((moved[2]?.[1] ?? 4) - 4)).toBeCloseTo(2, 6)
    expect(moved[3]?.[1]).toBeCloseTo(moved[2]?.[1] ?? 0, 6)
    commit(session)
  })

  test('deleting a corner leaves three; a triangle keeps its three', () => {
    const first = start(rockDeleteVertexAffordance, { vertexIndex: 3 }) as unknown as {
      commit: () => void
    }
    first.commit()
    expect(polygonOf(rock.id)).toHaveLength(3)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    const second = start(rockDeleteVertexAffordance, { vertexIndex: 0 }) as unknown as {
      commit: () => void
      canCommit: () => boolean
    }
    second.commit()

    expect(second.canCommit()).toBe(false)
    expect(polygonOf(rock.id)).toHaveLength(3)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[rock.id]).toEqual(rock)
  })
})
