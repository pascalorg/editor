import { expect, test } from 'bun:test'
import { DuctSegmentNode, useScene } from '@pascal-app/core'
import { planDuctDraw } from './tool'

const profile = { shape: 'round' as const, diameter: 6, width: 12, height: 8 }
test('a short existing run cannot silently lose its required elbow', () => {
  const node = DuctSegmentNode.parse({
    path: [
      [-0.1, 0, 0],
      [0, 0, 0],
    ],
  })
  const original = useScene.getState().nodes
  useScene.setState({ nodes: { ...original, [node.id]: node } })
  try {
    const plan = planDuctDraw(
      [0, 0, 0],
      [0, 0, 2],
      {
        nodeId: node.id,
        id: 'end',
        position: [0, 0, 0],
        direction: [1, 0, 0],
        diameter: 6,
        system: 'supply',
      },
      null,
      null,
      null,
      profile,
    )
    expect(plan?.validationMessage).toBeTruthy()
  } finally {
    useScene.setState({ nodes: original })
  }
})

test('a free run remains drawable', () => {
  const plan = planDuctDraw([0, 0, 0], [2, 0, 0], null, null, null, null, profile)
  expect(plan?.validationMessage).toBeNull()
  expect(plan?.ducts).toHaveLength(1)
})

test('a short branch reports failure instead of omitting its tee', () => {
  const node = DuctSegmentNode.parse({
    path: [
      [-0.1, 0, 0],
      [0.1, 0, 0],
    ],
  })
  const original = useScene.getState().nodes
  useScene.setState({ nodes: { ...original, [node.id]: node } })
  try {
    const plan = planDuctDraw(
      [0, 0, 0],
      [0, 0, 2],
      null,
      { nodeId: node.id, segmentIndex: 0, point: [0, 0, 0] },
      null,
      null,
      profile,
    )
    expect(plan?.validationMessage).toBeTruthy()
    expect(plan?.ducts).toHaveLength(0)
    expect(plan?.updates).toHaveLength(0)
  } finally {
    useScene.setState({ nodes: original })
  }
})
