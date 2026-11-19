import { beforeEach, expect, test } from 'bun:test'
import {
  clearSceneHistory,
  LawnNode,
  SiteNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  sceneLayout,
  TOOL_DRAFT_FILL_OPACITY,
  TOOL_PREVIEW_COLOR,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import type { BufferGeometry, Mesh, MeshBasicMaterial } from 'three'
import { Vector3 } from 'three'
import { installMountedScene, mount, settle } from '../__tests__/harness'
import { lawnDefinition } from './definition'
import LawnSelectionAffordance from './definition.edit-boundary'

// A selected lawn must be readable as an area: its grass alone hides where it ends.
installMountedScene({ nodes: [lawnDefinition] })

const outline: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]
let lawn: LawnNode
beforeEach(() => {
  const site = SiteNode.parse({})
  lawn = LawnNode.parse({ parentId: site.id, outline })
  useScene.setState({
    nodes: { [site.id]: { ...site, children: [lawn.id] }, [lawn.id]: lawn },
    rootNodeIds: [site.id],
    dirtyNodes: new Set(),
    readOnly: false,
  })
  clearSceneHistory()
  useInteractionScope.getState().end()
  useLiveNodeOverrides.getState().clearAll()
  useEditor.setState({
    mode: 'select',
    tool: null,
    workspaceMode: 'edit',
    viewLayouts: { edit: sceneLayout('3d') },
  })
  useViewer.getState().setSelection({ selectedIds: [lawn.id] })
  window.requestAnimationFrame = globalThis.requestAnimationFrame
  window.cancelAnimationFrame = globalThis.cancelAnimationFrame
})

test("a selected lawn shows its area in the editor's preview colour, with its handles standing on its ground", async () => {
  const renderer = await mount(<LawnSelectionAffordance node={lawn} readOnly={false} />)
  await settle(renderer)
  const fills = renderer.scene
    .findAll((entry) => (entry.instance as Mesh).isMesh === true)
    .map((entry) => entry.instance as Mesh<BufferGeometry, MeshBasicMaterial>)
    .filter((mesh) => mesh.material?.opacity === TOOL_DRAFT_FILL_OPACITY)
  expect(fills).toHaveLength(1)
  const fill = fills[0]
  if (!fill) throw new Error('Missing the selected area')
  expect(`#${fill.material.color.getHexString()}`).toBe(TOOL_PREVIEW_COLOR)
  // The four corners of the outline, on the flat Site ground (5 cm under the datum), as two triangles.
  const corners = fill.geometry.getAttribute('position')
  expect(corners.count).toBe(4)
  expect(fill.geometry.getIndex()?.count).toBe(6)
  for (const [index, [x, z]] of outline.entries()) {
    expect(corners.getX(index)).toBeCloseTo(x, 6)
    expect(corners.getZ(index)).toBeCloseTo(z, 6)
    expect(corners.getY(index)).toBeCloseTo(-0.01, 6)
  }
  // Every handle is a short marker on that ground, not a post from the world datum.
  const handles = renderer.scene.findAll((entry) => typeof entry.props.onPointerDown === 'function')
  expect(handles.length).toBeGreaterThanOrEqual(outline.length)
  for (const handle of handles) {
    const y = handle.instance.getWorldPosition(new Vector3()).y
    expect(y).toBeGreaterThan(-0.05)
    expect(y).toBeLessThan(0.25)
  }
})
