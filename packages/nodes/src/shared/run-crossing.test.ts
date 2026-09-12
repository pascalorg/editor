import { expect, test } from 'bun:test'
import { DuctSegmentNode, useScene } from '@pascal-app/core'
import type { RunSurfaceTarget } from './distribution-run-contract'
import { findRunBodyCrossingSurface } from './ports'

test('ceiling crossings ignore floor runs and connect only at matching 3D height', () => {
  const previous = useScene.getState().nodes
  const floor = DuctSegmentNode.parse({
    parentId: 'level_test',
    path: [
      [0, 0, -2],
      [0, 0, 2],
    ],
  })
  const ceiling = DuctSegmentNode.parse({
    parentId: 'level_test',
    path: [
      [0, 3, -2],
      [0, 3, 2],
    ],
  })
  const target: RunSurfaceTarget = {
    kind: 'ceiling',
    levelId: 'level_test',
    frame: { origin: [0, 3, 0], normal: [0, -1, 0], tangent: [1, 0, 0], bitangent: [0, 0, 1] },
  }
  try {
    useScene.setState({ nodes: { [floor.id]: floor } })
    expect(findRunBodyCrossingSurface([-2, 3, 0], [2, 3, 0], 0.1, target)).toBeNull()
    useScene.setState({ nodes: { [floor.id]: floor, [ceiling.id]: ceiling } })
    expect(findRunBodyCrossingSurface([-2, 3, 0], [2, 3, 0], 0.1, target)?.nodeId).toBe(ceiling.id)
  } finally {
    useScene.setState({ nodes: previous })
  }
})
