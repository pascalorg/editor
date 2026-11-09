import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  nodeRegistry,
  registerNode,
  SlabNode,
  useScene,
} from '@pascal-app/core'
import { paintSurface } from '../../../../editor/src/components/ui/controls/finish-swatch'
import { installImmediateAnimationFrames } from '../../../../editor/src/test-utils/immediate-animation-frames'
import { slabDefinition } from '../definition'
import { slabPaint } from '../paint'

// The Floor & foundation panel's finish swatches paint exactly as the paint
// tool does: same write, same undo step, for the edge band and the foundation.

const plate = SlabNode.parse({
  id: 'slab_swatch',
  boundary: 'auto',
  plateRole: 'base',
  polygon: [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ],
  foundation: { type: 'solid' },
})
const reset = () => {
  useScene.setState({
    nodes: { [plate.id]: plate } as Record<AnyNodeId, AnyNode>,
    materials: {},
    dirtyNodes: new Set(),
    readOnly: false,
  })
  useScene.temporal.getState().clear()
}
let restoreFrames = () => {}
beforeEach(() => {
  restoreFrames = installImmediateAnimationFrames()
  nodeRegistry._reset()
  registerNode(slabDefinition as never)
  reset()
})
afterEach(() => {
  nodeRegistry._reset()
  restoreFrames()
})

test.each(['edge', 'foundation'])('the %s swatch writes what the paint tool writes', (role) => {
  const ref = 'library:preset-tomato'
  slabPaint.commit({ node: plate, role, material: undefined, materialPreset: ref })
  const painted = useScene.getState().nodes[plate.id]
  const paintedSteps = useScene.temporal.getState().pastStates.length
  reset()
  paintSurface(plate, role, ref)
  expect(useScene.getState().nodes[plate.id]).toEqual(painted)
  expect(useScene.temporal.getState().pastStates.length).toBe(paintedSteps)
  expect(paintedSteps).toBe(1)
})
