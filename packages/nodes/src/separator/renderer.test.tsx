import { afterEach, expect, test } from 'bun:test'
import { SeparatorNode, sceneRegistry, useScene, ZoneNode } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { builtinPlugin } from '@pascal-app/nodes'
import { renderPlugin } from '@pascal-app/nodes/render'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'

const originalScene = useScene.getState()
const originalEditor = useEditor.getState()
const originalViewer = useViewer.getState()
afterEach(() => {
  useScene.setState(originalScene)
  useEditor.setState(originalEditor)
  useViewer.setState(originalViewer)
})

test.each([
  ['render', renderPlugin],
  ['full', builtinPlugin],
] as const)(
  '%s separator follows viewer room selection and standalone selection',
  async (_entry, plugin) => {
    const node = SeparatorNode.parse({ start: [0, 0], end: [2, 0] })
    const zone = ZoneNode.parse({
      name: 'Room',
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
      boundarySeparatorIds: [node.id],
      floor: { elevation: 0.6 },
    })
    useScene.setState({ nodes: { [node.id]: node, [zone.id]: zone } })
    useEditor.setState({ room: null })
    useViewer.getState().setSelection({ zoneId: zone.id, selectedIds: [] })
    const source = plugin.nodes!.find((definition) => definition.kind === 'separator')!.renderer!
    if (source.kind !== 'parametric') throw new Error('Expected parametric separator')
    const { default: Renderer } = await source.module()
    const renderer = await create(<Renderer node={node} />)
    const group = () => sceneRegistry.nodes.get(node.id)!
    try {
      expect(group().visible).toBe(true)
      expect(group().children[0]!.position.y).toBeCloseTo(0.62)
      await act(async () => useViewer.getState().setSelection({ zoneId: null, selectedIds: [] }))
      expect(group().visible).toBe(false)
      await act(async () => useViewer.getState().setSelection({ selectedIds: [node.id] }))
      expect(group().visible).toBe(true)
      expect(group().children[0]!.position.y).toBeCloseTo(0.62)
    } finally {
      await renderer.unmount()
    }
  },
)

test('the full separator renderer gives editor room focus precedence over viewer selection', async () => {
  const node = SeparatorNode.parse({ start: [0, 0], end: [2, 0] })
  const viewerZone = ZoneNode.parse({
    name: 'Room',
    polygon: [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ],
    boundarySeparatorIds: [],
    floor: { elevation: 0.2 },
  })
  const focused = ZoneNode.parse({
    name: 'Room',
    polygon: [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ],
    boundarySeparatorIds: [node.id],
    floor: { elevation: 1.2 },
  })
  useScene.setState({
    nodes: { [node.id]: node, [viewerZone.id]: viewerZone, [focused.id]: focused },
  })
  useViewer.getState().setSelection({ zoneId: viewerZone.id, selectedIds: [] })
  useEditor.setState({ room: { levelId: 'level_focus', zoneId: focused.id } })
  const source = builtinPlugin.nodes!.find((definition) => definition.kind === 'separator')!
    .renderer!
  if (source.kind !== 'parametric') throw new Error('Expected parametric separator')
  const { default: Renderer } = await source.module()
  const renderer = await create(<Renderer node={node} />)
  try {
    const group = sceneRegistry.nodes.get(node.id)!
    expect(group.visible).toBe(true)
    expect(group.children[0]!.position.y).toBeCloseTo(1.22)
    await act(async () => useEditor.setState({ room: null }))
    expect(group.visible).toBe(false)
  } finally {
    await renderer.unmount()
  }
})
