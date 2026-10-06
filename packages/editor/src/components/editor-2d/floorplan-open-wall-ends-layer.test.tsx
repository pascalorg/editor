import { expect, test } from 'bun:test'
import { type AnyNode, LevelNode, useScene, WallNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { act } from '@react-three/fiber'
import useEditor from '../../store/use-editor'
import useInteractionScope from '../../store/use-interaction-scope'
import { withSelectionHarness } from '../../test-utils/selection-harness'
import { FloorplanOpenWallEndsLayer } from './floorplan-open-wall-ends-layer'

test('hidden open-end overlays do not read 2,000 walls during moves, handles, any reshape, or 3D', async () => {
  await withSelectionHarness(async ({ render }) => {
    const wall = WallNode.parse({ id: 'wall_a', parentId: 'level_a', start: [0, 0], end: [2, 0] })
    const walls = [
      wall,
      ...Array.from({ length: 1999 }, (_, index) => ({
        ...wall,
        id: `wall_${index}` as typeof wall.id,
        start: [index * 4 + 4, 0] as [number, number],
        end: [index * 4 + 6, 0] as [number, number],
      })),
    ]
    const level = LevelNode.parse({ id: 'level_a', children: walls.map((node) => node.id) })
    let reads = 0
    const nodes = new Proxy<Record<string, AnyNode>>(
      Object.fromEntries([level, ...walls].map((node) => [node.id, node])),
      {
        get(target, key, receiver) {
          reads++
          return Reflect.get(target, key, receiver)
        },
      },
    )
    useScene.setState({ nodes })
    useViewer.setState({
      selection: { buildingId: null, levelId: level.id, zoneId: null, selectedIds: [] },
    })
    useEditor.setState({ viewMode: '2d', mode: 'build', tool: 'wall' })
    const scopes: ReturnType<typeof useInteractionScope.getState>['scope'][] = [
      { kind: 'moving', node: wall, nodeId: wall.id, nodeType: 'wall', view: '2d' },
      {
        kind: 'placing',
        node: wall,
        nodeId: wall.id,
        nodeType: 'wall',
        view: '2d',
        pressDrag: false,
        driver: 'move-tool',
      },
      { kind: 'handle-drag', nodeId: wall.id, handle: 'height' },
      ...(
        ['endpoint', 'curve', 'control-point', 'tangent', 'boundary', 'hole', 'split'] as const
      ).map((reshape) => ({
        kind: 'reshaping' as const,
        reshape,
        nodeId: wall.id,
        driver: 'floorplan' as const,
      })),
    ]
    for (const scope of scopes) {
      await act(async () => useInteractionScope.setState({ scope }))
      reads = 0
      await render(<FloorplanOpenWallEndsLayer />)
      expect(reads).toBe(0)
    }
    await act(async () => {
      useEditor.setState({ viewMode: '3d' })
      useInteractionScope.setState({ scope: { kind: 'idle' } })
    })
    reads = 0
    await render(<FloorplanOpenWallEndsLayer />)
    expect(reads).toBe(0)
  })
})
