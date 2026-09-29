import { expect, spyOn, test } from 'bun:test'
import { containsPoint, sceneRegistry, ZoneNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { act, create } from '@react-three/test-renderer'
import type { ReactNode } from 'react'
import { DoubleSide, type Mesh, Raycaster, Vector3 } from 'three'
import { ZoneRenderer } from './renderer'

if (process.env.PASCAL_ZONE_RENDERER_ISOLATED !== '1') {
  test('zone renderer holes and hidden-layer allocation with production modules', async () => {
    const child = Bun.spawn([process.execPath, 'test', 'src/zone/renderer.test.tsx'], {
      cwd: new URL('../..', import.meta.url).pathname,
      env: { ...process.env, PASCAL_ZONE_RENDERER_ISOLATED: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (code) console.log(stdout, stderr)
    expect(code).toBe(0)
  }, 30_000)
} else {
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
}
