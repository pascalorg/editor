import { afterEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  DoorNode,
  useInteractive,
  useScene,
  WindowNode,
} from '@pascal-app/core'
import { doorMechanism } from '../door/mechanism'
import { swapDoorSwingPatch } from '../door/swing'
import { windowMechanism } from '../window/mechanism'
import { canSwapWindowHinge, swapWindowHingePatch } from '../window/swing'
import { applyOpeningSwap } from './opening-swap'

const OPEN_ANGLE = Math.PI / 2
const originalScene = useScene.getState()
const originalInteractive = useInteractive.getState()
afterEach(() => {
  useScene.setState(originalScene)
  useInteractive.setState(originalInteractive)
})

function load(node: AnyNode) {
  useScene.setState({ nodes: { [node.id]: node } as Record<AnyNodeId, AnyNode>, rootNodeIds: [] })
  useScene.temporal.getState().clear()
  useScene.temporal.getState().resume()
}

test('swapping a closed door commits one undo step and opens it; an open door is left open', () => {
  const door = DoorNode.parse({ id: 'door_swap', swingDirection: 'inward' })
  load(door)
  applyOpeningSwap(door, swapDoorSwingPatch(door), doorMechanism)
  expect(useScene.getState().nodes[door.id]).toMatchObject({ swingDirection: 'outward' })
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  expect(useInteractive.getState().doorAnimations[door.id]).toMatchObject({
    field: 'swingAngle',
    to: OPEN_ANGLE,
    persist: false,
  })

  useInteractive.setState({
    doors: { [door.id]: { swingAngle: OPEN_ANGLE } },
    doorAnimations: {},
  })
  const swapped = useScene.getState().nodes[door.id] as DoorNode
  applyOpeningSwap(swapped, swapDoorSwingPatch(swapped), doorMechanism)
  expect(useScene.getState().nodes[door.id]).toMatchObject({ swingDirection: 'inward' })
  expect(useScene.temporal.getState().pastStates).toHaveLength(2)
  expect(useInteractive.getState().doorAnimations).toEqual({})
})

test("only a single casement's hinge swaps; the swap opens the closed sash", () => {
  expect(canSwapWindowHinge(WindowNode.parse({ windowType: 'casement' }))).toBe(true)
  for (const values of [
    { windowType: 'casement', casementStyle: 'french' },
    { windowType: 'awning' },
    { windowType: 'sliding' },
    { windowType: 'casement', openingKind: 'opening' },
  ] as const) {
    expect(canSwapWindowHinge(WindowNode.parse(values))).toBe(false)
  }

  const casement = WindowNode.parse({
    id: 'window_swap',
    windowType: 'casement',
    hingesSide: 'left',
  })
  load(casement)
  applyOpeningSwap(casement, swapWindowHingePatch(casement), windowMechanism)
  expect(useScene.getState().nodes[casement.id]).toMatchObject({ hingesSide: 'right' })
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  expect(useInteractive.getState().windowAnimations[casement.id]).toMatchObject({
    to: 1,
    persist: false,
  })
})
