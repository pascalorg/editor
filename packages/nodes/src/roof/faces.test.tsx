import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  BaseNode,
  clearSceneHistory,
  LevelNode,
  nodeRegistry,
  nodeType,
  objectId,
  RoofNode,
  RoofSegmentNode,
  registerNode,
  sceneRegistry,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { NodeRenderer, RoofSystem, useGeometryStatus } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { useRef } from 'react'
import { type Group, type Mesh, type Object3D, Vector3 } from 'three'
import { z } from 'zod'
import { builtinPlugin } from '../index'

// An architect's solved roof plane is a plugin kind that roofs: its roof holds it beside its
// segments, merges only the segments into its shell and draws the plane through the plane's own
// renderer, in the roof's frame.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

const RoofPlane = BaseNode.extend({
  id: objectId('roofplane'),
  type: nodeType('test:roof-plane'),
  /** A level-frame rectangle [x0, z0, x1, z1] at a height: enough for a frame to be read. */
  rect: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  height: z.number(),
})
type RoofPlane = z.infer<typeof RoofPlane>

/** Draws the plane as stored, in whatever frame holds it, as the plugin's renderer does. */
function RoofPlaneRenderer({ node }: { node: AnyNode }) {
  const ref = useRef<Group>(null!)
  useRegistry(node.id, node.type, ref)
  const { rect, height } = node as unknown as RoofPlane
  return (
    <group ref={ref} visible={node.visible}>
      <mesh name="plane" position={[(rect[0] + rect[2]) / 2, height, (rect[1] + rect[3]) / 2]}>
        <boxGeometry args={[rect[2] - rect[0], 0.1, rect[3] - rect[1]]} />
      </mesh>
    </group>
  )
}

const roofPlaneDefinition = {
  kind: 'test:roof-plane',
  schemaVersion: 1,
  schema: RoofPlane,
  category: 'structure',
  defaults: () => ({}),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    roofs: {
      outline: (node: AnyNode) => {
        const [x0, z0, x1, z1] = (node as unknown as RoofPlane).rect
        return [
          [x0, z0],
          [x1, z0],
          [x1, z1],
          [x0, z1],
        ]
      },
      heightAt: (node: AnyNode) => (node as unknown as RoofPlane).height,
    },
  },
  renderer: { kind: 'parametric', module: async () => ({ default: RoofPlaneRenderer }) },
} as unknown as AnyNodeDefinition

type Renderer = Awaited<ReturnType<typeof create>>
let renderer: Renderer | null = null
let restoreRegistry: () => void = () => {}
const previousScene = useScene.getState()

function LevelChildren({ levelId }: { levelId: AnyNodeId }) {
  const children = useScene(
    (state) => (state.nodes[levelId] as { children?: AnyNodeId[] } | undefined)?.children ?? [],
  )
  return (
    <>
      {children.map((id) => (
        <NodeRenderer key={id} nodeId={id} />
      ))}
    </>
  )
}

async function frame() {
  await act(async () => {
    await renderer?.advanceFrames(1, 1 / 60)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function until(done: () => boolean) {
  for (let i = 0; i < 400 && !done(); i++) await frame()
  expect(done()).toBe(true)
}

const object = (id: string): Object3D | undefined => sceneRegistry.nodes.get(id)
const worldOf = (target: Object3D | undefined) => {
  target?.updateWorldMatrix(true, false)
  const at = target?.getWorldPosition(new Vector3())
  return at ? [at.x, at.y, at.z].map((v) => Math.round(v * 1000) / 1000) : null
}
const shownInWorld = (target: Object3D | undefined) => {
  for (let at = target; at; at = at.parent ?? undefined) if (!at.visible) return false
  return target !== undefined
}

/** A roof at its level's origin holding a 6 × 4 m gable segment and a plane beside it. */
async function architectRoof() {
  const level = LevelNode.parse({ id: 'level_roof', level: 0, children: [] })
  useScene.getState().setScene({ [level.id]: level as AnyNode }, [level.id as AnyNodeId], {
    installedPlugins: [],
    hasExplicitPluginInstallState: false,
  })
  clearSceneHistory()
  renderer = await create(
    <>
      <LevelChildren levelId={level.id as AnyNodeId} />
      <RoofSystem />
    </>,
  )
  const roof = RoofNode.parse({ id: 'roof_main', children: [] })
  const segment = RoofSegmentNode.parse({ id: 'rseg_main', width: 6, depth: 4 })
  const plane = RoofPlane.parse({ id: 'roofplane_tower', rect: [4, -2, 8, 2], height: 3 })
  await act(async () => {
    useScene.getState().createNode(roof as AnyNode, level.id as AnyNodeId)
    useScene.getState().createNodes([
      { node: segment as AnyNode, parentId: roof.id as AnyNodeId },
      { node: plane as unknown as AnyNode, parentId: roof.id as AnyNodeId },
    ])
  })
  await until(() => object(plane.id) !== undefined)
  return { roof, segment, plane }
}

beforeEach(() => {
  restoreRegistry = nodeRegistry._snapshot()
  for (const definition of builtinPlugin.nodes ?? []) registerNode(definition)
  registerNode(roofPlaneDefinition)
})

afterEach(async () => {
  await renderer?.unmount()
  renderer = null
  restoreRegistry()
  useScene.setState(previousScene)
  sceneRegistry.clear()
})

describe('a roof holding a plane of a kind that roofs', () => {
  test('draws the plane through its own renderer in the roof frame, and merges only its segment', async () => {
    const { roof, plane } = await architectRoof()
    const planeObject = object(plane.id)!
    let holder: Object3D | null = planeObject.parent
    while (holder && holder !== object(roof.id)) holder = holder.parent
    expect(holder).toBe(object(roof.id)!)
    // At the level's origin the roof's frame is the level's: the plane stands where it is stored.
    expect(worldOf(planeObject.getObjectByName('plane'))).toEqual([6, 3, 0])
    expect(shownInWorld(planeObject)).toBe(true)

    const shell = () => object(roof.id)?.getObjectByName('merged-roof') as Mesh | undefined
    await until(() => (shell()?.geometry.getAttribute('position').count ?? 0) > 3)
    expect(useGeometryStatus.getState().failures.has(roof.id)).toBe(false)
  })

  test('moving and turning the roof carries the plane; hiding it hides the plane', async () => {
    const { roof, plane } = await architectRoof()
    await act(async () => {
      useScene.getState().updateNode(roof.id, { position: [10, 1, 5], rotation: Math.PI / 2 })
    })
    await frame()
    // A quarter turn takes the roof's (6, 0) to (0, -6), then the roof's place: (10, 4, -1).
    expect(worldOf(object(plane.id)?.getObjectByName('plane'))).toEqual([10, 4, -1])

    await act(async () => {
      useScene.getState().updateNode(roof.id, { visible: false })
    })
    await frame()
    expect(shownInWorld(object(plane.id))).toBe(false)
  })

  test('deleting the roof deletes the plane with it', async () => {
    const { roof, plane } = await architectRoof()
    await act(async () => {
      useScene.getState().deleteNode(roof.id)
    })
    await frame()
    expect(useScene.getState().nodes[plane.id as AnyNodeId]).toBeUndefined()
    expect(object(plane.id)).toBeUndefined()
  })
})
