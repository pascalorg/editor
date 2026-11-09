import { expect, test } from 'bun:test'
import { sceneRegistry, ZoneNode } from '@pascal-app/core'
import { Group } from 'three'
import { prepareSceneForExport } from './glb-export'

test('GLB zone identity carries holes for the baked viewer even when zone visuals are unmounted', () => {
  const zone = ZoneNode.parse({
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
  const root = new Group()
  const identity = new Group()
  root.add(identity)
  sceneRegistry.nodes.set(zone.id, identity)
  try {
    const result = prepareSceneForExport(root, { [zone.id]: zone })
    try {
      expect(result.scene.getObjectByName(zone.id)!.userData).toMatchObject({
        polygon: zone.polygon,
        holes: zone.holes,
      })
    } finally {
      result.dispose()
    }
  } finally {
    sceneRegistry.nodes.delete(zone.id)
  }
})
