import { afterEach, expect, test } from 'bun:test'
import { sceneRegistry, useInteractive, useScene, WindowNode } from '@pascal-app/core'
import { advanceWindowAnimations, buildWindowPreviewMesh, poseWindowMovingParts } from '../../index'
import { pendingWindowAnimationRebuilds } from './window-system'

const originalScene = useScene.getState()
const originalInteractive = useInteractive.getState()
const ids: WindowNode['id'][] = []
afterEach(() => {
  useScene.setState(originalScene)
  useInteractive.setState(originalInteractive)
  for (const id of ids) sceneRegistry.nodes.delete(id)
  ids.length = 0
  pendingWindowAnimationRebuilds.clear()
})

function load(fields: Partial<WindowNode>) {
  const node = WindowNode.parse(fields)
  ids.push(node.id)
  useScene.setState({ nodes: { [node.id]: node }, dirtyNodes: new Set() })
  useInteractive.setState({ windows: {}, windowAnimations: {} })
  const mesh = buildWindowPreviewMesh(node)
  sceneRegistry.nodes.set(node.id, mesh)
  return { node, mesh }
}

for (const field of ['shutterOpen', 'rollerShutterOpen'] as const) {
  test.each(['box', 'concealed'] as const)(
    `${field} tweens a %s roller to closed and settles without persisting`,
    (rollerShutter) => {
      const { node, mesh } = load({ shutters: 'panel', rollerShutter, [field]: 1 })
      const before = useScene.getState().nodes
      useInteractive.getState().startWindowAnimation(node.id, {
        field,
        from: 1,
        to: 0,
        startedAt: null,
        durationMs: 520,
        persist: false,
      })
      advanceWindowAnimations(100)
      expect(useInteractive.getState().windows[node.id]?.[field]).toBe(1)
      advanceWindowAnimations(360)
      expect(useInteractive.getState().windows[node.id]?.[field]).toBeCloseTo(0.5)
      if (field === 'shutterOpen') {
        expect(Math.abs(mesh.getObjectByName('shutter-left')!.rotation.y)).toBeCloseTo(Math.PI / 2)
        expect(pendingWindowAnimationRebuilds.has(node.id)).toBe(false)
        expect(useScene.getState().dirtyNodes.has(node.id)).toBe(false)
      } else {
        expect(pendingWindowAnimationRebuilds.has(node.id)).toBe(true)
        const half = buildWindowPreviewMesh(node).getObjectByName('window-roller-curtain')!
        expect(half.children).toHaveLength(1)
      }
      advanceWindowAnimations(620)
      expect(useInteractive.getState().windowAnimations[node.id]).toBeUndefined()
      expect(useInteractive.getState().windows[node.id]?.[field]).toBe(0)
      expect(useScene.getState().nodes).toBe(before)
      expect(useScene.getState().dirtyNodes.has(node.id)).toBe(true)
      advanceWindowAnimations(880)
      expect(useInteractive.getState().windows[node.id]?.[field]).toBe(0)
    },
  )
}

test('sash, hinged shutters and roller run together; persisting the sash preserves shutter previews', () => {
  const { node, mesh } = load({
    windowType: 'casement',
    shutters: 'panel',
    rollerShutter: 'box',
    shutterOpen: 0.2,
  })
  for (const field of ['operationState', 'shutterOpen', 'rollerShutterOpen'] as const) {
    useInteractive.getState().startWindowAnimation(node.id, {
      field,
      from: 0,
      to: 1,
      startedAt: 0,
      durationMs: 520,
      persist: field === 'operationState',
    })
  }
  advanceWindowAnimations(260)
  expect(useInteractive.getState().windows[node.id]).toEqual({
    operationState: 0.5,
    shutterOpen: 0.5,
    rollerShutterOpen: 0.5,
  })
  expect(Math.abs(mesh.getObjectByName('shutter-left')!.rotation.y)).toBeCloseTo(Math.PI / 2)
  advanceWindowAnimations(520)
  expect(useScene.getState().nodes[node.id]).toMatchObject({ operationState: 1, shutterOpen: 0.2 })
  expect(useInteractive.getState().windows[node.id]).toEqual({
    shutterOpen: 1,
    rollerShutterOpen: 1,
  })
  expect(useInteractive.getState().windowAnimations[node.id]).toBeUndefined()
})

test.each([0, 0.5, 1])(
  'shutters hinge at their inner edge and bake their saved pose at %s',
  (shutterOpen) => {
    const { node, mesh } = load({
      width: 1.2,
      shutterWidth: 0.6,
      shutters: 'panel',
      shutterOpen,
      windowType: 'casement',
      sill: false,
    })
    const left = mesh.getObjectByName('shutter-left')!
    const right = mesh.getObjectByName('shutter-right')!
    const hinge = left.position.clone()
    // A live preview may have left the mesh in another pose. Export resets to saved shutters.
    poseWindowMovingParts(node, mesh, 0, 1 - shutterOpen)
    poseWindowMovingParts(node, mesh, 1)
    expect(left.position.equals(hinge)).toBe(true)
    expect(Math.abs(left.rotation.y)).toBeCloseTo(Math.PI * (1 - shutterOpen))
    expect(left.rotation.y).toBeCloseTo(-right.rotation.y)
    const innerEdge = left.localToWorld(hinge.clone().set(0, 0, 0))
    const outerEdge = left.localToWorld(hinge.clone().set(-0.6, 0, 0))
    expect(innerEdge.x).toBeCloseTo(hinge.x)
    expect(innerEdge.z).toBeCloseTo(hinge.z)
    if (shutterOpen === 0) expect(outerEdge.x).toBeCloseTo(0)
    if (shutterOpen === 0.5) expect(outerEdge.x).toBeCloseTo(innerEdge.x)
    if (shutterOpen === 1) {
      expect(outerEdge.x).toBeCloseTo(-1.2)
      expect(outerEdge.z).toBeCloseTo(innerEdge.z)
    }
  },
)

test('deleting an animating window clears its queued fields, displayed values and part switches', () => {
  const { node } = load({ shutters: 'panel' })
  const interactive = useInteractive.getState()
  interactive.setMechanismPart(node.id, 'shutters', false)
  interactive.setWindowOpenState(node.id, { shutterOpen: 0.5 })
  interactive.startWindowAnimation(node.id, {
    field: 'shutterOpen',
    from: 1,
    to: 0,
    startedAt: 0,
    durationMs: 520,
    persist: false,
  })
  pendingWindowAnimationRebuilds.add(node.id)
  useScene.setState({ nodes: {} })
  advanceWindowAnimations(260)
  expect(useInteractive.getState().windowAnimations[node.id]).toBeUndefined()
  expect(useInteractive.getState().windows[node.id]).toBeUndefined()
  expect(useInteractive.getState().mechanismParts[`${node.id}:shutters`]).toBeUndefined()
  expect(pendingWindowAnimationRebuilds.has(node.id)).toBe(false)
})
