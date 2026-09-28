import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  LevelNode,
  nodeRegistry,
  registerNode,
  sceneRegistry,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { ProceduralItemNode, parseRecipe, type Recipe } from '@pascal-app/core/procedural-items'
import { act, create } from '@react-three/test-renderer'
import { Mesh, type Object3D, Raycaster, Vector3 } from 'three'
import jointJson from '../../../core/src/procedural-items/__fixtures__/joint_cabinet.json'
import { proceduralItemDefinition } from './definition'
import ProceduralRenderer from './renderer'

globalThis.requestAnimationFrame ??= () => 0
globalThis.cancelAnimationFrame ??= () => {}

const level = LevelNode.parse({ id: 'level_joint-renderer', height: 3 })
let restoreRegistry: () => void
let oldNodes: ReturnType<typeof useScene.getState>['nodes']
beforeEach(() => {
  restoreRegistry = nodeRegistry._snapshot()
  oldNodes = useScene.getState().nodes
  registerNode(proceduralItemDefinition)
})
afterEach(() => {
  useScene.setState({ nodes: oldNodes })
  restoreRegistry()
})
function install(recipe: Recipe) {
  const node = ProceduralItemNode.parse({
    id: 'procedural-item_joints',
    recipe: parseRecipe(recipe),
    parentId: level.id,
  })
  useScene.setState({ nodes: { [level.id]: level, [node.id]: node } as Record<AnyNodeId, AnyNode> })
  return node
}
const visibleChain = (object: Object3D | null) => {
  for (let at = object; at; at = at.parent) if (!at.visible) return false
  return true
}
// Every hit a raycaster returns from the design must be something drawn.
function hits(root: Object3D, from: Vector3, to: Vector3) {
  root.updateMatrixWorld(true)
  const ray = new Raycaster(from, to.clone().sub(from).normalize())
  return ray.intersectObject(root, true)
}

test('an idle joint tree draws and raycasts only its merged rest pose; playing swaps to the joint groups', async () => {
  const node = install(structuredClone(jointJson) as Recipe)
  const renderer = await create(<ProceduralRenderer node={node} />)
  try {
    await renderer.advanceFrames(2, 1 / 60)
    const root = sceneRegistry.nodes.get(node.id)!
    const knob = root.getObjectByName(`${node.id}__motion__knob`)!
    expect(knob.parent!.name).toBe(`${node.id}__motion__door`)
    const front = hits(root, new Vector3(-0.06, 0.45, 2), new Vector3(-0.06, 0.45, 0))
    expect(front.length).toBeGreaterThan(0)
    expect(front.every((hit) => visibleChain(hit.object))).toBe(true)
    const knobAtRest = knob.getWorldPosition(new Vector3())
    useInteractive.getState().setProceduralParts(node.id as AnyNodeId, ['door', 'knob'], true)
    await renderer.advanceFrames(90, 1 / 60)
    expect(visibleChain(knob)).toBe(true)
    expect(knob.getWorldPosition(new Vector3()).distanceTo(knobAtRest)).toBeGreaterThan(0.1)
    const open = hits(root, new Vector3(-0.2, 0.45, 2), new Vector3(-0.2, 0.45, 0))
    expect(open.every((hit) => visibleChain(hit.object))).toBe(true)
  } finally {
    await renderer.unmount()
    useInteractive.getState().removeProcedural(node.id)
  }
})

test('a continuous joint starts running in the editor', async () => {
  const recipe = structuredClone(jointJson) as Recipe
  recipe.joints![1] = {
    child: 'knob',
    kind: 'continuous',
    origin: [0, 0, 0],
    axis: [0, 0, 1],
    speed: 3,
  }
  const node = install(recipe)
  const renderer = await create(<ProceduralRenderer node={node} />)
  try {
    await renderer.advanceFrames(30, 1 / 60)
    expect(useInteractive.getState().procedural[node.id]?.parts.knob).toBe(true)
    const knob = sceneRegistry.nodes.get(node.id)!.getObjectByName(`${node.id}__motion__knob`)!
    expect(Math.abs(knob.rotation.z)).toBeGreaterThan(0.01)
  } finally {
    await renderer.unmount()
    useInteractive.getState().removeProcedural(node.id)
  }
})

test('hiding and redrawing the rest pose keeps each mesh its own raycast', async () => {
  const node = install(structuredClone(jointJson) as Recipe)
  const renderer = await create(<ProceduralRenderer node={node} />)
  try {
    await renderer.advanceFrames(2, 1 / 60)
    const root = sceneRegistry.nodes.get(node.id)!
    // As SceneBVH installs its accelerated raycast on drawn meshes.
    const accelerated = () => {}
    const meshes: Mesh[] = []
    root.traverse((child) => {
      if (child instanceof Mesh && child.raycast === Mesh.prototype.raycast) meshes.push(child)
    })
    expect(meshes.length).toBeGreaterThan(0)
    for (const mesh of meshes) mesh.raycast = accelerated
    useInteractive.getState().setProceduralParts(node.id as AnyNodeId, ['door'], true)
    await renderer.advanceFrames(90, 1 / 60)
    useInteractive.getState().setProceduralParts(node.id as AnyNodeId, ['door'], false)
    await renderer.advanceFrames(90, 1 / 60)
    expect(meshes.every((mesh) => mesh.raycast === accelerated)).toBe(true)
  } finally {
    await renderer.unmount()
    useInteractive.getState().removeProcedural(node.id)
  }
})

test('a sibling added to its level neither re-renders nor re-dirties a floor design', async () => {
  const node = install(structuredClone(jointJson) as Recipe)
  const renderer = await create(<ProceduralRenderer node={node} />)
  try {
    await renderer.advanceFrames(2, 1 / 60)
    useScene.getState().clearDirty(node.id as AnyNodeId)
    await act(async () => {
      useScene.setState((state) => ({
        nodes: { ...state.nodes, [level.id]: { ...level, children: ['item_sibling'] } as AnyNode },
      }))
    })
    expect(useScene.getState().dirtyNodes.has(node.id as AnyNodeId)).toBe(false)
  } finally {
    await renderer.unmount()
    useInteractive.getState().removeProcedural(node.id)
  }
})
