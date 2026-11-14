import { expect, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  containsPoint,
  GeometryArtifactManifest,
  LevelNode,
  SlabNode,
  sceneRegistry,
  useScene,
  ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { act, create } from '@react-three/test-renderer'
import type { ReactNode } from 'react'
import { DoubleSide, type Mesh, Raycaster, Vector3 } from 'three'
import { ZoneRenderer } from './renderer'

test('1000 hidden rooms allocate no geometry, material, or HTML; toggling creates and disposes visuals', async () => {
  const previous = useViewer.getState()
  const html = spyOn(
    Html as unknown as { render: (props: any) => ReactNode },
    'render',
  ).mockImplementation(() => null)
  const zone = ZoneNode.parse({
    id: 'zone_visible',
    name: 'Hall',
    polygon: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    holes: [
      [
        [3, 3],
        [7, 3],
        [7, 7],
        [3, 7],
      ],
    ],
  })
  useViewer.setState({ showZones: false })
  const renderer = await create(
    <group>
      {Array.from({ length: 1000 }, (_, i) => (
        <ZoneRenderer key={i} node={{ ...zone, id: `zone_${i}` }} />
      ))}
    </group>,
  )
  try {
    expect(html).not.toHaveBeenCalled()
    for (let i = 0; i < 1000; i++)
      expect(sceneRegistry.nodes.get(`zone_${i}`)!.children).toHaveLength(0)
    await renderer.update(<ZoneRenderer node={zone} />)
    await act(async () => useViewer.setState({ showZones: true }))
    const root = sceneRegistry.nodes.get(zone.id)!
    const floor = root.getObjectByName('floor') as Mesh
    const borders = root.getObjectByName('walls') as Mesh
    expect(floor).toBeDefined()
    expect(html).toHaveBeenCalledTimes(1)
    const position = html.mock.calls[0]![0].position
    expect(
      containsPoint([{ outer: zone.polygon, holes: zone.holes }], [position[0], position[2]]),
    ).toBe(true)
    floor.updateWorldMatrix(true, false)
    const ray = new Raycaster(new Vector3(5, 10, 5), new Vector3(0, -1, 0))
    ray.layers.mask = floor.layers.mask
    expect(ray.intersectObject(floor)).toHaveLength(0)
    ray.ray.origin.set(1, 10, 1)
    expect(ray.intersectObject(floor).length).toBeGreaterThan(0)
    const material = Array.isArray(floor.material) ? floor.material[0]! : floor.material
    expect(material.side).toBe(DoubleSide)
    const disposeMaterial = spyOn(material, 'dispose')
    const disposeBorders = spyOn(borders.geometry, 'dispose')
    await act(async () => useViewer.setState({ showZones: false }))
    expect(root.children).toHaveLength(0)
    expect(disposeMaterial).toHaveBeenCalled()
    expect(disposeBorders).toHaveBeenCalled()
  } finally {
    await renderer.unmount()
    html.mockRestore()
    useViewer.setState(previous, true)
  }
})

test("a room's floor script stands its y = 0 on the floor plate's top, and follows the plate", async () => {
  const previous = { viewer: useViewer.getState(), scene: useScene.getState() }
  const polygon: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ]
  const zone = ZoneNode.parse({
    id: 'zone_floor_script',
    name: 'Study',
    parentId: 'level_floor_script',
    polygon,
    floor: {
      script: {
        kind: 'script',
        script: 'a'.repeat(64),
        artifact: 'b'.repeat(64),
        manifest: GeometryArtifactManifest.parse({
          bounds: { min: [0, 0, 0], max: [4, 0.01, 3] },
          triangles: 12,
        }),
        inputs: 'c'.repeat(16),
      },
    },
  })
  const plate = (elevation: number) =>
    SlabNode.parse({
      id: 'slab_floor_script',
      parentId: 'level_floor_script',
      polygon,
      zoneIds: [zone.id],
      elevation,
      thickness: elevation,
    })
  const level = LevelNode.parse({ id: 'level_floor_script', children: [zone.id, plate(0).id] })
  const scene = (...nodes: AnyNode[]) =>
    useScene.setState({
      nodes: Object.fromEntries([level, zone, ...nodes].map((node) => [node.id, node])),
    } as never)
  useViewer.setState({ showZones: false })
  scene(plate(0.3))
  const renderer = await create(<ZoneRenderer node={zone} />)
  try {
    const root = sceneRegistry.nodes.get(zone.id)!
    expect(root.children).toHaveLength(1)
    expect(root.children[0]!.position.y).toBeCloseTo(0.301, 6)
    await act(async () => scene(plate(0.6)))
    expect(root.children[0]!.position.y).toBeCloseTo(0.601, 6)
    await act(async () => scene())
    expect(root.children).toHaveLength(0)
  } finally {
    await renderer.unmount()
    useViewer.setState(previous.viewer, true)
    useScene.setState(previous.scene, true)
  }
})
