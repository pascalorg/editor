import { afterEach, expect, test } from 'bun:test'
import {
  DuctFittingNode,
  DuctSegmentNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  useScene,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Quaternion, Vector3 } from 'three'
import { ductSegmentDefinition } from '../duct-segment/definition'
import { ductFittingToolOptions } from '../shared/fitting-tool-options'
import { ductFittingDefinition } from './definition'
import { buildDuctFittingGeometry } from './geometry'
import { getDuctFittingPorts } from './ports'
import { resolvePlacement } from './tool'

const scene = useScene.getState()
const editor = useEditor.getState()
const viewer = useViewer.getState()
afterEach(() => {
  useScene.setState(scene)
  useEditor.setState(editor)
  useViewer.setState(viewer)
})
if (!nodeRegistry.has('duct-segment')) registerNode(ductSegmentDefinition)
if (!nodeRegistry.has('duct-fitting')) registerNode(ductFittingDefinition)

for (const surface of [true, false]) {
  test(`hover previews round-to-rectangular before click in ${surface ? '3D' : '2D'}`, () => {
    const level = LevelNode.parse({})
    const run = DuctSegmentNode.parse({
      parentId: level.id,
      shape: 'round',
      diameter: 12,
      path: [
        [0, 2, 0],
        [3, 2, 0],
      ],
    })
    useScene.setState({ nodes: { [level.id]: level, [run.id]: run } })
    useViewer.setState({ selection: { ...viewer.selection, levelId: level.id } })
    useEditor.getState().setMode('build')
    useEditor.getState().setTool('duct-fitting')
    useEditor.getState().setToolDefaults('duct-fitting', null)
    ductFittingToolOptions.find((option) => option.id === 'fittingType')!.set('transition')
    const preview = DuctFittingNode.parse({
      ...ductFittingDefinition.defaults(),
      ...useEditor.getState().toolDefaults['duct-fitting'],
    })
    const before = useScene.getState().nodes
    const placement = resolvePlacement(
      [3, surface ? 2 : 0, 0],
      preview,
      0.5,
      new Quaternion(),
      surface,
    )
    expect(placement.snapPort?.nodeId).toBe(run.id)
    expect(placement.node.fittingType).toBe('transition')
    const ports = getDuctFittingPorts({
      ...placement.node,
      position: placement.position,
      rotation: placement.rotation,
    })
    expect(ports.map((port) => port.shape)).toEqual(['round', 'rect'])
    expect(new Vector3(...ports[0]!.position).distanceTo(new Vector3(3, 2, 0))).toBeLessThan(1e-6)
    expect(
      buildDuctFittingGeometry(placement.node).getObjectByName('fitting-flange-outlet'),
    ).toBeDefined()
    expect(useScene.getState().nodes).toBe(before)
  })
}
